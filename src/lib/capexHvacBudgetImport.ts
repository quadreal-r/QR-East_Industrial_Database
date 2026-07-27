import { buildingYearBudgetKey } from '@/lib/buildingYearBudget'
import { RCB_DEFAULT_YEAR } from '@/lib/constants'
import { rcbReplacementYearKey } from '@/lib/costEstimator'
import {
  extractBuFromCapexAddress,
  normalizeCapexBu,
  stripCapexAddressDecorations,
} from '@/lib/capexSharedBu'
import {
  buildBuildingAddressIndex,
  findBuildingBySheetAddress,
  type BuildingAddressIndex,
} from '@/lib/rtuMatch'
import type { Building } from '@/types/domain'

/** Capex year columns that hold HVAC dollar amounts. */
export const CAPEX_HVAC_YEAR_COLUMNS = [
  '2025',
  '2026',
  '2027',
  '2028',
  '2029',
  '2030',
  '2031',
] as const

/** Statuses included when loading Capex HVAC into building year budgets. */
export const CAPEX_HVAC_KEEP_STATUSES = new Set(['Approved', 'Submitted'])

/** Statuses shown on Capex source notes (includes Rejected for visibility). */
export const CAPEX_NOTE_KEEP_STATUSES = new Set(['Approved', 'Submitted', 'Rejected'])

export interface CapexItemRow {
  'Job Project Type'?: unknown
  Status?: unknown
  'DB Building Address'?: unknown
  Description?: unknown
  [year: string]: unknown
}

export interface CapexHvacYearBucket {
  address: string
  year: string
  total: number
  lineCount: number
}

export interface CapexHvacParseStats {
  hvacRows: number
  keptRows: number
  skippedStatus: number
  skippedNoAmount: number
  skippedNoAddress: number
  buildingYearBuckets: number
  portfolioTotal: number
}

export interface CapexHvacApplyStats {
  matchedBuildingYears: number
  unmatchedAddresses: string[]
  buildingYearBudgetsWritten: number
  portfolioTotalMatched: number
}

export interface CapexRtuDescriptionRow {
  address: string
  year: string
  description: string
  /** Capex Status (Approved / Submitted / Rejected). */
  status: string
  /** Capex Job Project Type (e.g. HVAC). */
  jobProjectType: string
}

export interface CapexRtuDescriptionParseStats {
  hvacRows: number
  keptRows: number
  skippedStatus: number
  skippedNoYear: number
  skippedNoAddress: number
  addressYearKeys: number
}

export interface CapexRtuNotesApplyStats {
  capexRowsMatched: number
  notesWritten: number
  unmatchedAddresses: string[]
  unmatchedYears: number
}

function cellText(value: unknown): string {
  if (value == null) return ''
  return String(value).trim()
}

function parseAmount(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : Number(String(raw ?? '').replace(/[$,\s]/g, ''))
  return Number.isFinite(n) && n > 0 ? n : 0
}

function bucketKey(address: string, year: string): string {
  return `${address}\0${year}`
}

/**
 * Sum Approved/Submitted HVAC Capex amounts by DB Building Address + Capex year.
 */
export function sumCapexHvacBudgetsByAddressYear(rows: CapexItemRow[]): {
  byAddressYear: Map<string, CapexHvacYearBucket>
  stats: CapexHvacParseStats
} {
  const byAddressYear = new Map<string, CapexHvacYearBucket>()
  const stats: CapexHvacParseStats = {
    hvacRows: 0,
    keptRows: 0,
    skippedStatus: 0,
    skippedNoAmount: 0,
    skippedNoAddress: 0,
    buildingYearBuckets: 0,
    portfolioTotal: 0,
  }

  for (const row of rows) {
    if (cellText(row['Job Project Type']) !== 'HVAC') continue
    stats.hvacRows++

    if (!CAPEX_HVAC_KEEP_STATUSES.has(cellText(row.Status))) {
      stats.skippedStatus++
      continue
    }

    const address = cellText(row['DB Building Address'])
    if (!address) {
      stats.skippedNoAddress++
      continue
    }

    let rowTotal = 0
    for (const year of CAPEX_HVAC_YEAR_COLUMNS) {
      const amount = parseAmount(row[year])
      if (!(amount > 0)) continue
      rowTotal += amount
      const key = bucketKey(address, year)
      const existing = byAddressYear.get(key)
      if (existing) {
        existing.total += amount
        existing.lineCount++
      } else {
        byAddressYear.set(key, { address, year, total: amount, lineCount: 1 })
      }
    }

    if (!(rowTotal > 0)) {
      stats.skippedNoAmount++
      continue
    }
    stats.keptRows++
  }

  let portfolioTotal = 0
  for (const entry of byAddressYear.values()) {
    entry.total = Math.round(entry.total)
    portfolioTotal += entry.total
  }
  stats.buildingYearBuckets = byAddressYear.size
  stats.portfolioTotal = portfolioTotal
  return { byAddressYear, stats }
}

