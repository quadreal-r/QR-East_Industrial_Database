import { describe, expect, it } from 'vitest'
import { applyRtuTextChangeInPortfolio } from '@/lib/rtuPortfolioEdit'
import type { Building, PortfolioData, Rtu } from '@/types/domain'

function testBuilding(
  address: string,
  lat: number,
  lng: number,
  rtus: Rtu[] = [],
): Building {
  return {
    park: 'P',
    address,
    bu: '1',
    lat,
    lng,
    sqft: '1',
    cluster: 'C',
    manager: 'M',
    rtus,
  }
}

const portfolio: PortfolioData = {
  buildings: [
    testBuilding('100 Main', 43.6, -79.4, [
      { name: 'RTU-01', description: 'Model: ABC', lat: 43.601, lng: -79.401 },
      { name: 'RTU-02', description: '', lat: 43.602, lng: -79.402 },
    ]),
  ],
  utilities: [],
  suiteEntrances: [],
  polygons: [],
}

describe('applyRtuTextChangeInPortfolio', () => {
  it('updates description without rename', () => {
    const { portfolio: next, rename } = applyRtuTextChangeInPortfolio(
      portfolio,
      '100 Main',
      'RTU-01',
      { name: 'RTU-01', description: 'Model: XYZ' },
    )
    expect(rename).toBeUndefined()
    expect(next.buildings[0]?.rtus?.[0]?.description).toBe('Model: XYZ')
  })

  it('renames RTU and returns rename metadata', () => {
    const { portfolio: next, rename } = applyRtuTextChangeInPortfolio(
      portfolio,
      '100 Main',
      'RTU-01',
      { name: 'RTU-01A', description: 'Model: ABC' },
    )
    expect(rename).toEqual({
      buildingAddress: '100 Main',
      oldName: 'RTU-01',
      newName: 'RTU-01A',
    })
    expect(next.buildings[0]?.rtus?.[0]?.name).toBe('RTU-01A')
  })

  it('rejects duplicate names on the same building', () => {
    expect(() =>
      applyRtuTextChangeInPortfolio(portfolio, '100 Main', 'RTU-01', {
        name: 'RTU-02',
        description: '',
      }),
    ).toThrow(/already exists/)
  })
})
