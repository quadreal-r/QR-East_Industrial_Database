import {
  buildingMatchesCapexStatusSearch,
  parseCapexStatusSearchQuery,
} from '@/lib/capexStatusSearch'
import { MAP_DETAIL_ZOOM } from '@/lib/constants'
import { isTenantCountSearch } from '@/lib/filters'
import { rtuMatchesSearch } from '@/lib/rtuSearch'
import {
  buildingForPolygon,
  buildPolygonBuildingIndex,
  polygonsForBuilding,
} from '@/lib/polygonBuildings'
import {
  defaultEntrancePosition,
  ensureSuiteEntrances,
  suiteEntranceForPolygon,
} from '@/lib/suiteEntrances'
import type { Building, Polygon, SuiteEntrance } from '@/types/domain'

export type SearchHitKind = 'rtu' | 'polygon' | 'building'

export interface SearchHit {
  kind: SearchHitKind
  label: string
  lat: number
  lng: number
  layerKey?: 'rtu'
  detailName?: string
  buildingAddress?: string
  polygonName?: string
  polygonDescription?: string
  address?: string
}

/** Ask map search rings for this building to pulse (attention). */
export const MAP_PULSE_SEARCH_HIGHLIGHTS_EVENT = 'map:pulseSearchHighlights'

export function pulseSearchHitCirclesForBuilding(address: string): void {
  const trimmed = String(address || '').trim()
  if (!trimmed) return
  window.dispatchEvent(
    new CustomEvent(MAP_PULSE_SEARCH_HIGHLIGHTS_EVENT, { detail: { address: trimmed } }),
  )
}

function normalizeSearch(search: string): string {
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

function polygonCentroid(polygon: Polygon): { lat: number; lng: number } {
  const lats = polygon.paths.reduce((sum, pt) => sum + pt.lat, 0)
  const lngs = polygon.paths.reduce((sum, pt) => sum + pt.lng, 0)
  return { lat: lats / polygon.paths.length, lng: lngs / polygon.paths.length }
}

function suiteGatePosition(
  buildings: Building[],
  entrances: SuiteEntrance[],
  polygon: Polygon,
  buildingPolygons: Polygon[],
): { lat: number; lng: number } {
  const building = buildingForPolygon(buildings, polygon)
  if (!building) return polygonCentroid(polygon)
  const entrance =
    building.id != null
      ? suiteEntranceForPolygon(entrances, polygon, building)
      : entrances.find(
          (item) =>
            item.polygon_id != null &&
            polygon.id != null &&
            item.polygon_id === polygon.id,
        )
  if (
    entrance &&
    Number.isFinite(entrance.lat) &&
    Number.isFinite(entrance.lng)
  ) {
    return { lat: entrance.lat, lng: entrance.lng }
  }
  return defaultEntrancePosition(polygon, {
    building,
    buildingPolygons,
  })
}

/** Collect map popup targets for a search term (RTU markers, tenant polygons, buildings). */
export function collectSearchHits(
  buildings: Building[],
  polygons: Polygon[],
  search: string,
  suiteEntrances: SuiteEntrance[] = [],
  capexStatuses: Record<string, string> = {},
): SearchHit[] {
  const q = normalizeSearch(search)
  if (!q) return []
  // Tenant-count queries are summarized as plain text under search — not map hits.
  if (isTenantCountSearch(q)) return []

  const statusQuery = parseCapexStatusSearchQuery(search)
  if (statusQuery) {
    const hits: SearchHit[] = []
    for (const building of buildings) {
      if (
        !buildingMatchesCapexStatusSearch(
          building.address,
          statusQuery.label,
          capexStatuses,
          statusQuery.year,
        )
      ) {
        continue
      }
      hits.push({
        kind: 'building',
        label: building.address,
        lat: building.lat,
        lng: building.lng,
        address: building.address,
        buildingAddress: building.address,
      })
    }
    return hits
  }

  const polygonIndex = buildPolygonBuildingIndex(buildings, polygons)
  const anyBuildingMeta = buildings.some((b) => buildingMetadataMatches(b, q))
  const hits: SearchHit[] = []

  if (!anyBuildingMeta) {
    for (const building of buildings) {
      for (const rtu of building.rtus ?? []) {
        if (!rtuMatchesSearch(rtu, q)) continue
        hits.push({
          kind: 'rtu',
          label: `${building.address} · ${rtu.name}`,
          lat: rtu.lat,
          lng: rtu.lng,
          layerKey: 'rtu',
          detailName: rtu.name,
          buildingAddress: building.address,
        })
      }
    }

    const resolvedEntrances = ensureSuiteEntrances(buildings, polygons, suiteEntrances)
    for (const polygon of polygons) {
      if (
        polygon.name.toLowerCase().includes(q) ||
        (polygon.description ?? '').toLowerCase().includes(q)
      ) {
        const building = buildingForPolygon(buildings, polygon)
        const buildingPolygons = building
          ? polygonsForBuilding(polygonIndex, building.address)
          : []
        const { lat, lng } = suiteGatePosition(
          buildings,
          resolvedEntrances,
          polygon,
          buildingPolygons,
        )
        hits.push({
          kind: 'polygon',
          label: polygon.description
            ? `${polygon.name} · ${polygon.description}`
            : polygon.name,
          lat,
          lng,
          polygonName: polygon.name,
          polygonDescription: polygon.description,
        })
      }
    }
  }

  if (hits.length === 0) {
    const buildingHits = buildings.filter((b) => buildingMetadataMatches(b, q))
    for (const building of buildingHits) {
      hits.push({
        kind: 'building',
        label: building.address,
        lat: building.lat,
        lng: building.lng,
        address: building.address,
      })
    }
  }

  return hits
}

/** Pan/zoom to a building and select it without opening the info popup. */
export function requestBuildingMapFocus(address: string): void {
  window.dispatchEvent(new CustomEvent('map:openBuilding', { detail: { address } }))
  pulseSearchHitCirclesForBuilding(address)
}

export function openSearchHit(hit: SearchHit): void {
  queueMicrotask(() => {
    window.dispatchEvent(
      new CustomEvent('map:panTo', { detail: { lat: hit.lat, lng: hit.lng, zoom: MAP_DETAIL_ZOOM } }),
    )

    if (hit.kind === 'rtu' && hit.layerKey && hit.detailName) {
      if (hit.buildingAddress) pulseSearchHitCirclesForBuilding(hit.buildingAddress)
      window.dispatchEvent(
        new CustomEvent('map:openDetail', {
          detail: {
            layerKey: hit.layerKey,
            name: hit.detailName,
            buildingAddress: hit.buildingAddress,
          },
        }),
      )
      return
    }

    if (hit.kind === 'polygon' && hit.polygonName !== undefined) {
      window.dispatchEvent(
        new CustomEvent('map:openPolygon', {
          detail: {
            name: hit.polygonName,
            description: hit.polygonDescription ?? '',
          },
        }),
      )
      return
    }

    if (hit.kind === 'building' && hit.address) {
      requestBuildingMapFocus(hit.address)
    }
  })
}
