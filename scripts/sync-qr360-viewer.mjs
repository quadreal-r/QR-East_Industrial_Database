/**
 * Sync the QR-360° viewer from the Inspections source folder into Building Map Explorer.
 *
 * Source of truth:
 *   C:\Users\Robert\Projects\QR-360°-Inspections\QR-360°-Inspections
 *   (latest QR-360°_viewer_v*.html or insp_360_viewer*.html)
 *
 * Writes:
 *   1) qr360-viewer/QR-360°_viewer_vX.Y.Z.html   — versioned copy (replaces older versions)
 *   2) public/insp360/viewer.html                 — stable URL the main app iframes
 *   3) qr360-viewer/CURRENT.json                  — pointer metadata
 *
 * Usage:  npm run sync:qr360-viewer
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const BME_ROOT = path.resolve(__dirname, '..')
const SOURCE_DIR =
  process.env.QR360_VIEWER_SOURCE ||
  path.resolve('C:\\Users\\Robert\\Projects\\QR-360°-Inspections\\QR-360°-Inspections')
const VERSIONED_DIR = path.join(BME_ROOT, 'qr360-viewer')
const LIVE_DIR = path.join(BME_ROOT, 'public', 'insp360')
const LIVE_FILE = path.join(LIVE_DIR, 'viewer.html')
const CURRENT_JSON = path.join(VERSIONED_DIR, 'CURRENT.json')

const NAME_RE = /^(?:QR-360°_viewer_v|insp_360_viewer-v|insp_360_viewer-?)(\d+\.\d+\.\d+)\.html$/i

function fail(msg) {
  console.error(`[sync-qr360-viewer] ${msg}`)
  process.exit(1)
}

function parseVersion(name) {
  const m = String(name).match(NAME_RE)
  if (!m) return null
  return m[1]
}

function versionParts(v) {
  return String(v)
    .split('.')
    .map((n) => parseInt(n, 10) || 0)
}

function cmpVersion(a, b) {
  const pa = versionParts(a)
  const pb = versionParts(b)
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i]
  }
  return 0
}

function findLatestSource() {
  if (!fs.existsSync(SOURCE_DIR)) fail(`Source folder not found:\n  ${SOURCE_DIR}`)
  const files = fs
    .readdirSync(SOURCE_DIR)
    .filter((n) => parseVersion(n))
    .map((n) => {
      const full = path.join(SOURCE_DIR, n)
      const st = fs.statSync(full)
      return { name: n, full, version: parseVersion(n), mtime: st.mtimeMs, size: st.size }
    })
  if (!files.length) {
    fail(
      `No viewer HTML found in:\n  ${SOURCE_DIR}\n` +
        `Expected names like QR-360°_viewer_v1.1.3.html`,
    )
  }
  files.sort((a, b) => {
    const c = cmpVersion(a.version, b.version)
    if (c !== 0) return c
    return a.mtime - b.mtime
  })
  return files[files.length - 1]
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true })
}

function clearOldVersions(keepName) {
  if (!fs.existsSync(VERSIONED_DIR)) return
  for (const n of fs.readdirSync(VERSIONED_DIR)) {
    if (n === 'CURRENT.json' || n === 'README.md' || n === keepName) continue
    if (parseVersion(n) || /\.html$/i.test(n)) {
      fs.unlinkSync(path.join(VERSIONED_DIR, n))
      console.log(`[sync-qr360-viewer] removed old ${n}`)
    }
  }
}

function bumpBadgeInCopy(filePath, version) {
  let html = fs.readFileSync(filePath, 'utf8')
  const ver = version.startsWith('v') ? version : `v${version}`
  html = html.replace(
    /(<span id="appVer"[^>]*>)\s*v?\d+\.\d+\.\d+\s*(<\/span>)/i,
    `$1${ver}$2`,
  )
  html = html.replace(/const VERSION="v?\d+\.\d+\.\d+"/g, `const VERSION="${ver}"`)
  fs.writeFileSync(filePath, html, 'utf8')
}

const latest = findLatestSource()
const versionedName = `QR-360°_viewer_v${latest.version}.html`
const versionedPath = path.join(VERSIONED_DIR, versionedName)

ensureDir(VERSIONED_DIR)
ensureDir(LIVE_DIR)
clearOldVersions(versionedName)

fs.copyFileSync(latest.full, versionedPath)
bumpBadgeInCopy(versionedPath, latest.version)
fs.copyFileSync(versionedPath, LIVE_FILE)

const meta = {
  version: latest.version,
  versionedFile: versionedName,
  liveFile: 'public/insp360/viewer.html',
  sourceFile: latest.name,
  sourceDir: SOURCE_DIR,
  syncedAt: new Date().toISOString(),
  bytes: fs.statSync(LIVE_FILE).size,
  mainAppUrl: 'insp360/viewer.html',
}
fs.writeFileSync(CURRENT_JSON, JSON.stringify(meta, null, 2) + '\n', 'utf8')

console.log(`[sync-qr360-viewer] synced v${latest.version}`)
console.log(`  source : ${latest.full}`)
console.log(`  kept   : ${versionedPath}`)
console.log(`  live   : ${LIVE_FILE}`)
console.log(`  bytes  : ${meta.bytes}`)
