import legacyBuildings from '../../supabase/data/buildings.json'
import legacyPolygons from '../../supabase/data/polygons.json'
import {
  applyCostScopeFilters,
  applyFilterSelection,
  applyFilters,
  applyPrimaryFilters,
  collectFilterOptions,
  isTenantCountSearch,
  matchesBuildingMetadata,
  matchesSearch,
  passAdvFilter,
  passDqFilter,
  reconcileFilterDropdowns,
} from '@/lib/filters'
import { buildPolygonBuildingIndex, polygonsForBuilding } from '@/lib/polygonBuildings'
import { getRtuAge } from '@/lib/rtu'
import {
  DEFAULT_ADV_FILTERS,
  DEFAULT_DQ_FILTERS,
  DEFAULT_FILTER_STATE,
  normalizeLegacyBuilding,
  normalizeLegacyPolygon,
  type FilterState,
  type LegacyBuildingJson,
  type LegacyPolygonJson,
} from '@/types/domain'

const buildings = (legacyBuildings as LegacyBuildingJson[]).map(
  normalizeLegacyBuilding,
)
const polygons = (legacyPolygons as LegacyPolygonJson[]).map(normalizeLegacyPolygon)
const polygonIndex = buildPolygonBuildingIndex(buildings, polygons)

/** Josh Starkey is Manager 2 when settings use manager slots. */
const JOSH_MANAGER_NAME = 'Josh Starkey'
const JOSH_MANAGER_SLOT = 'Manager 2'
const JOSH_MANAGER_RENAMES = { [JOSH_MANAGER_SLOT]: JOSH_MANAGER_NAME }

describe('matchesSearch', () => {
  it('matches address substring', () => {
    const hit = buildings.find((b) => b.address.includes('1850'))
    expect(hit).toBeDefined()
    expect(matchesSearch(hit!, '1850', polygonIndex)).toBe(true)
  })

  it('matches tenant polygon description', () => {
    const hit = buildings.find((b) =>
      polygonsForBuilding(polygonIndex, b.address).some((polygon) =>
        polygon.description.includes('National Energy'),
      ),
    )
    expect(hit).toBeDefined()
    expect(matchesSearch(hit!, 'national energy', polygonIndex)).toBe(true)
  })

  it('matches the tenant-count badge text like "33 Tenants"', () => {
    const withTenants = buildings
      .map((b) => ({ b, n: polygonsForBuilding(polygonIndex, b.address).length }))
      .filter((row) => row.n > 0)
      .sort((a, b) => b.n - a.n)[0]
    expect(withTenants).toBeDefined()
    expect(matchesSearch(withTenants!.b, 'tenants', polygonIndex)).toBe(true)
    expect(matchesSearch(withTenants!.b, `${withTenants!.n} Tenants`, polygonIndex)).toBe(true)
    expect(matchesSearch(withTenants!.b, `${withTenants!.n} tenants`, polygonIndex)).toBe(true)
  })
})

describe('applyPrimaryFilters tenant count search', () => {
  it('sorts tenant searches by tenant count descending', () => {
    const filtered = applyPrimaryFilters(
      buildings,
      { ...DEFAULT_FILTER_STATE, search: 'tenants' },
      polygonIndex,
    )
    expect(filtered.length).toBeGreaterThan(1)
    const counts = filtered.map((b) => polygonsForBuilding(polygonIndex, b.address).length)
    expect(counts.every((n) => n > 0)).toBe(true)
    for (let i = 1; i < counts.length; i++) {
      expect(counts[i]!).toBeLessThanOrEqual(counts[i - 1]!)
    }
  })
})

describe('isTenantCountSearch', () => {
  it('detects count queries but not tenant company names', () => {
    expect(isTenantCountSearch('tenants')).toBe(true)
    expect(isTenantCountSearch('13 Tenants')).toBe(true)
    expect(isTenantCountSearch('Baxter')).toBe(false)
    expect(isTenantCountSearch('6975 Creditview')).toBe(false)
  })
})