/**
 * Expand Capex DB address cells that name more than one building
 * (e.g. East | West Kennedy) into concrete sheet address fragments.
 */
export function expandCapexDbAddresses(address: string): string[] {
  const trimmed = address.trim()
  if (!trimmed) return []
  if (trimmed.includes('|')) {
    return trimmed
      .split('|')
      .map((part) => part.trim())
      .filter(Boolean)
  }
  return [trimmed]
}

function buildingsByBuMap(buildings: Building[]): Map<string, Building[]> {
  const byBu = new Map<string, Building[]>()
  for (const building of buildings) {
    const bu = normalizeCapexBu(building.bu)
    if (!bu) continue
    const list = byBu.get(bu) ?? []
    list.push(building)
    byBu.set(bu, list)
  }
  return byBu
}

function uniqueBuildings(buildings: Building[]): Building[] {
  return [...new Map(buildings.map((b) => [b.address, b])).values()]
}

/**
 * Resolve a Capex "DB Building Address" cell to portfolio buildings.
 * Prefers shared-BU groups when the sheet names `(BU 50311)` or a multi-building label.
 */
export function resolveCapexSheetBuildings(
  sheetAddress: string,
  buildings: Building[],
  index?: BuildingAddressIndex,
  byBu?: Map<string, Building[]>,
): Building[] {
  const trimmed = sheetAddress.trim()
  if (!trimmed) return []

  const addressIndex = index ?? buildBuildingAddressIndex(buildings)
  const buIndex = byBu ?? buildingsByBuMap(buildings)

  const buFromLabel = extractBuFromCapexAddress(trimmed)
  if (buFromLabel) {
    const members = buIndex.get(buFromLabel)
    if (members?.length) return uniqueBuildings(members)
  }

  const found: Building[] = []
  for (const fragment of expandCapexDbAddresses(trimmed)) {
    const direct = findBuildingBySheetAddress(addressIndex, fragment)
    if (direct) {
      found.push(direct)
      continue
    }
    const stripped = stripCapexAddressDecorations(fragment)
    if (stripped && stripped !== fragment) {
      const viaStrip = findBuildingBySheetAddress(addressIndex, stripped)
      if (viaStrip) found.push(viaStrip)
    }
  }

  const unique = uniqueBuildings(found)
  if (unique.length === 1) {
    const bu = normalizeCapexBu(unique[0]!.bu)
    const members = bu ? buIndex.get(bu) : undefined
    // Single address match that belongs to a multi-building BU → share the pot with siblings.
    if (members && members.length > 1) return uniqueBuildings(members)
  }
  return unique
}

/** True when every matched building shares one non-empty BU (shared Capex pot). */
export function isSharedCapexBuGroup(buildings: Building[]): boolean {
  if (buildings.length < 2) return false
  const bus = new Set(
    buildings.map((b) => normalizeCapexBu(b.bu)).filter((bu) => Boolean(bu)),
  )
  return bus.size === 1
}

function primarySharedAddress(buildings: Building[]): string {
  return [...buildings.map((b) => b.address)].sort((a, b) => a.localeCompare(b))[0]!
}

/**
 * Assign Capex (building + year) amounts to building-year pots.
 * Shared-BU groups (same BU, 2+ buildings) store the full pot on the primary address.
 * Pipe-split different buildings still equal-share.
 * Does not allocate to individual RTUs — those stay empty for in-app entry.
 */
