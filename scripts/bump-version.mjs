/**
 * Bump patch semver in package.json, version.build.json, and buildVersion.ts.
 * Used by `npm run version:bump`. Release skill uses bump-semver.mjs for minor/major.
 */
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { bumpAndWriteVersion } from './lib/semver-version.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const { from, to, label } = bumpAndWriteVersion(ROOT, 'patch', 'scripts/bump-version.mjs')
console.log(`Version: ${from} → ${to} (${label})`)
