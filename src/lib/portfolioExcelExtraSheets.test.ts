import { describe, expect, it } from 'vitest'
import { build360GatewayExportRows } from '@/lib/portfolioExcelExtraSheets'
import type { PortfolioData } from '@/types/domain'

const samplePortfolio = (): PortfolioData => ({
  buildings: [
    {
      id: 10,
      park: 'Park A',
      address: '100 Leek Crescent',
      bu: '1',
      lat: 43.6,
      lng: -79.6,
      sqft: '1000',
      cluster: 'Cluster A',
      manager: 'Manager 1',
    },
    {
      id: 11,
      park: 'Park A',
      address: '200 Leek Crescent',
      bu: '2',
      lat: 43.61,
      lng: -79.61,
      sqft: '2000',
      cluster: 'Cluster A',
      manager: 'Manager 2',
    },
  ],
  utilities: [
    {
      id: 5,
      utility_type: 'Electrical Rooms',
      name: 'ER-1',
      description: 'Main electrical',
      lat: 43.6001,
      lng: -79.6001,
      inspection_url: 'https://example.com/er1',
    },
    {
      id: 6,
      utility_type: 'Fire Hydrants',
      name: 'FH-1',
      description: 'Not a gateway',
      lat: 43.6,
      lng: -79.6,
    },
    {
      id: 7,
      utility_type: 'Sprinkler Rooms',
      name: 'SR-1',
      description: 'Sprinkler closet',
      lat: 43.6101,
      lng: -79.6101,
      inspection_url: '',
    },
  ],
  polygons: [],
  suiteEntrances: [
    {
      id: 1,
      building_id: 10,
      polygon_id: 99,
      name: 'Suite A',
      description: 'Front door',
      lat: 43.6002,
      lng: -79.6002,
      inspection_url: 'https://example.com/suite-a',
      auto_placed: true,
    },
  ],
})

describe('build360GatewayExportRows', () => {
  it('exports suite, electrical, and sprinkler gates and skips other utilities', () => {
    const rows = build360GatewayExportRows(samplePortfolio())
    expect(rows).toHaveLength(3)
    expect(rows.map((row) => row[0])).toEqual(['Electrical', 'Sprinkler', 'Suite'])
    expect(rows[0]).toEqual([
      'Electrical',
      '100 Leek Crescent',
      'ER-1',
      'Main electrical',
      43.6001,
      -79.6001,
      'https://example.com/er1',
      '',
      '',
      5,
    ])
    expect(rows[2]).toMatchObject([
      'Suite',
      '100 Leek Crescent',
      'Suite A',
      'Front door',
      43.6002,
      -79.6002,
      'https://example.com/suite-a',
      'Yes',
      99,
      1,
    ])
  })
})
