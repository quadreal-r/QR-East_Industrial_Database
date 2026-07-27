#!/usr/bin/env node
/**
 * Replace rtus.replacement_year from Capital Equipment sheet column E.
 * Match by building address + RTU number. 0 / blank / Demolition → None (NULL).
 *
 * Full replace: clears every RTU year, then writes matched years from the sheet.
 *
 * Usage:
 *   npm run import-equipment-replacement-years -- "C:\path\to\Capital.xlsx" --dry-run
 *   npm run import-equipment-replacement-years -- "C:\path\to\Capital.xlsx"
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { loadDotEnvLocal } from './lib/load-dotenv-local.mjs'
import { parseEquipmentSheetRows } from '../src/lib/equipmentSheet'
import {
  buildBuildingAddressIndex,
  findBuildingBySheetAddress,
  findRtuInBuilding,
} from '../src/lib/rtuMatch'
import type { Building, Rtu } from '../src/types/domain'

loadDotEnvLocal()

const supabaseUrl = process.env.SUPABASE_URL?.trim() || process.env.VITE_SUPABASE_URL?.trim()
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()

if (!supabaseUrl || !serviceKey) {
  console.error('Set SUPABASE_URL (or VITE_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY in .env.local')
  process.exit(1)
}

const DEFAULT_XLSX =
  'C:/Users/Robert/OneDrive - Quadreal Property Group/#OI-Industrial East - Capital/RTU - HVAC/Capital_RTU_Replacement-V2026_5_1_4.xlsx'

const excelPath = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : DEFAULT_XLSX
const dryRun = process.argv.includes('--dry-run')

const supabase = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})

async function fetchAllPages<T>(
  query: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const pageSize = 1000
  const out: T[] = []
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await query(from, from + pageSize - 1)
    if (error) throw new Error(error.message)
    if (!data?.length) break
    out.push(...data)
    if (data.length < pageSize) break
  }
  return out
}

async function fetchPortfolio(): Promise<Building[]> {
  const buildings = await fetchAllPages<{ id: number; address: string }>((from, to) =>
    supabase.from('buildings').select('id, address').order('id').range(from, to),
  )

  const rtus = await fetchAllPages<{ id: number; building_id: number; name: string }>((from, to) =>
    supabase.from('rtus').select('id, building_id, name').order('id').range(from, to),
  )

  const byBuilding = new Map<number, Rtu[]>()
  for (const rtu of rtus) {
    const list = byBuilding.get(rtu.building_id) ?? []
    list.push({ id: rtu.id, name: rtu.name } as Rtu)
    byBuilding.set(rtu.building_id, list)
  }

  return buildings.map((b) => ({
    id: b.id,
    address: b.address,
    rtus: byBuilding.get(b.id) ?? [],
  })) as Building[]
}

async function main() {
  console.log(`Reading ${excelPath}`)
  const buf = readFileSync(excelPath)
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
  const sheetRows = parseEquipmentSheetRows(ab)
  console.log(`Equipment rows: ${sheetRows.length}`)

  const buildings = await fetchPortfolio()
  console.log(`Portfolio: ${buildings.length} buildings`)

  const index = buildBuildingAddressIndex(buildings)

  /** Last row wins when the same RTU appears more than once. */
  const byRtuId = new Map<number, { address: string; rtu: string; year: number | null }>()
  let unmatchedBuilding = 0
  let unmatchedRtu = 0

  for (const row of sheetRows) {
    const building = findBuildingBySheetAddress(index, row.address, row.propertyAddress)
    if (!building) {
      unmatchedBuilding++
      continue
    }
    const rtu = findRtuInBuilding(building, row.rtuLabel)
    if (!rtu || typeof rtu.id !== 'number') {
      unmatchedRtu++
      continue
    }
    byRtuId.set(rtu.id, {
      address: building.address,
      rtu: rtu.name,
      year: row.replacementYear ? Number(row.replacementYear) : null,
    })
  }

  const sets = [...byRtuId.entries()]
    .filter(([, v]) => v.year != null)
    .map(([rtuId, v]) => ({ rtuId, address: v.address, rtu: v.rtu, year: v.year as number }))
  const clears = [...byRtuId.entries()]
    .filter(([, v]) => v.year == null)
    .map(([rtuId, v]) => ({ rtuId, address: v.address, rtu: v.rtu }))

  console.log({
    sets: sets.length,
    clearsAsNone: clears.length,
    unmatchedBuilding,
    unmatchedRtu,
    dryRun,
  })

  if (dryRun) {
    console.log('Sample sets', sets.slice(0, 8))
    console.log('Sample clears', clears.slice(0, 8))
    console.log('Dry run — no database changes.')
    return
  }

  // Full replace of replacement years from this workbook.
  const { error: clearAllErr } = await supabase.from('rtus').update({ replacement_year: null }).neq('id', 0)
  if (clearAllErr) throw clearAllErr
  console.log('Cleared all replacement_year values')

  let updated = 0
  const chunk = 80
  for (let i = 0; i < sets.length; i += chunk) {
    const batch = sets.slice(i, i + chunk)
    await Promise.all(
      batch.map(async (row) => {
        const { error } = await supabase
          .from('rtus')
          .update({ replacement_year: row.year })
          .eq('id', row.rtuId)
        if (error) throw error
        updated++
      }),
    )
  }

  const { error: sourceErr } = await supabase.from('app_settings').upsert(
    {
      key: 'rtu_schedule_source',
      value: { sourceFile: excelPath.split(/[/\\]/).pop() ?? excelPath },
    },
    { onConflict: 'key' },
  )
  if (sourceErr) throw sourceErr

  const { count } = await supabase
    .from('rtus')
    .select('*', { count: 'exact', head: true })
    .not('replacement_year', 'is', null)

  console.log(`Done. Wrote ${updated} years. RTUs with a year now: ${count ?? '?'}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
