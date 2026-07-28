import ExcelJS from 'exceljs'
import { normalizeCapexBu } from '@/lib/capexSharedBu'
import { findRtuInBuilding, normalizeRtuName } from '@/lib/rtuMatch'
import type { Building } from '@/types/domain'

/** Yellow fill → Submitted Capex amount. */
export const SYLVIA_YELLOW_ARGB = 'FFFFFF00'
/** Green fill → Approved Capex amount. */
export const SYLVIA_GREEN_ARGB = 'FF92D050'

export type SylviaCapexStatus = 'Approved' | 'Submitted' | 'Rejected'

export interface SylviaAmountCell {
  sheetRow: number
  bu: string
  propertyName: string
  year: string
  kind: 'Original' | 'Proposed'
  amount: number
  /** From cell fill: green=Approved, yellow=Submitted; else Status column / default. */
  status: SylviaCapexStatus
  colored: boolean
  note: string
  description: string
  jobProjectType: string
  /** RTU numbers mentioned in the cell comment (e.g. 3, 10). */
  rtuNumbers: string[]
}

export interface SylviaCapexPot {
  bu: string
  propertyName: string
  year: string
  amount: number
  status: SylviaCapexStatus
  note: string
  jobProjectType: string
  description: string
  sheetRow: number
  rtuNumbers: string[]
}

export interface SylviaRtuYearAssignment {
  bu: string
  propertyName: string
  year: string
  rtuNumber: string
  note: string
  sheetRow: number
}

export interface SylviaWorkingSheetParseResult {
  amounts: SylviaAmountCell[]
  pots: SylviaCapexPot[]
  rtuAssignments: SylviaRtuYearAssignment[]
  stats: {
    dataRows: number
    amountCells: number
    potYears: number
    rtuMentions: number
    yellowCells: number
    greenCells: number
  }
}

const YEAR_COLUMNS: Array<{
  col: number
  year: string
  kind: 'Original' | 'Proposed'
}> = [
  { col: 10, year: '2027', kind: 'Original' },
  { col: 11, year: '2027', kind: 'Proposed' },
  { col: 12, year: '2028', kind: 'Original' },
  { col: 13, year: '2028', kind: 'Proposed' },
  { col: 14, year: '2029', kind: 'Original' },
  { col: 15, year: '2029', kind: 'Proposed' },
  { col: 16, year: '2030', kind: 'Original' },
  { col: 17, year: '2030', kind: 'Proposed' },
  { col: 18, year: '2031', kind: 'Original' },
]

function cellText(value: ExcelJS.CellValue): string {
  if (value == null) return ''
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value).trim()
  }
  if (typeof value === 'object') {
    if ('richText' in value && Array.isArray(value.richText)) {
      return value.richText.map((part) => part.text).join('').trim()
    }
    if ('text' in value && typeof value.text === 'string') return value.text.trim()
    if ('result' in value && value.result != null) return String(value.result).trim()
  }
  return String(value).trim()
}

function parseAmount(value: ExcelJS.CellValue): number {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return Math.round(value)
  const n = Number(cellText(value).replace(/[$,\s]/g, ''))
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0
}

function cellNoteText(cell: ExcelJS.Cell): string {
  const note = cell.note
  if (!note) return ''
  if (typeof note === 'string') return note.trim()
  if (typeof note === 'object' && Array.isArray(note.texts)) {
    return note.texts.map((part) => part.text ?? '').join('').trim()
  }
  return ''
}

function cellFillArgb(cell: ExcelJS.Cell): string | null {
  const fill = cell.fill
  if (!fill || fill.type !== 'pattern' || fill.pattern === 'none') return null
  const argb = fill.fgColor?.argb || fill.bgColor?.argb
  return argb ? String(argb).toUpperCase() : null
}

