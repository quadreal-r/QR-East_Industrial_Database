/**
 * Upload every RTU picture in a folder to Cloudflare R2, merge into manifest.json,
 * sync metadata to Supabase rtu_pictures, upload cloud aliases, and push JSON to R2.
 *
 * Usage:
 *   node scripts/upload-rtu-pictures-from-folder.mjs --dry-run
 *   node scripts/upload-rtu-pictures-from-folder.mjs --from-folder "C:/path/Renamed"
 *   node scripts/upload-rtu-pictures-from-folder.mjs --from-folder "C:/path/Renamed" --skip-existing
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import {
  buildManifestFromFileNames,
  collectManifestFileNames,
  diffManifestFileNames,
} from './lib/build-manifest-from-files.mjs'
import { isImageFileName } from './lib/rtu-picture-filename.mjs'
import {
  getR2PublicBaseUrl,
  guessPictureContentType,
  isR2Configured,
  listR2PictureFileNames,
  uploadRtuPictureToR2,
} from './lib/r2-client.mjs'
import { getProjectRoot, loadDotEnvLocal } from './lib/load-dotenv-local.mjs'
import {
  appendSyncHistoryEntry,
  buildSyncMetaFromDataDir,
  writeSyncMetaFile,
} from './lib/sync-meta.mjs'
import {
  buildPictureRowsFromManifest,
  isSupabaseServiceConfigured,
  upsertPictureManifestToSupabase,
} from './lib/sync-rtu-pictures-supabase.mjs'
import { uploadPortfolioJsonToR2 } from './upload-json-to-r2.mjs'

const ROOT = getProjectRoot()
const PICS_DIR = join(ROOT, 'public', 'database', 'rtu-pictures')
const MANIFEST_PATH = join(PICS_DIR, 'manifest.json')
const DATA_DIR = join(ROOT, 'supabase', 'data')
const REPORT_DIR = join(ROOT, 'reports')

const DEFAULT_FOLDER =
  'C:/Users/Robert/OneDrive - Quadreal Property Group/#OI-Industrial East - @(RTU) Roof Top Units (All Industrial)/RTUs per Building/_RTU-Pictures-All/Renamed'

const IMAGE_EXT = /\.(jpe?g|png|webp|gif|heic|heif|tiff?)$/i

function parseArgs(argv) {
  let fromFolder = DEFAULT_FOLDER
  let dryRun = false
  let skipExisting = false
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--from-folder') fromFolder = argv[++i] ?? fromFolder
    else if (arg === '--dry-run') dryRun = true
    else if (arg === '--skip-existing') skipExisting = true
    else if (!arg.startsWith('-')) fromFolder = arg
  }
  return { fromFolder, dryRun, skipExisting }
}

function collectFromFolder(folderPath) {
  const index = new Map()
  function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (/old/i.test(entry.name)) continue
        walk(full)
      } else if (entry.isFile() && IMAGE_EXT.test(entry.name) && !index.has(entry.name)) {
        index.set(entry.name, full)
      }
    }
  }
  walk(folderPath)
  return index
}

function sortPictureFiles(files) {
  return [...files].sort((a, b) => {
    const indexA = Number(a.match(/\((\d+)\)\.[^.]+$/i)?.[1] ?? a.match(/-(\d+)\.[^.]+$/i)?.[1] ?? 0)
    const indexB = Number(b.match(/\((\d+)\)\.[^.]+$/i)?.[1] ?? b.match(/-(\d+)\.[^.]+$/i)?.[1] ?? 0)
    if (indexA !== indexB) return indexA - indexB
    return a.localeCompare(b)
  })
}

function mergeManifest(existing, folderBuild) {
  const entries = { ...(existing?.entries ?? {}) }
  for (const [key, files] of Object.entries(folderBuild.entries ?? {})) {
    const merged = sortPictureFiles([...new Set([...(entries[key] ?? []), ...files])])
    entries[key] = merged
  }
  return { entries }
}

function runNodeScript(scriptName, args) {
  const scriptPath = join(ROOT, 'scripts', scriptName)
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: ROOT,
    stdio: 'inherit',
    env: process.env,
  })
  if (result.status !== 0) {
    throw new Error(`${scriptName} exited with code ${result.status ?? 'unknown'}`)
  }
}

async function main() {
  loadDotEnvLocal()
  const { fromFolder, dryRun, skipExisting } = parseArgs(process.argv)

  if (!existsSync(fromFolder)) {
    console.error(`Folder not found: ${fromFolder}`)
    process.exit(1)
  }
  if (!isR2Configured()) {
    console.error('R2 is not configured. Set credentials in .env.local')
    process.exit(1)
  }

  const folderIndex = collectFromFolder(fromFolder)
  const fileNames = [...folderIndex.keys()].sort()
  if (!fileNames.length) {
    console.log(`No image files found under ${fromFolder}`)
    return
  }

  console.log(`Source folder: ${fromFolder}`)
  console.log(`Found ${fileNames.length} image file(s)`)

  const existingManifest = existsSync(MANIFEST_PATH)
    ? JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'))
    : { entries: {} }
  const beforeNames = collectManifestFileNames(existingManifest)
  const folderBuild = buildManifestFromFileNames(fileNames, ROOT)
  const mergedManifest = mergeManifest(existingManifest, folderBuild.manifest)
  const afterNames = collectManifestFileNames(mergedManifest)
  const manifestDiff = diffManifestFileNames(beforeNames, afterNames)

  console.log(
    `Manifest: +${manifestDiff.added.length} added, ${folderBuild.pictureCount} matched from folder (${folderBuild.unmatched.length} unmatched)`,
  )

  const r2Names = await listR2PictureFileNames()
  const r2Exact = new Set(r2Names)
  const r2ByLower = new Map(r2Names.map((name) => [name.toLowerCase(), name]))
  const toUpload = fileNames.filter((name) => {
    if (!skipExisting) return true
    return !r2Exact.has(name) && !r2ByLower.has(name.toLowerCase())
  })

  console.log(
    `Upload plan: ${toUpload.length} file(s)${skipExisting ? ` (${fileNames.length - toUpload.length} already on R2)` : ''}`,
  )

  const supabaseRowCount = buildPictureRowsFromManifest(mergedManifest, {
    onlyFileNames: new Set(fileNames),
  }).length
  if (isSupabaseServiceConfigured()) {
    console.log(`Supabase: ${dryRun ? 'would upsert' : 'will upsert'} ${supabaseRowCount} row(s) in rtu_pictures`)
  } else {
    console.warn(
      'Supabase service role not configured — pictures will upload to R2 but will not appear in the app until rtu_pictures is synced.',
    )
  }

  if (dryRun) {
    console.log('\nDry run — sample uploads:')
    for (const name of toUpload.slice(0, 20)) console.log(`  ${name}`)
    if (toUpload.length > 20) console.log(`  … and ${toUpload.length - 20} more`)
    if (manifestDiff.added.length) {
      console.log('\nSample manifest additions:')
      for (const name of manifestDiff.added.slice(0, 15)) console.log(`  ${name}`)
    }
    if (folderBuild.unmatched.length) {
      console.log('\nUnmatched samples:')
      for (const row of folderBuild.unmatched.slice(0, 10)) {
        console.log(`  ${row.fileName} — ${row.reason}`)
      }
    }
    return
  }

  let uploaded = 0
  for (const fileName of toUpload) {
    const filePath = folderIndex.get(fileName)
    const body = readFileSync(filePath)
    await uploadRtuPictureToR2(fileName, body, guessPictureContentType(fileName))
    uploaded += 1
    if (uploaded % 50 === 0 || uploaded === 1 || uploaded === toUpload.length) {
      console.log(`Uploaded ${uploaded}/${toUpload.length}: ${fileName}`)
    }
  }

  writeFileSync(MANIFEST_PATH, `${JSON.stringify(mergedManifest, null, 2)}\n`, 'utf8')
  console.log(`\nWrote ${MANIFEST_PATH}`)

  let supabaseUpserted = 0
  if (isSupabaseServiceConfigured()) {
    console.log('\nSyncing picture metadata to Supabase…')
    const result = await upsertPictureManifestToSupabase(mergedManifest, {
      onlyFileNames: new Set(fileNames),
    })
    supabaseUpserted = result.upserted
    console.log(`Upserted ${supabaseUpserted} row(s) to Supabase rtu_pictures`)
  }

  console.log('\nUploading cloud filename aliases…')
  runNodeScript('upload-rtu-picture-cloud-aliases.mjs', ['--from-folder', fromFolder])

  const syncMetaPath = join(DATA_DIR, 'sync-meta.json')
  const syncMeta = buildSyncMetaFromDataDir(DATA_DIR, PICS_DIR, {
    source: 'renamed-folder-upload',
    preserveExportedAt: true,
  })
  syncMeta.summary = {
    ...syncMeta.summary,
    picturesUploaded: uploaded,
    picturesAdded: manifestDiff.added.length,
    picturesSupabaseUpserted: supabaseUpserted,
  }
  writeSyncMetaFile(syncMetaPath, syncMeta)
  appendSyncHistoryEntry(DATA_DIR, syncMeta)

  try {
    const jsonUpload = await uploadPortfolioJsonToR2()
    console.log(`Uploaded ${jsonUpload.uploaded} JSON file(s) to R2`)
  } catch (error) {
    console.warn(
      `R2 JSON bucket upload skipped: ${error instanceof Error ? error.message : error}`,
    )
    console.warn('The live app reads picture metadata from Supabase, not the R2 JSON bucket.')
  }

  mkdirSync(REPORT_DIR, { recursive: true })
  const stamp = new Date().toISOString().slice(0, 10)
  const reportPath = join(REPORT_DIR, `renamed-folder-upload-${stamp}.json`)
  writeFileSync(
    reportPath,
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        fromFolder,
        folderFileCount: fileNames.length,
        uploaded,
        manifestAdded: manifestDiff.added,
        supabaseUpserted,
        unmatched: folderBuild.unmatched,
      },
      null,
      2,
    )}\n`,
    'utf8',
  )

  const publicBase = getR2PublicBaseUrl()
  console.log(
    `\nDone. Uploaded ${uploaded} picture(s) to R2; manifest +${manifestDiff.added.length}${supabaseUpserted ? `; Supabase ${supabaseUpserted} row(s)` : ''}.`,
  )
  console.log(`Report: ${reportPath}`)
  if (publicBase && toUpload.length) {
    console.log(`Sample URL: ${publicBase}${encodeURIComponent(toUpload[0])}`)
  }
  console.log('\nHard-refresh the app to see new pictures (metadata comes from Supabase).')
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
