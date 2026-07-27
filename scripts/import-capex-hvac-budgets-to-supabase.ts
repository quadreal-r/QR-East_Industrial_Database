#!/usr/bin/env node
/**
 * Import Capex HVAC job budgets as building-year pots (not per-RTU splits).
 *
 * - Job Project Type = HVAC, Status = Approved or Submitted
 * - Year columns 2025–2031 → building_year_budgets
 * - Clears all rtus.budget so RTU fields start empty for in-app allocation
 *
 * Usage:
 *   npm run import-capex-hvac-budgets -- "C:\path\to\Capex.xlsx" --dry-run
 *   npm run import-capex-hvac-budgets -- "C:\path\to\Capex.xlsx"
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import * as XLSX from 'xlsx'
import { loadDotEnvLocal } from './lib/load-dotenv-local.mjs'
import {
  buildCapexBuildingYearBudgets,
  buildCapexBuildingYearNotes,
  CAPEX_HVAC_YEAR_COLUMNS,
  collectCapexJobTypesByMoneyYear,
  collectCapexRtuDescriptionsByAddressYear,
  collectCapexStatusesByMoneyYear,
  sumCapexHvacBudgetsByAddressYear,
  type CapexItemRow,
} from '../src/lib/capexHvacBudgetImport'
import type { Building, Rtu } from '../src/types/domain'

loadDotEnvLocal()

const supabaseUrl = process.env.SUPABASE_URL?.trim() || process.env.VITE_SUPABASE_URL?.trim()
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()

if (!supabaseUrl || !serviceKey) {
  console.error('Set SUPABASE_URL (or VITE_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY in .env.local')
  process.exit(1)
}

const excelPath = process.argv[2]
const dryRun = process.argv.includes('--dry-run')

if (!excelPath || excelPath.startsWith('--')) {
  console.error('Usage: npm run import-capex-hvac-budgets -- <excel-path> [--dry-run]')
  process.exit(1)
}

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
      supabase.from('rtus').select('id, building_id, name, description, lat, lng').range(from, to),
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

async function clearAllRtuBudgets(): Promise<number> {
  const { error, count } = await supabase
    .from('rtus')
    .update({ budget: null }, { count: 'exact' })
    .not('budget', 'is', null)
  if (error) throw new Error(`Clear RTU budgets failed: ${error.message}`)
  return count ?? 0
}

async function replaceBuildingYearBudgets(
  pots: Record<string, number>,
  notes: Record<string, string> = {},
  statuses: Record<string, string> = {},
  jobTypes: Record<string, string> = {},
): Promise<number> {
  const buildings = await fetchAllPages<{ id: number; address: string }>((from, to) =>
    supabase.from('buildings').select('id, address').range(from, to),
  )
  const idByAddress = new Map(buildings.map((b) => [b.address, b.id]))

  const { error: clearError } = await supabase.from('building_year_budgets').delete().neq('id', 0)
  if (clearError) throw new Error(`Clear building year budgets failed: ${clearError.message}`)

  const rows: {
    building_id: number
    year: number
    budget: number
    note: string | null
    capex_status: string | null
    capex_job_project_type: string | null
  }[] = []
  for (const [key, amount] of Object.entries(pots)) {
    if (!(amount > 0)) continue
    const sep = key.lastIndexOf('::')
    if (sep <= 0) continue
    const address = key.slice(0, sep)
    const year = Number.parseInt(key.slice(sep + 2), 10)
    const buildingId = idByAddress.get(address)
    if (buildingId == null || !Number.isFinite(year)) {
      console.warn(`Skip pot (building missing): ${key}`)
      continue
    }
    rows.push({
      building_id: buildingId,
      year,
      budget: Math.round(amount),
      note: notes[key]?.trim() || null,
      capex_status: statuses[key]?.trim() || null,
      capex_job_project_type: jobTypes[key]?.trim() || null,
    })
  }

  if (!rows.length) return 0
  const { error } = await supabase.from('building_year_budgets').insert(rows)
  if (error) throw new Error(`Insert building year budgets failed: ${error.message}`)
  return rows.length
}

function logCapexTotalsByYear(pots: Record<string, number>): void {
  console.log('\nCapex HVAC pots by year (Approved + Submitted):')
  for (const year of CAPEX_HVAC_YEAR_COLUMNS) {
    let potsForYear = 0
    let total = 0
    for (const [key, amount] of Object.entries(pots)) {
      if (!key.endsWith(`::${year}`) || !(amount > 0)) continue
      potsForYear++
      total += amount
    }
    console.log(
      `  ${year}: ${potsForYear} building pots · $${Math.round(total).toLocaleString('en-CA')}`,
    )
  }
}

async function main() {
  const buffer = readFileSync(excelPath)
  const wb = XLSX.read(buffer, { type: 'buffer' })
  const sheet = wb.Sheets['Capex Items']
  if (!sheet) {
    console.error('Workbook is missing a "Capex Items" sheet.')
    process.exit(1)
  }

  const rows = XLSX.utils.sheet_to_json(sheet, { defval: null }) as CapexItemRow[]
  const { byAddressYear, stats: parseStats } = sumCapexHvacBudgetsByAddressYear(rows)

  console.log('Capex HVAC parse (building-year pots)')
  console.log(`  HVAC rows:              ${parseStats.hvacRows}`)
  console.log(`  Kept (Apr+Sub):         ${parseStats.keptRows}`)
  console.log(`  Building×year buckets:  ${parseStats.buildingYearBuckets}`)
  console.log(`  Portfolio total:        $${parseStats.portfolioTotal.toLocaleString('en-CA')}`)

  const buildings = await loadBuildings()
  const { buildingYearBudgets, stats: applyStats } = buildCapexBuildingYearBudgets(
    byAddressYear,
    buildings,
  )
  const { byAddressYear: descByAddressYear } = collectCapexRtuDescriptionsByAddressYear(rows)
  const statusByMoneyYear = collectCapexStatusesByMoneyYear(rows)
  const jobTypeByMoneyYear = collectCapexJobTypesByMoneyYear(rows)
  const {
    notes: potNotes,
    statuses: potStatuses,
    jobTypes: potJobTypes,
    stats: noteStats,
  } = buildCapexBuildingYearNotes(
    descByAddressYear,
    buildings,
    statusByMoneyYear,
    jobTypeByMoneyYear,
  )

  console.log('\nAssign to buildings (RTUs stay empty)')
  console.log(`  Matched building×years: ${applyStats.matchedBuildingYears}`)
  console.log(`  Unmatched addresses:    ${applyStats.unmatchedAddresses.length}`)
  console.log(`  Building-year pots:     ${applyStats.buildingYearBudgetsWritten}`)
  console.log(`  Capex pot notes:        ${noteStats.notesWritten}`)
  console.log(
    `  Matched total:          $${applyStats.portfolioTotalMatched.toLocaleString('en-CA')}`,
  )
  logCapexTotalsByYear(buildingYearBudgets)

  if (applyStats.unmatchedAddresses.length) {
    console.log('\nUnmatched:')
    for (const addr of applyStats.unmatchedAddresses.slice(0, 20)) console.log(`  - ${addr}`)
  }

  const sample = Object.entries(buildingYearBudgets)
    .slice(0, 10)
    .map(([k, v]) => `  ${k} = $${v.toLocaleString('en-CA')}${potNotes[k] ? ` · ${potNotes[k]}` : ''}`)
  console.log('\nSample building-year pots:')
  console.log(sample.join('\n') || '  (none)')

  if (dryRun) {
    console.log('\nDry run only — no Supabase writes.')
    return
  }

  const clearedRtus = await clearAllRtuBudgets()
  console.log(`\nCleared ${clearedRtus} RTU budget values (fields left empty for app entry).`)
  const written = await replaceBuildingYearBudgets(
    buildingYearBudgets,
    potNotes,
    potStatuses,
    potJobTypes,
  )
  console.log(
    `Wrote ${written} building-year Capex pots (notes + status + type) for years ${CAPEX_HVAC_YEAR_COLUMNS.join(', ')}.`,
  )
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
