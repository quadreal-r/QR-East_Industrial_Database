import type { Building, Polygon, PortfolioData, SuiteEntrance } from '@/types/domain'
import { facadeEntrancePosition } from '@/lib/polygonFacade'
import {
  buildingForPolygon,
  buildPolygonBuildingIndex,
  polygonCentroid,
  polygonOptionKey,
  polygonsForBuilding,
} from '@/lib/polygonBuildings'
export function normalizeSuiteName(name: string): string {
  return name
    .toLowerCase()
    .replace(/suites?\s*#?\s*/gi, '')
    .replace(/units?\s*#?\s*/gi, '')
    .replace(/main\s*suite/gi, 'main')
    .replace(/[^a-z0-9]+/g, '')
    .trim()
}

/** Digits-only signature so "Suite 9,10,11,12" matches "Suites # 9,10-12". */
export function suiteNumberSignature(name: string): string {
  return name.replace(/\D/g, '')
}

function suiteNumbersOverlap(a: string, b: string): boolean {
  const numsA = a.match(/\d+/g)?.map(Number) ?? []
  const numsB = b.match(/\d+/g)?.map(Number) ?? []
  if (!numsA.length || !numsB.length) return false
  if (numsA[0] !== numsB[0]) return false
  return numsA.some((value) => numsB.includes(value))
}

function suiteNumbersMatchExactly(a: string, b: string): boolean {
  const numsA = a.match(/\d+/g) ?? []
  const numsB = b.match(/\d+/g) ?? []
  if (!numsA.length || !numsB.length) return false
  return numsA.length === numsB.length && numsA.every((num, index) => num === numsB[index])
}

function isMultiSuiteLabel(name: string): boolean {
  return /[,;/-]|(?:\band\b)|(?:\bto\b)/i.test(name)
}

function suiteNamesLooselyMatch(a: string, b: string): boolean {
  const normA = normalizeSuiteName(a)
  const normB = normalizeSuiteName(b)
  if (!normA || !normB) return false
  if (normA === normB) return true

  // Single-suite labels must match exactly — avoids Suite 1 matching Suite 10.
  if (!isMultiSuiteLabel(a) && !isMultiSuiteLabel(b)) {
    return suiteNumbersMatchExactly(a, b)
  }

  const sigA = suiteNumberSignature(a)
  const sigB = suiteNumberSignature(b)
  if (!sigA || !sigB) return false
  if (sigA === sigB) return true
  return suiteNumbersOverlap(a, b)
}

export function suiteEntranceOptionKey(
  entrance: Pick<SuiteEntrance, 'id' | 'building_id' | 'name' | 'polygon_id'>,
  buildingAddress?: string | null,
): string {
  if (entrance.id != null) return `id:${entrance.id}`
  const buildingPart = entrance.building_id != null ? String(entrance.building_id) : (buildingAddress ?? '')
  const suitePart =
    entrance.polygon_id != null ? `poly:${entrance.polygon_id}` : `${entrance.name}\0${buildingPart}`
  return suitePart
}

export function suiteEntranceEditorLabel(
  entrance: SuiteEntrance,
  buildingAddress: string | null,
): string {
  const name = entrance.name || 'Suite entrance'
  if (buildingAddress) return `${name} — ${buildingAddress}`
  if (entrance.description) return `${name} (${entrance.description.split('\n')[0]})`
  return name
}

export function matchesSuiteEntrance(
  a: Pick<SuiteEntrance, 'id' | 'building_id' | 'name' | 'polygon_id'>,
  b: Pick<SuiteEntrance, 'id' | 'building_id' | 'name' | 'polygon_id'>,
): boolean {
  if (a.id != null && b.id != null) return a.id === b.id
  if (a.polygon_id != null && b.polygon_id != null && a.building_id === b.building_id) {
    return a.polygon_id === b.polygon_id
  }
  return (
    a.building_id === b.building_id &&
    (a.name === b.name || suiteNamesLooselyMatch(a.name, b.name))
  )
}

export function findSuiteEntrance(
  entrances: SuiteEntrance[],
  target: Pick<SuiteEntrance, 'id' | 'building_id' | 'name' | 'polygon_id'>,
): SuiteEntrance | undefined {
  return entrances.find((entrance) => matchesSuiteEntrance(entrance, target))
}

export function buildingForSuiteEntrance(
  buildings: Building[],
  polygons: Polygon[],
  entrance: SuiteEntrance,
): Building | undefined {
  const byId = buildingForEntrance(buildings, entrance)
  if (byId) return byId
  if (entrance.polygon_id == null) return undefined
  const polygon = polygons.find((item) => item.id === entrance.polygon_id)
  if (!polygon) return undefined
  return buildingForPolygon(buildings, polygon) ?? undefined
}

export function buildingForEntrance(
  buildings: Building[],
  entrance: SuiteEntrance,
): Building | undefined {
  if (entrance.building_id != null) {
    return buildings.find((b) => b.id === entrance.building_id)
  }
  return undefined
}

function entranceMatchesPolygon(
  entrance: SuiteEntrance,
  polygon: Polygon,
  building: Building,
): boolean {
  if (
    entrance.polygon_id != null &&
    polygon.id != null &&
    entrance.polygon_id === polygon.id
  ) {
    return true
  }
  if (entrance.building_id != null && building.id != null && entrance.building_id !== building.id) {
    return false
  }
  const entranceNorm = normalizeSuiteName(entrance.name)
  const polygonNorm = normalizeSuiteName(polygon.name)
  if (!entranceNorm || !polygonNorm) return false
  if (entranceNorm === polygonNorm) return true
  return suiteNamesLooselyMatch(entrance.name, polygon.name)
}

function findEntranceIndexForPolygon(
  entrances: SuiteEntrance[],
  polygon: Polygon,
  building: Building,
  claimed: Set<number>,
): number {
  if (polygon.id != null) {
    const byPolygonId = entrances.findIndex(
      (entrance, index) =>
        !claimed.has(index) &&
        entrance.building_id === building.id &&
        entrance.polygon_id === polygon.id,
    )
    if (byPolygonId >= 0) return byPolygonId
  }

  return entrances.findIndex(
    (entrance, index) =>
      !claimed.has(index) &&
      entrance.building_id === building.id &&
      entranceMatchesPolygon(entrance, polygon, building),
  )
}

/** Default gate position: front facade edge midpoint (refined manually at the suite door). */
export function defaultEntrancePosition(
  polygon: Polygon,
  options?: {
    building?: Building | null
    buildingPolygons?: Polygon[]
  },
): { lat: number; lng: number } {
  if (options?.building) {
    return facadeEntrancePosition(
      polygon,
      options.building,
      options.buildingPolygons ?? [],
    )
  }
  return polygonCentroid(polygon.paths)
}

/**
 * Only re-snap gates explicitly marked as still auto-placed — i.e. never
 * dragged or manually positioned by a user. Distance-based checks don't
 * work here: suites are often narrower than a reasonable "did they move it"
 * tolerance, so any intentional small adjustment would look like it was
 * still at the default spot and get snapped straight back.
 */
function shouldSnapEntranceToFacade(entrance: SuiteEntrance): boolean {
  return entrance.auto_placed === true
}

/**
 * Ensure every tenant polygon has a 360° gate marker.
 * Existing DB rows are kept; missing suites get an in-memory entrance at the polygon centroid.
 */
export function ensureSuiteEntrances(
  buildings: Building[],
  polygons: Polygon[],
  entrances: SuiteEntrance[],
): SuiteEntrance[] {
  const next = [...entrances]
  const claimed = new Set<number>()
  const polygonIndex = buildPolygonBuildingIndex(buildings, polygons)

  for (const polygon of polygons) {
    const building = buildingForPolygon(buildings, polygon)
    if (!building?.id) continue

    const buildingPolygons = polygonsForBuilding(polygonIndex, building.address)
    const facadePos = facadeEntrancePosition(polygon, building, buildingPolygons)

    const existingIndex = findEntranceIndexForPolygon(next, polygon, building, claimed)
    if (existingIndex >= 0) {
      claimed.add(existingIndex)
      const existing = next[existingIndex]!
      const updates: Partial<SuiteEntrance> = {}
      if (existing.polygon_id == null && polygon.id != null) {
        updates.polygon_id = polygon.id
      }
      if (
        !Number.isFinite(existing.lat) ||
        !Number.isFinite(existing.lng) ||
        shouldSnapEntranceToFacade(existing)
      ) {
        updates.lat = facadePos.lat
        updates.lng = facadePos.lng
        updates.auto_placed = true
      }
      if (Object.keys(updates).length > 0) {
        next[existingIndex] = { ...existing, ...updates }
      }
      continue
    }

    const autoEntrance: SuiteEntrance = {
      building_id: building.id,
      polygon_id: polygon.id ?? null,
      name: polygon.name,
      description: polygon.description ?? '',
      lat: facadePos.lat,
      lng: facadePos.lng,
      inspection_url: null,
      auto_placed: true,
    }
    next.push(autoEntrance)
    claimed.add(next.length - 1)
  }

  return next
}

export function mergePortfolioSuiteEntrances(portfolio: PortfolioData): PortfolioData {
  const suiteEntrances = ensureSuiteEntrances(
    portfolio.buildings,
    portfolio.polygons,
    portfolio.suiteEntrances ?? [],
  )
  return { ...portfolio, suiteEntrances }
}

export function suiteEntranceMatchesSearch(
  entrance: SuiteEntrance,
  buildings: Building[],
  query: string,
): boolean {
  const trimmed = query.trim().toLowerCase()
  if (!trimmed) return true
  const building = buildingForEntrance(buildings, entrance)
  const haystack = [
    entrance.name,
    entrance.description,
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

export function polygonForEntrance(
  polygons: Polygon[],
  entrance: SuiteEntrance,
): Polygon | undefined {
  if (entrance.polygon_id != null) {
    return polygons.find((polygon) => polygon.id === entrance.polygon_id)
  }
  return polygons.find((polygon) => polygonOptionKey(polygon) === `${entrance.name}\0${entrance.description ?? ''}`)
}

export function resolveSuiteEntranceEditorSelection(
  entrances: SuiteEntrance[],
  buildings: Building[],
  options: {
    buildingAddress?: string | null
    entranceKey?: string | null
  },
): string {
  if (!entrances.length) return ''

  const sorted = [...entrances].sort((a, b) =>
    suiteEntranceEditorLabel(a, buildingForEntrance(buildings, a)?.address ?? null).localeCompare(
      suiteEntranceEditorLabel(b, buildingForEntrance(buildings, b)?.address ?? null),
    ),
  )

  if (options.entranceKey) {
    const match = sorted.find(
      (entrance) =>
        suiteEntranceOptionKey(entrance, buildingForEntrance(buildings, entrance)?.address ?? null) ===
        options.entranceKey,
    )
    if (match) {
      return suiteEntranceOptionKey(match, buildingForEntrance(buildings, match)?.address ?? null)
    }
  }

  if (options.buildingAddress) {
    const building = buildings.find((b) => b.address === options.buildingAddress)
    if (building?.id != null) {
      const buildingEntrances = sorted.filter((entrance) => entrance.building_id === building.id)
      if (buildingEntrances[0]) {
        return suiteEntranceOptionKey(
          buildingEntrances[0],
          building.address,
        )
      }
    }
  }

  const first = sorted[0]!
  return suiteEntranceOptionKey(first, buildingForEntrance(buildings, first)?.address ?? null)
}

export function entrancesForBuilding(
  entrances: SuiteEntrance[],
  building: Building | undefined,
): SuiteEntrance[] {
  if (!building?.id) return []
  return entrances.filter((entrance) => entrance.building_id === building.id)
}

/** Polygons at a building that do not yet have a 360° gate. */
export function polygonsWithoutEntrance(
  building: Building,
  polygons: Polygon[],
  entrances: SuiteEntrance[],
): Polygon[] {
  const index = buildPolygonBuildingIndex([building], polygons)
  const buildingPolygons = index.get(building.address) ?? []
  return buildingPolygons.filter(
    (polygon) =>
      !entrances.some(
        (entrance) =>
          entrance.building_id === building.id &&
          entranceMatchesPolygon(entrance, polygon, building),
      ),
  )
}