function statusFromArgb(
  argb: string | null,
  rowStatus: string,
): { status: SylviaCapexStatus; colored: boolean } {
  if (argb === SYLVIA_GREEN_ARGB) return { status: 'Approved', colored: true }
  if (argb === SYLVIA_YELLOW_ARGB) return { status: 'Submitted', colored: true }
  const normalized = rowStatus.trim().toLowerCase()
  if (normalized === 'approved') return { status: 'Approved', colored: false }
  if (normalized === 'rejected') return { status: 'Rejected', colored: false }
  if (normalized === 'submitted') return { status: 'Submitted', colored: false }
  return { status: 'Submitted', colored: false }
}

/**
 * Pull RTU unit numbers from Capex cell comments.
 * Handles: RTU 03, RTU-5, RTU 01,02,03, RTU 01(18Y), 06(18Y), RTU 05(18Y),07(18Y)
 */
export function extractRtuNumbersFromComment(text: string): string[] {
  const found = new Set<string>()
  const raw = String(text ?? '')
  if (!raw.trim()) return []

  for (const match of raw.matchAll(/\bRTU[\s-]*((?:\d{1,2}\s*,\s*)+\d{1,2})\b/gi)) {
    for (const part of match[1]!.split(',')) {
      const digits = part.trim().match(/^(\d{1,2})/)
      if (digits?.[1]) found.add(String(Number.parseInt(digits[1], 10)))
    }
  }

  for (const match of raw.matchAll(/\bRTU[\s-]*0*(\d{1,2})\b/gi)) {
    found.add(String(Number.parseInt(match[1]!, 10)))
  }

  // Companion units written as N(ageY) after the first RTU label (no repeated “RTU”).
  for (const match of raw.matchAll(/(?:^|[^\d.])0*(\d{1,2})\s*\(\d{1,2}\s*[Yy]\)/g)) {
    found.add(String(Number.parseInt(match[1]!, 10)))
  }

  // Drop units the note says were already replaced (e.g. “RTU 04 already replaced”).
  for (const match of raw.matchAll(
    /\bRTU[\s-]*0*(\d{1,2})\b[\s,.-]*already\s+repla(?:ced|cement)?/gi,
  )) {
    found.delete(String(Number.parseInt(match[1]!, 10)))
  }

  return [...found].sort((a, b) => Number(a) - Number(b))
}

/** Rank for choosing one pot amount per building+year. */
function amountPriority(cell: SylviaAmountCell): number {
  // Colored Approved beats colored Submitted beats uncolored Submitted Proposed beats Original.
  let score = 0
  if (cell.status === 'Approved') score += 300
  else if (cell.status === 'Submitted') score += 200
  else score += 50
  if (cell.colored) score += 40
  if (cell.kind === 'Proposed') score += 10
  return score
}

function pickPots(amounts: SylviaAmountCell[]): SylviaCapexPot[] {
  const best = new Map<string, SylviaAmountCell>()
  for (const cell of amounts) {
    if (cell.status === 'Rejected') continue
    const key = `${normalizeCapexBu(cell.bu)}\0${cell.year}`
    const prev = best.get(key)
    if (!prev || amountPriority(cell) > amountPriority(prev)) best.set(key, cell)
  }
  return [...best.values()]
    .sort((a, b) => a.bu.localeCompare(b.bu) || Number(a.year) - Number(b.year))
    .map((cell) => ({
      bu: normalizeCapexBu(cell.bu),
      propertyName: cell.propertyName,
      year: cell.year,
      amount: cell.amount,
      status: cell.status,
      note: cell.note,
      jobProjectType: cell.jobProjectType || 'HVAC',
      description: cell.description,
      sheetRow: cell.sheetRow,
      rtuNumbers: cell.rtuNumbers,
    }))
}

function collectRtuAssignments(pots: SylviaCapexPot[]): SylviaRtuYearAssignment[] {
  const out: SylviaRtuYearAssignment[] = []
  for (const pot of pots) {
    for (const rtuNumber of pot.rtuNumbers) {
      out.push({
        bu: pot.bu,
        propertyName: pot.propertyName,
        year: pot.year,
        rtuNumber,
        note: pot.note,
        sheetRow: pot.sheetRow,
      })
    }
  }
  return out
}

