/**
 * Fail production builds if Supabase Vite env is missing or still a CI stub.
 * Vite prefers process.env over .env.local — a leftover CI=true shell can bake
 * https://example.supabase.co into Pages and break the live app.
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()
const PLACEHOLDER = 'example.supabase.co'

function readDotEnvLocal(key) {
  const path = join(ROOT, '.env.local')
  if (!existsSync(path)) return undefined
  const line = readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .find((row) => row.startsWith(`${key}=`))
  if (!line) return undefined
  return line.slice(key.length + 1).trim().replace(/^["']|["']$/g, '')
}

function effective(key) {
  const fromEnv = process.env[key]?.trim()
  if (fromEnv) return { value: fromEnv, source: 'process.env' }
  const fromFile = readDotEnvLocal(key)
  if (fromFile) return { value: fromFile, source: '.env.local' }
  return { value: undefined, source: 'missing' }
}

const url = effective('VITE_SUPABASE_URL')
const key = effective('VITE_SUPABASE_ANON_KEY')

const errors = []
if (!url.value) errors.push('VITE_SUPABASE_URL is not set')
if (!key.value) errors.push('VITE_SUPABASE_ANON_KEY is not set')
if (url.value?.includes(PLACEHOLDER)) {
  errors.push(
    `VITE_SUPABASE_URL is the CI stub (${PLACEHOLDER}) via ${url.source}. ` +
      'Clear process.env.VITE_SUPABASE_URL / CI / GITHUB_ACTIONS and use .env.local before deploy.',
  )
}
if (key.value === 'test-anon-key') {
  errors.push(
    `VITE_SUPABASE_ANON_KEY is the CI stub via ${key.source}. Clear it before deploy.`,
  )
}

if (errors.length) {
  console.error('[assert-production-supabase-env] Refusing production build:')
  for (const err of errors) console.error(`  - ${err}`)
  process.exit(1)
}

console.log(
  `[assert-production-supabase-env] OK (${url.source}) → ${url.value.replace(/^https?:\/\//, '')}`,
)

/** Optional post-build scan of dist JS for the placeholder host. */
const mode = process.argv[2]
if (mode === '--scan-dist') {
  const assets = join(ROOT, 'dist', 'assets')
  if (!existsSync(assets)) {
    console.error('[assert-production-supabase-env] dist/assets missing')
    process.exit(1)
  }
  for (const name of readdirSync(assets)) {
    if (!name.endsWith('.js')) continue
    const text = readFileSync(join(assets, name), 'utf8')
    if (text.includes(PLACEHOLDER)) {
      console.error(
        `[assert-production-supabase-env] ${name} still contains ${PLACEHOLDER} — abort deploy`,
      )
      process.exit(1)
    }
  }
  console.log('[assert-production-supabase-env] dist scan OK')
}
