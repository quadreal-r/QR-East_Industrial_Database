#!/usr/bin/env node
/**
 * Excel report for Equipment sheet → replacement_year import matching.
 * Does not change the database.
 *
 * Usage:
 *   npm run report-equipment-replacement-years
 *   npm run report-equipment-replacement-years -- "C:\path\to\Capital.xlsx"
 */
import { createClient } from '@supabase/supabase-js'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import * as XLSX from 'xlsx'
import { loadDotEnvLocal } from './lib/load-dotenv-local.mjs'
import { parseEquipmentSheetRows } from '../src/lib/equipmentSheet'
import {
  buildBuildingAddressIndex,
  findBuildingBySheetAddress,
  findRtuInBuilding,
  normalizeRtuName,
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

const supabase = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})

type PortfolioRtu = Rtu & { replacement_year?: number | null }

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

  const rtus = await fetchAllPages<{
    id: number
    building_id: number
    name: string
    replacement_year: number | null
  }>((from, to) =>
    supabase
      .from('rtus')
      .select('id, building_id, name, replacement_year')
      .order('id')
      .range(from, to),
  )

  const byBuilding = new Map<number, PortfolioRtu[]>()
  for (const rtu of rtus) {
    const list = byBuilding.get(rtu.building_id) ?? []
    list.push({
      id: rtu.id,
      name: rtu.name,
      replacement_year: rtu.replacement_year,
    })
    byBuilding.set(rtu.building_id, list)
  }

  return buildings.map((b) => ({
    id: b.id,
    address: b.address,
    rtus: byBuilding.get(b.id) ?? [],
  })) as Building[]
}

function aoaSheet(rows: (string | number | null)[][]): XLSX.WorkSheet {
  return XLSX.utils.aoa_to_sheet(rows)
}

