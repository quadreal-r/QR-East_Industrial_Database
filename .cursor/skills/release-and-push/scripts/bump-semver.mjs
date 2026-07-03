#!/usr/bin/env node
/** Wrapper — delegates to scripts/bump-semver.mjs. */
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..')
const script = join(ROOT, 'scripts', 'bump-semver.mjs')
const result = spawnSync(process.execPath, [script, ...process.argv.slice(2)], {
  stdio: 'inherit',
  cwd: ROOT,
})
process.exit(result.status ?? 1)
