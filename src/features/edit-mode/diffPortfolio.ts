import type { Building, LatLng, Polygon, PortfolioData, Rtu, SuiteEntrance, Utility } from '@/types/domain'
import { matchesSuiteEntrance } from '@/lib/suiteEntrances'

export interface EditSummaryGroup {
  label: string
  count: number
  items: string[]
}

export interface EditSummary {
  total: number
  groups: EditSummaryGroup[]
}

const POSITION_EPSILON = 1e-6
const MAX_ITEMS_PER_GROUP = 5

function coordsEqual(a: LatLng, b: LatLng): boolean {
  return Math.abs(a.lat - b.lat) < POSITION_EPSILON && Math.abs(a.lng - b.lng) < POSITION_EPSILON
}

function pathsEqual(a: LatLng[], b: LatLng[]): boolean {
  if (a.length !== b.length) return false
  return a.every((point, index) => coordsEqual(point, b[index]!))
}

function buildingLabel(building: Building): string {
  return building.address || building.park || 'Building'
}

function rtuLabel(rtu: Rtu, building?: Building): string {
  const name = rtu.name || 'RTU'
  return building ? `${name} (${buildingLabel(building)})` : name
}

function utilityLabel(utility: Utility): string {
  return `${utility.name} (${utility.utility_type})`
}

function polygonLabel(polygon: Polygon): string {
  return polygon.name || 'Polygon'
}

function suiteEntranceLabel(entrance: SuiteEntrance, building?: Building): string {
  const name = entrance.name || '360° gate'
  return building ? `${name} (${buildingLabel(building)})` : name
}

function suiteEntranceTextFields(entrance: SuiteEntrance): Record<string, unknown> {
  return {
    building_id: entrance.building_id ?? null,
    polygon_id: entrance.polygon_id ?? null,
    name: entrance.name,
    description: entrance.description,
    inspection_url: entrance.inspection_url ?? null,
  }
}

function findBaselineSuiteEntrance(
  baseline: PortfolioData,
  entrance: SuiteEntrance,
): SuiteEntrance | undefined {
  return (baseline.suiteEntrances ?? []).find((item) => matchesSuiteEntrance(item, entrance))
}

function suiteEntranceChanged(a: SuiteEntrance, b: SuiteEntrance): { moved: boolean; edited: boolean } {
  const moved = !coordsEqual({ lat: a.lat, lng: a.lng }, { lat: b.lat, lng: b.lng })
  const edited = !recordsEqual(suiteEntranceTextFields(a), suiteEntranceTextFields(b))
  return { moved, edited }
}

function pushSuiteEntranceUpsert(
  changes: PortfolioChanges,
  entrance: SuiteEntrance,
  baselineMatch?: SuiteEntrance,
): void {
  if (entrance.building_id == null) return
  const payload = {
    ...entrance,
    building_id: entrance.building_id,
    id: entrance.id ?? baselineMatch?.id,
  }
  changes.suiteEntrancesToUpsert.push(payload as SuiteEntrance & { building_id: number })
}

function buildingTextFields(building: Building): Record<string, unknown> {
  return {
    park: building.park,
    address: building.address,
    bu: building.bu,
    sqft: building.sqft,
    cluster: building.cluster,
    manager: building.manager,
    notes: building.notes ?? null,
    sold: building.sold ?? false,
  }
}

function rtuTextFields(rtu: Rtu): Record<string, unknown> {
  return {
    name: rtu.name,
    description: rtu.description,
    model: rtu.model ?? null,
    serial: rtu.serial ?? null,
    make: rtu.make ?? null,
    install_date: rtu.install_date ?? null,
    install_year: rtu.install_year ?? null,
    heating_btu: rtu.heating_btu ?? null,
    cooling_tons: rtu.cooling_tons ?? null,
    suite: rtu.suite ?? null,
    marker_shape: rtu.marker_shape ?? null,
    marker_scale: rtu.marker_scale ?? null,
  }
}

