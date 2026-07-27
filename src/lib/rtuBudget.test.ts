import { beforeEach, describe, expect, it } from 'vitest'
import { rcbReplacementYearKey } from '@/lib/costEstimator'
import {
  equalBudgetShareByBuildingYear,
  formatBudgetInputValue,
  parseBudgetInput,
  splitBuildingBudget,
  sumBuildingBudget,
} from '@/lib/rtuBudget'
import { STORAGE_KEYS } from '@/lib/storageKeys'
import { useRtuBudgetStore } from '@/stores/rtuBudgetStore'

describe('sumBuildingBudget', () => {
  it('sums only the named RTUs for a building', () => {
    const budgets = {
      [rcbReplacementYearKey('A', 'RTU-01')]: 1000,
      [rcbReplacementYearKey('A', 'RTU-02')]: 2500,
      [rcbReplacementYearKey('B', 'RTU-01')]: 9999,
    }
    expect(sumBuildingBudget(budgets, 'A', ['RTU-01', 'RTU-02'])).toBe(3500)
    expect(sumBuildingBudget(budgets, 'A', ['RTU-01'])).toBe(1000)
    expect(sumBuildingBudget(budgets, 'A', ['RTU-99'])).toBe(0)
  })
})

describe('splitBuildingBudget', () => {
  it('splits by estimated cost share and preserves the total', () => {
    const split = splitBuildingBudget(1000, [
      { rtu: 'RTU-01', cost: 750 },
      { rtu: 'RTU-02', cost: 250 },
    ])
    expect(split['RTU-01']).toBe(750)
    expect(split['RTU-02']).toBe(250)
    expect((split['RTU-01'] ?? 0) + (split['RTU-02'] ?? 0)).toBe(1000)
  })

  it('uses equal share when costs are zero and puts remainder on the last RTU', () => {
    const split = splitBuildingBudget(100, [
      { rtu: 'A', cost: 0 },
      { rtu: 'B', cost: 0 },
      { rtu: 'C', cost: 0 },
    ])
    expect(split['A']).toBe(33)
    expect(split['B']).toBe(33)
    expect(split['C']).toBe(34)
    expect((split['A'] ?? 0) + (split['B'] ?? 0) + (split['C'] ?? 0)).toBe(100)
  })

  it('returns empty for zero/negative total or no items', () => {
    expect(splitBuildingBudget(0, [{ rtu: 'A', cost: 10 }])).toEqual({})
    expect(splitBuildingBudget(100, [])).toEqual({})
  })
})

describe('equalBudgetShareByBuildingYear', () => {
  it('splits each building+year budget pot equally across eligible RTUs', () => {
    const shares = equalBudgetShareByBuildingYear([
      { address: '100 Leek', rtu: 'RTU-01', replacementYear: '2029', budget: 750 },
      { address: '100 Leek', rtu: 'RTU-02', replacementYear: '2029', budget: 250 },
      { address: '100 Leek', rtu: 'RTU-03', replacementYear: '2031', budget: 400 },
      { address: 'Other', rtu: 'RTU-01', replacementYear: '2029', budget: 1000 },
    ])
    expect(shares[rcbReplacementYearKey('100 Leek', 'RTU-01')]).toBe(500)
    expect(shares[rcbReplacementYearKey('100 Leek', 'RTU-02')]).toBe(500)
    expect(shares[rcbReplacementYearKey('100 Leek', 'RTU-03')]).toBe(400)
    expect(shares[rcbReplacementYearKey('Other', 'RTU-01')]).toBe(1000)
  })
})

describe('parseBudgetInput / formatBudgetInputValue', () => {
  it('parses currency-like input', () => {
    expect(parseBudgetInput('$1,234')).toBe(1234)
    expect(parseBudgetInput(' 5000 ')).toBe(5000)
    expect(parseBudgetInput('')).toBeNull()
    expect(parseBudgetInput('abc')).toBeNull()
  })

  it('formats for inputs', () => {
    expect(formatBudgetInputValue(1234)).toBe('1,234')
    expect(formatBudgetInputValue(null)).toBe('')
  })
})

describe('useRtuBudgetStore', () => {
  beforeEach(() => {
    localStorage.removeItem(STORAGE_KEYS.rtuBudgets)
    useRtuBudgetStore.setState({ budgets: {}, loaded: false })
  })

  it('persists RTU budgets and rebuilds a building total via split', () => {
    const store = useRtuBudgetStore.getState()
    store.setRtuBudget('1850 Derry Road East', 'RTU-01', 1200)
    store.setRtuBudget('1850 Derry Road East', 'RTU-02', 800)
    expect(store.getRtuBudget('1850 Derry Road East', 'RTU-01')).toBe(1200)

    store.load()
    expect(useRtuBudgetStore.getState().budgets[rcbReplacementYearKey('1850 Derry Road East', 'RTU-01')]).toBe(
      1200,
    )

    useRtuBudgetStore.getState().setBuildingBudget('1850 Derry Road East', 3000, [
      { rtu: 'RTU-01', cost: 2000 },
      { rtu: 'RTU-02', cost: 1000 },
    ])
    const next = useRtuBudgetStore.getState()
    expect(next.getRtuBudget('1850 Derry Road East', 'RTU-01')).toBe(2000)
    expect(next.getRtuBudget('1850 Derry Road East', 'RTU-02')).toBe(1000)

    next.clearBuildingBudgets('1850 Derry Road East', ['RTU-01', 'RTU-02'])
    expect(useRtuBudgetStore.getState().getRtuBudget('1850 Derry Road East', 'RTU-01')).toBeNull()
  })
})
