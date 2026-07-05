/**
 * Sync RTU picture manifest entries to Supabase `rtu_pictures` (live app metadata).
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { getProjectRoot } from './load-dotenv-local.mjs'

const DEFAULT_HIDDEN_PATH = join(
  getProjectRoot(),
  'public',
  'database',
  'rtu-pictures',
  'hidden.json',
)

export function isSupabaseServiceConfigured() {
  const url = process.env.SUPABASE_URL?.trim() || process.env.VITE_SUPABASE_URL?.trim()
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  return Boolean(url && key)
}

export function createSupabaseServiceClient() {
  const url = process.env.SUPABASE_URL?.trim() || process.env.VITE_SUPABASE_URL?.trim()
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (!url || !key) {
    throw new Error('Set SUPABASE_URL (or VITE_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY in .env.local')
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

export function loadHiddenPictureKeys(hiddenPath = DEFAULT_HIDDEN_PATH) {
  if (!existsSync(hiddenPath)) return new Set()
  try {
    const parsed = JSON.parse(readFileSync(hiddenPath, 'utf8'))
    return new Set(Array.isArray(parsed) ? parsed : [])
  } catch {
    return new Set()
  }
}

export function parseManifestRtuKey(key) {
  const pipe = key.indexOf('|')
  if (pipe < 0) return null
  const buildingAddress = key.slice(0, pipe)
  const rtuName = key.slice(pipe + 1)
  if (!buildingAddress || !rtuName) return null
  return { buildingAddress, rtuName }
}

/** Build upsert rows from a manifest `{ entries }` object. */
export function buildPictureRowsFromManifest(
  manifest,
  { onlyFileNames, hiddenSet = new Set(), rtuIdByKey = new Map() } = {},
) {
  const rows = []
  for (const [key, files] of Object.entries(manifest?.entries ?? {})) {
    if (!Array.isArray(files)) continue
    const parsed = parseManifestRtuKey(key)
    if (!parsed) continue
    const { buildingAddress, rtuName } = parsed
    for (const [position, fileName] of files.entries()) {
      if (typeof fileName !== 'string' || !fileName) continue
      if (onlyFileNames && !onlyFileNames.has(fileName)) continue
      rows.push({
        rtu_id: rtuIdByKey.get(key) ?? null,
        building_address: buildingAddress,
        rtu_name: rtuName,
        file_name: fileName,
        position,
        hidden: hiddenSet.has(`${key}|${fileName}`),
      })
    }
  }
  return rows
}

export async function loadRtuIdByKey(supabase) {
  const [{ data: rtus }, { data: buildings }] = await Promise.all([
    supabase.from('rtus').select('id, name, building_id'),
    supabase.from('buildings').select('id, address'),
  ])
  const addressByBuildingId = new Map((buildings ?? []).map((b) => [b.id, b.address]))
  const rtuIdByKey = new Map()
  for (const rtu of rtus ?? []) {
    const address = addressByBuildingId.get(rtu.building_id)
    if (address) rtuIdByKey.set(`${address}|${rtu.name}`, rtu.id)
  }
  return rtuIdByKey
}

/**
 * Upsert manifest picture rows into Supabase.
 * @param {object} manifest `{ entries: Record<string, string[]> }`
 * @param {{ onlyFileNames?: Set<string>, hiddenPath?: string }} options
 */
export async function upsertPictureManifestToSupabase(manifest, options = {}) {
  const supabase = createSupabaseServiceClient()
  const rtuIdByKey = await loadRtuIdByKey(supabase)
  const hiddenSet =
    options.hiddenSet ?? loadHiddenPictureKeys(options.hiddenPath ?? DEFAULT_HIDDEN_PATH)
  const rows = buildPictureRowsFromManifest(manifest, {
    onlyFileNames: options.onlyFileNames,
    hiddenSet,
    rtuIdByKey,
  })
  if (!rows.length) return { upserted: 0, rows: [] }

  const chunkSize = 500
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize)
    const { error } = await supabase.from('rtu_pictures').upsert(chunk, {
      onConflict: 'building_address,rtu_name,file_name',
    })
    if (error) throw error
  }

  return { upserted: rows.length, rows }
}
