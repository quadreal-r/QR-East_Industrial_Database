import { isCapexStatusSearch } from '@/lib/capexStatusSearch'
import { isTenantCountSearch } from '@/lib/filters'
import { rtuMatchesSearch } from '@/lib/rtuSearch'
import type { Building, Rtu } from '@/types/domain'

export interface RtuNameSearchMatch {
  address: string
  park: string
  cluster: string
  manager: string
  rtu: Rtu
}

function normalize(search: string): string {
  return search.trim().toLowerCase()
}

function buildingMetadataMatches(building: Building, q: string): boolean {
  return (
    building.address.toLowerCase().includes(q) ||
    Boolean(building.bu?.toLowerCase().includes(q)) ||
    Boolean(building.cluster?.toLowerCase().includes(q)) ||
    Boolean(building.manager?.toLowerCase().includes(q))
  )
}

/**
 * When global search looks like an RTU/equipment query (name, serial, model, make…),
 * return matching units. Skips Capex status / tenant-count / address-style metadata searches.
 */
export function collectRtuNameSearchMatches(
  buildings: Building[],
  search: string,
): RtuNameSearchMatch[] | null {
  const q = normalize(search)
  if (!q || q.length < 2) return null
  if (isCapexStatusSearch(search) || isTenantCountSearch(search)) return null
  if (buildings.some((building) => buildingMetadataMatches(building, q))) return null

  const matches: RtuNameSearchMatch[] = []
  for (const building of buildings) {
    for (const rtu of building.rtus ?? []) {
      if (!rtuMatchesSearch(rtu, q)) continue
      matches.push({
        address: building.address,
        park: building.park ?? '',
        cluster: building.cluster ?? '',
        manager: building.manager ?? '',
        rtu,
      })
    }
  }

  if (!matches.length) return null
  matches.sort((a, b) => {
    const byAddress = a.address.localeCompare(b.address)
    if (byAddress) return byAddress
    return a.rtu.name.localeCompare(b.rtu.name)
  })
  return matches
}
