#!/usr/bin/env node
/**
 * Bump semver in package.json, version.build.json, and src/generated/buildVersion.ts.
 *
 * Usage: node scripts/bump-semver.mjs patch|minor|major
 */
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { bumpAndWriteVersion } from './lib/semver-version.mjs'

const kind = process.argv[2]
if (!['patch', 'minor', 'major'].includes(kind)) {
  console.error('Usage: bump-semver.mjs patch|minor|major')
  process.exit(1)
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const { from, to, label } = bumpAndWriteVersion(ROOT, kind, 'scripts/bump-semver.mjs')
console.log(`Version: ${from} → ${to} (${label})`)
