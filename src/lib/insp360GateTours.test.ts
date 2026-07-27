import { describe, expect, it } from 'vitest'
import {
  clearGateTourLinkInPortfolio,
  getGateInspectionUrlFromPortfolio,
  insp360RemoveTourConfirmMessage,
  normalizeCloudTourUrlInput,
  setGateTourUrlInPortfolio,
} from '@/lib/insp360GateTours'
import type { PortfolioData } from '@/types/domain'

const sample: PortfolioData = {
  buildings: [],
  utilities: [
    {
      id: 2,
      name: 'ER-1',
      lat: 1,
      lng: 2,
      utility_type: 'Electrical Rooms',
      description: '',
      inspection_url: 'https://cdn.example.com/er.insp360',
    },
  ],
  polygons: [],
  suiteEntrances: [
    {
      id: 12,
      name: 'Suite A',
      lat: 1,
      lng: 2,
      description: '',
      building_id: 9,
      inspection_url: 'https://cdn.example.com/suite.insp360',
    },
  ],
}

describe('setGateTourUrlInPortfolio', () => {
  it('sets a new online tour URL on a suite gate', () => {
    const empty: PortfolioData = {
      ...sample,
      suiteEntrances: [{ ...sample.suiteEntrances[0]!, inspection_url: null }],
    }
    const next = setGateTourUrlInPortfolio(empty, 'suite:12', '60-birmingham/er.insp360')
    expect(next?.suiteEntrances[0]?.inspection_url).toBe('60-birmingham/er.insp360')
  })

  it('clears suite entrance tour URLs by gate id', () => {
    const next = clearGateTourLinkInPortfolio(sample, 'suite:12')
    expect(next?.suiteEntrances[0]?.inspection_url).toBeNull()
    expect(next?.utilities[0]?.inspection_url).toBe('https://cdn.example.com/er.insp360')
  })

  it('clears electrical utility tour URLs by gate id', () => {
    const next = clearGateTourLinkInPortfolio(sample, 'electrical:2')
    expect(next?.utilities[0]?.inspection_url).toBeNull()
    expect(next?.suiteEntrances[0]?.inspection_url).toBe('https://cdn.example.com/suite.insp360')
  })

  it('returns null when the gate already has no tour URL', () => {
    const empty: PortfolioData = {
      ...sample,
      suiteEntrances: [{ ...sample.suiteEntrances[0]!, inspection_url: null }],
    }
    expect(clearGateTourLinkInPortfolio(empty, 'suite:12')).toBeNull()
  })
})

describe('getGateInspectionUrlFromPortfolio', () => {
  it('reads the live tour URL for suite and electrical gates', () => {
    expect(getGateInspectionUrlFromPortfolio(sample, 'suite:12')).toBe(
      'https://cdn.example.com/suite.insp360',
    )
    expect(getGateInspectionUrlFromPortfolio(sample, 'electrical:2')).toBe(
      'https://cdn.example.com/er.insp360',
    )
  })

  it('returns null when the gate has no tour URL', () => {
    const empty: PortfolioData = {
      ...sample,
      suiteEntrances: [{ ...sample.suiteEntrances[0]!, inspection_url: null }],
    }
    expect(getGateInspectionUrlFromPortfolio(empty, 'suite:12')).toBeNull()
  })
})

describe('insp360RemoveTourConfirmMessage', () => {
  it('names the tour being removed', () => {
    expect(insp360RemoveTourConfirmMessage('60 Birmingham Electrical Room.insp360')).toContain(
      '60 Birmingham Electrical Room',
    )
    expect(insp360RemoveTourConfirmMessage(null)).toContain('Not connected yet')
  })
})

describe('normalizeCloudTourUrlInput', () => {
  it('trims quotes and whitespace', () => {
    expect(normalizeCloudTourUrlInput('  "tours/a.insp360"  ')).toBe('tours/a.insp360')
  })
})
