import { describe, expect, it } from 'vitest'
import {
  allocatedBuildingYearBudget,
  buildingBudgetByYearFromPots,
  buildingYearBudgetKey,
  equalShareFromBuildingYearPots,
  filterBuildingYearBudgetsForView,
  remainingBuildingYearBudget,
  resolveCapexPotYears,
  sumBuildingYearBudgets,
  uniqueReplacementYears,
} from '@/lib/buildingYearBudget'

describe('buildingYearBudget helpers', () => {
  it('keys and sums pots by address', () => {
    const pots = {
      [buildingYearBudgetKey('1850 Derry Road East', 2026)]: 10_000,
      [buildingYearBudgetKey('1850 Derry Road East', 2029)]: 5_000,
      [buildingYearBudgetKey('Other', 2026)]: 99,
    }
    expect(sumBuildingYearBudgets(pots, '1850 Derry Road East')).toBe(15_000)
    expect(sumBuildingYearBudgets(pots, '1850 Derry Road East', ['2029'])).toBe(5_000)
    expect(buildingBudgetByYearFromPots(pots, '1850 Derry Road East')).toEqual({
      '2026': 10_000,
      '2029': 5_000,
    })
  })

  it('computes remaining after RTU draw-down for a year', () => {
    expect(remainingBuildingYearBudget(10_000, 3_500)).toBe(6_500)
    expect(remainingBuildingYearBudget(1_000, 1_200)).toBe(-200)
  })

  it('sums RTU allocations for one building year', () => {
    const units = [
      { address: 'A', rtu: 'RTU-1', replacementYear: '2026' },
      { address: 'A', rtu: 'RTU-2', replacementYear: '2026' },
      { address: 'A', rtu: 'RTU-3', replacementYear: '2029' },
    ]
    const rtuBudgets = {
      'A::RTU-1': 400,
      'A::RTU-2': 600,
      'A::RTU-3': 999,
    }
    expect(allocatedBuildingYearBudget(rtuBudgets, units, 'A', '2026')).toBe(1_000)
  })

  it('splits Capex pot equally across eligible RTUs', () => {
    const shares = equalShareFromBuildingYearPots(
      [
        { address: 'A', rtu: '1', replacementYear: '2026' },
        { address: 'A', rtu: '2', replacementYear: '2026' },
        { address: 'A', rtu: '3', replacementYear: '2029' },
      ],
      { 'A::2026': 1001 },
    )
    expect(shares['A::1']).toBe(500)
    expect(shares['A::2']).toBe(501)
    expect(shares['A::3']).toBeUndefined()
  })

  it('filters Capex pots to the buildings and year currently on screen', () => {
    const pots = {
      [buildingYearBudgetKey('1850 Derry Road East', 2026)]: 10_000,
      [buildingYearBudgetKey('1850 Derry Road East', 2027)]: 20_000,
      [buildingYearBudgetKey('Other Building', 2027)]: 99_000,
    }
    expect(
      filterBuildingYearBudgetsForView(pots, ['1850 Derry Road East'], ['2027']),
    ).toEqual({
      [buildingYearBudgetKey('1850 Derry Road East', 2027)]: 20_000,
    })
    expect(filterBuildingYearBudgetsForView(pots, ['1850 Derry Road East'])).toEqual({
      [buildingYearBudgetKey('1850 Derry Road East', 2026)]: 10_000,
      [buildingYearBudgetKey('1850 Derry Road East', 2027)]: 20_000,
    })
  })

  it('lists unique replacement years from visible RTUs', () => {
    expect(
      uniqueReplacementYears([
        { replacementYear: '2028' },
        { replacementYear: '2028' },
        { replacementYear: '2027' },
        { replacementYear: '' },
        { replacementYear: null },
      ]),
    ).toEqual(['2027', '2028'])
  })

  it('resolves Capex pot year from an explicit Repl. Year filter', () => {
    expect(
      resolveCapexPotYears({
        replacementYearFilter: '2029',
        visibleUnits: [{ replacementYear: '2028' }],
        fallbackYear: '2026',
      }),
    ).toEqual({ mode: 'single', year: '2029' })
  })

  it('uses the shared Repl. Year when filter is All and all units match', () => {
    expect(
      resolveCapexPotYears({
        replacementYearFilter: '',
        visibleUnits: [
          { replacementYear: '2028' },
          { replacementYear: '2028' },
        ],
        fallbackYear: '2026',
      }),
    ).toEqual({ mode: 'single', year: '2028' })
  })

  it('lists Capex years when visible RTUs span multiple Repl. Years', () => {
    expect(
      resolveCapexPotYears({
        replacementYearFilter: '',
        visibleUnits: [
          { replacementYear: '2028' },
          { replacementYear: '2027' },
          { replacementYear: '2028' },
        ],
        fallbackYear: '2026',
      }),
    ).toEqual({ mode: 'multi', years: ['2027', '2028'] })
  })

  it('falls back to the estimate year when no Repl. Years are visible', () => {
    expect(
      resolveCapexPotYears({
        replacementYearFilter: '',
        visibleUnits: [],
        fallbackYear: '2026',
      }),
    ).toEqual({ mode: 'single', year: '2026' })
  })
})