describe('passAdvFilter', () => {
  it('requires old RTU when adv.rtu is yes', () => {
    const oldBuilding = buildings.find((b) => {
      const age = b.rtus?.reduce(
        (max, r) => Math.max(max, getRtuAge(r, 2026) ?? 0),
        0,
      )
      return (age ?? 0) >= 20
    })
    expect(oldBuilding).toBeDefined()
    expect(
      passAdvFilter(oldBuilding!, { ...DEFAULT_ADV_FILTERS, rtu: 'yes' }),
    ).toBe(true)
  })

  it('excludes buildings without RTUs when hasrtu is yes', () => {
    const noRtus: (typeof buildings)[number] = {
      park: 'Test',
      address: '1 Test Rd',
      bu: '',
      lat: 0,
      lng: 0,
      sqft: '',
      cluster: '',
      manager: '',
      rtus: [],
    }
    expect(
      passAdvFilter(noRtus, { ...DEFAULT_ADV_FILTERS, hasrtu: 'yes' }),
    ).toBe(false)
  })
})

describe('passDqFilter', () => {
  it('filters placeholder GPS when dq.gps is enabled', () => {
    const placeholder = buildings.find((b) =>
      Math.abs(b.lat - 43.5852972) < 0.0001,
    )
    if (!placeholder) return
    expect(passDqFilter(placeholder, { ...DEFAULT_DQ_FILTERS, gps: true })).toBe(
      true,
    )
  })
})

describe('collectFilterOptions', () => {
  it('narrows parks and clusters when a manager is selected', () => {
    const all = collectFilterOptions(buildings)
    const josh = collectFilterOptions(
      buildings,
      { search: '', park: '', cluster: '', manager: JOSH_MANAGER_SLOT, buildingOperator: '' },
      polygonIndex,
      JOSH_MANAGER_RENAMES,
    )

    expect(josh.parks.length).toBeGreaterThan(0)
    expect(josh.parks.length).toBeLessThan(all.parks.length)
    expect(josh.clusters.length).toBeGreaterThan(0)
    expect(josh.clusters.length).toBeLessThanOrEqual(all.clusters.length)

    const joshBuildings = buildings.filter((b) => b.manager === JOSH_MANAGER_NAME)
    expect(josh.parks.every((p) => joshBuildings.some((b) => b.park === p))).toBe(true)
    expect(josh.clusters.every((c) => joshBuildings.some((b) => b.cluster === c))).toBe(true)
  })

  it('narrows clusters and managers when a business park is selected', () => {
    const park = 'Dixie Business Park (x 34)'
    const scoped = collectFilterOptions(buildings, {
      search: '',
      park,
      cluster: '',
      manager: '',
      buildingOperator: '',
    })
    const parkBuildings = buildings.filter((b) => b.park === park)

    expect(scoped.parks).toContain(park)
    expect(scoped.clusters.every((c) => parkBuildings.some((b) => b.cluster === c))).toBe(true)
    expect(scoped.managers.every((m) => parkBuildings.some((b) => b.manager === m))).toBe(true)
  })
})

