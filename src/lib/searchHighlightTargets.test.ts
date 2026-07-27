import { describe, expect, it } from 'vitest'
import legacyBuildings from '../../supabase/data/buildings.json'
import legacyPolygons from '../../supabase/data/polygons.json'
import {
  collectClusterHighlightTargets,
  collectFilterFitPoints,
  collectSearchHighlightTargets,
  collectSuiteHighlightTargets,
  metersForScreenRadius,
  metersPerScreenPixel,
} from '@/lib/searchHighlightTargets'
import {
  normalizeLegacyBuilding,
  normalizeLegacyPolygon,
  type Building,
  type LegacyBuildingJson,
  type LegacyPolygonJson,
} from '@/types/domain'

function building(partial: Partial<Building> & Pick<Building, 'address'>): Building {
  return {
    park: 'Dixie Business Park (x 34)',
    bu: '1',
    lat: 43.66,
    lng: -79.65,
    sqft: '1000',
    cluster: 'Dixie 2 (x 13)',
    manager: 'Manager 1',
    ...partial,
  }
}

const buildings = [
  building({
    address: '1495 Bonhill Road',
    bu: '65186',
    lat: 43.661,
    lng: -79.654,
    cluster: 'Dixie 2 (x 13)',
    buildingOperator: 'Christopher Peles',
  }),
  building({
    address: '1535 Meyerside Drive',
    bu: '65187',
    lat: 43.662,
    lng: -79.655,
    cluster: 'Dixie 1 (x 8)',
    buildingOperator: 'Christopher Peles',
  }),
  building({
    address: '2300 Bristol Circle',
    park: 'Western Business Park (x 22)',
    cluster: 'Bristol (x 4)',
    bu: '51201',
    lat: 43.58,
    lng: -79.72,
    buildingOperator: 'Ramesh Ramnarine',
  }),
]

describe('metersForScreenRadius', () => {
  it('grows meter radius when zooming out so on-screen size stays similar', () => {
    const lat = 43.66
    const radiusPx = 48
    const close = metersForScreenRadius(lat, 18, radiusPx)
    const far = metersForScreenRadius(lat, 12, radiusPx)
    expect(far).toBeGreaterThan(close * 30)
    expect(metersPerScreenPixel(lat, 12)).toBeGreaterThan(metersPerScreenPixel(lat, 18))
  })
})

describe('collectClusterHighlightTargets', () => {
  it('circles each distinct cluster in the filtered set', () => {
    const dixie = buildings.filter((b) => b.park.startsWith('Dixie'))
    const targets = collectClusterHighlightTargets(dixie)
    expect(targets.every((t) => t.kind === 'cluster')).toBe(true)
    expect(targets.map((t) => t.label)).toEqual(['Dixie 1 (x 8)', 'Dixie 2 (x 13)'])
  })

  it('returns one circle when a single cluster is selected', () => {
    const scoped = buildings.filter((b) => b.cluster === 'Bristol (x 4)')
    expect(collectClusterHighlightTargets(scoped)).toEqual([
      expect.objectContaining({ kind: 'cluster', label: 'Bristol (x 4)' }),
    ])
  })
})

describe('collectFilterFitPoints', () => {
  it('returns lat/lng for each building with valid coordinates', () => {
    const scoped = buildings.filter((b) => b.cluster === 'Dixie 2 (x 13)')
    expect(collectFilterFitPoints(scoped)).toEqual([{ lat: 43.661, lng: -79.654 }])
  })

  it('skips buildings with invalid coordinates', () => {
    const mixed = [
      buildings[0]!,
      building({ address: 'No Coord', lat: Number.NaN, lng: -79.65 }),
      building({ address: 'Also Bad', lat: 43.66, lng: Number.NaN }),
    ]
    expect(collectFilterFitPoints(mixed)).toEqual([{ lat: 43.661, lng: -79.654 }])
  })

  it('includes every building when fitting the All Buildings overview fallback', () => {
    expect(collectFilterFitPoints(buildings)).toEqual([
      { lat: 43.661, lng: -79.654 },
      { lat: 43.662, lng: -79.655 },
      { lat: 43.58, lng: -79.72 },
    ])
  })
})