export function buildCapexBuildingYearBudgets(
  byAddressYear: Map<string, CapexHvacYearBucket>,
  buildings: Building[],
): {
  buildingYearBudgets: Record<string, number>
  stats: CapexHvacApplyStats
} {
  const index = buildBuildingAddressIndex(buildings)
  const byBu = buildingsByBuMap(buildings)
  const buildingYearBudgets: Record<string, number> = {}
  const unmatchedAddresses = new Set<string>()
  let matchedBuildingYears = 0
  let portfolioTotalMatched = 0

  for (const { address, year, total } of byAddressYear.values()) {
    const unique = resolveCapexSheetBuildings(address, buildings, index, byBu)
    if (!unique.length) {
      unmatchedAddresses.add(address)
      continue
    }

    if (isSharedCapexBuGroup(unique)) {
      const primary = primarySharedAddress(unique)
      const key = buildingYearBudgetKey(primary, year)
      buildingYearBudgets[key] = (buildingYearBudgets[key] ?? 0) + total
      matchedBuildingYears++
      portfolioTotalMatched += total
      continue
    }

    const perBuilding = Math.floor(total / unique.length)
    let assigned = 0
    for (let i = 0; i < unique.length; i++) {
      const building = unique[i]!
      const share = i === unique.length - 1 ? total - assigned : perBuilding
      assigned += share
      if (!(share > 0)) continue
      const key = buildingYearBudgetKey(building.address, year)
      buildingYearBudgets[key] = (buildingYearBudgets[key] ?? 0) + share
      matchedBuildingYears++
    }
    portfolioTotalMatched += total
  }

  for (const [key, amount] of Object.entries(buildingYearBudgets)) {
    buildingYearBudgets[key] = Math.round(amount)
  }

  return {
    buildingYearBudgets,
    stats: {
      matchedBuildingYears,
      unmatchedAddresses: [...unmatchedAddresses],
      buildingYearBudgetsWritten: Object.keys(buildingYearBudgets).length,
      portfolioTotalMatched,
    },
  }
}

/** Capex report stamp prepended to imported notes (month.year of the workbook). */
export const CAPEX_NOTE_SOURCE_STAMP = '07.2026'

/** Property code + year at start of Description, e.g. "50454 2027". */
const CAPEX_PROP_YEAR_LINE = /^\d+\s+20\d{2}\b/

/**
 * Year in Capex Description, e.g. "50301 2031 HVAC RTU Replacement" → "2031".
 * Prefers the year after the property code; falls back to the first 20xx token.
 */
export function extractYearFromCapexDescription(description: string): string | null {
  const text = description.trim()
  if (!text) return null
  const afterCode = text.match(/^\S+\s+(20\d{2})\b/)
  if (afterCode?.[1]) return afterCode[1]
  const any = text.match(/\b(20\d{2})\b/)
  return any?.[1] ?? null
}

/**
 * Prefix Capex Description lines that start with "50454 2027"-style codes:
 * `(From CAPEX 07.2026) 50454 2027 BAS Upgrade`
 */
