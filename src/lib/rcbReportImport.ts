import * as XLSX from 'xlsx'
import { rcbReplacementYearKey } from '@/lib/costEstimator'
import { assertSheetHeaders } from '@/lib/excelHeaders'
import {
  RCB_ALL_UNITS_HEADERS,
  RCB_AGE_ON_REPL_YEAR_HEADER,
  RCB_AGE_ON_REPL_YEAR_HEADER_ALIASES,
  RCB_ELIGIBLE_YEAR_HEADER,
  RCB_ELIGIBLE_YEAR_HEADER_ALIASES,
  RCB_ESTIMATED_COST_HEADER,
  RCB_ESTIMATED_COST_HEADER_ALIASES,
  RCB_RTU_ALLOCATION_HEADER,
  RCB_RTU_ALLOCATION_HEADER_ALIASES,
} from '@/lib/rcbPresentation'
import {
  buildBuildingAddressIndex,
  findBuildingBySheetAddress,
  findRtuInBuilding,
} from '@/lib/rtuMatch'
import {
  computeRtuAllInFromComponents,
  parseTonnageLabel,
  type RtuPricingRow,
} from '@/lib/rtuPricingSheet'
import type { Building, CostBasis } from '@/types/domain'

const BUDGET_ALIASES = new Set(
  RCB_RTU_ALLOCATION_HEADER_ALIASES.map((h) => h.toLowerCase()),
)
const COST_ALIASES = new Set(
  RCB_ESTIMATED_COST_HEADER_ALIASES.map((h) => h.toLowerCase()),
)
const AGE_ALIASES = new Set(
  RCB_AGE_ON_REPL_YEAR_HEADER_ALIASES.map((h) => h.toLowerCase()),
)
const NOTES_HEADER = 'notes'

/** Year column like `2026` or legacy `2026 (CAD)`. */
function matchPricingYearHeader(value: unknown): string | null {
  const match = cellText(value).match(/^(\d{4})(?:\s*\(cad\))?$/i)
  return match?.[1] ?? null
}

export interface RcbAllUnitsSheetRow {
  building: string
  unit: string
  replacementYear: string | null
  budget: number | null
  notes: string
  hasBudgetCell: boolean
  hasNotesCell: boolean
  hasYearCell: boolean
}

export interface RcbReportPricingRow {
  tonnageKey: number
  label: string
  baseYear: string
  baseAllIn: number
}

export interface RcbAllUnitsImportResult {
  replacementYears: Record<string, string>
  /** `null` clears an existing note. */
  notes: Record<string, string | null>
  /** `null` clears an existing budget. */
  budgets: Record<string, number | null>
  stats: {
    totalRows: number
    matchedYears: number
    matchedNotes: number
    matchedBudgets: number
    unmatchedBuilding: number
    unmatchedRtu: number
    skippedNoYear: number
  }
}

export interface RcbPricingMergeResult {
  rows: RtuPricingRow[]
  stats: {
    totalRows: number
    matchedTiers: number
    updatedTiers: number
    unmatchedTiers: number
  }
}

export interface RcbReportImportResult {
  allUnits: RcbAllUnitsImportResult
  pricing: RcbPricingMergeResult | null
  pricingBasis: CostBasis | null
}

function sheetMatrix(ws: XLSX.WorkSheet): unknown[][] {
  return XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) as unknown[][]
}

function cellText(value: unknown): string {
  return String(value ?? '').trim()
}

function parseYear(raw: unknown): string | null {
  if (raw == null || raw === '' || raw === 0 || raw === '0') return null
  const text = String(raw).trim()
  if (!text || /^0+$/.test(text) || /^none$/i.test(text)) return null
  const year = Math.round(Number(text))
  if (!Number.isFinite(year) || year < 2000 || year > 2100) return null
  return String(year)
}

