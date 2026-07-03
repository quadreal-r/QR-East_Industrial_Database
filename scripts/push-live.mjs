#!/usr/bin/env node
/**
 * Push local app code to GitHub main. Deploy runs automatically via deploy.yml on push.
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
const ACTIONS_URL = 'https://github.com/quadreal-r/building-map-explorer/actions/workflows/deploy.yml'

const EXCLUDE_FROM_COMMIT = ['.env.local', 'nogps-list.txt', 'nogps-not-on-cdn.txt']

function run(cmd) {
  console.log(`> ${cmd}`)
  execSync(cmd, { cwd: ROOT, stdio: 'inherit', shell: true })
}

function runCapture(cmd) {
  return execSync(cmd, { cwd: ROOT, encoding: 'utf8', shell: true }).trim()
}

function parseArgs(argv) {
  const flags = new Set()
  const messageParts = []
  for (const arg of argv) {
    if (arg === '--push-only') flags.add('push-only')
    else if (arg.startsWith('-')) flags.add(arg)
    else messageParts.push(arg)
  }
  return {
    pushOnly: flags.has('--push-only'),
    message: messageParts.join(' ').trim() || 'chore: push app to live site',
  }
}

function shellQuote(value) {
  return `"${value.replace(/"/g, '\\"')}"`
}

const { pushOnly, message } = parseArgs(process.argv.slice(2))

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

console.log('\nPushed to main.')
if (pushOnly) {
  console.log('Push-only mode — deploy.yml runs from the push hook.')
} else {
  console.log(`Watch deploy: ${ACTIONS_URL}`)
}
console.log('Map data lives in Supabase. RTU picture/document files live on Cloudflare R2.')
