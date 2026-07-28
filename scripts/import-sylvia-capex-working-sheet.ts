#!/usr/bin/env node
/**
 * Import Sylvia Capex “Working Sheet” (colors + comments) into Supabase.
 *
 * - Yellow amount cells → Submitted Capex pot
 * - Green amount cells → Approved Capex pot
 * - Cell comments → Capex pot notes + RTU replacement years for that column year
 * - Merges only matched Sylvia buildings (does not wipe other managers’ pots)
 *
 * Usage:
 *   npm run import-sylvia-capex -- "C:\Users\Robert\Downloads\Sylvia RTU replacement capital 2026.xlsx" --dry-run
 *   npm run import-sylvia-capex -- "C:\Users\Robert\Downloads\Sylvia RTU replacement capital 2026.xlsx"
 */
import { createClient } from '@supabase/supabase-js'
import { loadDotEnvLocal } from './lib/load-dotenv-local.mjs'
import {
  buildBuildingAddressIndex,
  findBuildingBySheetAddress,
} from '../src/lib/rtuMatch'
import {
  matchSylviaRtu,
  parseSylviaWorkingSheet,
  resolveSylviaBuilding,
} from '../src/lib/sylviaCapexWorkingSheet'
import type { Building, Rtu } from '../src/types/domain'

loadDotEnvLocal()

const supabaseUrl = process.env.SUPABASE_URL?.trim() || process.env.VITE_SUPABASE_URL?.trim()
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()

if (!supabaseUrl || !serviceKey) {
  console.error('Set SUPABASE_URL (or VITE_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY in .env.local')
  process.exit(1)
}

const DEFAULT_XLSX =
  'C:/Users/Robert/Downloads/Sylvia RTU replacement capital 2026.xlsx'

const excelPath =
  process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : DEFAULT_XLSX
const dryRun = process.argv.includes('--dry-run')

const supabase = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})

