import { rcbReplacementYearKey } from '@/lib/costEstimator'

export interface RtuBudgetSplitItem {
  rtu: string
  cost: number
}

export interface EqualBudgetShareUnit {
  address: string
  rtu: string
  replacementYear: string
  budget: number | null | undefined
}

/** Sum stored RTU budgets for a building (only names provided). */
export function sumBuildingBudget(
  budgets: Record<string, number>,
  address: string,
  rtuNames: string[],
): number {
  let total = 0
  for (const rtu of rtuNames) {
    const amount = budgets[rcbReplacementYearKey(address, rtu)]
    if (typeof amount === 'number' && Number.isFinite(amount)) total += amount
  }
  return Math.round(total)
}

/**
 * Split a building budget across RTUs by estimated cost share.
 * Equal share when all costs are 0. Last RTU absorbs rounding remainder.
 */
export function splitBuildingBudget(
  total: number,
  items: RtuBudgetSplitItem[],
): Record<string, number> {
  const roundedTotal = Math.round(total)
  if (!items.length || roundedTotal <= 0) return {}

  const costSum = items.reduce((sum, item) => sum + Math.max(0, item.cost), 0)
  const out: Record<string, number> = {}
  let assigned = 0

  for (let i = 0; i < items.length; i++) {
    const item = items[i]!
    const isLast = i === items.length - 1
    if (isLast) {
      out[item.rtu] = Math.max(0, roundedTotal - assigned)
      break
    }
    const share =
      costSum > 0
        ? (Math.max(0, item.cost) / costSum) * roundedTotal
        : roundedTotal / items.length
    const amount = Math.max(0, Math.round(share))
    out[item.rtu] = amount
    assigned += amount
  }

  return out
}

/**
 * For each building + eligible replacement year, take the total budgeted money
 * in that cohort and split it equally across every RTU eligible that year.
 * Returns amounts keyed by `address::rtu` (0 omitted).
 */
export function equalBudgetShareByBuildingYear(
  units: EqualBudgetShareUnit[],
): Record<string, number> {
  const cohorts = new Map<string, EqualBudgetShareUnit[]>()
  for (const unit of units) {
    const year = String(unit.replacementYear ?? '').trim()
    if (!unit.address?.trim() || !unit.rtu?.trim() || !year) continue
    const cohortKey = `${unit.address}\0${year}`
    const list = cohorts.get(cohortKey) ?? []
    list.push(unit)
    cohorts.set(cohortKey, list)
  }

  const out: Record<string, number> = {}
  for (const group of cohorts.values()) {
    const pot = group.reduce((sum, unit) => {
      const amount = unit.budget
      return sum + (typeof amount === 'number' && amount > 0 ? amount : 0)
    }, 0)
    if (!(pot > 0) || !group.length) continue

    // Equal costs → splitBuildingBudget uses an equal share (remainder on last).
    const split = splitBuildingBudget(
      pot,
      group.map((unit) => ({ rtu: unit.rtu, cost: 0 })),
    )
    for (const unit of group) {
      const amount = split[unit.rtu] ?? 0
      if (!(amount > 0)) continue
      out[rcbReplacementYearKey(unit.address, unit.rtu)] = amount
    }
  }
  return out
}

/** Parse a currency-ish input into whole CAD dollars, or null when empty/invalid. */
export function parseBudgetInput(raw: string): number | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  const cleaned = trimmed.replace(/[$,\s]/g, '')
  if (!cleaned || cleaned === '-' || cleaned === '.') return null
  const value = Number(cleaned)
  if (!Number.isFinite(value) || value < 0) return null
  return Math.round(value)
}

/** Format a budget amount for an input field (plain digits with thousands separators). */
export function formatBudgetInputValue(amount: number | null | undefined): string {
  if (amount == null || !Number.isFinite(amount)) return ''
  return Math.round(amount).toLocaleString('en-CA')
}
