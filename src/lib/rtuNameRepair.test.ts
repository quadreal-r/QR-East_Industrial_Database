import { describe, expect, it } from 'vitest'
import { canonicalRtuMapName, repairPortfolioRtuNames } from '@/lib/rtuNameRepair'
import type { PortfolioData } from '@/types/domain'

const bristol2320: PortfolioData = {
  buildings: [
    {
      park: 'P',
      address: '2320 Bristol Circle',
      bu: '1',
      lat: 43.5,
      lng: -79.6,
      sqft: '1',
      cluster: 'C',
      manager: 'M',
      rtus: [
        {
          name: 'RTU-04 Hybrid/Dual Fuel Heat Pump',
          description:
            'Building: 2320 Bristol Circle\r\nDescription: RTU-04 Hybrid/Dual Fuel Heat Pump\r\nModel: X',
          lat: 1,
          lng: 2,
        },
        {
          name: 'RTU-01 Hybrid',
          description: 'Building: 2320 Bristol Circle\r\nDescription: RTU-01 Hybrid/Dual Fuel Heat Pump',
          lat: 1,
          lng: 2,
        },
      ],
    },
  ],
  utilities: [],
  suiteEntrances: [],
  polygons: [],
}

describe('rtuNameRepair', () => {
  it('shortens RTU names with description suffix after slash', () => {
    expect(canonicalRtuMapName('RTU-04 Hybrid/Dual Fuel Heat Pump')).toBe('RTU-04 Hybrid')
    expect(canonicalRtuMapName('RTU-01 Hybrid')).toBe('RTU-01 Hybrid')
  })

  it('repairs portfolio RTU names to match manifest keys', () => {
    const { portfolio, renames } = repairPortfolioRtuNames(bristol2320)
    expect(portfolio.buildings[0]?.rtus?.[0]?.name).toBe('RTU-04 Hybrid')
    expect(renames).toEqual([
      {
        buildingAddress: '2320 Bristol Circle',
        oldName: 'RTU-04 Hybrid/Dual Fuel Heat Pump',
        newName: 'RTU-04 Hybrid',
      },
    ])
  })
})
