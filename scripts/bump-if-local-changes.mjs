#!/usr/bin/env node
/**
 * Bump map app patch version when there are local app changes.
 *
 * Measures uncommitted app-code changes vs HEAD (diff + new files).
 * Bumps once per distinct change set (fingerprint); re-running with the
 * same changes is a no-op. Further edits produce a new fingerprint → bump again.
 *
 * Usage: node scripts/bump-if-local-changes.mjs [--dry-run]
 */
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { bumpAndWriteVersion, readCurrentVersion } from './lib/semver-version.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const VERSION_BUILD_PATH = join(ROOT, 'version.build.json')

/** Paths that count toward "local app" change size */
const APP_PATHS = [
  'src',
  'public',
  'functions',
  'index.html',
  'package.json',
  'package-lock.json',
  'vite.config.ts',
  'vite.config.mjs',
  'vitest.config.ts',
  'tsconfig.json',
  'tsconfig.app.json',
  'tsconfig.node.json',
  'supabase/functions',
]

/** Never count these toward the fingerprint (version churn / noise) */
const EXCLUDE_PREFIXES = [
  'src/generated/buildVersion.ts',
  'version.build.json',
  'package.json', // version field changes on every bump
  'CHANGELOG.md',
  '.cursor/',
  'docs/',
  'qr360-viewer/',
  'node_modules/',
  'dist/',
  'coverage/',
  'test-results',
  'vitest-gate-out.txt',
  'tmp-',
]

function parseArgs(argv) {
  let dryRun = false
  for (const arg of argv) {
    if (arg === '--dry-run') dryRun = true
  }
  return { dryRun }
}

function git(args, { allowFail = false } = {}) {
  try {
    return execFileSync('git', args, {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 64 * 1024 * 1024,
    })
  } catch (err) {
    if (allowFail) return ''
    throw err
  }
}

function isExcluded(relPath) {
  const norm = relPath.replace(/\\/g, '/')
  return EXCLUDE_PREFIXES.some((p) => (p.endsWith('/') ? norm.startsWith(p) : norm === p))
}

function isAppPath(relPath) {
  const norm = relPath.replace(/\\/g, '/')
  if (isExcluded(norm)) return false
  return APP_PATHS.some((p) => norm === p || norm.startsWith(`${p}/`))
}

/** Unified diffs for tracked app files (excludes version-only paths). */
function appDiffText() {
  const out = git(['diff', 'HEAD', '--', ...APP_PATHS], { allowFail: true })
  if (!out) return ''
  let result = ''
  let currentFile = null
  let chunk = ''
  const flush = () => {
    if (currentFile && isAppPath(currentFile) && chunk) result += chunk
    chunk = ''
  }
  for (const line of out.split('\n')) {
    const m = line.match(/^diff --git a\/(.+) b\/(.+)$/)
    if (m) {
      flush()
      currentFile = m[2]
      chunk = `${line}\n`
      continue
    }
    if (currentFile != null) chunk += `${line}\n`
  }
  flush()
  return result
}

/** Manifest of untracked new app files (path + size). */
function untrackedManifest() {
  const out = git(['ls-files', '--others', '--exclude-standard'], { allowFail: true })
  if (!out.trim()) return ''
  const lines = []
  for (const line of out.split('\n')) {
    const rel = line.trim()
    if (!rel || !isAppPath(rel)) continue
    const abs = join(ROOT, rel)
    if (!existsSync(abs)) continue
    try {
      lines.push(`${rel}\0${statSync(abs).size}`)
    } catch {
      /* ignore */
    }
  }
  return lines.sort().join('\n')
}

function appChangeFingerprint() {
  const payload = `${appDiffText()}\n---\n${untrackedManifest()}`
  if (!payload.replace(/\s/g, '') || payload === '\n---\n') return null
  // Treat empty diff + empty untracked as no changes
  if (!appDiffText().trim() && !untrackedManifest().trim()) return null
  return createHash('sha256').update(payload, 'utf8').digest('hex').slice(0, 20)
}

function readStoredBumpHash() {
  try {
    const data = JSON.parse(readFileSync(VERSION_BUILD_PATH, 'utf8'))
    return typeof data.bumpSourceHash === 'string' ? data.bumpSourceHash : null
  } catch {
    return null
  }
}

function writeBumpSourceHash(hash) {
  let data = { semver: readCurrentVersion(ROOT).semver }
  try {
    data = JSON.parse(readFileSync(VERSION_BUILD_PATH, 'utf8'))
  } catch {
    /* use defaults */
  }
  data.bumpSourceHash = hash
  writeFileSync(VERSION_BUILD_PATH, `${JSON.stringify(data, null, 2)}\n`)
}

function main() {
  const { dryRun } = parseArgs(process.argv.slice(2))
  const fingerprint = appChangeFingerprint()

  if (!fingerprint) {
    console.log('No local app changes — no version bump.')
    process.exit(0)
  }

  const stored = readStoredBumpHash()
  if (stored && stored === fingerprint) {
    const local = readCurrentVersion(ROOT).semver
    console.log(`App changes already covered by local version ${local} — skip bump.`)
    process.exit(0)
  }

  if (dryRun) {
    console.log(`Dry run: would bump patch (fingerprint ${fingerprint}).`)
    process.exit(0)
  }

  const { from, to, label } = bumpAndWriteVersion(ROOT, 'patch', 'scripts/bump-if-local-changes.mjs')
  writeBumpSourceHash(fingerprint)
  console.log(`Local version bump: ${from} → ${to} (${label})`)
  console.log('Push when ready — online build will pick up this version.')
}

main()
