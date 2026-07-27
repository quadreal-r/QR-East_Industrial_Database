import type { Building } from '@/types/domain'

/** Normalize BU codes for comparison ("50311", " 50311 "). */
export function normalizeCapexBu(bu: string | null | undefined): string {
  return String(bu ?? '')
    .trim()
    .replace(/^0+(?=\d)/, '')
}

/** Extract BU from Capex labels like "3150-3170 Ridgeway Dr (2 Bldgs) (BU 50311)". */
export function extractBuFromCapexAddress(address: string): string | null {
  const text = String(address ?? '').trim()
  if (!text) return null
  const paren = text.match(/\(\s*BU\s*[#:]?\s*(\d+)\s*\)/i)
  if (paren?.[1]) return normalizeCapexBu(paren[1])
  const bare = text.match(/\bBU\s*[#:]?\s*(\d+)\b/i)
  if (bare?.[1]) return normalizeCapexBu(bare[1])
  return null
}

/** Strip Capex-only suffixes so remaining text can fuzzy-match a street. */
export function stripCapexAddressDecorations(address: string): string {
  return String(address ?? '')
    .replace(/\(\s*\d+\s*Bldgs?\s*\)/gi, ' ')
    .replace(/\(\s*BU\s*[#:]?\s*\d+\s*\)/gi, ' ')
    .replace(/\(\s*SM\s*\)/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export interface CapexShareGroup {
  /** Normalized BU code shared by all members. */
  bu: string
  /** Member addresses, sorted (primary is addresses[0]). */
  addresses: string[]
  primaryAddress: string
}

/**
 * Multi-building Capex share groups keyed by normalized BU.
 * Only BUs with 2+ portfolio buildings are included.
 */
export function buildCapexShareGroupsByBu(buildings: Building[]): Map<string, CapexShareGroup> {
  const byBu = new Map<string, string[]>()
  for (const building of buildings) {
    const bu = normalizeCapexBu(building.bu)
    if (!bu) continue
    const list = byBu.get(bu) ?? []
    if (!list.includes(building.address)) list.push(building.address)
    byBu.set(bu, list)
  }

  const groups = new Map<string, CapexShareGroup>()
  for (const [bu, addresses] of byBu) {
    if (addresses.length < 2) continue
    const sorted = [...addresses].sort((a, b) => a.localeCompare(b))
    groups.set(bu, {
      bu,
      addresses: sorted,
      primaryAddress: sorted[0]!,
    })
  }
  return groups
}

/** Share group for an address, or null when the building is alone on its BU. */
export function capexShareGroupForAddress(
  buildings: Building[],
  address: string,
  groups?: Map<string, CapexShareGroup>,
): CapexShareGroup | null {
  const map = groups ?? buildCapexShareGroupsByBu(buildings)
  const building = buildings.find((b) => b.address === address)
  if (!building) {
    for (const group of map.values()) {
      if (group.addresses.includes(address.trim())) return group
    }
    return null
  }
  const bu = normalizeCapexBu(building.bu)
  if (!bu) return null
  return map.get(bu) ?? null
}

/** Address that owns the Capex pot row for this building (primary of the BU group). */
export function capexPotOwnerAddress(
  buildings: Building[],
  address: string,
  groups?: Map<string, CapexShareGroup>,
): string {
  const group = capexShareGroupForAddress(buildings, address, groups)
  return group?.primaryAddress ?? address.trim()
}

/** All addresses that draw from the same Capex pot as this building. */
export function capexShareAddresses(
  buildings: Building[],
  address: string,
  groups?: Map<string, CapexShareGroup>,
): string[] {
  const group = capexShareGroupForAddress(buildings, address, groups)
  return group?.addresses ?? [address.trim()]
}

/** Dedupe key for Capex pot totals (shared BU pots count once). */
export function capexBudgetDedupeKey(
  buildings: Building[],
  address: string,
  groups?: Map<string, CapexShareGroup>,
): string {
  const group = capexShareGroupForAddress(buildings, address, groups)
  return group ? `bu:${group.bu}` : `addr:${address.trim()}`
}
