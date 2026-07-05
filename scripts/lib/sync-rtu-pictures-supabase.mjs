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

const SUPABASE_PAGE_SIZE = 1000

/** All `rtu_pictures` rows (paginated past PostgREST 1k limit). */
export async function fetchAllPictureRows(supabase) {
  const rows = []
  let from = 0
  while (true) {
    const { data, error } = await supabase
      .from('rtu_pictures')
      .select('id, building_address, rtu_name, file_name, hidden')
      .order('id', { ascending: true })
      .range(from, from + SUPABASE_PAGE_SIZE - 1)
    if (error) throw error
    if (!data?.length) break
    rows.push(...data)
    if (data.length < SUPABASE_PAGE_SIZE) break
    from += SUPABASE_PAGE_SIZE
  }
  return rows
}

function isFileOnR2(fileName, r2FileNames) {
  if (r2FileNames.has(fileName)) return true
  const lower = fileName.toLowerCase()
  for (const name of r2FileNames) {
    if (name.toLowerCase() === lower) return true
  }
  return false
}

/**
 * Align Supabase `rtu_pictures` with files that exist on R2.
 * - Deletes rows whose file_name is not on R2 (e.g. manual Cloudflare deletes).
 * - Upserts manifest rows (adds new R2 files, updates positions).
 */
export async function syncSupabasePicturesWithR2(manifest, r2FileNames, options = {}) {
  const { dryRun = false, hiddenPath } = options
  const r2Set = new Set(r2FileNames)
  const supabase = createSupabaseServiceClient()
  const existing = await fetchAllPictureRows(supabase)

  const orphans = existing.filter((row) => !isFileOnR2(row.file_name, r2Set))

  let deleted = 0
  if (!dryRun) {
    for (const row of orphans) {
      const { error } = await supabase
        .from('rtu_pictures')
        .delete()
        .eq('building_address', row.building_address)
        .eq('rtu_name', row.rtu_name)
        .eq('file_name', row.file_name)
      if (error) throw error
      deleted += 1
    }
  } else {
    deleted = orphans.length
  }

  const rtuIdByKey = await loadRtuIdByKey(supabase)
  const hiddenSet = loadHiddenPictureKeys(hiddenPath ?? DEFAULT_HIDDEN_PATH)
  const upsertRows = buildPictureRowsFromManifest(manifest, { hiddenSet, rtuIdByKey })

  let upserted = 0
  if (!dryRun && upsertRows.length) {
    const chunkSize = 500
    for (let i = 0; i < upsertRows.length; i += chunkSize) {
      const chunk = upsertRows.slice(i, i + chunkSize)
      const { error } = await supabase.from('rtu_pictures').upsert(chunk, {
        onConflict: 'building_address,rtu_name,file_name',
      })
      if (error) throw error
      upserted += chunk.length
    }
  } else {
    upserted = upsertRows.length
  }

  return {
    deleted,
    upserted,
    orphans: orphans.map((r) => ({
      building_address: r.building_address,
      rtu_name: r.rtu_name,
      file_name: r.file_name,
    })),
    supabaseBefore: existing.length,
    r2FileCount: r2Set.size,
  }
}
