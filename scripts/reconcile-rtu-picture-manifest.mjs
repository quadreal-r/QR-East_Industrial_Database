/**
 * Reconcile RTU picture manifest with Cloudflare R2 storage and GitHub copy.
 *
 * 1. Prefer listing the R2 images bucket via S3 API when credentials work.
 * 2. Otherwise verify manifest filenames on the public CDN (HEAD requests).
 * 3. Build a fresh manifest from files that actually exist on R2.
 * 4. Write public/database/rtu-pictures/manifest.json and upload to the JSON bucket.
 *
 * Usage:
 *   node scripts/reconcile-rtu-picture-manifest.mjs
 *   node scripts/reconcile-rtu-picture-manifest.mjs --dry-run
 *   node scripts/reconcile-rtu-picture-manifest.mjs --skip-upload
 *   node scripts/reconcile-rtu-picture-manifest.mjs --sync-supabase
 *   node scripts/reconcile-rtu-picture-manifest.mjs --sync-supabase --dry-run
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  buildManifestFromFileNames,
  collectManifestFileNames,
  diffManifestFileNames,
} from './lib/build-manifest-from-files.mjs'
import { getProjectRoot, loadDotEnvLocal } from './lib/load-dotenv-local.mjs'
import { isImageFileName } from './lib/rtu-picture-filename.mjs'
import {
  isR2Configured,
  isR2JsonConfigured,
  listR2PictureFileNames,
  uploadJsonFileToR2,
} from './lib/r2-client.mjs'
import { alternateCdnFileNames } from './lib/cloud-picture-filename.mjs'
import {
  isSupabaseServiceConfigured,
  syncSupabasePicturesWithR2,
} from './lib/sync-rtu-pictures-supabase.mjs'

const ROOT = getProjectRoot()
const MANIFEST_PATH = join(ROOT, 'public', 'database', 'rtu-pictures', 'manifest.json')

function parseArgs(argv) {
  let dryRun = false
  let skipUpload = false
  let syncSupabase = false
  for (const arg of argv.slice(2)) {
    if (arg === '--dry-run') dryRun = true
    if (arg === '--skip-upload') skipUpload = true
    if (arg === '--sync-supabase') syncSupabase = true
  }
  return { dryRun, skipUpload, syncSupabase }
}

function normalizeBaseUrl(url) {
  if (!url) return ''
  return url.endsWith('/') ? url : `${url}/`
}

async function fetchJsonManifest(url) {
  try {
    const response = await fetch(url, { cache: 'no-store' })
    if (!response.ok) return null
    return await response.json()
  } catch {
    return null
  }
}

async function verifyFilesOnCdn(fileNames, cdnBase, concurrency = 32) {
  const exists = new Set()
  const missing = []
  const queue = [...fileNames]

  async function worker() {
    while (queue.length) {
      const fileName = queue.shift()
      if (!fileName) continue
      const url = `${cdnBase}${encodeURIComponent(fileName)}`
      try {
        const response = await fetch(url, { method: 'HEAD', cache: 'no-store' })
        if (response.ok) exists.add(fileName)
        else missing.push(fileName)
      } catch {
        missing.push(fileName)
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()))
  return { exists, missing }
}

/** Resolve manifest entries to filenames that actually exist on the CDN. */
async function resolveManifestEntriesOnCdn(manifest, cdnBase) {
  const resolvedByKey = new Map()
  const unresolved = []

  for (const [rtuKey, fileNames] of Object.entries(manifest?.entries ?? {})) {
    const resolved = []
    for (const fileName of fileNames) {
      const candidates = alternateCdnFileNames(fileName, rtuKey)
      let found = null
      for (const candidate of candidates) {
        const url = `${cdnBase}${encodeURIComponent(candidate)}`
        try {
          const response = await fetch(url, { method: 'HEAD', cache: 'no-store' })
          if (response.ok) {
            found = candidate
            break
          }
        } catch {
          /* try next candidate */
        }
      }
      if (found) resolved.push(found)
      else unresolved.push({ rtuKey, fileName, candidates })
    }
    if (resolved.length) resolvedByKey.set(rtuKey, [...new Set(resolved)])
  }

  const exists = new Set()
  for (const files of resolvedByKey.values()) {
    for (const fileName of files) exists.add(fileName)
  }
  return { exists, unresolved, resolvedByKey }
}

