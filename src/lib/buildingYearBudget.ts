/** Key for a building Capex pot in a specific calendar year. */
export function buildingYearBudgetKey(address: string, year: string | number): string {
  return `${address.trim()}::${String(year).trim()}`
}

export function parseBuildingYearBudgetKey(
  key: string,
): { address: string; year: string } | null {
  const sep = key.lastIndexOf('::')
  if (sep <= 0) return null
  const address = key.slice(0, sep).trim()
  const year = key.slice(sep + 2).trim()
  if (!address || !/^\d{4}$/.test(year)) return null
  return { address, year }
}

/** Sum building year pots for one address (all years, or only listed years). */
export function sumBuildingYearBudgets(
  pots: Record<string, number>,
  address: string,
  years?: string[],
): number {
  let total = 0
  if (years?.length) {
    for (const year of years) {
      const amount = pots[buildingYearBudgetKey(address, year)]
      if (typeof amount === 'number' && amount > 0) total += amount
    }
    return Math.round(total)
  }
  const prefix = `${address.trim()}::`
  for (const [key, amount] of Object.entries(pots)) {
    if (!key.startsWith(prefix)) continue
    if (typeof amount === 'number' && amount > 0) total += amount
  }
  return Math.round(total)
}

/** Years at a building that have a Capex pot > 0. */
export function buildingBudgetYearsLabel(
  pots: Record<string, number>,
  address: string,
): string {
  const prefix = `${address.trim()}::`
  const years: string[] = []
  for (const [key, amount] of Object.entries(pots)) {
    if (!key.startsWith(prefix) || !(amount > 0)) continue
    const year = key.slice(prefix.length)
    if (/^\d{4}$/.test(year)) years.push(year)
  }
  return years.sort().join(' · ')
}

/**
 * Remaining Capex pot for a building+year after RTU allocations for that year.
 * Positive = still available; negative = over-allocated.
 */
export function remainingBuildingYearBudget(
  pot: number,
  allocated: number,
): number {
  return Math.round((pot || 0) - (allocated || 0))
}

/** Sum RTU budget allocations for one building + eligible replacement year. */
export function allocatedBuildingYearBudget(
  rtuBudgets: Record<string, number>,
  units: Array<{ address: string; rtu: string; replacementYear: string }>,
  address: string,
  year: string,
): number {
  return allocatedBuildingYearBudgetForAddresses(rtuBudgets, units, [address], year)
}

/** Sum RTU allocations across one or more buildings for a Capex year (shared BU pots). */
export function allocatedBuildingYearBudgetForAddresses(
  rtuBudgets: Record<string, number>,
  units: Array<{ address: string; rtu: string; replacementYear: string }>,
  addresses: string[],
  year: string,
): number {
  const addrSet = new Set(addresses.map((a) => a.trim()).filter(Boolean))
  const y = String(year).trim()
  let total = 0
  for (const unit of units) {
    if (!addrSet.has(unit.address.trim())) continue
    if (String(unit.replacementYear).trim() !== y) continue
    const amount = rtuBudgets[`${unit.address}::${unit.rtu}`]
    if (typeof amount === 'number' && amount > 0) total += amount
  }
  return Math.round(total)
}

/**
 * Capex pot dollars for a year across a BU share group (or a single building).
 * Works for primary-only storage and legacy equal-split pots (sums member rows).
 */
export function sumSharedBuildingYearPot(
  pots: Record<string, number>,
  addresses: string[],
  year: string,
): number {
  const y = String(year).trim()
  if (!/^\d{4}$/.test(y)) return 0
  let total = 0
  for (const address of addresses) {
    const amount = pots[buildingYearBudgetKey(address, y)]
    if (typeof amount === 'number' && amount > 0) total += amount
  }
  return Math.round(total)
}

/**
 * Sum Capex pots for a share group across all years (or only listed years).
 */
