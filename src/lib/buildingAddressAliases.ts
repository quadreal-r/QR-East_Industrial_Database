/**
 * Alternate names / Capex sheet labels that map to a portfolio building address.
 * Canonical key must match `building.address` exactly.
 */
export const BUILDING_ADDRESS_ALIASES: Readonly<Record<string, readonly string[]>> = {
  '7540 Jane Street': [
    '7540 Jane Street (Interchange - Mobile Climate Control)',
    'Interchange - Mobile Climate Control',
  ],
}

/** Known-as labels for a portfolio address (empty when none). */
export function aliasesForBuildingAddress(address: string): string[] {
  const list = BUILDING_ADDRESS_ALIASES[String(address ?? '').trim()]
  return list ? [...list] : []
}

/** Address + aliases — used by global search and Capex/workbook matching. */
export function buildingAddressSearchTexts(address: string): string[] {
  const canonical = String(address ?? '').trim()
  if (!canonical) return []
  return [canonical, ...aliasesForBuildingAddress(canonical)]
}

/** True when the search query matches the address or any known-as alias. */
export function buildingAddressMatchesSearch(address: string, query: string): boolean {
  const q = String(query ?? '').trim().toLowerCase()
  if (!q) return false
  return buildingAddressSearchTexts(address).some((text) => text.toLowerCase().includes(q))
}
