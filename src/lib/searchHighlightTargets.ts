import { isCapexStatusSearch } from '@/lib/capexStatusSearch'
import { buildingAddressMatchesSearch } from '@/lib/buildingAddressAliases'
import { buildingBuMatchesSearch, isTenantCountSearch } from '@/lib/filters'
import {
  buildingForPolygon,
  buildPolygonBuildingIndex,
  polygonsForBuilding,
} from '@/lib/polygonBuildings'
import { rtuMatchesSearch } from '@/lib/rtuSearch'
import {
  defaultEntrancePosition,
  ensureSuiteEntrances,
  suiteEntranceForPolygon,
} from '@/lib/suiteEntrances'
import type { Building, Polygon, SuiteEntrance } from '@/types/domain'

export type SearchHighlightKind = 'building' | 'cluster' | 'suite' | 'rtu'

export interface SearchHighlightTarget {
  kind: SearchHighlightKind
  label: string
  lat: number
  lng: number
  /** Building address this ring belongs to — used to pulse on sidebar click. */
  buildingAddress?: string
}

/** On-screen radius in CSS pixels — stays constant while the map zooms. */
export const SEARCH_HIGHLIGHT_RADIUS_PX: Record<SearchHighlightKind, number> = {
  building: 48,
  cluster: 64,
  suite: 40,
  rtu: 36,
}

export interface SearchHighlightContext {
  polygons?: Polygon[]
  suiteEntrances?: SuiteEntrance[]
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
  if (buildingAddressMatchesSearch(building.address, q)) return true
  if (buildingBuMatchesSearch(building.bu, q)) return true
  if (building.manager?.toLowerCase().includes(q)) return true
  if (building.buildingOperator?.toLowerCase().includes(q)) return true
  return false
}

function buildingAddressMatchesQuery(building: Building, q: string): boolean {
  return buildingAddressMatchesSearch(building.address, q)
}