export function sumSharedBuildingYearBudgets(
  pots: Record<string, number>,
  addresses: string[],
  years?: string[],
): number {
  if (years?.length) {
    let total = 0
    for (const year of years) total += sumSharedBuildingYearPot(pots, addresses, year)
    return Math.round(total)
  }
  const seenYears = new Set<string>()
  for (const address of addresses) {
    const prefix = `${address.trim()}::`
    for (const key of Object.keys(pots)) {
      if (!key.startsWith(prefix)) continue
      const year = key.slice(prefix.length)
      if (/^\d{4}$/.test(year)) seenYears.add(year)
    }
  }
  let total = 0
  for (const year of seenYears) total += sumSharedBuildingYearPot(pots, addresses, year)
  return Math.round(total)
}

/** Budget-by-year map for one building from Capex pots. */
export function buildingBudgetByYearFromPots(
  pots: Record<string, number>,
  address: string,
): Record<string, number> {
  const prefix = `${address.trim()}::`
  const byYear: Record<string, number> = {}
  for (const [key, amount] of Object.entries(pots)) {
    if (!key.startsWith(prefix) || !(amount > 0)) continue
    const year = key.slice(prefix.length)
    if (/^\d{4}$/.test(year)) byYear[year] = Math.round(amount)
  }
  return byYear
}

/**
 * Keep only Capex pots for the buildings (and optional years) currently in view.
 * Used so Excel/PDF budgets match the Cost Center header, not the whole portfolio.
 */
export function filterBuildingYearBudgetsForView(
  pots: Record<string, number>,
  addresses: Iterable<string>,
  years?: string[] | null,
): Record<string, number> {
  const allowAddr = new Set(
    [...addresses].map((address) => address.trim()).filter(Boolean),
  )
  if (!allowAddr.size) return {}
  const allowYear =
    years?.length ? new Set(years.map((year) => String(year).trim()).filter(Boolean)) : null
  const next: Record<string, number> = {}
  for (const [key, amount] of Object.entries(pots)) {
    const sep = key.lastIndexOf('::')
    if (sep <= 0) continue
    const address = key.slice(0, sep)
    const year = key.slice(sep + 2)
    if (!allowAddr.has(address)) continue
    if (allowYear && !allowYear.has(year)) continue
    next[key] = amount
  }
  return next
}

/** Budget-by-year map using a Capex share group (sums member pots for each year). */
export function buildingBudgetByYearFromSharedPots(
  pots: Record<string, number>,
  addresses: string[],
): Record<string, number> {
  const years = new Set<string>()
  for (const address of addresses) {
    for (const year of Object.keys(buildingBudgetByYearFromPots(pots, address))) {
      years.add(year)
    }
  }
  const byYear: Record<string, number> = {}
  for (const year of years) {
    const amount = sumSharedBuildingYearPot(pots, addresses, year)
    if (amount > 0) byYear[year] = amount
  }
  return byYear
}

/**
 * Suggested equal share of each building-year Capex pot across RTUs
 * eligible for that year (does not write to RTU budgets).
 */
export function equalShareFromBuildingYearPots(
  units: Array<{ address: string; rtu: string; replacementYear: string }>,
  pots: Record<string, number>,
): Record<string, number> {
  const cohorts = new Map<string, string[]>()
  for (const unit of units) {
    const year = String(unit.replacementYear ?? '').trim()
    if (!unit.address?.trim() || !unit.rtu?.trim() || !/^\d{4}$/.test(year)) continue
    const cohortKey = `${unit.address}\0${year}`
    const list = cohorts.get(cohortKey) ?? []
    list.push(unit.rtu)
    cohorts.set(cohortKey, list)
  }

  const out: Record<string, number> = {}
  for (const [cohortKey, rtus] of cohorts) {
    const [address, year] = cohortKey.split('\0')
    if (!address || !year || !rtus.length) continue
    const pot = pots[buildingYearBudgetKey(address, year)] ?? 0
    if (!(pot > 0)) continue
    const base = Math.floor(pot / rtus.length)
    let assigned = 0
    for (let i = 0; i < rtus.length; i++) {
      const amount = i === rtus.length - 1 ? pot - assigned : base
      assigned += amount
      if (amount > 0) out[`${address}::${rtus[i]}`] = amount
    }
  }
  return out
}
