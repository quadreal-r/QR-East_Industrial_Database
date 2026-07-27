import { describe, expect, it } from 'vitest'
import {
  buildCapexShareGroupsByBu,
  capexBudgetDedupeKey,
  capexPotOwnerAddress,
  capexShareAddresses,
  extractBuFromCapexAddress,
  normalizeCapexBu,
  stripCapexAddressDecorations,
} from '@/lib/capexSharedBu'
import {
  isSharedCapexBuGroup,
  resolveCapexSheetBuildings,
} from '@/lib/capexHvacBudgetImport'
import { sumSharedBuildingYearPot } from '@/lib/buildingYearBudget'
import type { Building } from '@/types/domain'

function bldg(address: string, bu: string): Building {
  return {
    park: 'East',
    address,
    bu,
    lat: 0,
    lng: 0,
    sqft: '',
    cluster: '',
    manager: '',
    rtus: [],
  }
}

const ridgeway = [
  bldg('3150 Ridgeway Drive', '50311'),
  bldg('3170 Ridgeway Drive', '50311'),
  bldg('3176 Ridgeway Drive', '50312'),
  bldg('3180 Ridgeway Drive', '50312'),
  bldg('3184 Ridgeway Drive', '50312'),
  bldg('3190 Ridgeway Drive', '50312'),
]

const portfolio = [
  ...ridgeway,
  bldg('4161 Sladeview Crescent', '50304'),
  bldg('4181 Sladeview Crescent', '50304'),
  bldg('6901 Creditview Road', '65126'),
  bldg('6911 Creditview Road', '65126'),
  bldg('3165 Unity Drive', '50301'),
]

describe('capexSharedBu', () => {
  it('extracts BU from Capex combined labels', () => {
    expect(extractBuFromCapexAddress('3150-3170 Ridgeway Dr (2 Bldgs) (BU 50311)')).toBe('50311')
    expect(extractBuFromCapexAddress('6901-6911 Creditview Rd (SM) (2 Bldgs) (BU 65126)')).toBe(
      '65126',
    )
    expect(normalizeCapexBu('050311')).toBe('50311')
  })

  it('strips Capex decorations for fuzzy matching', () => {
    expect(stripCapexAddressDecorations('4161-4181 Sladeview Cres (2 Bldgs) (BU 50304)')).toBe(
      '4161-4181 Sladeview Cres',
    )
  })

  it('groups multi-building BUs and picks a primary owner', () => {
    const groups = buildCapexShareGroupsByBu(portfolio)
    expect(groups.get('50311')?.addresses).toEqual([
      '3150 Ridgeway Drive',
      '3170 Ridgeway Drive',
    ])
    expect(capexPotOwnerAddress(portfolio, '3170 Ridgeway Drive', groups)).toBe(
      '3150 Ridgeway Drive',
    )
    expect(capexShareAddresses(portfolio, '3170 Ridgeway Drive', groups)).toHaveLength(2)
    expect(capexBudgetDedupeKey(portfolio, '3150 Ridgeway Drive', groups)).toBe('bu:50311')
    expect(capexBudgetDedupeKey(portfolio, '3165 Unity Drive', groups)).toBe(
      'addr:3165 Unity Drive',
    )
  })
})

describe('resolveCapexSheetBuildings', () => {
  it('resolves Capex combined Ridgeway label via BU 50311', () => {
    const matched = resolveCapexSheetBuildings(
      '3150-3170 Ridgeway Dr (2 Bldgs) (BU 50311)',
      portfolio,
    )
    expect(matched.map((b) => b.address).sort()).toEqual([
      '3150 Ridgeway Drive',
      '3170 Ridgeway Drive',
    ])
    expect(isSharedCapexBuGroup(matched)).toBe(true)
  })

  it('resolves Sladeview and Creditview shared BUs', () => {
    expect(
      resolveCapexSheetBuildings('4161-4181 Sladeview Cres (2 Bldgs) (BU 50304)', portfolio).map(
        (b) => b.address,
      ),
    ).toEqual(['4161 Sladeview Crescent', '4181 Sladeview Crescent'])
    expect(
      resolveCapexSheetBuildings(
        '6901-6911 Creditview Rd (SM) (2 Bldgs) (BU 65126)',
        portfolio,
      ).map((b) => b.address),
    ).toEqual(['6901 Creditview Road', '6911 Creditview Road'])
  })

  it('expands a single Ridgeway address into its shared BU siblings', () => {
    const matched = resolveCapexSheetBuildings('3170 Ridgeway Drive', portfolio)
    expect(matched.map((b) => b.address).sort()).toEqual([
      '3150 Ridgeway Drive',
      '3170 Ridgeway Drive',
    ])
  })
})

describe('sumSharedBuildingYearPot', () => {
  it('sums legacy equal-split pots across the share group', () => {
    const pots = {
      '3150 Ridgeway Drive::2026': 50_000,
      '3170 Ridgeway Drive::2026': 50_000,
    }
    expect(
      sumSharedBuildingYearPot(pots, ['3150 Ridgeway Drive', '3170 Ridgeway Drive'], '2026'),
    ).toBe(100_000)
  })
})