function collectBuildingAddressHighlightTargets(
  buildings: Building[],
  q: string,
): SearchHighlightTarget[] {
  const targets: SearchHighlightTarget[] = []
  for (const building of buildings) {
    if (!buildingAddressMatchesQuery(building, q)) continue
    if (!Number.isFinite(building.lat) || !Number.isFinite(building.lng)) continue
    targets.push({
      kind: 'building',
      label: building.address,
      lat: building.lat,
      lng: building.lng,
      buildingAddress: building.address,
    })
  }
  return targets
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

/** Lat/lng points for fitting the map (e.g. All Buildings overview fallback). */
export function collectFilterFitPoints(
  buildings: Building[],
): Array<{ lat: number; lng: number }> {
  const points: Array<{ lat: number; lng: number }> = []
  for (const building of buildings) {
    if (!Number.isFinite(building.lat) || !Number.isFinite(building.lng)) continue
    points.push({ lat: building.lat, lng: building.lng })
  }
  return points
}

function polygonMatchesTenantQuery(polygon: Polygon, q: string): boolean {
  return (
    polygon.name.toLowerCase().includes(q) ||
    (polygon.description ?? '').toLowerCase().includes(q)
  )
}

/**
 * Circle 360° suite gateways whose tenant polygon name/description matches
 * (e.g. search "Baxter" → Suite # 3 gate).
 */
export function collectSuiteHighlightTargets(
  buildings: Building[],
  polygons: Polygon[],
  suiteEntrances: SuiteEntrance[],
  search: string,
): SearchHighlightTarget[] {
  const q = normalizeSearch(search)
  if (!q || !polygons.length) return []

  const polygonIndex = buildPolygonBuildingIndex(buildings, polygons)
  const entrances = ensureSuiteEntrances(buildings, polygons, suiteEntrances)
  const targets: SearchHighlightTarget[] = []
  const seen = new Set<string>()

  for (const polygon of polygons) {
    if (!polygonMatchesTenantQuery(polygon, q)) continue
    const building = buildingForPolygon(buildings, polygon)
    if (!building) continue

    const entrance =
      building.id != null
        ? suiteEntranceForPolygon(entrances, polygon, building)
        : entrances.find(
            (item) =>
              item.polygon_id != null &&
              polygon.id != null &&
              item.polygon_id === polygon.id,
          )
    const buildingPolygons = polygonsForBuilding(polygonIndex, building.address)
    const fallback = defaultEntrancePosition(polygon, {
      building,
      buildingPolygons,
    })
    const lat = Number.isFinite(entrance?.lat) ? entrance!.lat : fallback.lat
    const lng = Number.isFinite(entrance?.lng) ? entrance!.lng : fallback.lng
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue

    const key = `${lat.toFixed(6)},${lng.toFixed(6)}`
    if (seen.has(key)) continue
    seen.add(key)

    const tenant = (polygon.description || polygon.name).split('\n')[0]!.trim()
    targets.push({
      kind: 'suite',
      label: tenant ? `${polygon.name} · ${tenant}` : polygon.name,
      lat,
      lng,
      buildingAddress: building.address,
    })
  }

  return targets
}

/**
 * Circle RTU markers whose name / description / serial / model / make / suite
 * matches the search (e.g. a serial number or Lennox model).
 */
export function collectRtuHighlightTargets(
  buildings: Building[],
  search: string,
): SearchHighlightTarget[] {
  const q = normalizeSearch(search)
  if (!q) return []

  const targets: SearchHighlightTarget[] = []
  const seen = new Set<string>()

  for (const building of buildings) {
    for (const rtu of building.rtus ?? []) {
      if (!rtuMatchesSearch(rtu, q)) continue
      if (!Number.isFinite(rtu.lat) || !Number.isFinite(rtu.lng)) continue
      const key = `${rtu.lat.toFixed(6)},${rtu.lng.toFixed(6)},${rtu.name}`
      if (seen.has(key)) continue
      seen.add(key)
      targets.push({
        kind: 'rtu',
        label: `${building.address} · ${rtu.name}`,
        lat: rtu.lat,
        lng: rtu.lng,
        buildingAddress: building.address,
      })
    }
  }

  return targets
}

/**
 * Search map circles (all red):
 * - park name match → one circle per cluster inside that park
 * - else cluster name match → circle that cluster
 * - else tenant name match → circle matching suite gateways
 * - else building address match → circle address markers only (never RTUs)
 * - else RTU / equipment field match → circle matching RTUs
 * - else → circle matching buildings (BU / manager / operator)
 */
export function collectSearchHighlightTargets(
  buildings: Building[],
  search: string,
  context: SearchHighlightContext = {},
): SearchHighlightTarget[] {
  const q = normalizeSearch(search)
  if (!q || buildings.length === 0) return []
  // Count-style "tenants" search is text-only under the search field.
  if (isTenantCountSearch(q)) return []
  // Capex status search filters buildings only; map uses building hit nav.
  if (isCapexStatusSearch(q)) return []

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

  const suiteTargets = collectSuiteHighlightTargets(
    buildings,
    context.polygons ?? [],
    context.suiteEntrances ?? [],
    search,
  )
  if (suiteTargets.length > 0) return suiteTargets

  // Address search → building pins only. Do not ring RTUs on the same property.
  const addressTargets = collectBuildingAddressHighlightTargets(buildings, q)
  if (addressTargets.length > 0) return addressTargets

  const rtuTargets = collectRtuHighlightTargets(buildings, search)
  if (rtuTargets.length > 0) return rtuTargets

  const targets: SearchHighlightTarget[] = []
  for (const building of buildings) {
    if (!buildingMatchesQuery(building, q)) continue
    if (!Number.isFinite(building.lat) || !Number.isFinite(building.lng)) continue
    targets.push({
      kind: 'building',
      label: building.address,
      lat: building.lat,
      lng: building.lng,
      buildingAddress: building.address,
    })
  }
  return targets
}

/** Shared red ring style for every search highlight (transparent fill — outline only). */
export const SEARCH_HIGHLIGHT_STYLE = {
  strokeColor: '#ef4444',
  fillColor: '#ef4444',
  fillOpacity: 0,
  strokeWeight: 2.5,
  strokeOpacity: 0.9,
} as const