function stamp(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`
}

async function main() {
  console.log(`Reading ${excelPath}`)
  const buf = readFileSync(excelPath)
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
  const sheetRows = parseEquipmentSheetRows(ab)

  const buildings = await fetchPortfolio()
  const index = buildBuildingAddressIndex(buildings)
  const sourceFile = excelPath.split(/[/\\]/).pop() ?? excelPath

  type SetRow = {
    sheetAddress: string
    sheetProperty: string
    sheetLabel: string
    dbAddress: string
    dbRtu: string
    rtuId: number
    year: number
    dbYearNow: number | null
  }
  type ClearRow = Omit<SetRow, 'year'> & { sheetYear: string }
  type UnmatchedBuildingRow = {
    sheetAddress: string
    sheetProperty: string
    sheetLabel: string
    sheetYear: string
  }
  type UnmatchedRtuRow = UnmatchedBuildingRow & {
    dbAddress: string
    normalizedLabel: string
    dbRtuNames: string
  }

  const byRtuId = new Map<number, SetRow | ClearRow>()
  const unmatchedBuildings: UnmatchedBuildingRow[] = []
  const unmatchedRtus: UnmatchedRtuRow[] = []
  const matchedRtuIds = new Set<number>()

  for (const row of sheetRows) {
    const sheetYear = row.replacementYear ?? 'None (0/blank)'
    const building = findBuildingBySheetAddress(index, row.address, row.propertyAddress)
    if (!building) {
      unmatchedBuildings.push({
        sheetAddress: row.address,
        sheetProperty: row.propertyAddress,
        sheetLabel: row.rtuLabel,
        sheetYear: String(sheetYear),
      })
      continue
    }
    const rtu = findRtuInBuilding(building, row.rtuLabel)
    if (!rtu || typeof rtu.id !== 'number') {
      unmatchedRtus.push({
        sheetAddress: row.address,
        sheetProperty: row.propertyAddress,
        sheetLabel: row.rtuLabel,
        sheetYear: String(sheetYear),
        dbAddress: building.address,
        normalizedLabel: normalizeRtuName(row.rtuLabel),
        dbRtuNames: (building.rtus ?? []).map((u) => u.name).sort().join(', '),
      })
      continue
    }

    matchedRtuIds.add(rtu.id)
    const dbYearNow = (rtu as PortfolioRtu).replacement_year ?? null

    if (row.replacementYear) {
      byRtuId.set(rtu.id, {
        sheetAddress: row.address,
        sheetProperty: row.propertyAddress,
        sheetLabel: row.rtuLabel,
        dbAddress: building.address,
        dbRtu: rtu.name,
        rtuId: rtu.id,
        year: Number(row.replacementYear),
        dbYearNow,
      })
    } else {
      byRtuId.set(rtu.id, {
        sheetAddress: row.address,
        sheetProperty: row.propertyAddress,
        sheetLabel: row.rtuLabel,
        dbAddress: building.address,
        dbRtu: rtu.name,
        rtuId: rtu.id,
        sheetYear: 'None (0/blank)',
        dbYearNow,
      })
    }
  }

  const sets = [...byRtuId.values()].filter((r): r is SetRow => 'year' in r && typeof r.year === 'number')
  const clears = [...byRtuId.values()].filter((r): r is ClearRow => !('year' in r))

  sets.sort((a, b) => a.dbAddress.localeCompare(b.dbAddress) || a.dbRtu.localeCompare(b.dbRtu))
  clears.sort((a, b) => a.dbAddress.localeCompare(b.dbAddress) || a.dbRtu.localeCompare(b.dbRtu))
  unmatchedBuildings.sort((a, b) => a.sheetAddress.localeCompare(b.sheetAddress))
  unmatchedRtus.sort((a, b) => a.dbAddress.localeCompare(b.dbAddress) || a.sheetLabel.localeCompare(b.sheetLabel))

  const notInSheet: { dbAddress: string; dbRtu: string; rtuId: number; note: string }[] = []
  for (const b of buildings) {
    for (const rtu of b.rtus ?? []) {
      if (typeof rtu.id !== 'number' || matchedRtuIds.has(rtu.id)) continue
      notInSheet.push({
        dbAddress: b.address,
        dbRtu: rtu.name,
        rtuId: rtu.id,
        note: 'Not on Equipment sheet — year cleared by full replace',
      })
    }
  }
  notInSheet.sort((a, b) => a.dbAddress.localeCompare(b.dbAddress) || a.dbRtu.localeCompare(b.dbRtu))

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(
    wb,
    aoaSheet([
      ['Equipment replacement year import — match report'],
      ['Generated', new Date().toISOString()],
      ['Source workbook', sourceFile],
      ['Source path', excelPath],
      [],
      ['Metric', 'Count'],
      ['Equipment sheet rows', sheetRows.length],
      ['Portfolio buildings', buildings.length],
      ['Portfolio RTUs', buildings.reduce((n, b) => n + (b.rtus?.length ?? 0), 0)],
      ['Years set in database', sets.length],
      ['Matched & cleared to None (0/blank)', clears.length],
      ['Sheet rows — building not found', unmatchedBuildings.length],
      ['Sheet rows — RTU not found', unmatchedRtus.length],
      ['Portfolio RTUs not on sheet (cleared)', notInSheet.length],
      [],
      ['Notes'],
      ['0, blank, and Demolition on the sheet = None'],
      ['Import was a full replace: all RTU years cleared, then matched years written'],
      ['Db year now = current replacement_year in the database after import'],
    ]),
    'Summary',
  )

  XLSX.utils.book_append_sheet(
    wb,
    aoaSheet([
      [
        'Sheet building',
        'Sheet property',
        'Sheet description',
        'DB building',
        'DB RTU',
        'RTU id',
        'Year set',
        'DB year now',
      ],
      ...sets.map((r) => [
        r.sheetAddress,
        r.sheetProperty,
        r.sheetLabel,
        r.dbAddress,
        r.dbRtu,
        r.rtuId,
        r.year,
        r.dbYearNow,
      ]),
    ]),
    'Years set',
  )

  XLSX.utils.book_append_sheet(
    wb,
    aoaSheet([
      [
        'Sheet building',
        'Sheet property',
        'Sheet description',
        'DB building',
        'DB RTU',
        'RTU id',
        'Sheet year',
        'DB year now',
      ],
      ...clears.map((r) => [
        r.sheetAddress,
        r.sheetProperty,
        r.sheetLabel,
        r.dbAddress,
        r.dbRtu,
        r.rtuId,
        r.sheetYear,
        r.dbYearNow,
      ]),
    ]),
    'Cleared to None',
  )

  XLSX.utils.book_append_sheet(
    wb,
    aoaSheet([
      ['Sheet building', 'Sheet property', 'Sheet description', 'Sheet year'],
      ...unmatchedBuildings.map((r) => [r.sheetAddress, r.sheetProperty, r.sheetLabel, r.sheetYear]),
    ]),
    'Unmatched building',
  )

  XLSX.utils.book_append_sheet(
    wb,
    aoaSheet([
      [
        'Sheet building',
        'Sheet property',
        'Sheet description',
        'Normalized label',
        'Sheet year',
        'DB building',
        'DB RTU names at building',
      ],
      ...unmatchedRtus.map((r) => [
        r.sheetAddress,
        r.sheetProperty,
        r.sheetLabel,
        r.normalizedLabel,
        r.sheetYear,
        r.dbAddress,
        r.dbRtuNames,
      ]),
    ]),
    'Unmatched RTU',
  )

  XLSX.utils.book_append_sheet(
    wb,
    aoaSheet([
      ['DB building', 'DB RTU', 'RTU id', 'Note'],
      ...notInSheet.map((r) => [r.dbAddress, r.dbRtu, r.rtuId, r.note]),
    ]),
    'Not on sheet',
  )

  const reportDir = join(process.cwd(), 'reports')
  mkdirSync(reportDir, { recursive: true })
  const reportName = `equipment-replacement-years-import-${stamp()}.xlsx`
  const reportPath = join(reportDir, reportName)
  const besideSource = join(
    dirname(excelPath),
    `Equipment-Replacement-Years-Import-Report-${stamp()}.xlsx`,
  )

  const bytes = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
  writeFileSync(reportPath, bytes)

  try {
    writeFileSync(besideSource, bytes)
    console.log(`Report written:\n  ${reportPath}\n  ${besideSource}`)
  } catch (err) {
    console.log(`Report written:\n  ${reportPath}`)
    console.warn('Could not also save beside the Capital workbook:', err)
  }

  console.log({
    yearsSet: sets.length,
    clearedToNone: clears.length,
    unmatchedBuilding: unmatchedBuildings.length,
    unmatchedRtu: unmatchedRtus.length,
    notOnSheet: notInSheet.length,
  })
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
