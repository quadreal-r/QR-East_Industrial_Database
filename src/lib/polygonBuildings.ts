import type { Building, LatLng, Polygon } from '@/types/domain'
import { distanceFeet } from '@/lib/geo'

export type PolygonBuildingIndex = Map<string, Polygon[]>

export function polygonOptionKey(polygon: Pick<Polygon, 'name' | 'description'>): string {
  return `${polygon.name}\0${polygon.description ?? ''}`
}

export function polygonEditorLabel(
  polygon: Polygon,
  buildingAddress: string | null,
): string {
  const name = polygon.name || 'Polygon'
  if (buildingAddress) return `${name} — ${buildingAddress}`
  if (polygon.description) return `${name} (${polygon.description.split('\n')[0]})`
  return name
}

export function polygonMatchesSearch(
  polygon: Polygon,
  buildings: Building[],
  query: string,
): boolean {
  const trimmed = query.trim().toLowerCase()
  if (!trimmed) return true
  const building = buildingForPolygon(buildings, polygon)
  const haystack = [
    polygon.name,
    polygon.description,
    building?.address,
    building?.park,
    building?.bu,
    building?.cluster,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
  return haystack.includes(trimmed)
}

export function resolvePolygonEditorSelection(
  polygons: Polygon[],
  buildings: Building[],
  options: {
    viewedPolygon?: { name: string; description: string } | null
    buildingAddress?: string | null
  },
): string {
  if (!polygons.length) return ''

  const sorted = [...polygons].sort((a, b) =>
    polygonEditorLabel(a, buildingForPolygon(buildings, a)?.address ?? null).localeCompare(
      polygonEditorLabel(b, buildingForPolygon(buildings, b)?.address ?? null),
    ),
  )

  if (options.viewedPolygon) {
    const viewedKey = polygonOptionKey(options.viewedPolygon)
    const viewedMatch = sorted.find((polygon) => polygonOptionKey(polygon) === viewedKey)
    if (viewedMatch) return viewedKey
  }

  if (options.buildingAddress) {
    const index = buildPolygonBuildingIndex(buildings, polygons)
    const buildingPolygons = polygonsForBuilding(index, options.buildingAddress)
    if (buildingPolygons.length) {
      const preferred = [...buildingPolygons].sort((a, b) =>
        polygonEditorLabel(a, options.buildingAddress!).localeCompare(
          polygonEditorLabel(b, options.buildingAddress!),
        ),
      )
      return polygonOptionKey(preferred[0]!)
    }
  }

  return polygonOptionKey(sorted[0]!)
}

export function polygonCentroid(paths: LatLng[]): { lat: number; lng: number } {
  const lats = paths.map((p) => p.lat)
  const lngs = paths.map((p) => p.lng)
  return {
    lat: lats.reduce((a, v) => a + v, 0) / lats.length,
    lng: lngs.reduce((a, v) => a + v, 0) / lngs.length,
  }
}

function distanceSq(lat1: number, lng1: number, lat2: number, lng2: number): number {
  return (lat1 - lat2) ** 2 + (lng1 - lng2) ** 2
}

/** Building center plus RTU marker positions — closer to drawn tenant suites than address pin alone. */
function buildingReferencePoints(building: Building): Array<{ lat: number; lng: number }> {
  const points: Array<{ lat: number; lng: number }> = []
  if (building.lat && building.lng) {
    points.push({ lat: building.lat, lng: building.lng })
  }
  for (const rtu of building.rtus ?? []) {
    if (rtu.lat && rtu.lng) points.push({ lat: rtu.lat, lng: rtu.lng })
  }
  return points
}

export function nearestBuilding(
  buildings: Building[],
  lat: number,
  lng: number,
): Building | null {
  let best: Building | null = null
  let bestDist = Infinity
  for (const building of buildings) {
    if (!building.lat || !building.lng) continue
    const d = distanceSq(building.lat, building.lng, lat, lng)
    if (d < bestDist) {
      bestDist = d
      best = building
    }
  }
  return best
}

export function findNearestBuildingByDistance(
  buildings: Building[],
  lat: number,
  lng: number,
): { building: Building; feet: number } | null {
  let best: { building: Building; feet: number } | null = null
  for (const building of buildings) {
    if (!Number.isFinite(building.lat) || !Number.isFinite(building.lng)) continue
    const feet = distanceFeet(lat, lng, building.lat, building.lng)
    if (!best || feet < best.feet) {
      best = { building, feet }
    }
  }
  return best
}

/** Assign tenant polygons using nearest RTU footprint, not just the building address pin. */
export function nearestBuildingForPolygon(
  buildings: Building[],
  lat: number,
  lng: number,
): Building | null {
  let best: Building | null = null
  let bestDist = Infinity
  for (const building of buildings) {
    for (const point of buildingReferencePoints(building)) {
      const d = distanceSq(point.lat, point.lng, lat, lng)
      if (d < bestDist) {
        bestDist = d
        best = building
      }
    }
  }
  return best
}

export function buildingForPolygon(buildings: Building[], polygon: Polygon): Building | null {
  if (polygon.paths.length < 3) return null
  const centroid = polygonCentroid(polygon.paths)
  return nearestBuildingForPolygon(buildings, centroid.lat, centroid.lng)
}

/** Excel export label — disambiguates duplicate suite numbers across buildings. */
export function formatSuiteExportLabel(suiteName: string, buildingAddress: string): string {
  const suite = suiteName.trim()
  const address = buildingAddress.trim()
  if (!suite) return address
  if (!address) return suite
  return `${suite} — ${address}`
}

/** Strip building address suffix when re-importing tenant polygon rows. */
export function parseSuiteImportLabel(label: string): string {
  const trimmed = label.trim()
  const sep = trimmed.indexOf(' — ')
  return sep >= 0 ? trimmed.slice(0, sep).trim() : trimmed
}

export function buildPolygonBuildingIndex(
  buildings: Building[],
  polygons: Polygon[],
): PolygonBuildingIndex {
  const index: PolygonBuildingIndex = new Map()
  for (const building of buildings) {
    index.set(building.address, [])
  }
  for (const polygon of polygons) {
    const building = buildingForPolygon(buildings, polygon)
    if (!building) continue
    const list = index.get(building.address) ?? []
    list.push(polygon)
    index.set(building.address, list)
  }
  return index
}

export function polygonsForBuilding(
  index: PolygonBuildingIndex,
  address: string,
): Polygon[] {
  return index.get(address) ?? []
}

export function tenantPolygonCount(
  index: PolygonBuildingIndex,
  address: string,
): number {
  return polygonsForBuilding(index, address).length
}