function printManifestStats(label, manifest) {
  const names = collectManifestFileNames(manifest)
  const rtus = Object.keys(manifest?.entries ?? {}).length
  console.log(`  ${label}: ${rtus} RTU(s), ${names.size} picture file(s)`)
}

async function main() {
  loadDotEnvLocal()
  const { dryRun, skipUpload, syncSupabase } = parseArgs(process.argv)

  const cdnBase = normalizeBaseUrl(
    process.env.VITE_RTU_PICTURES_BASE_URL ?? process.env.R2_PUBLIC_URL,
  )
  const jsonBase = normalizeBaseUrl(process.env.VITE_JSON_DATA_BASE_URL)

  const githubManifest = existsSync(MANIFEST_PATH)
    ? JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'))
    : { entries: {} }
  const cloudJsonManifest = jsonBase
    ? await fetchJsonManifest(`${jsonBase}manifest.json`)
    : null

  console.log('=== RTU picture manifest reconciliation ===\n')
  printManifestStats('GitHub (local)', githubManifest)
  if (cloudJsonManifest) printManifestStats('Cloudflare JSON bucket', cloudJsonManifest)
  else console.log('  Cloudflare JSON bucket: (not configured or unreachable)')

  const githubNames = collectManifestFileNames(githubManifest)
  const cloudJsonNames = collectManifestFileNames(cloudJsonManifest ?? { entries: {} })
  const unionNames = new Set([...githubNames, ...cloudJsonNames])
  console.log(`\nUnique filenames across GitHub + Cloudflare JSON: ${unionNames.size}`)

  let sourceFiles = null
  let sourceLabel = ''

  if (isR2Configured()) {
    try {
      const listed = await listR2PictureFileNames()
      sourceFiles = listed.filter(isImageFileName)
      sourceLabel = 'R2 bucket listing (S3 API)'
      console.log(`\nListed ${sourceFiles.length} image file(s) from ${sourceLabel}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.warn(`\nR2 bucket listing failed: ${message}`)
      if (String(process.env.R2_ACCOUNT_ID ?? '').startsWith('cfat_')) {
        console.warn(
          '  Hint: R2_ACCOUNT_ID looks like an API token. Use your 32-character Account ID from',
          'Cloudflare Dashboard → Workers & Pages → Overview → Account ID.',
        )
      }
    }
  } else {
    console.warn('\nR2 S3 credentials not configured — will verify via public CDN instead.')
  }

  if (!sourceFiles?.length) {
    if (!cdnBase) {
      console.error('Set VITE_RTU_PICTURES_BASE_URL in .env.local to verify files on CDN.')
      process.exit(1)
    }
    console.log(`\nResolving manifest entries on CDN ${cdnBase} (with legacy name aliases)...`)

    const mergedEntries = { ...(githubManifest.entries ?? {}) }
    for (const [key, files] of Object.entries(cloudJsonManifest?.entries ?? {})) {
      const list = mergedEntries[key] ?? []
      mergedEntries[key] = [...new Set([...list, ...files])]
    }

    const { exists, unresolved } = await resolveManifestEntriesOnCdn(
      { entries: mergedEntries },
      cdnBase,
    )
    sourceFiles = [...exists]
    sourceLabel = 'CDN resolution (manifest + legacy aliases)'
    console.log(`  Resolved on CDN: ${exists.size}`)
    console.log(`  Unresolved manifest entries: ${unresolved.length}`)
    if (unresolved.length) {
      console.log('\n  Unresolved samples (first 15):')
      for (const row of unresolved.slice(0, 15)) {
        console.log(`    ${row.rtuKey} → ${row.fileName}`)
      }
    }
  }

  const build = buildManifestFromFileNames(sourceFiles, ROOT, { keepAllFiles: true })
  const newManifest = build.manifest
  const newNames = collectManifestFileNames(newManifest)
  const r2ImageFiles = sourceFiles.filter(isImageFileName)

  console.log(`\nBuilt manifest from ${sourceLabel}`)
  console.log(`  Matched: ${build.pictureCount} picture(s) on ${build.rtuCount} RTU(s)`)
  console.log(`  Unmatched on R2/CDN: ${build.unmatched.length}`)
  console.log(`  Index conflicts skipped: ${build.slotConflicts.length}`)

  const githubDiff = diffManifestFileNames(githubNames, newNames)
  const cloudDiff = diffManifestFileNames(cloudJsonNames, newNames)

  console.log('\nChanges vs GitHub manifest:')
  console.log(`  Added: ${githubDiff.added.length}`)
  console.log(`  Removed: ${githubDiff.removed.length}`)
  if (githubDiff.added.length) {
    console.log('  Added samples:', githubDiff.added.slice(0, 10).join(', '))
  }
  if (githubDiff.removed.length) {
    console.log('  Removed samples:', githubDiff.removed.slice(0, 10).join(', '))
  }

  if (cloudJsonManifest) {
    console.log('\nChanges vs Cloudflare JSON manifest:')
    console.log(`  Added: ${cloudDiff.added.length}`)
    console.log(`  Removed: ${cloudDiff.removed.length}`)
  }

  const onCdnNotInNew = [...unionNames].filter((name) => !newNames.has(name))
  if (onCdnNotInNew.length) {
    console.log(
      `\n${onCdnNotInNew.length} filename(s) were in old manifest(s) but not matched to an RTU or not on CDN.`,
    )
  }

  if (dryRun) {
    console.log('\nDry run — manifest not written or uploaded.')
    if (syncSupabase) {
      if (!isSupabaseServiceConfigured()) {
        console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY for --sync-supabase.')
        process.exit(1)
      }
      const preview = await syncSupabasePicturesWithR2(newManifest, r2ImageFiles, { dryRun: true })
      console.log('\nSupabase sync preview (--sync-supabase):')
      console.log(`  R2 image files: ${preview.r2FileCount}`)
      console.log(`  Supabase rows now: ${preview.supabaseBefore}`)
      console.log(`  Would delete (not on R2): ${preview.deleted}`)
      console.log(`  Would upsert from manifest: ${preview.upserted}`)
      if (preview.orphans.length) {
        console.log('\n  Orphan samples (first 20):')
        for (const row of preview.orphans.slice(0, 20)) {
          console.log(`    ${row.building_address}|${row.rtu_name} → ${row.file_name}`)
        }
      }
    }
    return
  }

  writeFileSync(MANIFEST_PATH, `${JSON.stringify(newManifest, null, 2)}\n`, 'utf8')
  console.log(`\nWrote ${MANIFEST_PATH}`)

  if (syncSupabase) {
    if (!isSupabaseServiceConfigured()) {
      console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY for --sync-supabase.')
      process.exit(1)
    }
    console.log('\nSyncing Supabase rtu_pictures with R2…')
    const sync = await syncSupabasePicturesWithR2(newManifest, r2ImageFiles)
    console.log(`  Deleted ${sync.deleted} orphan row(s) (file not on R2)`)
    console.log(`  Upserted ${sync.upserted} row(s) from manifest`)
    console.log(`  Supabase before: ${sync.supabaseBefore} → after: ${sync.supabaseBefore - sync.deleted}`)
    if (sync.orphans.length) {
      console.log('\n  Removed from Supabase:')
      for (const row of sync.orphans.slice(0, 20)) {
        console.log(`    ${row.file_name}`)
      }
      if (sync.orphans.length > 20) {
        console.log(`    … and ${sync.orphans.length - 20} more`)
      }
    }
  }

  if (skipUpload) {
    console.log('Skipped JSON bucket upload (--skip-upload).')
    return
  }

  if (!isR2JsonConfigured()) {
    console.log('R2 JSON upload not configured — commit manifest.json and run upload-json-to-r2.')
    return
  }

  try {
    const body = readFileSync(MANIFEST_PATH)
    await uploadJsonFileToR2('manifest.json', body)
    console.log('Uploaded manifest.json → Cloudflare JSON bucket')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn(`\nJSON bucket upload failed: ${message}`)
    console.warn('Supabase and local manifest.json are updated. To upload JSON later:')
    console.warn('  npm run upload-json-to-r2')
    if (!syncSupabase) process.exit(1)
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
