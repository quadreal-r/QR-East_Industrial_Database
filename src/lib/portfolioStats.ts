import type { PortfolioData } from '@/types/domain'

export interface PortfolioCounts {
  buildingCount: number
  rtuCount: number
  utilityCount: number
  polygonCount: number
}

export function countPortfolioStats(portfolio: PortfolioData): PortfolioCounts {
  let rtuCount = 0
  for (const building of portfolio.buildings) {
    rtuCount += building.rtus?.length ?? 0
  }
  return {
    buildingCount: portfolio.buildings.length,
    rtuCount,
    utilityCount: portfolio.utilities.length,
    polygonCount: portfolio.polygons.length,
  }
}