function parseBudget(raw: unknown): { value: number | null; present: boolean } {
  if (raw == null || raw === '') return { value: null, present: false }
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return { value: raw > 0 ? Math.round(raw) : null, present: true }
  }
  const text = String(raw).trim()
  if (!text) return { value: null, present: false }
  const n = Number(text.replace(/[$,]/g, ''))
  if (!Number.isFinite(n)) return { value: null, present: false }
  return { value: n > 0 ? Math.round(n) : null, present: true }
}

function headerIndexMap(row: unknown[]): Map<string, number> {
  const map = new Map<string, number>()
  row.forEach((cell, index) => {
    const key = cellText(cell).toLowerCase()
    if (key) map.set(key, index)
  })
  return map
}

/** Parse the RCB export “All Units” sheet (report format). */
export function parseRcbAllUnitsSheet(data: ArrayBuffer): RcbAllUnitsSheetRow[] {
  const wb = XLSX.read(data, { type: 'array' })
  const sheetName = wb.SheetNames.find((name) => /^all units$/i.test(name.trim()))
  if (!sheetName) return []

  const matrix = sheetMatrix(wb.Sheets[sheetName]!)
  const yearAliases = new Set(
    RCB_ELIGIBLE_YEAR_HEADER_ALIASES.map((h) => h.toLowerCase()),
  )
  const headerIdx = matrix.findIndex((row) => {
    const headers = headerIndexMap(row)
    const hasYear = [...yearAliases].some((alias) => headers.has(alias))
    return headers.has('building') && headers.has('unit') && hasYear
  })
  if (headerIdx < 0) {
    throw new Error(
      `Import blocked: “All Units” sheet headers do not match the expected export format (need “${RCB_ELIGIBLE_YEAR_HEADER}”). Re-export from RTU Replacement Cost Center and try again.`,
    )
  }

  // Normalize year / cost / allocation / age header aliases so assertSheetHeaders accepts older exports.
  const headerRow = [...(matrix[headerIdx] ?? [])]
  for (let i = 0; i < headerRow.length; i++) {
    const key = cellText(headerRow[i]).toLowerCase()
    if (yearAliases.has(key)) headerRow[i] = RCB_ELIGIBLE_YEAR_HEADER
    if (COST_ALIASES.has(key)) headerRow[i] = RCB_ESTIMATED_COST_HEADER
    if (BUDGET_ALIASES.has(key)) headerRow[i] = RCB_RTU_ALLOCATION_HEADER
    if (AGE_ALIASES.has(key)) headerRow[i] = RCB_AGE_ON_REPL_YEAR_HEADER
  }
  assertSheetHeaders(headerRow, RCB_ALL_UNITS_HEADERS, 'All Units')

  const headers = headerIndexMap(matrix[headerIdx]!)
  const buildingCol = headers.get('building')!
  const unitCol = headers.get('unit')!
  const yearCol = [...yearAliases]
    .map((alias) => headers.get(alias))
    .find((col): col is number => col != null)!
  const budgetCol = [...BUDGET_ALIASES]
    .map((alias) => headers.get(alias))
    .find((col): col is number => col != null)!
  const notesCol = headers.get(NOTES_HEADER)!

  const rows: RcbAllUnitsSheetRow[] = []
  for (let r = headerIdx + 1; r < matrix.length; r++) {
    const line = matrix[r] ?? []
    const building = cellText(line[buildingCol])
    const unit = cellText(line[unitCol])
    if (!building || !unit) continue
    if (/^total$/i.test(building)) continue

    const yearRaw = line[yearCol]
    const hasYearCell = yearRaw != null && cellText(yearRaw) !== ''
    const budgetParsed = parseBudget(line[budgetCol])
    const notes = cellText(line[notesCol])

    rows.push({
      building,
      unit,
      replacementYear: parseYear(yearRaw),
      budget: budgetParsed.value,
      notes,
      hasBudgetCell: budgetParsed.present,
      hasNotesCell: true,
      hasYearCell,
    })
  }
  return rows
}