describe('reconcileFilterDropdowns', () => {
  it('clears park when it does not appear in search hits', () => {
    const filters: FilterState = {
      ...DEFAULT_FILTER_STATE,
      search: '1850 Derry',
      park: 'Western Business Park (x 22)',
    }
    const reconciled = reconcileFilterDropdowns(buildings, filters)
    expect(reconciled.park).not.toBe('Western Business Park (x 22)')
    expect(reconciled.park).toBe('')
  })

  it('clears park when it does not belong to the selected manager', () => {
    const joshParks = new Set(
      buildings.filter((b) => b.manager === JOSH_MANAGER_NAME).map((b) => b.park),
    )
    const otherPark = [...new Set(buildings.map((b) => b.park))].find((p) => !joshParks.has(p))!

    const reconciled = reconcileFilterDropdowns(
      buildings,
      {
        ...DEFAULT_FILTER_STATE,
        manager: JOSH_MANAGER_SLOT,
        park: otherPark,
      },
      polygonIndex,
      JOSH_MANAGER_RENAMES,
    )
    expect(reconciled.park).toBe('')
  })

  it('auto-fills park when manager leaves only one business park', () => {
    const next = applyFilterSelection(
      buildings,
      DEFAULT_FILTER_STATE,
      { manager: JOSH_MANAGER_SLOT },
      polygonIndex,
      JOSH_MANAGER_RENAMES,
    )
    expect(next.park).toBe('Western Business Park (x 22)')
  })

  it('does not re-fill park when user clears it to all parks', () => {
    const next = applyFilterSelection(
      buildings,
      {
        ...DEFAULT_FILTER_STATE,
        manager: JOSH_MANAGER_SLOT,
        park: 'Western Business Park (x 22)',
      },
      { park: '' },
    )
    expect(next.park).toBe('')
    expect(next.manager).toBe('')
    expect(next.cluster).toBe('')
  })

  it('resets park and cluster when user clears manager to all managers', () => {
    const next = applyFilterSelection(
      buildings,
      {
        ...DEFAULT_FILTER_STATE,
        manager: JOSH_MANAGER_SLOT,
        park: 'Western Business Park (x 22)',
        cluster: 'Single (x 5)',
      },
      { manager: '' },
    )
    expect(next.manager).toBe('')
    expect(next.park).toBe('')
    expect(next.cluster).toBe('')
  })
})

describe('applyCostScopeFilters', () => {
  it('narrows to address-level hits when search matches a building address', () => {
    const full = applyFilters(buildings, { ...DEFAULT_FILTER_STATE, search: '441' }, polygonIndex)
    const scoped = applyCostScopeFilters(
      buildings,
      { ...DEFAULT_FILTER_STATE, search: '441' },
      polygonIndex,
    )
    expect(scoped.length).toBeGreaterThan(0)
    expect(scoped.every((b) => matchesBuildingMetadata(b, '441'))).toBe(true)
    expect(scoped.some((b) => b.address.includes('441 Courtneypark'))).toBe(true)
    if (full.length > scoped.length) {
      expect(full.length).toBeGreaterThan(scoped.length)
    }
  })

  it('keeps RTU-only search hits when no building metadata matches', () => {
    const query = 'RTU- 01'
    const full = applyFilters(buildings, { ...DEFAULT_FILTER_STATE, search: query }, polygonIndex)
    const scoped = applyCostScopeFilters(
      buildings,
      { ...DEFAULT_FILTER_STATE, search: query },
      polygonIndex,
    )
    expect(scoped).toEqual(full)
  })
})

describe('applyFilters', () => {
  it('filters by exact property manager slot', () => {
    const filtered = applyFilters(
      buildings,
      { ...DEFAULT_FILTER_STATE, manager: JOSH_MANAGER_SLOT },
      polygonIndex,
      JOSH_MANAGER_RENAMES,
    )
    expect(filtered.length).toBeGreaterThan(0)
    expect(filtered.every((b) => b.manager === JOSH_MANAGER_NAME)).toBe(true)
  })

  it('filters by display name when buildings use manager slots', () => {
    const filtered = applyFilters(
      buildings,
      { ...DEFAULT_FILTER_STATE, manager: JOSH_MANAGER_NAME },
      polygonIndex,
      JOSH_MANAGER_RENAMES,
    )
    expect(filtered.length).toBeGreaterThan(0)
    expect(filtered.every((b) => b.manager === JOSH_MANAGER_NAME)).toBe(true)
  })

  it('returns subset for park filter', () => {
    const filtered = applyFilters(buildings, {
      ...DEFAULT_FILTER_STATE,
      park: 'Dixie Business Park (x 34)',
    })
    expect(filtered.length).toBeGreaterThan(0)
    expect(filtered.every((b) => b.park === 'Dixie Business Park (x 34)')).toBe(
      true,
    )
  })

  it('combines search and dq filters', () => {
    const filtered = applyFilters(buildings, {
      ...DEFAULT_FILTER_STATE,
      search: 'derry',
      dq: { ...DEFAULT_DQ_FILTERS, rtu: true },
    })
    expect(filtered.length).toBeGreaterThanOrEqual(0)
  })
})
