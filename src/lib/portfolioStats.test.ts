import { describe, expect, it } from 'vitest'
import { countPortfolioStats } from '@/lib/portfolioStats'
import type { PortfolioData } from '@/types/domain'

const samplePortfolio: PortfolioData = {
  buildings: [
    {
      park: 'Test',
      address: '1 Test St',
      bu: '',
      lat: 0,
      lng: 0,
      sqft: '',
      cluster: '',
      manager: '',
      rtus: [{ name: 'RTU-01', description: '', lat: 0, lng: 0 }],
    },
  ],
  utilities: [],
  suiteEntrances: [],
  polygons: [],
}

describe('portfolioStats', () => {
  it('counts buildings, rtus, utilities, and polygons', () => {
    expect(countPortfolioStats(samplePortfolio)).toEqual({
      buildingCount: 1,
      rtuCount: 1,
      utilityCount: 0,
      polygonCount: 0,
    })
  })
})
