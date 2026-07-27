#!/usr/bin/env node
/**
 * Push local app code to GitHub main for version tracking.
 * Does NOT deploy the live Cloudflare site — use the push-cloudflare-build skill for that.
 *
 * Usage:
 *   npm run push-live
 *   npm run push-live -- "feat: description"
 *   npm run push-live -- --push-only "fix: typo"
 */
import { execSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const ACTIONS_URL = 'https://github.com/quadreal-r/QR-East_Industrial_Database/actions/workflows/ci.yml'
const LIVE_URL = 'https://qr-east-industrial-database.pages.dev/'

const EXCLUDE_FROM_COMMIT = ['.env.local', 'nogps-list.txt', 'nogps-not-on-cdn.txt']

function run(cmd) {
  console.log(`> ${cmd}`)
  execSync(cmd, { cwd: ROOT, stdio: 'inherit', shell: true })
}

function runCapture(cmd) {
  return execSync(cmd, { cwd: ROOT, encoding: 'utf8', shell: true }).trim()
}

function parseArgs(argv) {
  const messageParts = []
  for (const arg of argv) {
    if (arg === '--push-only') continue // kept for old scripts; GitHub push never deploys live
    else if (arg.startsWith('-')) continue
    else messageParts.push(arg)
  }
  return {
    message: messageParts.join(' ').trim() || 'chore: push app to GitHub',
  }
}

function shellQuote(value) {
  return `"${value.replace(/"/g, '\\"')}"`
}

const { message } = parseArgs(process.argv.slice(2))

run('npm run typecheck')
run('npm run lint')
run('npm run test')

const status = runCapture('git status --porcelain')
if (status) {
  run('git add -A')
  for (const path of EXCLUDE_FROM_COMMIT) {
    try {
      runCapture(`git reset HEAD -- "${path}"`)
    } catch {
      /* not staged */
    }
  }
  const staged = runCapture('git diff --staged --name-only')
  if (staged) {
    run(`git commit -m ${shellQuote(message)}`)
  } else {
    console.log('Nothing to commit after excluding secrets and local list files.')
  }
} else {
  console.log('No local changes to commit — pushing current branch to main.')
}

run('git pull --rebase origin main')
run('git push origin main')

console.log('\nPushed to main (GitHub version tracking).')
console.log(`CI checks: ${ACTIONS_URL}`)
console.log(`Live site is Cloudflare — not updated by this push: ${LIVE_URL}`)
console.log('To publish live, use: push a new build to Cloudflare quadreal')
console.log('Map data lives in Supabase. RTU picture/document files live on Cloudflare R2.')