async function fetchAllPages<T>(
  query: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
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

async function loadBuildings(): Promise<Building[]> {
  type BuildingRow = {
    id: number
    park: string | null
    address: string
    bu: string | null
    lat: number
    lng: number
    sqft: string | null
    cluster: string | null
    manager: string | null
  }
  type RtuRow = {
    id: number
    building_id: number
    name: string
    description: string | null
    lat: number
    lng: number
  }

  const [buildingRows, rtuRows] = await Promise.all([
    fetchAllPages<BuildingRow>((from, to) =>
      supabase.from('buildings').select('*').order('address').range(from, to),
    ),
    fetchAllPages<RtuRow>((from, to) =>
      supabase
        .from('rtus')
        .select('id, building_id, name, description, lat, lng')
        .range(from, to),
    ),
  ])

  const rtusByBuilding = new Map<number, Rtu[]>()
  for (const row of rtuRows) {
    const list = rtusByBuilding.get(row.building_id) ?? []
    list.push({
      id: row.id,
      building_id: row.building_id,
      name: row.name,
      description: row.description ?? '',
      lat: row.lat,
      lng: row.lng,
    })
    rtusByBuilding.set(row.building_id, list)
  }

  return buildingRows.map((row) => ({
    id: row.id,
    park: row.park ?? '',
    address: row.address,
    bu: row.bu ?? '',
    lat: row.lat,
    lng: row.lng,
    sqft: row.sqft ?? '',
    cluster: row.cluster ?? '',
    manager: row.manager ?? '',
    rtus: rtusByBuilding.get(row.id) ?? [],
  }))
}

async function main() {
  console.log(`Reading ${excelPath}`)
  const parsed = await parseSylviaWorkingSheet(excelPath)
  console.log('Parse stats:', parsed.stats)

  const buildings = await loadBuildings()
  const addressIndex = buildBuildingAddressIndex(buildings)
  const findByAddress = (name: string) =>
    findBuildingBySheetAddress(addressIndex, name)

  const potWrites: Array<{
    building_id: number
    address: string
    year: number
    budget: number
    note: string | null
    capex_status: string
    capex_job_project_type: string
  }> = []
  const unmatchedPots: string[] = []

  for (const pot of parsed.pots) {
    const building = resolveSylviaBuilding(buildings, pot, findByAddress)
    if (!building?.id) {
      unmatchedPots.push(`BU ${pot.bu} · ${pot.propertyName} · ${pot.year}`)
      continue
    }
    potWrites.push({
      building_id: building.id,
      address: building.address,
      year: Number(pot.year),
      budget: pot.amount,
      note: pot.note.trim() || null,
      capex_status: pot.status,
      capex_job_project_type: pot.jobProjectType || 'HVAC',
    })
  }

  type YearPatch = { id: number; address: string; name: string; year: number; note: string }
  const rtuWrites: YearPatch[] = []
  const unmatchedRtus: string[] = []

  for (const assign of parsed.rtuAssignments) {
    const building = resolveSylviaBuilding(buildings, assign, findByAddress)
    if (!building) {
      unmatchedRtus.push(`BU ${assign.bu} RTU ${assign.rtuNumber} (${assign.year}) — building`)
      continue
    }
    const rtu = matchSylviaRtu(building, assign.rtuNumber)
    if (!rtu?.id) {
      unmatchedRtus.push(
        `${building.address} RTU ${assign.rtuNumber} (${assign.year}) — no matching unit`,
      )
      continue
    }
    rtuWrites.push({
      id: rtu.id,
      address: building.address,
      name: rtu.name,
      year: Number(assign.year),
      note: assign.note.trim(),
    })
  }

  // Prefer first assignment when the same RTU appears in multiple year notes.
  const rtuById = new Map<number, YearPatch>()
  for (const patch of rtuWrites) {
    if (!rtuById.has(patch.id)) rtuById.set(patch.id, patch)
  }
  const uniqueRtuWrites = [...rtuById.values()]

  console.log(`\nCapex pots to upsert: ${potWrites.length}`)
  for (const row of potWrites) {
    console.log(
      `  ${row.address} ${row.year}  $${row.budget.toLocaleString()}  ${row.capex_status}`,
    )
  }

  console.log(`\nRTU replacement years to set: ${uniqueRtuWrites.length}`)
  for (const row of uniqueRtuWrites) {
    console.log(`  ${row.address} · ${row.name} → ${row.year}`)
  }

  if (unmatchedPots.length) {
    console.log(`\nUnmatched pots (${unmatchedPots.length}):`)
    for (const line of unmatchedPots) console.log(`  ${line}`)
  }
  if (unmatchedRtus.length) {
    console.log(`\nUnmatched RTUs (${unmatchedRtus.length}):`)
    for (const line of unmatchedRtus) console.log(`  ${line}`)
  }

  if (dryRun) {
    console.log('\nDry run — no database writes.')
    return
  }

  for (const row of potWrites) {
    const { error } = await supabase.from('building_year_budgets').upsert(
      {
        building_id: row.building_id,
        year: row.year,
        budget: row.budget,
        note: row.note,
        capex_status: row.capex_status,
        capex_job_project_type: row.capex_job_project_type,
      },
      { onConflict: 'building_id,year' },
    )
    if (error) throw new Error(`Pot upsert failed ${row.address} ${row.year}: ${error.message}`)
  }

  for (const row of uniqueRtuWrites) {
    const { error } = await supabase
      .from('rtus')
      .update({
        replacement_year: row.year,
        replacement_note: row.note || null,
      })
      .eq('id', row.id)
    if (error) {
      throw new Error(`RTU update failed ${row.address} ${row.name}: ${error.message}`)
    }
  }

  const { error: settingsError } = await supabase.from('app_settings').upsert(
    {
      key: 'rtu_schedule_source',
      value: { sourceFile: excelPath.split(/[/\\]/).pop() ?? excelPath },
    },
    { onConflict: 'key' },
  )
  if (settingsError) throw new Error(settingsError.message)

  console.log(
    `\nDone. Upserted ${potWrites.length} Capex pots and ${uniqueRtuWrites.length} RTU years.`,
  )
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
