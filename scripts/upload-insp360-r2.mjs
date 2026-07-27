/**
 * Upload QR-360° tour files (.insp360 / .zip) to the insp360 R2 bucket
 * on the dedicated Cloudflare account (separate from RTU pictures).
 *
 * Usage:
 *   npm run upload:insp360 -- --file "C:/path/to/tour.insp360"
 *   npm run upload:insp360 -- --file "C:/path/to/tour.insp360" --key "145-carrier/suite-7.insp360"
 *   npm run upload:insp360 -- --from-folder "C:/Users/Robert/Tours" --skip-existing
 *
 * Env (see .env.example / docs/INSP360_R2.md):
 *   INSP360_R2_ACCOUNT_ID
 *   INSP360_R2_ACCESS_KEY_ID
 *   INSP360_R2_SECRET_ACCESS_KEY
 *   INSP360_R2_BUCKET_NAME=insp360
 *   VITE_INSP360_BASE_URL
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { basename, join, relative, resolve } from 'node:path'
import {
  guessInsp360ContentType,
  insp360ObjectExists,
  insp360PublicUrl,
  isInsp360R2Configured,
  uploadInsp360FileToR2,
} from './lib/insp360-r2-client.mjs'
import { loadDotEnvLocal } from './lib/load-dotenv-local.mjs'

const TOUR_EXT = /\.(insp360|zip)$/i

function parseArgs(argv) {
  /** @type {string | null} */
  let file = null
  /** @type {string | null} */
  let key = null
  /** @type {string | null} */
  let fromFolder = null
  let skipExisting = false
  let dryRun = false

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--file') file = argv[++i] ?? null
    else if (arg === '--key') key = argv[++i] ?? null
    else if (arg === '--from-folder') fromFolder = argv[++i] ?? null
    else if (arg === '--skip-existing') skipExisting = true
    else if (arg === '--dry-run') dryRun = true
    else if (!arg.startsWith('-') && !file && !fromFolder) {
      // bare path: treat as file if it looks like one, else folder
      if (TOUR_EXT.test(arg) || existsSync(arg) && !statSync(arg).isDirectory()) file = arg
      else fromFolder = arg
    }
  }
  return { file, key, fromFolder, skipExisting, dryRun }
}

/** @returns {{ abs: string, key: string }[]} */
function collectFromFolder(rootDir) {
  const root = resolve(rootDir)
  /** @type {{ abs: string, key: string }[]} */
  const items = []

  function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (/^(old|archive|_old)$/i.test(entry.name)) continue
        walk(full)
      } else if (entry.isFile() && TOUR_EXT.test(entry.name)) {
        const rel = relative(root, full).replace(/\\/g, '/')
        items.push({ abs: full, key: rel })
      }
    }
  }

  walk(root)
  return items.sort((a, b) => a.key.localeCompare(b.key))
}

async function main() {
  loadDotEnvLocal()
  const { file, key, fromFolder, skipExisting, dryRun } = parseArgs(process.argv)

  if (!isInsp360R2Configured()) {
    console.error(`
insp360 R2 is not configured.

1. On the krutki11 Cloudflare account: R2 → Manage R2 API Tokens → Create API token
   (Object Read & Write on the insp360 bucket is enough).
2. Add to .env.local (do NOT reuse the pictures-account keys):

   INSP360_R2_ACCOUNT_ID=...
   INSP360_R2_ACCESS_KEY_ID=...
   INSP360_R2_SECRET_ACCESS_KEY=...
   INSP360_R2_BUCKET_NAME=insp360
   VITE_INSP360_BASE_URL=https://pub-0d0f264ce842432887754b840b270786.r2.dev/

See docs/INSP360_R2.md
`)
    process.exit(1)
  }

  /** @type {{ abs: string, key: string }[]} */
  let uploads = []

  if (file) {
    const abs = resolve(file)
    if (!existsSync(abs) || !statSync(abs).isFile()) {
      console.error(`File not found: ${abs}`)
      process.exit(1)
    }
    if (!TOUR_EXT.test(abs)) {
      console.error('File must end with .insp360 or .zip')
      process.exit(1)
    }
    uploads = [{ abs, key: (key?.trim() || basename(abs)).replace(/\\/g, '/') }]
  } else if (fromFolder) {
    const absFolder = resolve(fromFolder)
    if (!existsSync(absFolder) || !statSync(absFolder).isDirectory()) {
      console.error(`Folder not found: ${absFolder}`)
      process.exit(1)
    }
    uploads = collectFromFolder(absFolder)
    if (!uploads.length) {
      console.error(`No .insp360 / .zip files found under ${absFolder}`)
      process.exit(1)
    }
  } else {
    console.error(`Usage:
  npm run upload:insp360 -- --file "C:/path/tour.insp360"
  npm run upload:insp360 -- --file "C:/path/tour.insp360" --key "145-carrier/suite-7.insp360"
  npm run upload:insp360 -- --from-folder "C:/Users/Robert/Tours" --skip-existing
`)
    process.exit(1)
  }

  console.log(`Uploading ${uploads.length} tour file(s) to bucket "${process.env.INSP360_R2_BUCKET_NAME || 'insp360'}"…`)
  if (dryRun) console.log('(dry run — no uploads)')

  let uploaded = 0
  let skipped = 0
  let failed = 0

  for (const item of uploads) {
    const publicUrl = insp360PublicUrl(item.key)
    try {
      if (skipExisting && (await insp360ObjectExists(item.key))) {
        console.log(`SKIP  ${item.key}${publicUrl ? ` → ${publicUrl}` : ''}`)
        skipped++
        continue
      }
      if (dryRun) {
        console.log(`PLAN  ${item.key}${publicUrl ? ` → ${publicUrl}` : ''}`)
        uploaded++
        continue
      }
      const body = readFileSync(item.abs)
      const result = await uploadInsp360FileToR2(
        item.key,
        body,
        guessInsp360ContentType(item.key),
      )
      console.log(`OK    ${item.key}`)
      if (result.publicUrl) console.log(`      ${result.publicUrl}`)
      console.log(`      Paste as Tour URL: ${item.key}`)
      uploaded++
    } catch (error) {
      failed++
      console.error(`FAIL  ${item.key}: ${error instanceof Error ? error.message : error}`)
    }
  }

  console.log(`\nDone. uploaded=${uploaded} skipped=${skipped} failed=${failed}`)
  if (failed) process.exit(1)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
