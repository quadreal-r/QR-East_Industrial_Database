#!/usr/bin/env node
/**
 * Import Capex Items Description into building-year Capex pot notes (not RTUs).
 *
 * - Include every Capex row where Job Project Type = HVAC (no Description text filter)
 * - Status = Approved, Submitted, or Rejected (building Capex pots only)
 * - Year from Description when present, else from Capex year columns with dollars
 * - Writes note + status + job type onto building_year_budgets
 *
 * Usage:
 *   npm run import-capex-rtu-notes -- "C:\path\to\Capex.xlsx" --dry-run
 *   npm run import-capex-rtu-notes -- "C:\path\to\Capex.xlsx"
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import * as XLSX from 'xlsx'
import { loadDotEnvLocal } from './lib/load-dotenv-local.mjs'
import {
  buildCapexBuildingYearNotes,
  collectCapexJobTypesByMoneyYear,
  collectCapexRtuDescriptionsByAddressYear,
  collectCapexStatusesByMoneyYear,
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
  console.error('Usage: npm run import-capex-rtu-notes -- <excel-path> [--dry-run]')
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

async function writePotNotes(
  notes: Record<string, string>,
  statuses: Record<string, string> = {},
  jobTypes: Record<string, string> = {},
): Promise<number> {
  const buildings = await fetchAllPages<{ id: number; address: string }>((from, to) =>
    supabase.from('buildings').select('id, address').range(from, to),
  )
  const idByAddress = new Map(buildings.map((b) => [b.address, b.id]))

  // Update every pot that has a note, status, and/or job project type.
  const keys = new Set([
    ...Object.keys(notes),
    ...Object.keys(statuses),
    ...Object.keys(jobTypes),
  ])
  let written = 0
  for (const key of keys) {
    const sep = key.lastIndexOf('::')
    if (sep <= 0) continue
    const address = key.slice(0, sep)
    const year = Number.parseInt(key.slice(sep + 2), 10)
    const buildingId = idByAddress.get(address)
    if (buildingId == null || !Number.isFinite(year)) {
      console.warn(`Skip pot note (building missing): ${key}`)
      continue
    }

    const { data: pot, error: findError } = await supabase
      .from('building_year_budgets')
      .select('id, note')
      .eq('building_id', buildingId)
      .eq('year', year)
      .maybeSingle()
    if (findError) throw new Error(`Find pot failed (${key}): ${findError.message}`)
    if (!pot) {
      console.warn(`Skip pot note (no Capex pot): ${key}`)
      continue
    }

    const nextNote =
      Object.prototype.hasOwnProperty.call(notes, key)
        ? notes[key]!.trim() || null
        : pot.note
    const nextStatus = statuses[key]?.trim() || null
    const nextJobType = jobTypes[key]?.trim() || null

    const { error } = await supabase
      .from('building_year_budgets')
      .update({
        note: nextNote,
        capex_status: nextStatus,
        capex_job_project_type: nextJobType,
      })
      .eq('id', pot.id)
    if (error) throw new Error(`Update pot note failed (${key}): ${error.message}`)
    written++
  }
  return written
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
  const { byAddressYear, stats: parseStats } = collectCapexRtuDescriptionsByAddressYear(rows)

  console.log('Capex HVAC Description → building Capex pots (status stays on buildings)')
  console.log(`  HVAC rows:              ${parseStats.hvacRows}`)
  console.log(`  Kept (Apr+Sub+Rej):     ${parseStats.keptRows}`)
  console.log(`  Address×year keys:      ${parseStats.addressYearKeys}`)
  console.log(`  Skipped status:         ${parseStats.skippedStatus}`)

  const buildings = await loadBuildings()
  const statusByMoneyYear = collectCapexStatusesByMoneyYear(rows)
  const jobTypeByMoneyYear = collectCapexJobTypesByMoneyYear(rows)
  const {
    notes: potNotes,
    statuses: potStatuses,
    jobTypes: potJobTypes,
    stats: potNoteStats,
  } = buildCapexBuildingYearNotes(
    byAddressYear,
    buildings,
    statusByMoneyYear,
    jobTypeByMoneyYear,
  )

  console.log('\nCapex pot notes (building-year only — not applied to RTUs)')
  console.log(`  Pot notes to write:      ${potNoteStats.notesWritten}`)
  console.log(`  Unmatched addresses:     ${potNoteStats.unmatchedAddresses.length}`)
  const potSample = Object.entries(potNotes)
    .filter(([k]) => k.includes('50 Leek') || k.includes('Leek') || k.includes('Dixie'))
    .slice(0, 8)
    .map(([k, v]) => `  ${k} ← ${v}`)
  if (potSample.length) {
    console.log('  Sample:')
    console.log(potSample.join('\n'))
  }

  if (dryRun) {
    console.log('\nDry run only — no Supabase writes.')
    return
  }

  // Capex status/notes belong on building pots — clear older Capex stamps from RTUs.
  const { data: cleared, error: clearError } = await supabase
    .from('rtus')
    .update({ replacement_note: null })
    .like('replacement_note', '(From CAPEX%')
    .select('id')
  if (clearError) throw new Error(`Clear Capex RTU notes failed: ${clearError.message}`)
  console.log(`\nCleared Capex stamps from ${cleared?.length ?? 0} RTU notes.`)

  const potWritten = await writePotNotes(potNotes, potStatuses, potJobTypes)
  console.log(`Wrote ${potWritten} Capex pot notes (with status + job type) to Supabase.`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
