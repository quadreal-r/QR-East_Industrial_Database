import { describe, expect, it } from 'vitest'
import {
  listDormantSheetNames,
  mergePortfolioExcelImport,
} from '@/lib/portfolioExcelMerge'
import type { Building, PortfolioData, Polygon, SuiteEntrance, Utility } from '@/types/domain'

function building(partial: Partial<Building> & Pick<Building, 'address' | 'park'>): Building {
  return {
    id: partial.id,
    park: partial.park,
    address: partial.address,
    bu: partial.bu ?? '',
    lat: partial.lat ?? 43.7,
    lng: partial.lng ?? -79.4,
    sqft: partial.sqft ?? '10,000',
    cluster: partial.cluster ?? '',
    manager: partial.manager ?? '',
    notes: partial.notes ?? null,
    sold: partial.sold ?? false,
    mapLat: partial.mapLat ?? 43.71,
    mapLng: partial.mapLng ?? -79.41,
    mapZoom: partial.mapZoom ?? 18,
    rtus: partial.rtus ?? [],
  }
}

function utility(partial: Partial<Utility> & Pick<Utility, 'name' | 'utility_type'>): Utility {
  return {
    id: partial.id,
    utility_type: partial.utility_type,
    name: partial.name,
    description: partial.description ?? '',
    lat: partial.lat ?? 43.7,
    lng: partial.lng ?? -79.4,
  }
}

function polygon(partial: Partial<Polygon> & Pick<Polygon, 'name' | 'paths'>): Polygon {
  return {
    id: partial.id,
    name: partial.name,
    description: partial.description ?? '',
    color: partial.color ?? '#60a5fa',
    paths: partial.paths,
  }
}

describe('listDormantSheetNames', () => {
  it('treats known archive sheets and unknown sheets as dormant', () => {
    expect(
      listDormantSheetNames([
        'Buildings',
        'RTUs',
        'RTU Pictures',
        'Tenant Polygons',
        'Utilities',
        '360 Gateways',
        'Building Operators',
        'Lease Items',
        'Normalized Building Report',
      ]),
    ).toEqual([
      'RTU Pictures',
      '360 Gateways',
      'Lease Items',
      'Normalized Building Report',
    ])
  })
})

describe('mergePortfolioExcelImport', () => {
  const paths = [
    { lat: 43.86, lng: -79.38 },
    { lat: 43.861, lng: -79.38 },
    { lat: 43.861, lng: -79.381 },
  ]

  const baseline: PortfolioData = {
    buildings: [
      building({
        id: 10,
        address: '100 Leek Crescent',
        park: 'East Business Park (x 22)',
        notes: 'Keep me',
        mapZoom: 19,
        rtus: [
          {
            id: 101,
            building_id: 10,
            name: 'RTU-01',
            description: 'old',
            lat: 43.86,
            lng: -79.38,
          },
          {
            id: 102,
            building_id: 10,
            name: 'RTU-02',
            description: 'remove me',
            lat: 43.861,
            lng: -79.382,
          },
        ],
      }),
    ],
    utilities: [
      utility({
        id: 5,
        utility_type: 'Fire Hydrants',
        name: 'Hydrant A',
        description: 'old',
        lat: 43.63,
        lng: -79.69,
      }),
    ],
    polygons: [
      polygon({
        id: 7,
        name: 'Suite 1',
        description: 'Tenant A',
        paths,
      }),
    ],
    suiteEntrances: [
      {
        id: 50,
        building_id: 10,
        polygon_id: 7,
        name: 'Suite 1',
        description: 'Tenant A',
        lat: 43.8605,
        lng: -79.3805,
        inspection_url: 'https://example.com/tour',
        auto_placed: false,
      } satisfies SuiteEntrance,
    ],
  }

  it('preserves ids, notes, building map views, and 360 gates while updating RTUs', () => {
    const imported: PortfolioData = {
      buildings: [
        building({
          address: '100 Leek Crescent',
          park: 'East Business Park (x 22)',
          sqft: '69,802',
          manager: 'Sylvia Zwierkowski',
          rtus: [
            {
              name: 'RTU- 01',
              description: 'updated',
              lat: 43.8601,
              lng: -79.3801,
            },
          ],
        }),
      ],
      utilities: [
        utility({
          utility_type: 'Fire Hydrants',
          name: 'Hydrant A',
          description: 'updated',
          lat: 43.63,
          lng: -79.69,
        }),
      ],
      polygons: [
        polygon({
          name: 'Suite 1',
          description: 'Vacant',
          paths,
        }),
      ],
      suiteEntrances: [],
    }

    const merged = mergePortfolioExcelImport(baseline, imported)
    const b = merged.buildings[0]!

    expect(b.id).toBe(10)
    expect(b.notes).toBe('Keep me')
    expect(b.mapZoom).toBe(19)
    expect(b.sqft).toBe('69,802')
    expect(b.rtus).toHaveLength(1)
    expect(b.rtus![0]!.id).toBe(101)
    expect(b.rtus![0]!.description).toBe('updated')
    expect(b.rtus![0]!.name).toBe('RTU- 01')

    expect(merged.utilities[0]!.id).toBe(5)
    expect(merged.utilities[0]!.description).toBe('updated')

    expect(merged.polygons[0]!.id).toBe(7)
    expect(merged.polygons[0]!.description).toBe('Vacant')

    expect(merged.suiteEntrances).toHaveLength(1)
    expect(merged.suiteEntrances[0]!.id).toBe(50)
    expect(merged.suiteEntrances[0]!.inspection_url).toBe('https://example.com/tour')
  })

  it('drops suite entrances whose polygon disappeared', () => {
    const imported: PortfolioData = {
      buildings: baseline.buildings.map((b) => ({ ...b, id: undefined, rtus: [] })),
      utilities: [],
      polygons: [],
      suiteEntrances: [],
    }

    const merged = mergePortfolioExcelImport(baseline, imported)
    expect(merged.suiteEntrances).toEqual([])
  })
})
