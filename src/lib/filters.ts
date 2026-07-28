import {
  buildingMatchesCapexStatusSearch,
  parseCapexStatusSearchQuery,
} from '@/lib/capexStatusSearch'
import { buildingAddressMatchesSearch } from '@/lib/buildingAddressAliases'
import { normalizeCapexBu } from '@/lib/capexSharedBu'
import { RTU_AGE_WARN } from '@/lib/constants'
import { collectBuildingOperatorFilterOptions } from '@/lib/buildingOperators'
import { hasPlaceholderGps, hasVacant, mlCount } from '@/lib/dataQuality'
import { resolveManagerDisplayName, isManagerSlotKey } from '@/lib/managerNames'
import {
  type PolygonBuildingIndex,
  polygonsForBuilding,
} from '@/lib/polygonBuildings'
import { oldestRtuAge } from '@/lib/rtu'
import { rtuMatchesSearch } from '@/lib/rtuSearch'
import type {
  AdvFilterState,
  Building,
  DqFilterState,
  FilterState,
  Polygon,
} from '@/types/domain'

export type { CapexStatusSearchLabel, CapexStatusSearchQuery } from '@/lib/capexStatusSearch'
export {
  isCapexStatusSearch,
  parseCapexStatusSearch,
  parseCapexStatusSearchQuery,
} from '@/lib/capexStatusSearch'

const ADV_RTU_AGE_THRESHOLD = 20

function normalizeSearch(search: string): string {
  return search.trim().toLowerCase()
}

/**
 * Match building BU # for global search.
 * Accepts bare codes (`50454`) and prefixed forms (`BU50454`, `BU #50454`, `bu:50454`).
 */