/** Parse Sylvia “Working Sheet” Capex workbook (colors + comments). */
export async function parseSylviaWorkingSheet(
  filePathOrBuffer: string | ArrayBuffer | Buffer | Uint8Array,
): Promise<SylviaWorkingSheetParseResult> {
  const workbook = new ExcelJS.Workbook()
  if (typeof filePathOrBuffer === 'string') {
    await workbook.xlsx.readFile(filePathOrBuffer)
  } else {
    await workbook.xlsx.load(filePathOrBuffer as never)
  }
  const sheet = workbook.worksheets[0]
  if (!sheet) {
    return {
      amounts: [],
      pots: [],
      rtuAssignments: [],
      stats: {
        dataRows: 0,
        amountCells: 0,
        potYears: 0,
        rtuMentions: 0,
        yellowCells: 0,
        greenCells: 0,
      },
    }
  }

  const amounts: SylviaAmountCell[] = []
  let dataRows = 0
  let yellowCells = 0
  let greenCells = 0

  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return
    const bu = cellText(row.getCell(2).value)
    const propertyName = cellText(row.getCell(3).value)
    if (!bu && !propertyName) return
    dataRows++

    const description = cellText(row.getCell(4).value)
    const rowStatus = cellText(row.getCell(6).value)
    const jobProjectType = cellText(row.getCell(8).value) || 'HVAC'

    for (const col of YEAR_COLUMNS) {
      const cell = row.getCell(col.col)
      const amount = parseAmount(cell.value)
      if (!(amount > 0)) continue
      const argb = cellFillArgb(cell)
      if (argb === SYLVIA_YELLOW_ARGB) yellowCells++
      if (argb === SYLVIA_GREEN_ARGB) greenCells++
      const { status, colored } = statusFromArgb(argb, rowStatus)
      const note = cellNoteText(cell)
      amounts.push({
        sheetRow: rowNumber,
        bu: normalizeCapexBu(bu),
        propertyName,
        year: col.year,
        kind: col.kind,
        amount,
        status,
        colored,
        note,
        description,
        jobProjectType,
        rtuNumbers: extractRtuNumbersFromComment(note),
      })
    }
  })

  const pots = pickPots(amounts)
  const rtuAssignments = collectRtuAssignments(pots)

  return {
    amounts,
    pots,
    rtuAssignments,
    stats: {
      dataRows,
      amountCells: amounts.length,
      potYears: pots.length,
      rtuMentions: rtuAssignments.length,
      yellowCells,
      greenCells,
    },
  }
}

/** Resolve a Sylvia pot/property row to a portfolio building (BU first, then address / aka). */
export function resolveSylviaBuilding(
  buildings: Building[],
  pot: { bu: string; propertyName: string },
  findByAddress: (propertyName: string) => Building | null,
): Building | null {
  const bu = normalizeCapexBu(pot.bu)
  if (bu) {
    const byBu = buildings.filter((b) => normalizeCapexBu(b.bu) === bu)
    if (byBu.length === 1) return byBu[0]!
    if (byBu.length > 1) {
      const viaName = findByAddress(pot.propertyName)
      if (viaName && byBu.some((b) => b.address === viaName.address)) return viaName
      return byBu[0]!
    }
  }
  return findByAddress(pot.propertyName)
}

/** Match a comment RTU number to a portfolio RTU name on the building. */
export function matchSylviaRtu(building: Building, rtuNumber: string) {
  const candidates = [
    `RTU-${rtuNumber.padStart(2, '0')}`,
    `RTU- ${rtuNumber.padStart(2, '0')}`,
    `RTU ${rtuNumber.padStart(2, '0')}`,
    `RTU-${rtuNumber}`,
    `RTU ${rtuNumber}`,
  ]
  for (const label of candidates) {
    const hit = findRtuInBuilding(building, label)
    if (hit) return hit
  }
  // Fallback: any unit whose normalized name equals this number.
  const target = normalizeRtuName(`RTU ${rtuNumber}`)
  return building.rtus?.find((unit) => normalizeRtuName(unit.name) === target) ?? null
}