export function applyRcbAllUnitsRows(
  sheetRows: RcbAllUnitsSheetRow[],
  buildings: Building[],
): RcbAllUnitsImportResult {
  const index = buildBuildingAddressIndex(buildings)
  const replacementYears: Record<string, string> = {}
  const notes: Record<string, string | null> = {}
  const budgets: Record<string, number | null> = {}
  const stats = {
    totalRows: sheetRows.length,
    matchedYears: 0,
    matchedNotes: 0,
    matchedBudgets: 0,
    unmatchedBuilding: 0,
    unmatchedRtu: 0,
    skippedNoYear: 0,
  }

  for (const row of sheetRows) {
    const building = findBuildingBySheetAddress(index, row.building)
    if (!building) {
      stats.unmatchedBuilding++
      continue
    }
    const rtu = findRtuInBuilding(building, row.unit)
    if (!rtu) {
      stats.unmatchedRtu++
      continue
    }

    const key = rcbReplacementYearKey(building.address, rtu.name)

    if (row.hasYearCell && row.replacementYear) {
      replacementYears[key] = row.replacementYear
      stats.matchedYears++
    } else if (row.hasYearCell) {
      stats.skippedNoYear++
    }

    if (row.hasNotesCell) {
      notes[key] = row.notes ? row.notes : null
      stats.matchedNotes++
    }

    if (row.hasBudgetCell) {
      budgets[key] = row.budget
      stats.matchedBudgets++
    } else if (row.budget != null) {
      budgets[key] = row.budget
      stats.matchedBudgets++
    }
  }

  return { replacementYears, notes, budgets, stats }
}

function detectPricingBasis(matrix: unknown[][]): CostBasis | null {
  for (const row of matrix.slice(0, 6)) {
    const text = row.map(cellText).join(' ').toLowerCase()
    if (!text.includes('pricing basis')) continue
    if (text.includes('hybrid')) return 'hyb'
    if (text.includes('standard') || text.includes('xion')) return 'std'
  }
  return null
}

/** Parse the RCB export “RTU Pricing” sheet (unit size + all-in by year). */
export function parseRcbReportPricingSheet(data: ArrayBuffer): {
  basis: CostBasis | null
  rows: RcbReportPricingRow[]
} {
  const wb = XLSX.read(data, { type: 'array' })
  const sheetName =
    wb.SheetNames.find((name) => /^rtu pricing$/i.test(name.trim())) ?? null
  if (!sheetName) return { basis: null, rows: [] }

  const matrix = sheetMatrix(wb.Sheets[sheetName]!)
  const basis = detectPricingBasis(matrix)

  const headerIdx = matrix.findIndex((row) => {
    const first = cellText(row[0]).toLowerCase()
    return first === 'unit size' && row.some((cell) => matchPricingYearHeader(cell) != null)
  })
  if (headerIdx < 0) {
    // Capital “RTU Pricing” sheets use a different layout — leave empty for those.
    // Callers that require the report format should use assertRcbReportPricingHeaders.
    return { basis, rows: [] }
  }

  const header = matrix[headerIdx] ?? []
  let baseYearCol = -1
  let baseYear = ''
  for (let c = 1; c < header.length; c++) {
    const year = matchPricingYearHeader(header[c])
    if (year) {
      baseYearCol = c
      baseYear = year
      break
    }
  }
  if (baseYearCol < 0) return { basis, rows: [] }

  const rows: RcbReportPricingRow[] = []
  for (let r = headerIdx + 1; r < matrix.length; r++) {
    const line = matrix[r] ?? []
    const label = cellText(line[0])
    if (!label || !/ton/i.test(label)) continue
    const tonnageKey = parseTonnageLabel(label)
    if (tonnageKey == null) continue
    const raw = line[baseYearCol]
    const n = typeof raw === 'number' ? raw : Number(String(raw ?? '').replace(/[$,]/g, ''))
    if (!Number.isFinite(n) || n <= 0) continue
    rows.push({
      tonnageKey,
      label,
      baseYear,
      baseAllIn: Math.round(n),
    })
  }

  return { basis, rows }
}

