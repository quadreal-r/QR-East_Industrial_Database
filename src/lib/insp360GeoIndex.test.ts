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
  it('maps buildings, tenant polygons, and utility rooms for the QR-360 viewer', () => {
    const geo = buildInsp360GeoIndex(portfolio)

    expect(geo.buildings).toHaveLength(1)
    expect(geo.buildings[0]).toMatchObject({
      a: '145 Carrier Drive',
      p: 'East Business Park (x 22)',
      sf: 55264,
    })

    expect(geo.polys).toHaveLength(1)
    expect(geo.polys[0]).toMatchObject({
      a: '145 Carrier Drive',
      s: 'Suite # 1',
      t: 'Acme Corp',
    })
    expect(geo.polys[0]!.path).toHaveLength(3)

    expect(geo.rooms).toHaveLength(2)
    expect(geo.rooms.map((room) => room.type).sort()).toEqual(['electrical', 'sprinkler'])
    expect(geo.rooms.every((room) => room.a === '145 Carrier Drive')).toBe(true)
  })
})
