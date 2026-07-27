import { describe, expect, it } from 'vitest'
import {
  buildingMatchesCapexStatusSearch,
  isCapexStatusSearch,
  matchingCapexStatusYears,
  parseCapexStatusSearch,
  parseCapexStatusSearchQuery,
} from '@/lib/capexStatusSearch'
import { buildingYearBudgetKey } from '@/lib/buildingYearBudget'

describe('parseCapexStatusSearch', () => {
  it('recognizes Approved / Submitted / Rejected keywords', () => {
    expect(parseCapexStatusSearch('Approved')).toBe('Approved')
    expect(parseCapexStatusSearch(' submitted ')).toBe('Submitted')
    expect(parseCapexStatusSearch('REJECTED')).toBe('Rejected')
    expect(isCapexStatusSearch('Approved')).toBe(true)
    expect(isCapexStatusSearch('carrier')).toBe(false)
  })

  it('parses status with optional year (Approved, 2027)', () => {
    expect(parseCapexStatusSearchQuery('Approved, 2027')).toEqual({
      label: 'Approved',
      year: '2027',
    })
    expect(parseCapexStatusSearchQuery('submitted 2026')).toEqual({
      label: 'Submitted',
      year: '2026',
    })
    expect(parseCapexStatusSearch('Approved, 2027')).toBe('Approved')
    expect(isCapexStatusSearch('Approved, 2027')).toBe(true)
  })
})

describe('buildingMatchesCapexStatusSearch', () => {
  it('matches buildings by Capex pot status and optional year', () => {
    const statuses = {
      [buildingYearBudgetKey('6160 Kenway Drive', '2026')]: 'Approved',
      [buildingYearBudgetKey('6160 Kenway Drive', '2027')]: 'Submitted',
      [buildingYearBudgetKey('50 Leek Crescent', '2026')]: 'Approved',
    }

    expect(buildingMatchesCapexStatusSearch('6160 Kenway Drive', 'Approved', statuses)).toBe(true)
    expect(buildingMatchesCapexStatusSearch('6160 Kenway Drive', 'Rejected', statuses)).toBe(false)
    expect(
      buildingMatchesCapexStatusSearch('6160 Kenway Drive', 'Approved', statuses, '2027'),
    ).toBe(false)
    expect(
      buildingMatchesCapexStatusSearch('6160 Kenway Drive', 'Submitted', statuses, '2027'),
    ).toBe(true)
    expect(matchingCapexStatusYears('6160 Kenway Drive', 'Approved', statuses)).toEqual(['2026'])
  })
})