describe('collectSearchHighlightTargets', () => {
  it('returns nothing for blank search', () => {
    expect(collectSearchHighlightTargets(buildings, '  ')).toEqual([])
  })

  it('circles matching buildings by address', () => {
    const targets = collectSearchHighlightTargets(buildings, 'Bonhill')
    expect(targets).toHaveLength(1)
    expect(targets[0]).toMatchObject({
      kind: 'building',
      label: '1495 Bonhill Road',
    })
  })

  it('address search circles only the building pin, not RTUs on that property', () => {
    const withRtus: Building[] = [
      building({
        address: '1495 Bonhill Road',
        rtus: [
          {
            name: 'RTU-1',
            description: '1495 Bonhill Road roof',
            lat: 43.6611,
            lng: -79.6541,
            serial: '1495-BONHILL-01',
            model: 'Lennox LDT060',
          },
        ],
      }),
    ]
    const targets = collectSearchHighlightTargets(withRtus, '1495 Bonhill')
    expect(targets).toEqual([
      expect.objectContaining({
        kind: 'building',
        label: '1495 Bonhill Road',
      }),
    ])
    expect(targets.every((t) => t.kind === 'building')).toBe(true)
  })

  it('circles each cluster inside a matching park (not one park ring)', () => {
    const targets = collectSearchHighlightTargets(buildings, 'Dixie Business')
    expect(targets.every((t) => t.kind === 'cluster')).toBe(true)
    expect(targets.map((t) => t.label).sort()).toEqual(['Dixie 1 (x 8)', 'Dixie 2 (x 13)'])
  })

  it('circles a matching cluster', () => {
    const targets = collectSearchHighlightTargets(buildings, 'Bristol')
    expect(targets).toHaveLength(1)
    expect(targets[0]).toMatchObject({
      kind: 'cluster',
      label: 'Bristol (x 4)',
    })
  })

  it('circles buildings by operator name', () => {
    const targets = collectSearchHighlightTargets(buildings, 'Peles')
    expect(targets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'building', label: '1495 Bonhill Road' }),
        expect.objectContaining({ kind: 'building', label: '1535 Meyerside Drive' }),
      ]),
    )
  })

  it('circles matching RTUs by serial number', () => {
    const withSerial: Building[] = [
      building({
        address: '1495 Bonhill Road',
        rtus: [
          {
            name: 'RTU-1',
            description: '',
            lat: 43.6611,
            lng: -79.6541,
            serial: 'SN-5510-ABC',
            model: 'Lennox LDT060H5-PKG',
            make: 'Lennox',
          },
          {
            name: 'RTU-2',
            description: '',
            lat: 43.6612,
            lng: -79.6542,
            serial: 'OTHER-99',
          },
        ],
      }),
    ]
    const targets = collectSearchHighlightTargets(withSerial, '5510-abc')
    expect(targets).toEqual([
      expect.objectContaining({
        kind: 'rtu',
        label: '1495 Bonhill Road · RTU-1',
        lat: 43.6611,
        lng: -79.6541,
      }),
    ])
  })

  it('circles matching RTUs by model / make', () => {
    const withModel: Building[] = [
      building({
        address: '1495 Bonhill Road',
        rtus: [
          {
            name: 'RTU-3',
            description: '',
            lat: 43.6613,
            lng: -79.6543,
            model: 'Lennox LDT060H5-PKG',
            make: 'Lennox',
          },
        ],
      }),
    ]
    const byModel = collectSearchHighlightTargets(withModel, 'LDT060')
    expect(byModel).toHaveLength(1)
    expect(byModel[0]).toMatchObject({ kind: 'rtu', label: '1495 Bonhill Road · RTU-3' })

    const byMake = collectSearchHighlightTargets(withModel, 'lennox')
    expect(byMake).toHaveLength(1)
    expect(byMake[0]!.kind).toBe('rtu')
  })

  it('circles the suite gateway for a tenant name like Baxter', () => {
    const portfolioBuildings = (legacyBuildings as LegacyBuildingJson[]).map(
      normalizeLegacyBuilding,
    )
    const portfolioPolygons = (legacyPolygons as LegacyPolygonJson[]).map(
      normalizeLegacyPolygon,
    )
    const targets = collectSearchHighlightTargets(portfolioBuildings, 'Baxter', {
      polygons: portfolioPolygons,
      suiteEntrances: [],
    })
    expect(targets.length).toBeGreaterThan(0)
    expect(targets.every((t) => t.kind === 'suite')).toBe(true)
    expect(targets.some((t) => /#\s*3/i.test(t.label) && /Baxter/i.test(t.label))).toBe(
      true,
    )
  })
})

describe('collectSuiteHighlightTargets', () => {
  it('places the circle on the suite entrance coordinates', () => {
    const portfolioBuildings = (legacyBuildings as LegacyBuildingJson[]).map(
      normalizeLegacyBuilding,
    )
    const portfolioPolygons = (legacyPolygons as LegacyPolygonJson[]).map(
      normalizeLegacyPolygon,
    )
    const targets = collectSuiteHighlightTargets(
      portfolioBuildings,
      portfolioPolygons,
      [],
      'Baxter',
    )
    expect(targets.length).toBeGreaterThan(0)
    expect(Number.isFinite(targets[0]!.lat)).toBe(true)
    expect(Number.isFinite(targets[0]!.lng)).toBe(true)
  })
})
