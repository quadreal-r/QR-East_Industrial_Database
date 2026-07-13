import type { Building } from '@/types/domain'

export type SearchHighlightKind = 'building' | 'cluster'

export interface SearchHighlightTarget {
  kind: SearchHighlightKind
  label: string
  lat: number
  lng: number
}

/** On-screen radius in CSS pixels — stays constant while the map zooms. */
export const SEARCH_HIGHLIGHT_RADIUS_PX: Record<SearchHighlightKind, number> = {
  building: 48,
  cluster: 64,
}

/**
 * Web-Mercator meters covered by one screen pixel at this latitude + zoom.
 * Used so Google Maps Circle (meter radius) can keep a fixed on-screen size.
 */
export function metersPerScreenPixel(lat: number, zoom: number): number {
  const safeZoom = Math.max(0, Math.min(22, zoom))
  return (156_543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** safeZoom
}

/** Convert a fixed pixel radius into meters for google.maps.Circle at the current zoom. */
export function metersForScreenRadius(lat: number, zoom: number, radiusPx: number): number {
  return Math.max(1, radiusPx * metersPerScreenPixel(lat, zoom))
}

function normalizeSearch(search: string): string {
  return search.trim().toLowerCase()
}

function buildingMatchesQuery(building: Building, q: string): boolean {
  if (building.address.toLowerCase().includes(q)) return true
  if (building.bu?.toLowerCase().includes(q)) return true
  if (building.manager?.toLowerCase().includes(q)) return true
  if (building.buildingOperator?.toLowerCase().includes(q)) return true
  return false
}

function centroid(buildings: Building[]): { lat: number; lng: number } {
  let lat = 0
  let lng = 0
  let n = 0
  for (const building of buildings) {
    if (!Number.isFinite(building.lat) || !Number.isFinite(building.lng)) continue
    lat += building.lat
    lng += building.lng
    n += 1
  }
  if (!n) return { lat: 0, lng: 0 }
  return { lat: lat / n, lng: lng / n }
}

function clusterTarget(label: string, members: Building[]): SearchHighlightTarget | null {
  if (!members.length) return null
  const center = centroid(members)
  if (!Number.isFinite(center.lat) || !Number.isFinite(center.lng)) return null
  return {
    kind: 'cluster',
    label,
    lat: center.lat,
    lng: center.lng,
  }
}

/** One red circle per distinct cluster among the given buildings. */
export function collectClusterHighlightTargets(buildings: Building[]): SearchHighlightTarget[] {
  if (!buildings.length) return []
  const targets: SearchHighlightTarget[] = []
  const seen = new Set<string>()
  for (const building of buildings) {
    const cluster = building.cluster?.trim()
    if (!cluster) continue
    const key = `${building.park}\0${cluster}`
    if (seen.has(key)) continue
    seen.add(key)
    const members = buildings.filter(
      (b) => b.park === building.park && b.cluster === cluster,
    )
    const target = clusterTarget(cluster, members)
    if (target) targets.push(target)
  }
  return targets.sort((a, b) => a.label.localeCompare(b.label))
}

/**
 * Search map circles (all red):
 * - park name match → one circle per cluster inside that park
 * - else cluster name match → circle that cluster
 * - else → circle matching buildings
 */
export function collectSearchHighlightTargets(
  buildings: Building[],
  search: string,
): SearchHighlightTarget[] {
  const q = normalizeSearch(search)
  if (!q || buildings.length === 0) return []

  const parks = [...new Set(buildings.map((b) => b.park).filter(Boolean))].sort()
  const matchedParks = parks.filter((park) => park.toLowerCase().includes(q))

  if (matchedParks.length > 0) {
    const scoped = buildings.filter((b) => matchedParks.includes(b.park))
    return collectClusterHighlightTargets(scoped)
  }

  const clusters = [...new Set(buildings.map((b) => b.cluster).filter(Boolean))].sort()
  const matchedClusters = clusters.filter((cluster) => cluster.toLowerCase().includes(q))
  if (matchedClusters.length > 0) {
    const scoped = buildings.filter((b) => matchedClusters.includes(b.cluster))
    return collectClusterHighlightTargets(scoped)
  }

  const targets: SearchHighlightTarget[] = []
  for (const building of buildings) {
    if (!buildingMatchesQuery(building, q)) continue
    if (!Number.isFinite(building.lat) || !Number.isFinite(building.lng)) continue
    targets.push({
      kind: 'building',
      label: building.address,
      lat: building.lat,
      lng: building.lng,
    })
  }
  return targets
}

/** Shared red ring style for every search highlight. */
export const SEARCH_HIGHLIGHT_STYLE = {
  strokeColor: '#ef4444',
  fillColor: '#ef4444',
  fillOpacity: 0.12,
  strokeWeight: 2.5,
  strokeOpacity: 0.95,
} as const