function utilityTextFields(utility: Utility): Record<string, unknown> {
  return {
    utility_type: utility.utility_type,
    name: utility.name,
    description: utility.description,
    marker_shape: utility.marker_shape ?? null,
    marker_scale: utility.marker_scale ?? null,
  }
}

function polygonTextFields(polygon: Polygon): Record<string, unknown> {
  return {
    name: polygon.name,
    description: polygon.description,
    color: polygon.color,
  }
}

function recordsEqual(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

function pushItem(groups: Map<string, string[]>, label: string, item: string) {
  const items = groups.get(label) ?? []
  items.push(item)
  groups.set(label, items)
}

function finalizeGroups(groups: Map<string, string[]>): EditSummaryGroup[] {
  const order = [
    'Markers added',
    'Markers moved',
    'Markers edited',
    'Markers deleted',
    '360° gates added',
    '360° gates moved',
    '360° gates edited',
    '360° gates deleted',
    'Polygons added',
    'Polygons moved',
    'Polygons edited',
    'Polygons deleted',
  ]

  return order
    .map((label) => {
      const items = groups.get(label) ?? []
      if (!items.length) return null
      return {
        label,
        count: items.length,
        items: items.slice(0, MAX_ITEMS_PER_GROUP),
      }
    })
    .filter((group): group is EditSummaryGroup => group !== null)
}

function diffRtus(
  baselineBuilding: Building,
  pendingBuilding: Building,
  groups: Map<string, string[]>,
) {
  const baselineRtus = new Map(
    (baselineBuilding.rtus ?? []).filter((rtu) => rtu.id != null).map((rtu) => [rtu.id!, rtu]),
  )
  const pendingRtus = pendingBuilding.rtus ?? []

  for (const rtu of pendingRtus) {
    if (rtu.id == null) {
      pushItem(groups, 'Markers added', rtuLabel(rtu, pendingBuilding))
      continue
    }

    const baselineRtu = baselineRtus.get(rtu.id)
    if (!baselineRtu) {
      pushItem(groups, 'Markers added', rtuLabel(rtu, pendingBuilding))
      continue
    }

    const moved = !coordsEqual(
      { lat: baselineRtu.lat, lng: baselineRtu.lng },
      { lat: rtu.lat, lng: rtu.lng },
    )
    const edited = !recordsEqual(rtuTextFields(baselineRtu), rtuTextFields(rtu))

    if (moved) pushItem(groups, 'Markers moved', rtuLabel(rtu, pendingBuilding))
    if (edited) pushItem(groups, 'Markers edited', rtuLabel(rtu, pendingBuilding))

    baselineRtus.delete(rtu.id)
  }

  for (const rtu of baselineRtus.values()) {
    pushItem(groups, 'Markers deleted', rtuLabel(rtu, baselineBuilding))
  }
}

export interface PortfolioChanges {
  buildingsToInsert: Building[]
  buildingsToUpdate: Building[]
  buildingIdsToDelete: number[]
  rtusToUpsert: Array<Rtu & { building_id: number }>
  rtuIdsToDelete: number[]
  utilitiesToUpsert: Utility[]
  utilityIdsToDelete: number[]
  polygonsToUpsert: Polygon[]
  polygonIdsToDelete: number[]
  suiteEntrancesToUpsert: Array<SuiteEntrance & { building_id: number }>
  suiteEntranceIdsToDelete: number[]
}

export function countPortfolioChanges(changes: PortfolioChanges): number {
  return (
    changes.buildingsToInsert.length +
    changes.buildingsToUpdate.length +
    changes.buildingIdsToDelete.length +
    changes.rtusToUpsert.length +
    changes.rtuIdsToDelete.length +
    changes.utilitiesToUpsert.length +
    changes.utilityIdsToDelete.length +
    changes.polygonsToUpsert.length +
    changes.polygonIdsToDelete.length +
    changes.suiteEntrancesToUpsert.length +
    changes.suiteEntranceIdsToDelete.length
  )
}

function collectRtuChanges(
  baselineBuilding: Building,
  pendingBuilding: Building,
  changes: PortfolioChanges,
) {
  const baselineRtus = new Map(
    (baselineBuilding.rtus ?? []).filter((rtu) => rtu.id != null).map((rtu) => [rtu.id!, rtu]),
  )
  const buildingId = pendingBuilding.id!

  for (const rtu of pendingBuilding.rtus ?? []) {
    if (rtu.id == null) {
      changes.rtusToUpsert.push({ ...rtu, building_id: buildingId })
      continue
    }

    const baselineRtu = baselineRtus.get(rtu.id)
    if (!baselineRtu) {
      changes.rtusToUpsert.push({ ...rtu, building_id: buildingId })
      continue
    }

    const moved = !coordsEqual(
      { lat: baselineRtu.lat, lng: baselineRtu.lng },
      { lat: rtu.lat, lng: rtu.lng },
    )
    const edited = !recordsEqual(rtuTextFields(baselineRtu), rtuTextFields(rtu))

    if (moved || edited) {
      changes.rtusToUpsert.push({ ...rtu, building_id: buildingId })
    }

    baselineRtus.delete(rtu.id)
  }

  for (const rtu of baselineRtus.values()) {
    if (rtu.id != null) changes.rtuIdsToDelete.push(rtu.id)
  }
}

export function computePortfolioChanges(
  baseline: PortfolioData,
  pending: PortfolioData,
): PortfolioChanges {
  const changes: PortfolioChanges = {
    buildingsToInsert: [],
    buildingsToUpdate: [],
    buildingIdsToDelete: [],
    rtusToUpsert: [],
    rtuIdsToDelete: [],
    utilitiesToUpsert: [],
    utilityIdsToDelete: [],
    polygonsToUpsert: [],
    polygonIdsToDelete: [],
    suiteEntrancesToUpsert: [],
    suiteEntranceIdsToDelete: [],
  }

  const baselineBuildings = new Map(
    baseline.buildings
      .filter((building) => building.id != null)
      .map((building) => [building.id!, building]),
  )

  for (const building of pending.buildings) {
    if (building.id == null) {
      changes.buildingsToInsert.push(building)
      continue
    }

    const baselineBuilding = baselineBuildings.get(building.id)
    if (!baselineBuilding) {
      changes.buildingsToInsert.push(building)
      continue
    }

    const moved = !coordsEqual(
      { lat: baselineBuilding.lat, lng: baselineBuilding.lng },
      { lat: building.lat, lng: building.lng },
    )
    const edited = !recordsEqual(buildingTextFields(baselineBuilding), buildingTextFields(building))

    if (moved || edited) {
      changes.buildingsToUpdate.push(building)
    }

    collectRtuChanges(baselineBuilding, building, changes)
    baselineBuildings.delete(building.id)
  }

  for (const building of baselineBuildings.values()) {
    if (building.id != null) changes.buildingIdsToDelete.push(building.id)
  }

  const baselineUtilities = new Map(
    baseline.utilities
      .filter((utility) => utility.id != null)
      .map((utility) => [utility.id!, utility]),
  )

  for (const utility of pending.utilities) {
    if (utility.id == null) {
      changes.utilitiesToUpsert.push(utility)
      continue
    }

    const baselineUtility = baselineUtilities.get(utility.id)
    if (!baselineUtility) {
      changes.utilitiesToUpsert.push(utility)
      continue
    }

    const moved = !coordsEqual(
      { lat: baselineUtility.lat, lng: baselineUtility.lng },
      { lat: utility.lat, lng: utility.lng },
    )
    const edited = !recordsEqual(utilityTextFields(baselineUtility), utilityTextFields(utility))

    if (moved || edited) {
      changes.utilitiesToUpsert.push(utility)
    }

    baselineUtilities.delete(utility.id)
  }

  for (const utility of baselineUtilities.values()) {
    if (utility.id != null) changes.utilityIdsToDelete.push(utility.id)
  }

  const baselinePolygons = new Map(
    baseline.polygons
      .filter((polygon) => polygon.id != null)
      .map((polygon) => [polygon.id!, polygon]),
  )

  for (const polygon of pending.polygons) {
    if (polygon.id == null) {
      changes.polygonsToUpsert.push(polygon)
      continue
    }

    const baselinePolygon = baselinePolygons.get(polygon.id)
    if (!baselinePolygon) {
      changes.polygonsToUpsert.push(polygon)
      continue
    }

    const moved = !pathsEqual(baselinePolygon.paths, polygon.paths)
    const edited = !recordsEqual(polygonTextFields(baselinePolygon), polygonTextFields(polygon))

    if (moved || edited) {
      changes.polygonsToUpsert.push(polygon)
    }

    baselinePolygons.delete(polygon.id)
  }

  for (const polygon of baselinePolygons.values()) {
    if (polygon.id != null) changes.polygonIdsToDelete.push(polygon.id)
  }

  const baselineEntrances = new Map(
    (baseline.suiteEntrances ?? [])
      .filter((entrance) => entrance.id != null)
      .map((entrance) => [entrance.id!, entrance]),
  )

  for (const entrance of pending.suiteEntrances ?? []) {
    if (entrance.id == null) {
      const baselineMatch = findBaselineSuiteEntrance(baseline, entrance)
      if (!baselineMatch) {
        pushSuiteEntranceUpsert(changes, entrance)
        continue
      }
      const { moved, edited } = suiteEntranceChanged(baselineMatch, entrance)
      if (moved || edited) {
        pushSuiteEntranceUpsert(changes, entrance, baselineMatch)
      }
      continue
    }

    const baselineEntrance = baselineEntrances.get(entrance.id)
    if (!baselineEntrance) {
      pushSuiteEntranceUpsert(changes, entrance)
      continue
    }

    const { moved, edited } = suiteEntranceChanged(baselineEntrance, entrance)

    if ((moved || edited) && entrance.building_id != null) {
      pushSuiteEntranceUpsert(changes, entrance)
    }

    baselineEntrances.delete(entrance.id)
  }

  for (const entrance of baselineEntrances.values()) {
    if (entrance.id != null) changes.suiteEntranceIdsToDelete.push(entrance.id)
  }

  return changes
}

export function diffPortfolio(baseline: PortfolioData, pending: PortfolioData): EditSummary {
  const groups = new Map<string, string[]>()

  const baselineBuildings = new Map(
    baseline.buildings.filter((building) => building.id != null).map((building) => [building.id!, building]),
  )

  for (const building of pending.buildings) {
    if (building.id == null) {
      pushItem(groups, 'Markers added', buildingLabel(building))
      for (const rtu of building.rtus ?? []) {
        pushItem(groups, 'Markers added', rtuLabel(rtu, building))
      }
      continue
    }

    const baselineBuilding = baselineBuildings.get(building.id)
    if (!baselineBuilding) {
      pushItem(groups, 'Markers added', buildingLabel(building))
      continue
    }

    const moved = !coordsEqual(
      { lat: baselineBuilding.lat, lng: baselineBuilding.lng },
      { lat: building.lat, lng: building.lng },
    )
    const edited = !recordsEqual(buildingTextFields(baselineBuilding), buildingTextFields(building))

    if (moved) pushItem(groups, 'Markers moved', buildingLabel(building))
    if (edited) pushItem(groups, 'Markers edited', buildingLabel(building))

    diffRtus(baselineBuilding, building, groups)
    baselineBuildings.delete(building.id)
  }

  for (const building of baselineBuildings.values()) {
    pushItem(groups, 'Markers deleted', buildingLabel(building))
    for (const rtu of building.rtus ?? []) {
      pushItem(groups, 'Markers deleted', rtuLabel(rtu, building))
    }
  }

  const baselineUtilities = new Map(
    baseline.utilities.filter((utility) => utility.id != null).map((utility) => [utility.id!, utility]),
  )

  for (const utility of pending.utilities) {
    if (utility.id == null) {
      pushItem(groups, 'Markers added', utilityLabel(utility))
      continue
    }

    const baselineUtility = baselineUtilities.get(utility.id)
    if (!baselineUtility) {
      pushItem(groups, 'Markers added', utilityLabel(utility))
      continue
    }

    const moved = !coordsEqual(
      { lat: baselineUtility.lat, lng: baselineUtility.lng },
      { lat: utility.lat, lng: utility.lng },
    )
    const edited = !recordsEqual(utilityTextFields(baselineUtility), utilityTextFields(utility))

    if (moved) pushItem(groups, 'Markers moved', utilityLabel(utility))
    if (edited) pushItem(groups, 'Markers edited', utilityLabel(utility))

    baselineUtilities.delete(utility.id)
  }

  for (const utility of baselineUtilities.values()) {
    pushItem(groups, 'Markers deleted', utilityLabel(utility))
  }

  const baselinePolygons = new Map(
    baseline.polygons.filter((polygon) => polygon.id != null).map((polygon) => [polygon.id!, polygon]),
  )

  for (const polygon of pending.polygons) {
    if (polygon.id == null) {
      pushItem(groups, 'Polygons added', polygonLabel(polygon))
      continue
    }

    const baselinePolygon = baselinePolygons.get(polygon.id)
    if (!baselinePolygon) {
      pushItem(groups, 'Polygons added', polygonLabel(polygon))
      continue
    }

    const moved = !pathsEqual(baselinePolygon.paths, polygon.paths)
    const edited = !recordsEqual(polygonTextFields(baselinePolygon), polygonTextFields(polygon))

    if (moved) pushItem(groups, 'Polygons moved', polygonLabel(polygon))
    if (edited) pushItem(groups, 'Polygons edited', polygonLabel(polygon))

    baselinePolygons.delete(polygon.id)
  }

  for (const polygon of baselinePolygons.values()) {
    pushItem(groups, 'Polygons deleted', polygonLabel(polygon))
  }

  const baselineEntrances = new Map(
    (baseline.suiteEntrances ?? [])
      .filter((entrance) => entrance.id != null)
      .map((entrance) => [entrance.id!, entrance]),
  )
  const buildingById = new Map(
    pending.buildings.filter((b) => b.id != null).map((b) => [b.id!, b]),
  )

  for (const entrance of pending.suiteEntrances ?? []) {
    const building = entrance.building_id != null ? buildingById.get(entrance.building_id) : undefined
    if (entrance.id == null) {
      const baselineMatch = findBaselineSuiteEntrance(baseline, entrance)
      if (!baselineMatch) {
        pushItem(groups, '360° gates added', suiteEntranceLabel(entrance, building))
        continue
      }
      const { moved, edited } = suiteEntranceChanged(baselineMatch, entrance)
      if (moved) pushItem(groups, '360° gates moved', suiteEntranceLabel(entrance, building))
      if (edited) pushItem(groups, '360° gates edited', suiteEntranceLabel(entrance, building))
      continue
    }

    const baselineEntrance = baselineEntrances.get(entrance.id)
    if (!baselineEntrance) {
      pushItem(groups, '360° gates added', suiteEntranceLabel(entrance, building))
      continue
    }

    const { moved, edited } = suiteEntranceChanged(baselineEntrance, entrance)

    if (moved) pushItem(groups, '360° gates moved', suiteEntranceLabel(entrance, building))
    if (edited) pushItem(groups, '360° gates edited', suiteEntranceLabel(entrance, building))

    baselineEntrances.delete(entrance.id)
  }

  for (const entrance of baselineEntrances.values()) {
    const building =
      entrance.building_id != null ? buildingById.get(entrance.building_id) : undefined
    pushItem(groups, '360° gates deleted', suiteEntranceLabel(entrance, building))
  }

  const summaryGroups = finalizeGroups(groups)
  const total = summaryGroups.reduce((sum, group) => sum + group.count, 0)

  return { total, groups: summaryGroups }
}
