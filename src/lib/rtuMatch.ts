import type { Building } from '@/types/domain'
import { aliasesForBuildingAddress } from '@/lib/buildingAddressAliases'

const STREET_SUFFIXES =
  /\s+(drive|dr|road|rd|avenue|ave|way|street|st|crescent|cres|boulevard|blvd|court|crt|lane|ln|place|pl)\.?$/i

/** Normalize building address for workbook ↔ portfolio matching. */
export function normalizeBuildingAddress(address: string): string {
  return String(address)
    .trim()
    .toLowerCase()
    .replace(/[.,#]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\.$/, '')
    .trim()
}

/** Additional lookup keys for fuzzy address matching. */
export function buildingAddressKeys(address: string): string[] {
  const base = normalizeBuildingAddress(address)
  const keys = new Set<string>()
  if (!base) return []

  const add = (value: string) => {
    const key = value.trim()
    if (key) keys.add(key)
  }

  add(base)
  add(base.replace(/\s*&\s*/g, ' and '))
  add(base.replace(/\band\b/g, '&'))
  add(base.replace(/\s*-\s*/g, '-'))
  add(base.replace(/-/g, ' '))
  add(base.replace(/\s+/g, ' '))
  add(base.replace(/\s*(?:and|&|-)\s*/g, ' ').replace(/\s+/g, ' ').trim())

  const withoutSuffix = base.replace(STREET_SUFFIXES, '').trim()
  add(withoutSuffix)

  for (const key of [...keys]) {
    add(key.replace(/\bway\b/g, 'avenue'))
    add(key.replace(/\bavenue\b/g, 'way'))
    add(key.replace(/\bave\b/g, 'avenue'))
    add(key.replace(/\bavenue\b/g, 'ave'))
    add(key.replace(/\bdrive\b/g, 'dr'))
    add(key.replace(/\bdr\b/g, 'drive'))
    add(key.replace(/\broad\b/g, 'rd'))
    add(key.replace(/\brd\b/g, 'road'))
    add(key.replace(/\bcrescent\b/g, 'cres'))
    add(key.replace(/\bcres\b/g, 'crescent'))
  }

  return [...keys]
}

export interface BuildingAddressIndex {
  byKey: Map<string, Building>
  buildings: Building[]
}

export function buildBuildingAddressIndex(buildings: Building[]): BuildingAddressIndex {
  const byKey = new Map<string, Building>()
  for (const building of buildings) {
    const labels = [building.address, ...aliasesForBuildingAddress(building.address)]
    for (const label of labels) {
      for (const key of buildingAddressKeys(label)) {
        if (!byKey.has(key)) byKey.set(key, building)
      }
    }
  }
  return { byKey, buildings }
}

export function findBuildingBySheetAddress(
  index: BuildingAddressIndex,
  ...candidates: string[]
): Building | null {
  for (const candidate of candidates) {
    if (!candidate.trim()) continue
    for (const key of buildingAddressKeys(candidate)) {
      const building = index.byKey.get(key)
      if (building) return building
    }
  }
  return null
}

/**
 * Normalize RTU label for matching (workbook “RTU 02 DX …” ↔ portfolio “RTU- 02”).
 * Also accepts short forms (RT01, RTU-6). Pads unit numbers to 2 digits.
 * Keeps optional letter suffix (e.g. 12B).
 */
export function normalizeRtuName(name: string): string {
  const text = String(name)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')

  // RTU 02 / RTU-02 / RT01 / RT-6 / RTU-1 Roof Top Unit / RTU 12B …
  const match = text.match(/^rtu?\s*[-–]?\s*(\d+)([a-z]?)\b/i)
  const rawDigits = match?.[1]
  if (!rawDigits) return text

  const digits = rawDigits.replace(/^0+(?=\d)/, '')
  const padded = digits.padStart(2, '0')
  const letter = (match?.[2] ?? '').toLowerCase()
  return `rtu ${padded}${letter}`
}

export function findRtuInBuilding(building: Building, rtuLabel: string) {
  const target = normalizeRtuName(rtuLabel)
  return building.rtus?.find((unit) => normalizeRtuName(unit.name) === target) ?? null
}

export function rtuScheduleKey(address: string, rtu: string): string {
  return `${normalizeBuildingAddress(address)}::${normalizeRtuName(rtu)}`
}