export function formatCapexImportedNote(
  description: string,
  stamp: string = CAPEX_NOTE_SOURCE_STAMP,
): string {
  return description
    .split('\n')
    .map((line) => {
      const text = line.trim()
      if (!text) return ''
      if (/^\(From CAPEX\b/i.test(text)) return text
      if (CAPEX_PROP_YEAR_LINE.test(text)) return `(From CAPEX ${stamp}) ${text}`
      return text
    })
    .filter(Boolean)
    .join('\n')
}

/** Years to attach a Capex note: Description year first, else year columns with dollars. */
function yearsForCapexNoteRow(row: CapexItemRow, description: string): string[] {
  const fromDescription = extractYearFromCapexDescription(description)
  if (fromDescription) return [fromDescription]
  const years: string[] = []
  for (const year of CAPEX_HVAC_YEAR_COLUMNS) {
    if (parseAmount(row[year]) > 0) years.push(year)
  }
  return years
}

function mergeCapexStatuses(current: string, next: string): string {
  const parts = new Set(
    [...current.split('/'), ...next.split('/')]
      .map((part) => part.trim())
      .filter(Boolean),
  )
  // Stable order for the three Capex workflow labels.
  const order = ['Approved', 'Submitted', 'Rejected']
  const sorted = order.filter((label) => parts.has(label))
  for (const part of parts) {
    if (!sorted.includes(part)) sorted.push(part)
  }
  return sorted.join(' / ')
}

/** Merge Capex Job Project Type labels (stable, unique). */
export function mergeCapexJobProjectTypes(current: string, next: string): string {
  const parts = [
    ...new Set(
      [...current.split('/'), ...next.split('/')]
        .map((part) => part.trim())
        .filter(Boolean),
    ),
  ]
  return parts.join(' / ')
}

/**
 * Collect Capex Descriptions for Cost Center notes keyed by DB address + year.
 * Inclusion is Job Project Type = HVAC only (no Description text filter).
 * Keeps Approved / Submitted / Rejected.
 */
export function collectCapexRtuDescriptionsByAddressYear(rows: CapexItemRow[]): {
  byAddressYear: Map<string, CapexRtuDescriptionRow>
  stats: CapexRtuDescriptionParseStats
} {
  const byAddressYear = new Map<string, CapexRtuDescriptionRow>()
  const stats: CapexRtuDescriptionParseStats = {
    hvacRows: 0,
    keptRows: 0,
    skippedStatus: 0,
    skippedNoYear: 0,
    skippedNoAddress: 0,
    addressYearKeys: 0,
  }

  for (const row of rows) {
    const jobProjectType = cellText(row['Job Project Type'])
    if (jobProjectType !== 'HVAC') continue
    stats.hvacRows++

    const status = cellText(row.Status)
    if (!CAPEX_NOTE_KEEP_STATUSES.has(status)) {
      stats.skippedStatus++
      continue
    }

    const description = cellText(row.Description)
    if (!description) {
      stats.skippedNoYear++
      continue
    }

    const address = cellText(row['DB Building Address'])
    if (!address) {
      stats.skippedNoAddress++
      continue
    }

    const years = yearsForCapexNoteRow(row, description)
    if (!years.length) {
      stats.skippedNoYear++
      continue
    }

    for (const year of years) {
      const key = bucketKey(address, year)
      const existing = byAddressYear.get(key)
      if (existing) {
        if (!existing.description.split('\n').includes(description)) {
          existing.description = `${existing.description}\n${description}`
        }
        existing.status = mergeCapexStatuses(existing.status, status)
        existing.jobProjectType = mergeCapexJobProjectTypes(
          existing.jobProjectType,
          jobProjectType,
        )
      } else {
        byAddressYear.set(key, { address, year, description, status, jobProjectType })
      }
      stats.keptRows++
    }
  }

  stats.addressYearKeys = byAddressYear.size
  return { byAddressYear, stats }
}

/**
 * Capex Status keyed by DB address + year column that holds the dollar amount.
 * Keeps pot status aligned with the money that funded the Capex pot (not only Description year).
 */
export function collectCapexStatusesByMoneyYear(rows: CapexItemRow[]): Map<string, string> {
  const byAddressYear = new Map<string, string>()

  for (const row of rows) {
    if (cellText(row['Job Project Type']) !== 'HVAC') continue
    const status = cellText(row.Status)
    if (!CAPEX_NOTE_KEEP_STATUSES.has(status)) continue
    const address = cellText(row['DB Building Address'])
    if (!address) continue

    for (const year of CAPEX_HVAC_YEAR_COLUMNS) {
      if (!(parseAmount(row[year]) > 0)) continue
      const key = bucketKey(address, year)
      const existing = byAddressYear.get(key)
      byAddressYear.set(key, existing ? mergeCapexStatuses(existing, status) : status)
    }
  }

  return byAddressYear
}

/**
 * Capex Job Project Type keyed by DB address + year column that holds the dollar amount.
 */
export function collectCapexJobTypesByMoneyYear(rows: CapexItemRow[]): Map<string, string> {
  const byAddressYear = new Map<string, string>()

  for (const row of rows) {
    const jobProjectType = cellText(row['Job Project Type'])
    if (!jobProjectType) continue
    // Cost Center pots are HVAC Capex; keep the Excel label for display.
    if (jobProjectType !== 'HVAC') continue
    const status = cellText(row.Status)
    if (!CAPEX_NOTE_KEEP_STATUSES.has(status)) continue
    const address = cellText(row['DB Building Address'])
    if (!address) continue

    for (const year of CAPEX_HVAC_YEAR_COLUMNS) {
      if (!(parseAmount(row[year]) > 0)) continue
      const key = bucketKey(address, year)
      const existing = byAddressYear.get(key)
      byAddressYear.set(
        key,
        existing ? mergeCapexJobProjectTypes(existing, jobProjectType) : jobProjectType,
      )
    }
  }

  return byAddressYear
}

/**
 * Map Capex Descriptions onto building-year Capex pot keys (`address::year`).
 * Notes come from Description; status / job type prefer Capex rows that put money in that year.
 */
export function buildCapexBuildingYearNotes(
  byAddressYear: Map<string, CapexRtuDescriptionRow>,
  buildings: Building[],
  statusByMoneyYear: Map<string, string> = new Map(),
  jobTypeByMoneyYear: Map<string, string> = new Map(),
): {
  notes: Record<string, string>
  statuses: Record<string, string>
  jobTypes: Record<string, string>
  stats: { notesWritten: number; unmatchedAddresses: string[] }
} {
  const index = buildBuildingAddressIndex(buildings)
  const byBu = buildingsByBuMap(buildings)
  const notes: Record<string, string> = {}
  const statuses: Record<string, string> = {}
  const jobTypes: Record<string, string> = {}
  const unmatchedAddresses = new Set<string>()

  for (const { address, year, description, status, jobProjectType } of byAddressYear.values()) {
    const unique = resolveCapexSheetBuildings(address, buildings, index, byBu)
    if (!unique.length) {
      unmatchedAddresses.add(address)
      continue
    }

    const stamped = formatCapexImportedNote(description)
    const moneyKey = bucketKey(address, year)
    const moneyStatus = statusByMoneyYear.get(moneyKey)
    const moneyJobType = jobTypeByMoneyYear.get(moneyKey)
    for (const building of unique) {
      const key = buildingYearBudgetKey(building.address, year)
      const existing = notes[key]
      if (existing) {
        if (!existing.split('\n').includes(stamped)) {
          notes[key] = `${existing}\n${stamped}`
        }
        statuses[key] = mergeCapexStatuses(statuses[key] ?? '', moneyStatus || status)
        jobTypes[key] = mergeCapexJobProjectTypes(
          jobTypes[key] ?? '',
          moneyJobType || jobProjectType,
        )
      } else {
        notes[key] = stamped
        statuses[key] = moneyStatus || status
        jobTypes[key] = moneyJobType || jobProjectType
      }
    }
  }

  // Attach status / job type to pots that have Capex money even if Description year differed.
  for (const [rawKey, status] of statusByMoneyYear) {
    const sep = rawKey.indexOf('\0')
    if (sep < 0) continue
    const address = rawKey.slice(0, sep)
    const year = rawKey.slice(sep + 1)
    const moneyJobType = jobTypeByMoneyYear.get(rawKey) || 'HVAC'
    const candidates = resolveCapexSheetBuildings(address, buildings, index, byBu)
    for (const building of candidates) {
      const key = buildingYearBudgetKey(building.address, year)
      statuses[key] = statuses[key]
        ? mergeCapexStatuses(statuses[key]!, status)
        : status
      jobTypes[key] = jobTypes[key]
        ? mergeCapexJobProjectTypes(jobTypes[key]!, moneyJobType)
        : moneyJobType
    }
  }

  return {
    notes,
    statuses,
    jobTypes,
    stats: {
      notesWritten: Object.keys(notes).length,
      unmatchedAddresses: [...unmatchedAddresses],
    },
  }
}

/**
 * Put Capex Description into RTU notes when the Description year matches the RTU
 * replacement year (unset RTUs inherit defaultYear, same as Cost Center).
 */
export function buildCapexRtuNotesFromDescriptions(
  byAddressYear: Map<string, CapexRtuDescriptionRow>,
  buildings: Building[],
  replacementYearByRtu: Record<string, string>,
  defaultYear: string = RCB_DEFAULT_YEAR,
): {
  notes: Record<string, string>
  stats: CapexRtuNotesApplyStats
} {
  const index = buildBuildingAddressIndex(buildings)
  const byBu = buildingsByBuMap(buildings)
  const notes: Record<string, string> = {}
  const unmatchedAddresses = new Set<string>()
  let capexRowsMatched = 0
  let unmatchedYears = 0

  for (const { address, year, description } of byAddressYear.values()) {
    const unique = resolveCapexSheetBuildings(address, buildings, index, byBu)
    if (!unique.length) {
      unmatchedAddresses.add(address)
      continue
    }

    const stamped = formatCapexImportedNote(description)
    let wroteForCapexRow = false
    for (const building of unique) {
      for (const rtu of building.rtus ?? []) {
        const key = rcbReplacementYearKey(building.address, rtu.name)
        const rtuYear = replacementYearByRtu[key] ?? defaultYear
        if (rtuYear !== year) continue
        notes[key] = stamped
        wroteForCapexRow = true
      }
    }

    if (wroteForCapexRow) capexRowsMatched++
    else unmatchedYears++
  }

  return {
    notes,
    stats: {
      capexRowsMatched,
      notesWritten: Object.keys(notes).length,
      unmatchedAddresses: [...unmatchedAddresses],
      unmatchedYears,
    },
  }
}

