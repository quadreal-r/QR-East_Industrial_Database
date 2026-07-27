import * as XLSX from 'xlsx'
import type { Building } from '@/types/domain'
import { buildBuildingAddressIndex, findBuildingBySheetAddress, findRtuInBuilding } from '@/lib/rtuMatch'
import { rcbReplacementYearKey } from '@/lib/costEstimator'

export interface EquipmentSheetRow {
  address: string
  propertyAddress: string
  rtuLabel: string
  replacementYear: string | null
  notes: string
}

export interface EquipmentImportResult {
  replacementYears: Record<string, string>
  notes: Record<string, string>
  rows: EquipmentSheetRow[]
  stats: {
    totalRows: number
    matchedYears: number
    matchedNotes: number
    skippedNoYear: number
    skippedInvalidYear: number
    unmatchedBuilding: number
    unmatchedRtu: number
  }
}

const EQUIPMENT_COL = {
  property: 1,
  building: 2,
  description: 3,
  replacementYear: 4,
  notes: 5, // column F — notes about replacement year
} as const

function parseReplacementYear(raw: unknown): string | null {
  if (raw == null || raw === '' || raw === 0 || raw === '0') return null
  const text = String(raw).trim()
  if (!text || /^0+$/.test(text)) return null
  if (/demolition/i.test(text)) return null

  const year = Math.round(Number(text))
  if (!Number.isFinite(year) || year < 2000 || year > 2100) return null
  return String(year)
}

export function parseEquipmentSheetRows(data: ArrayBuffer): EquipmentSheetRow[] {
  const wb = XLSX.read(data, { type: 'array' })
  const sheetName = wb.SheetNames.find((name) => /^equipment$/i.test(name))
  if (!sheetName) return []

  const ws = wb.Sheets[sheetName]
  if (!ws?.['!ref']) return []

  const matrix = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) as unknown[][]
  const headerIdx = matrix.findIndex(
    (row) => String(row[EQUIPMENT_COL.replacementYear] ?? '').trim() === 'RTU Replacement Year',
  )
  if (headerIdx < 0) {
    throw new Error(
      'Import blocked: “Equipment” sheet headers do not match the expected Capital workbook format (column E must be “RTU Replacement Year”).',
    )
  }

  const rows: EquipmentSheetRow[] = []
  for (let r = headerIdx + 1; r < matrix.length; r++) {
    const line = matrix[r] ?? []
    const address = String(line[EQUIPMENT_COL.building] ?? '').trim()
    const propertyAddress = String(line[EQUIPMENT_COL.property] ?? '').trim()
    const rtuLabel = String(line[EQUIPMENT_COL.description] ?? '').trim()
    if ((!address && !propertyAddress) || !rtuLabel) continue

    rows.push({
      address,
      propertyAddress,
      rtuLabel,
      replacementYear: parseReplacementYear(line[EQUIPMENT_COL.replacementYear]),
      notes: String(line[EQUIPMENT_COL.notes] ?? '').trim(),
    })
  }

  return rows
}

export function applyEquipmentRowsToPortfolio(
  sheetRows: EquipmentSheetRow[],
  buildings: Building[],
): EquipmentImportResult {
  const index = buildBuildingAddressIndex(buildings)

  const replacementYears: Record<string, string> = {}
  const notes: Record<string, string> = {}
  const stats = {
    totalRows: sheetRows.length,
    matchedYears: 0,
    matchedNotes: 0,
    skippedNoYear: 0,
    skippedInvalidYear: 0,
    unmatchedBuilding: 0,
    unmatchedRtu: 0,
  }

  for (const row of sheetRows) {
    const building = findBuildingBySheetAddress(index, row.address, row.propertyAddress)
    if (!building) {
      stats.unmatchedBuilding++
      continue
    }

    const rtu = findRtuInBuilding(building, row.rtuLabel)
    if (!rtu) {
      stats.unmatchedRtu++
      continue
    }

    const key = rcbReplacementYearKey(building.address, rtu.name)

    if (row.replacementYear) {
      replacementYears[key] = row.replacementYear
      stats.matchedYears++
    } else if (row.replacementYear === null) {
      stats.skippedNoYear++
    } else {
      stats.skippedInvalidYear++
    }

    const trimmedNotes = row.notes.trim()
    if (trimmedNotes) {
      notes[key] = trimmedNotes
      stats.matchedNotes++
    }
  }

  return { replacementYears, notes, rows: sheetRows, stats }
}

export function importEquipmentSchedule(
  data: ArrayBuffer,
  buildings: Building[],
): EquipmentImportResult {
  const rows = parseEquipmentSheetRows(data)
  return applyEquipmentRowsToPortfolio(rows, buildings)
}
