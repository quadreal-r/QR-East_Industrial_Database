import { describe, expect, it } from 'vitest'
import {
  applyDeltaToSnapshot,
  applySnapshotToPortfolio,
  buildingDragKey,
  buildGroupDragSnapshot,
  detailDragKey,
  polygonDragKey,
  utilityDragKey,
} from '@/lib/dragSelection'
import type { PortfolioData } from '@/types/domain'

const portfolio: PortfolioData = {
  buildings: [
    {
      park: 'P',
      address: '100 Main',
      bu: '1',
      lat: 43.65,
      lng: -79.62,
      sqft: '1',
      cluster: 'C',
      manager: 'M',
      rtus: [{ name: 'RTU-1', description: '', lat: 43.651, lng: -79.621 }],
    },
  ],
  utilities: [
    {
      id: 1,
      utility_type: 'Fire Hydrants',
      name: 'H1',
      description: 'Hydrant A',
      lat: 43.652,
      lng: -79.622,
    },
    {
      id: 2,
      utility_type: 'Sprinkler Rooms',
      name: 'Sprinkler Room',
      description: '6200 Kenway Dr.',
      lat: 43.1,
      lng: -79.1,
    },
    {
      id: 3,
      utility_type: 'Sprinkler Rooms',
      name: 'Sprinkler Room',
      description: '2300 Bristol Cir',
      lat: 43.2,
      lng: -79.2,
    },
  ],
  suiteEntrances: [
    {
      id: 10,
      building_id: 1,
      polygon_id: 1,
      name: 'Suite 7',
      description: 'Tenant A',
      lat: 43.6505,
      lng: -79.6205,
      inspection_url: null,
    },
  ],
  polygons: [
    {
      name: 'Tenant A',
      description: 'Suite 1',
      color: '#00f',
      paths: [
        { lat: 43.653, lng: -79.623 },
        { lat: 43.654, lng: -79.623 },
        { lat: 43.654, lng: -79.622 },
      ],
    },
  ],
}

describe('dragSelection group drag', () => {
  it('builds and applies a multi-item snapshot', () => {
    const keys = [
      buildingDragKey('100 Main'),
      detailDragKey('rtu', 'RTU-1', '100 Main'),
      utilityDragKey(portfolio.utilities[0]!),
      polygonDragKey('Tenant A', 'Suite 1'),
    ]
    const snapshot = buildGroupDragSnapshot(portfolio, keys)
    const moved = applyDeltaToSnapshot(snapshot, 0.001, -0.002)
    const next = applySnapshotToPortfolio(portfolio, moved)

    expect(next.buildings[0]!.lat).toBeCloseTo(43.651)
    expect(next.buildings[0]!.rtus![0]!.lat).toBeCloseTo(43.652)
    expect(next.utilities[0]!.lng).toBeCloseTo(-79.624)
    expect(next.polygons[0]!.paths[0]!.lat).toBeCloseTo(43.654)
  })

  it('moves only the selected utility when names are duplicated', () => {
    const selected = portfolio.utilities[1]!
    const keys = [utilityDragKey(selected)]
    const snapshot = buildGroupDragSnapshot(portfolio, keys)
    const moved = applyDeltaToSnapshot(snapshot, 0.01, 0.02)
    const next = applySnapshotToPortfolio(portfolio, moved)

    expect(next.utilities[1]!.lat).toBeCloseTo(43.11)
    expect(next.utilities[1]!.lng).toBeCloseTo(-79.08)
    expect(next.utilities[2]!.lat).toBe(43.2)
    expect(next.utilities[2]!.lng).toBe(-79.2)
  })

  it('moves a selected 360° gate with the group snapshot', () => {
    const portfolioWithBuildingId = {
      ...portfolio,
      buildings: [{ ...portfolio.buildings[0]!, id: 1 }],
    }
    const keys = [detailDragKey('inspection360', 'Suite 7', '100 Main')]
    const snapshot = buildGroupDragSnapshot(portfolioWithBuildingId, keys)
    const moved = applyDeltaToSnapshot(snapshot, 0.002, -0.001)
    const next = applySnapshotToPortfolio(portfolioWithBuildingId, moved)

    expect(next.suiteEntrances[0]!.lat).toBeCloseTo(43.6525)
    expect(next.suiteEntrances[0]!.lng).toBeCloseTo(-79.6215)
  })
})