export function buildingBuMatchesSearch(
  bu: string | null | undefined,
  query: string,
): boolean {
  const buRaw = String(bu ?? '').trim()
  if (!buRaw) return false
  const q = String(query ?? '').trim().toLowerCase()
  if (!q) return false
  const buLower = buRaw.toLowerCase()
  if (buLower.includes(q)) return true

  const prefixed = q.match(/^bu\s*[#:]?\s*(\d+)$/)
  if (!prefixed?.[1]) return false
  const needle = normalizeCapexBu(prefixed[1])
  const hay = normalizeCapexBu(buRaw)
  return hay === needle || hay.includes(needle) || buLower.includes(prefixed[1])
}

/** Same wording as the building-list badge (e.g. "33 Tenants"). */
export function formatTenantCountLabel(count: number): string {
  if (count <= 0) return ''
  return `${count} ${count === 1 ? 'Tenant' : 'Tenants'}`
}

/** Match search against the tenant-count badge text (e.g. "tenants", "33 Tenants"). */
export function matchesTenantCountLabel(count: number, search: string): boolean {
  const q = normalizeSearch(search)
  if (!q || count <= 0) return false
  const label = formatTenantCountLabel(count).toLowerCase()
  if (label.includes(q)) return true
  const exact = q.match(/^(\d+)\s*tenants?$/)
  if (exact) return count === Number(exact[1])
  return false
}

/** True for count-style queries like "tenants" or "13 Tenants" (not tenant company names). */
export function isTenantCountSearch(search: string): boolean {
  const q = normalizeSearch(search)
  if (!q) return false
  if (q === 'tenant' || q === 'tenants') return true
  return /^\d+\s*tenants?$/.test(q)
}

function matchesManagerFilter(
  building: Building,
  managerFilter: string,
  managerRenames?: Record<string, string>,
): boolean {
  if (!managerFilter) return true
  const stored = building.manager ?? ''
  if (stored === managerFilter) return true

  const storedDisplay = resolveManagerDisplayName(stored, managerRenames)
  if (storedDisplay === managerFilter) return true

  if (isManagerSlotKey(managerFilter)) {
    const slotDisplay = managerRenames?.[managerFilter]?.trim()
    if (slotDisplay && (stored === slotDisplay || storedDisplay === slotDisplay)) return true
  }

  if (isManagerSlotKey(stored)) {
    const renamed = managerRenames?.[stored]?.trim()
    if (renamed && renamed === managerFilter) return true
  }

  return false
}

/** Building-level search (address, BU, cluster, manager, tenant count) — not RTU/tenant name fields. */
export function matchesBuildingMetadata(
  building: Building,
  search: string,
  managerRenames?: Record<string, string>,
  polygonIndex?: PolygonBuildingIndex,
  capexStatuses?: Record<string, string>,
): boolean {
  const q = normalizeSearch(search)
  if (!q) return true
  const statusQuery = parseCapexStatusSearchQuery(search)
  if (statusQuery && capexStatuses) {
    return buildingMatchesCapexStatusSearch(
      building.address,
      statusQuery.label,
      capexStatuses,
      statusQuery.year,
    )
  }
  if (buildingAddressMatchesSearch(building.address, q)) return true
  if (buildingBuMatchesSearch(building.bu, q)) return true
  if (building.cluster?.toLowerCase().includes(q)) return true
  if (building.manager?.toLowerCase().includes(q)) return true
  if (building.buildingOperator?.toLowerCase().includes(q)) return true
  if (resolveManagerDisplayName(building.manager ?? '', managerRenames).toLowerCase().includes(q)) {
    return true
  }
  if (matchesTenantCountLabel(buildingPolygons(polygonIndex, building).length, q)) return true
  return false
}

function buildingPolygons(
  index: PolygonBuildingIndex | undefined,
  building: Building,
): Polygon[] {
  return index ? polygonsForBuilding(index, building.address) : []
}

/** Search match across address, metadata, tenant polygons, RTUs, and Capex status. */
export function matchesSearch(
  building: Building,
  search: string,
  polygonIndex?: PolygonBuildingIndex,
  managerRenames?: Record<string, string>,
  capexStatuses?: Record<string, string>,
): boolean {
  const q = normalizeSearch(search)
  if (!q) return true

  const statusQuery = parseCapexStatusSearchQuery(search)
  if (statusQuery) {
    if (!capexStatuses) return false
    return buildingMatchesCapexStatusSearch(
      building.address,
      statusQuery.label,
      capexStatuses,
      statusQuery.year,
    )
  }

  if (buildingAddressMatchesSearch(building.address, q)) return true
  if (buildingBuMatchesSearch(building.bu, q)) return true
  if (building.cluster?.toLowerCase().includes(q)) return true
  if (building.manager?.toLowerCase().includes(q)) return true
  if (building.buildingOperator?.toLowerCase().includes(q)) return true
  if (resolveManagerDisplayName(building.manager ?? '', managerRenames).toLowerCase().includes(q)) {
    return true
  }

  const tenantPolygons = buildingPolygons(polygonIndex, building)
  if (matchesTenantCountLabel(tenantPolygons.length, q)) return true
  if (
    tenantPolygons.some(
      (polygon) =>
        polygon.description.toLowerCase().includes(q) ||
        polygon.name.toLowerCase().includes(q),
    )
  ) {
    return true
  }

  if (building.rtus?.some((r) => rtuMatchesSearch(r, q))) {
    return true
  }

  return false
}

/** Advanced filter predicates from the legacy `_passAdvFilter`. */
export function passAdvFilter(
  building: Building,
  adv: AdvFilterState,
  polygonIndex?: PolygonBuildingIndex,
): boolean {
  const tenantPolygons = buildingPolygons(polygonIndex, building)
  if (adv.vacant === 'yes' && !hasVacant(building, tenantPolygons)) return false
  if (adv.vacant === 'no' && hasVacant(building, tenantPolygons)) return false

  const oldest = oldestRtuAge(building)
  if (adv.rtu === 'yes' && oldest < ADV_RTU_AGE_THRESHOLD) return false
  if (adv.rtu === 'no' && oldest >= ADV_RTU_AGE_THRESHOLD) return false

  const hasRtus = Boolean(building.rtus && building.rtus.length > 0)
  if (adv.hasrtu === 'yes' && !hasRtus) return false
  if (adv.hasrtu === 'no' && hasRtus) return false

  const ml = mlCount(building)
  if (adv.ml === 'yes' && !ml) return false
  if (adv.ml === 'no' && ml) return false

  return true
}

/** Data-quality chip filters applied on top of primary filters. */
export function passDqFilter(
  building: Building,
  dq: DqFilterState,
  polygonIndex?: PolygonBuildingIndex,
): boolean {
  const tenantPolygons = buildingPolygons(polygonIndex, building)
  if (dq.gps && !hasPlaceholderGps(building)) return false
  if (dq.rtu && oldestRtuAge(building) < RTU_AGE_WARN) return false
  if (dq.vacant && !hasVacant(building, tenantPolygons)) return false
  if (dq.ml && !mlCount(building)) return false
  return true
}

/** When search is active, reset dropdown values that no longer match search hits. */
export function reconcileFilterDropdowns(
  buildings: Building[],
  filters: FilterState,
  polygonIndex?: PolygonBuildingIndex,
  managerRenames?: Record<string, string>,
  capexStatuses?: Record<string, string>,
): FilterState {
  const search = normalizeSearch(filters.search)
  const next = { ...filters }

  if (search) {
    const searchMatches = buildings.filter((b) =>
      matchesSearch(b, search, polygonIndex, managerRenames, capexStatuses),
    )
    if (next.park && !searchMatches.some((b) => b.park === next.park)) {
      next.park = ''
    }
    if (next.cluster && !searchMatches.some((b) => b.cluster === next.cluster)) {
      next.cluster = ''
    }
    if (next.manager && !searchMatches.some((b) => matchesManagerFilter(b, next.manager, managerRenames))) {
      next.manager = ''
    }
    if (
      next.buildingOperator &&
      !searchMatches.some((b) => (b.buildingOperator ?? '') === next.buildingOperator)
    ) {
      next.buildingOperator = ''
    }
  }

  if (next.park && !buildingsForFilterOptions(buildings, next, 'park', polygonIndex, managerRenames).some((b) => b.park === next.park)) {
    next.park = ''
  }
  if (
    next.cluster &&
    !buildingsForFilterOptions(buildings, next, 'cluster', polygonIndex, managerRenames).some((b) => b.cluster === next.cluster)
  ) {
    next.cluster = ''
  }
  if (
    next.manager &&
    !buildingsForFilterOptions(buildings, next, 'manager', polygonIndex, managerRenames).some((b) =>
      matchesManagerFilter(b, next.manager, managerRenames),
    )
  ) {
    next.manager = ''
  }
  // Building operator stays selected even when park/manager scope has no matches.
  // Options themselves come from live portfolio values (see collectBuildingOperatorFilterOptions).

  return next
}

/** When a dropdown has exactly one option left, select it (unless the user just cleared that field). */
export function autoFillFilterDropdowns(
  buildings: Building[],
  filters: Pick<FilterState, 'search' | 'park' | 'cluster' | 'manager' | 'buildingOperator'>,
  skipFields: ReadonlySet<string> = new Set(),
  polygonIndex?: PolygonBuildingIndex,
  managerRenames?: Record<string, string>,
  capexStatuses?: Record<string, string>,
): Pick<FilterState, 'search' | 'park' | 'cluster' | 'manager' | 'buildingOperator'> {
  const next = { ...filters }
  let changed = true

  while (changed) {
    changed = false
    const options = collectFilterOptions(
      buildings,
      next,
      polygonIndex,
      managerRenames,
      capexStatuses,
    )

    if (!next.park && !skipFields.has('park') && options.parks.length === 1) {
      next.park = options.parks[0]!
      changed = true
    }
    if (!next.cluster && !skipFields.has('cluster') && options.clusters.length === 1) {
      next.cluster = options.clusters[0]!
      changed = true
    }
    if (!next.manager && !skipFields.has('manager') && options.managers.length === 1) {
      next.manager = options.managers[0]!
      changed = true
    }
    if (
      !next.buildingOperator &&
      !skipFields.has('buildingOperator') &&
      options.buildingOperators.length === 1
    ) {
      next.buildingOperator = options.buildingOperators[0]!
      changed = true
    }
  }

  return next
}

/** Apply a dropdown change: reconcile invalid values, then auto-fill other fields. */
export function applyFilterSelection(
  buildings: Building[],
  filters: FilterState,
  patch: Partial<Pick<FilterState, 'park' | 'cluster' | 'manager' | 'buildingOperator'>>,
  polygonIndex?: PolygonBuildingIndex,
  managerRenames?: Record<string, string>,
  capexStatuses?: Record<string, string>,
): Pick<FilterState, 'search' | 'park' | 'cluster' | 'manager' | 'buildingOperator'> {
  const expanded = { ...patch }
  if (patch.park === '') {
    expanded.manager = ''
    expanded.cluster = ''
    expanded.buildingOperator = ''
  }
  if (patch.manager === '') {
    expanded.park = ''
    expanded.cluster = ''
  }

  const reconciled = reconcileFilterDropdowns(
    buildings,
    { ...filters, ...expanded },
    polygonIndex,
    managerRenames,
    capexStatuses,
  )
  return autoFillFilterDropdowns(
    buildings,
    reconciled,
    new Set(Object.keys(expanded)),
    polygonIndex,
    managerRenames,
    capexStatuses,
  )
}

/** Primary filter pass (search, park, cluster, manager, building operator, advanced). */
export function applyPrimaryFilters(
  buildings: Building[],
  filters: FilterState,
  polygonIndex?: PolygonBuildingIndex,
  managerRenames?: Record<string, string>,
  capexStatuses?: Record<string, string>,
): Building[] {
  const reconciled = reconcileFilterDropdowns(
    buildings,
    filters,
    polygonIndex,
    managerRenames,
    capexStatuses,
  )
  const search = normalizeSearch(reconciled.search)

  const filtered = buildings.filter((building) => {
    if (!matchesSearch(building, search, polygonIndex, managerRenames, capexStatuses)) return false
    if (reconciled.park && building.park !== reconciled.park) return false
    if (reconciled.cluster && building.cluster !== reconciled.cluster) return false
    if (reconciled.manager && !matchesManagerFilter(building, reconciled.manager, managerRenames)) return false
    if (reconciled.buildingOperator && (building.buildingOperator ?? '') !== reconciled.buildingOperator) {
      return false
    }
    if (!passAdvFilter(building, reconciled.adv, polygonIndex)) return false
    return true
  })

  // Tenant-count searches (e.g. "tenants", "33 Tenants"): highest counts first.
  if (search && isTenantCountSearch(search)) {
    return [...filtered].sort(
      (a, b) =>
        buildingPolygons(polygonIndex, b).length - buildingPolygons(polygonIndex, a).length,
    )
  }

  return filtered
}

/** Full filter pipeline including data-quality chips. */
export function applyFilters(
  buildings: Building[],
  filters: FilterState,
  polygonIndex?: PolygonBuildingIndex,
  managerRenames?: Record<string, string>,
  capexStatuses?: Record<string, string>,
): Building[] {
  return applyPrimaryFilters(
    buildings,
    filters,
    polygonIndex,
    managerRenames,
    capexStatuses,
  ).filter((building) => passDqFilter(building, filters.dq, polygonIndex))
}

/**
 * Buildings for RTU replacement cost scope.
 * When search matches any address/metadata, exclude buildings that only matched via RTU/tenant detail.
 */
export function applyCostScopeFilters(
  buildings: Building[],
  filters: FilterState,
  polygonIndex?: PolygonBuildingIndex,
  managerRenames?: Record<string, string>,
  capexStatuses?: Record<string, string>,
): Building[] {
  const filtered = applyPrimaryFilters(
    buildings,
    filters,
    polygonIndex,
    managerRenames,
    capexStatuses,
  )
  const search = normalizeSearch(filters.search)
  if (!search) return filtered
  const metadataHits = filtered.filter((building) =>
    matchesBuildingMetadata(building, search, managerRenames, polygonIndex, capexStatuses),
  )
  return metadataHits.length > 0 ? metadataHits : filtered
}

/** Buildings eligible for a dropdown, excluding that dropdown's own filter. */
function buildingsForFilterOptions(
  buildings: Building[],
  filters: Pick<FilterState, 'search' | 'park' | 'cluster' | 'manager' | 'buildingOperator'>,
  exclude: 'park' | 'cluster' | 'manager' | 'buildingOperator',
  polygonIndex?: PolygonBuildingIndex,
  managerRenames?: Record<string, string>,
  capexStatuses?: Record<string, string>,
): Building[] {
  const search = normalizeSearch(filters.search)
  return buildings.filter((building) => {
    if (!matchesSearch(building, search, polygonIndex, managerRenames, capexStatuses)) return false
    if (exclude !== 'park' && filters.park && building.park !== filters.park) return false
    if (exclude !== 'cluster' && filters.cluster && building.cluster !== filters.cluster) {
      return false
    }
    if (exclude !== 'manager' && filters.manager && !matchesManagerFilter(building, filters.manager, managerRenames)) {
      return false
    }
    if (
      exclude !== 'buildingOperator' &&
      filters.buildingOperator &&
      (building.buildingOperator ?? '') !== filters.buildingOperator
    ) {
      return false
    }
    return true
  })
}

/** Unique sorted values for filter dropdown population (cascades with active filters). */
export function collectFilterOptions(
  buildings: Building[],
  filters: Pick<FilterState, 'search' | 'park' | 'cluster' | 'manager' | 'buildingOperator'> = {
    search: '',
    park: '',
    cluster: '',
    manager: '',
    buildingOperator: '',
  },
  polygonIndex?: PolygonBuildingIndex,
  managerRenames?: Record<string, string>,
  capexStatuses?: Record<string, string>,
): {
  parks: string[]
  clusters: string[]
  managers: string[]
  buildingOperators: string[]
} {
  const parks = [
    ...new Set(
      buildingsForFilterOptions(
        buildings,
        filters,
        'park',
        polygonIndex,
        managerRenames,
        capexStatuses,
      ).map((b) => b.park),
    ),
  ].sort()
  const clusters = [
    ...new Set(
      buildingsForFilterOptions(
        buildings,
        filters,
        'cluster',
        polygonIndex,
        managerRenames,
        capexStatuses,
      )
        .map((b) => b.cluster)
        .filter(Boolean),
    ),
  ].sort()
  const managers = [
    ...new Set(
      buildingsForFilterOptions(
        buildings,
        filters,
        'manager',
        polygonIndex,
        managerRenames,
        capexStatuses,
      )
        .map((b) => b.manager)
        .filter(Boolean),
    ),
  ].sort()
  // Operators listed from the current portfolio (unique building_operator values).
  const buildingOperators = collectBuildingOperatorFilterOptions(buildings)

  return { parks, clusters, managers, buildingOperators }
}

/** True when search only matches RTU/tenant detail fields (not building metadata). */
export function isDetailOnlySearch(
  filtered: Building[],
  search: string,
): boolean {
  const q = normalizeSearch(search)
  if (!q) return false

  return !filtered.some(
    (b) =>
      buildingAddressMatchesSearch(b.address, q) ||
      buildingBuMatchesSearch(b.bu, q) ||
      Boolean(b.cluster?.toLowerCase().includes(q)) ||
      Boolean(b.manager?.toLowerCase().includes(q)),
  )
}