/**
 * Write report all-in base-year costs back into Cost DB component rows.
 * Adjusts supplyHyb (hybrid) or supplyStd (standard) so computed all-in matches;
 * leaves other component columns and unmatched tonnage tiers alone.
 */
export function mergeRcbReportPricingIntoRows(
  existing: RtuPricingRow[],
  reportRows: RcbReportPricingRow[],
  basis: CostBasis | null,
): RcbPricingMergeResult {
  const effectiveBasis: CostBasis = basis ?? 'hyb'
  const byKey = new Map(existing.map((row) => [row.tonnageKey, { ...row }]))
  let matchedTiers = 0
  let updatedTiers = 0
  let unmatchedTiers = 0

  for (const report of reportRows) {
    const current = byKey.get(report.tonnageKey)
    if (!current) {
      unmatchedTiers++
      continue
    }
    matchedTiers++

    const mult = current.supervisoryMult > 0 ? current.supervisoryMult : 1.05
    const other =
      current.install +
      current.consulting +
      current.structural +
      current.serviceBalancing +
      current.electrical +
      current.miscellaneous
    const supply = Math.max(0, Math.round(report.baseAllIn / mult - other))
    const next = { ...current }
    if (effectiveBasis === 'hyb') next.supplyHyb = supply
    else next.supplyStd = supply

    const computed = computeRtuAllInFromComponents(next, effectiveBasis)
    if (computed !== computeRtuAllInFromComponents(current, effectiveBasis)) {
      updatedTiers++
    }
    byKey.set(report.tonnageKey, next)
  }

  // Preserve original order; only tiers that existed remain.
  const rows = existing.map((row) => byKey.get(row.tonnageKey) ?? row)

  return {
    rows,
    stats: {
      totalRows: reportRows.length,
      matchedTiers,
      updatedTiers,
      unmatchedTiers,
    },
  }
}

/** Require the RCB report “RTU Pricing” header row (Unit Size + year columns). */
export function assertRcbReportPricingHeaders(data: ArrayBuffer): void {
  const wb = XLSX.read(data, { type: 'array' })
  const sheetName =
    wb.SheetNames.find((name) => /^rtu pricing$/i.test(name.trim())) ?? null
  if (!sheetName) {
    throw new Error(
      'Import blocked: missing “RTU Pricing” sheet. Re-export from RTU Replacement Cost Center and try again.',
    )
  }
  const matrix = sheetMatrix(wb.Sheets[sheetName]!)
  const headerIdx = matrix.findIndex((row) => {
    const first = cellText(row[0]).toLowerCase()
    return first === 'unit size' && row.some((cell) => matchPricingYearHeader(cell) != null)
  })
  if (headerIdx < 0) {
    throw new Error(
      'Import blocked: “RTU Pricing” sheet headers do not match the expected export format (need “Unit Size” and a year column like “2026”). Re-export from RTU Replacement Cost Center and try again.',
    )
  }
}

export function importRcbReportWorkbook(
  data: ArrayBuffer,
  buildings: Building[],
  existingPricing: RtuPricingRow[],
): RcbReportImportResult {
  assertRcbReportPricingHeaders(data)
  const allUnitsRows = parseRcbAllUnitsSheet(data)
  const allUnits = applyRcbAllUnitsRows(allUnitsRows, buildings)

  const { basis, rows: pricingRows } = parseRcbReportPricingSheet(data)
  const pricing =
    pricingRows.length > 0
      ? mergeRcbReportPricingIntoRows(existingPricing, pricingRows, basis)
      : null

  return { allUnits, pricing, pricingBasis: basis }
}

/** True when the RTU Pricing sheet looks like the RCB report (not Capital D–L). */
export function isRcbReportPricingSheet(data: ArrayBuffer): boolean {
  const { rows } = parseRcbReportPricingSheet(data)
  return rows.length > 0
}
