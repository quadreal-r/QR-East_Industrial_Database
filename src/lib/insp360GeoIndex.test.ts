import { describe, expect, it } from 'vitest'
import { buildInsp360GeoIndex } from '@/lib/insp360GeoIndex'
import type { PortfolioData } from '@/types/domain'

const portfolio: PortfolioData = {
  buildings: [
    {
      id: 1,
      park: 'East Business Park (x 22)',
      address: '145 Carrier Drive',
      bu: 'BU1',
      lat: 43.74,
      lng: -79.61,
      sqft: '55,264',
      cluster: 'A',
      manager: 'Manager',
      rtus: [
        {
          name: 'RTU-01',
          description: 'Roof',
          lat: 43.74005,
          lng: -79.61005,
          model: 'AAON',
        },
      ],
    },
  ],
  utilities: [
    {
      id: 2,
      utility_type: 'Electrical Rooms',
      name: 'Elec Rm 1',
      description: '145 Carrier Drive',
      lat: 43.7401,
      lng: -79.6101,
    },
    {
      id: 3,
      utility_type: 'Sprinkler Rooms',
      name: 'Sprinkler A',
      description: '',
      lat: 43.7402,
      lng: -79.6102,
    },
    {
      id: 4,
      utility_type: 'Fire Hydrants',
      name: 'FH-1',
      description: '',
      lat: 43.7403,
      lng: -79.6103,
    },
    {
      id: 5,
      utility_type: 'Natural Gas Shut-Off',
      name: 'Gas Main',
      description: '',
      lat: 43.7404,
      lng: -79.6104,
    },
  ],
  polygons: [
    {
      id: 10,
      name: 'Suite # 1',
      description: 'Acme Corp',
      color: '#60a5fa',
      paths: [
        { lat: 43.7405, lng: -79.611 },
        { lat: 43.741, lng: -79.611 },
        { lat: 43.741, lng: -79.6105 },
      ],
    },
  ],
  suiteEntrances: [],
}

describe('buildInsp360GeoIndex', () => {
  it('maps buildings, tenant polygons, utilities, and RTUs from the live portfolio', () => {
    const geo = buildInsp360GeoIndex(portfolio)

    expect(geo.buildings).toHaveLength(1)
    expect(geo.buildings[0]).toMatchObject({
      a: '145 Carrier Drive',
      p: 'East Business Park (x 22)',
      sf: 55264,
      rtuCount: 1,
    })

    expect(geo.polys).toHaveLength(1)
    expect(geo.polys[0]).toMatchObject({
      a: '145 Carrier Drive',
      s: 'Suite # 1',
      t: 'Acme Corp',
    })
    expect(geo.polys[0]!.path).toHaveLength(3)

    expect(geo.rooms).toHaveLength(4)
    expect(geo.rooms.map((room) => room.type).sort()).toEqual([
      'electrical',
      'gas',
      'hydrant',
      'sprinkler',
    ])
    expect(geo.rooms.every((room) => room.a === '145 Carrier Drive')).toBe(true)

    expect(geo.rtus).toHaveLength(1)
    expect(geo.rtuTotal).toBe(1)
    expect(geo.rtus[0]).toMatchObject({
      a: '145 Carrier Drive',
      name: 'RTU-01',
      model: 'AAON',
    })
  })
})
