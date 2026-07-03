#!/usr/bin/env node
/**
 * Load .env.local, link the Supabase project if needed, then run db push.
 * Requires SUPABASE_ACCESS_TOKEN and SUPABASE_DB_PASSWORD in .env.local.
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { loadDotEnvLocal, ROOT } from './lib/load-dotenv-local.mjs'

const PROJECT_REF = 'wyiymdtlncperqpwriuk'
const dryRun = process.argv.includes('--dry-run')

loadDotEnvLocal()

function runSupabase(args) {
  const result = spawnSync('npx', ['supabase', ...args], {
    cwd: ROOT,
    stdio: 'inherit',
    env: process.env,
    shell: true,
  })
  if (result.status !== 0) process.exit(result.status ?? 1)
}

const linkedRefPath = join(ROOT, '.supabase', 'project-ref')
if (!existsSync(linkedRefPath)) {
  if (!process.env.SUPABASE_ACCESS_TOKEN) {
    console.error(
      'Missing SUPABASE_ACCESS_TOKEN in .env.local. Create one at https://supabase.com/dashboard/account/tokens',
    )
    process.exit(1)
  }
  if (!process.env.SUPABASE_DB_PASSWORD) {
    console.error(
      'Missing SUPABASE_DB_PASSWORD in .env.local (Supabase project Settings → Database).',
    )
    process.exit(1)
  }
  console.log(`Linking project ${PROJECT_REF}…`)
  runSupabase([
    'link',
    '--project-ref',
    PROJECT_REF,
    '--password',
    process.env.SUPABASE_DB_PASSWORD,
    '--yes',
  ])
}

const pushArgs = ['db', 'push', '--linked', '--yes']
if (dryRun) pushArgs.push('--dry-run')

console.log(dryRun ? 'Dry run — migrations that would apply:' : 'Applying pending migrations…')
runSupabase(pushArgs)
