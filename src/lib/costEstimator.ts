import {
  DEFAULT_RCB_PRICING,
  RCB_DEFAULT_THRESHOLD,
  RCB_YEARS,
  type RcbPricingTable,
  type RtuPricingUnit,
} from '@/lib/costEstimator.pricing'
import { ageAtCalendarYear, getRtuAge, getRtuYear, parseRtuMeta, rcbGetTons } from '@/lib/rtu'
import type { Building, CostBasis } from '@/types/domain'

export {
  RTU_PRICING,
  RCB_TIERS,
  RCB_YEARS,
  DEFAULT_RCB_PRICING,
  type RcbPricingTable,
  type RtuPricingUnit,
} from '@/lib/costEstimator.pricing'

export interface RcbTierMatch {
  tier: number
  key: string
  unit: RtuPricingUnit
}

export interface RcbBuildingSummary {
  address: string
  park: string
  cluster: string
  manager: string
  units: number
  tons: number
  cost: number
}

export interface RcbLineItem {
  address: string
  park: string
  cluster: string
  manager: string
  rtu: string
  model: string
  serial: string
  make: string
  suite: string
  year: number | null
  age: number | null
  tons: number | null
  tierKey: number
  tier: string
  cost: number
}

export type RcbScheduledLineItem = RcbLineItem & { replacementYear: string }

export interface RcbTierAggregate {
  tier: number
  label: string
  unit: number
  qty: number
  ext: number
}

export interface RcbTotals {
  bldgCount: number
  units: number
  tons: number
  cost: number
  excludedOld: number
}

export interface RcbComputeResult {
  basis: CostBasis
  year: string
  threshold: number
  scope: string
  perBldg: RcbBuildingSummary[]
  tiers: Record<string, RcbTierAggregate>
  lineItems: RcbLineItem[]
  totals: RcbTotals
}

export interface RcbProjectionPoint {
  year: string
  total: number
}

export function rcbMoney(amount: number): string {
  const n = Math.round(amount || 0)
  if (n < 0) return `-$${Math.abs(n).toLocaleString('en-CA')}`
  return `$${n.toLocaleString('en-CA')}`
}

/** Display cooling tonnage as e.g. "5 Ton" or "7.5 Ton". */
export function formatRtuTons(tons: number | null | undefined): string {
  if (tons == null || tons <= 0) return '—'
  const rounded = Math.round(tons * 10) / 10
  const label = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)
  return `${label} Ton`
}

/** Round tons up to the nearest supplied pricing tier. */
export function rcbTierFor(
  tons: number | null,
  table: RcbPricingTable = DEFAULT_RCB_PRICING,
): RcbTierMatch | null {
  if (!tons || tons <= 0) return null

  let tier: number | null = null
  for (const candidate of table.tiers) {
    if (candidate >= tons - 0.001) {
      tier = candidate
      break
    }
  }
  if (tier === null) tier = table.tiers[table.tiers.length - 1]!

  const key = String(tier)
  const unit = table.pricing[key]
  if (!unit) return null

  return { tier, key, unit }
}

/** Look up installed cost for a unit at the chosen basis and replacement year. */
export function rcbUnitCost(
  unit: RtuPricingUnit,
  basis: CostBasis,
  year: string,
): number | null {
  const table = unit[basis]
  if (!table) return null
  const direct = table[year]
  if (direct != null) return direct

  const yearNum = Number(year)
  if (!Number.isFinite(yearNum)) return null

  if (basis === 'hyb') {
    const base2026 = table['2026']
    if (base2026 == null) return null
    // Pricing sheet is 2026-based (~5%/yr). Support Capex years before 2026 and after 2032.
    if (yearNum > 2032) {
      return Math.round(base2026 * 1.05 ** (yearNum - 2026))
    }
    if (yearNum < 2026 && yearNum >= 2020) {
      return Math.round(base2026 / 1.05 ** (2026 - yearNum))
    }
  }

  // Standard sheet is a single 2025 all-in; reuse it for any Capex year view.
  if (basis === 'std') {
    const std2025 = table['2025']
    if (std2025 != null) return std2025
  }

  return null
}

export interface RcbComputeOptions {
  basis?: CostBasis
  year?: string
  threshold?: number
  scope?: string
  currentYear?: number
  pricingTable?: RcbPricingTable
}

/** Core replacement-cost computation for in-scope buildings. */
export function rcbCompute(
  buildings: Building[],
  options: RcbComputeOptions = {},
): RcbComputeResult {
  const basis = options.basis ?? 'hyb'
  const year =
    options.year ??
    (basis === 'std' ? '2025' : '2026')
  const threshold = options.threshold ?? RCB_DEFAULT_THRESHOLD
  const scope = options.scope ?? 'All buildings'
  const nowYear = options.currentYear
  const pricingTable = options.pricingTable ?? DEFAULT_RCB_PRICING

  const perBldg: RcbBuildingSummary[] = []
  const tiers: Record<string, RcbTierAggregate> = {}
  const lineItems: RcbLineItem[] = []
  let totUnits = 0
  let totTons = 0
  let totCost = 0
  let excludedOld = 0

  for (const building of buildings) {
    const summary = { units: 0, tons: 0, cost: 0 }

    for (const rtu of building.rtus ?? []) {
      const age = getRtuAge(rtu, nowYear)
      if (age == null || age < threshold) continue

      const tons = rcbGetTons(rtu)
      const tierMatch = rcbTierFor(tons, pricingTable)
      const cost = tierMatch
        ? rcbUnitCost(tierMatch.unit, basis, year)
        : null

      if (cost == null || tierMatch == null) {
        excludedOld++
        continue
      }

      summary.units++
      summary.tons += tons ?? 0
      summary.cost += cost
      totUnits++
      totTons += tons ?? 0
      totCost += cost

      const tierKey = tierMatch.key
      if (!tiers[tierKey]) {
        tiers[tierKey] = {
          tier: tierMatch.tier,
          label: tierMatch.unit.l,
          unit: cost,
          qty: 0,
          ext: 0,
        }
      }
      tiers[tierKey].qty++
      tiers[tierKey].ext += cost

      const meta = parseRtuMeta(rtu)
      lineItems.push({
        address: building.address,
        park: building.park,
        cluster: building.cluster ?? '',
        manager: building.manager ?? '',
        rtu: rtu.name,
        model: meta.model,
        serial: meta.serial,
        make: meta.make,
        suite: meta.suite,
        year: getRtuYear(rtu),
        age,
        tons,
        tierKey: tierMatch.tier,
        tier: tierMatch.unit.l,
        cost,
      })
    }

    if (summary.units > 0) {
      perBldg.push({
        address: building.address,
        park: building.park,
        cluster: building.cluster ?? '',
        manager: building.manager ?? '',
        units: summary.units,
        tons: summary.tons,
        cost: summary.cost,
      })
    }
  }

  return {
    basis,
    year,
    threshold,
    scope,
    perBldg,
    tiers,
    lineItems,
    totals: {
      bldgCount: perBldg.length,
      units: totUnits,
      tons: totTons,
      cost: totCost,
      excludedOld,
    },
  }
}

/** Build a human-readable scope label from active filters. */
export function rcbScopeLabel(parts: {
  park?: string
  cluster?: string
  manager?: string
  search?: string
}): string {
  const labels: string[] = []
  if (parts.park) labels.push(parts.park)
  if (parts.cluster) labels.push(parts.cluster)
  if (parts.manager) labels.push(`Mgr: ${parts.manager}`)
  const search = parts.search?.trim()
  if (search) labels.push(`"${search}"`)
  return labels.length > 0 ? labels.join(' · ') : 'All buildings'
}

/** Line items for one building, sorted by RTU name. */
export function rcbLineItemsForBuilding(
  result: RcbComputeResult,
  address: string,
): RcbLineItem[] {
  return result.lineItems
    .filter((item) => item.address === address)
    .sort((a, b) => a.rtu.localeCompare(b.rtu))
}

export function rcbReplacementYearKey(address: string, rtu: string): string {
  return `${address}::${rtu}`
}

/** Unit cost for a priced tier at a specific replacement year. */
export function rcbCostForTier(
  tierKey: number,
  basis: CostBasis,
  replacementYear: string,
  table: RcbPricingTable = DEFAULT_RCB_PRICING,
): number | null {
  const unit = table.pricing[String(tierKey)]
  return unit ? rcbUnitCost(unit, basis, replacementYear) : null
}

/**
 * Attach per-RTU replacement year assignments.
 * Cost stays from the pricing-year estimate; Age becomes age on that RTU's Repl. Year
 * (replacement year − install year). Unassigned RTUs show defaultYear in the UI but are
 * not treated as assigned for filters.
 */
export function rcbLineItemsWithReplacementYears(
  items: RcbLineItem[],
  basis: CostBasis,
  defaultYear: string,
  assignments: Record<string, string> = {},
  table: RcbPricingTable = DEFAULT_RCB_PRICING,
): RcbScheduledLineItem[] {
  void basis
  void table
  return items.map((item) => {
    const key = rcbReplacementYearKey(item.address, item.rtu)
    const replacementYear = assignments[key] ?? defaultYear
    const ageOnRepl = ageAtCalendarYear(item.year, replacementYear)
    return {
      ...item,
      replacementYear,
      age: ageOnRepl ?? item.age,
    }
  })
}

/**
 * True for a real calendar replacement year (e.g. 2027).
 * 0 / blank / Demolition-style placeholders are not assignments (treat as None).
 */
export function isValidRtuReplacementYear(year: string | number | null | undefined): boolean {
  if (year == null || year === '') return false
  const n = typeof year === 'number' ? year : Math.round(Number(String(year).trim()))
  return Number.isFinite(n) && n >= 2000 && n <= 2100
}

/** Keep every valid year assignment (filter/default year must not clear stored picks). */
export function rcbSanitizeReplacementYearAssignments(
  assignments: Record<string, string>,
  allowedYears: string[],
  _defaultYear: string,
): Record<string, string> {
  const allowed = new Set(allowedYears)
  const next: Record<string, string> = {}
  for (const [key, year] of Object.entries(assignments)) {
    if (!isValidRtuReplacementYear(year)) continue
    const normalized = String(Math.round(Number(year)))
    if (allowed.has(normalized) || /^\d{4}$/.test(normalized)) next[key] = normalized
  }
  return next
}

/** Merge pricing years with any assigned replacement years for dropdowns. */
export function rcbScheduleYearOptions(
  basis: CostBasis,
  defaultYear: string,
  assignments: Record<string, string> = {},
): string[] {
  const base = RCB_YEARS[basis] ?? [defaultYear]
  const years = new Set([...base, defaultYear, ...Object.values(assignments)])
  return [...years]
    .filter((year) => isValidRtuReplacementYear(year))
    .sort((a, b) => Number(a) - Number(b))
}

export interface RcbScheduledExport {
  defaultYear: string
  items: RcbScheduledLineItem[]
  perBldg: RcbBuildingSummary[]
  tiers: RcbTierAggregate[]
  totals: Pick<RcbTotals, 'units' | 'tons' | 'cost' | 'bldgCount'>
  customizedCount: number
}

/** Merge global RCB result with per-RTU replacement year assignments for export/display. */
export function rcbBuildScheduledExport(
  result: RcbComputeResult,
  replacementYearByRtu: Record<string, string> = {},
  table: RcbPricingTable = DEFAULT_RCB_PRICING,
): RcbScheduledExport {
  const defaultYear = result.year
  const items = rcbLineItemsWithReplacementYears(
    result.lineItems,
    result.basis,
    defaultYear,
    replacementYearByRtu,
    table,
  )

  const perBldgMap = new Map<string, RcbBuildingSummary>()
  for (const item of items) {
    let row = perBldgMap.get(item.address)
    if (!row) {
      row = {
        address: item.address,
        park: item.park,
        cluster: item.cluster,
        manager: item.manager,
        units: 0,
        tons: 0,
        cost: 0,
      }
      perBldgMap.set(item.address, row)
    }
    row.units++
    row.tons += item.tons ?? 0
    row.cost += item.cost
  }

  const perBldg = [...perBldgMap.values()].sort((a, b) => b.cost - a.cost)
  const tiers = rcbTierBreakdownForItems(items)
  const cost = items.reduce((sum, item) => sum + item.cost, 0)
  const tons = items.reduce((sum, item) => sum + (item.tons ?? 0), 0)
  const customizedCount = items.filter((item) => item.replacementYear !== defaultYear).length

  return {
    defaultYear,
    items,
    perBldg,
    tiers,
    totals: {
      bldgCount: perBldg.length,
      units: items.length,
      tons,
      cost,
    },
    customizedCount,
  }
}

/** Tonnage-tier rollup for a subset of line items (e.g. one building). */
export function rcbTierBreakdownForItems(items: RcbLineItem[]): RcbTierAggregate[] {
  const map = new Map<number, RcbTierAggregate>()
  for (const item of items) {
    const existing = map.get(item.tierKey)
    if (existing) {
      existing.qty++
      existing.ext += item.cost
    } else {
      map.set(item.tierKey, {
        tier: item.tierKey,
        label: item.tier,
        unit: item.cost,
        qty: 1,
        ext: item.cost,
      })
    }
  }
  for (const row of map.values()) {
    row.unit = row.qty ? Math.round(row.ext / row.qty) : 0
  }
  return [...map.values()].sort((a, b) => a.tier - b.tier)
}

/** Project total cost across every available year for the current basis. */
export function rcbProjection(
  result: RcbComputeResult,
  table: RcbPricingTable = DEFAULT_RCB_PRICING,
): RcbProjectionPoint[] {
  return rcbProjectionFromTierQuantities(
    result.basis,
    Object.values(result.tiers).map((tier) => ({ tierKey: tier.tier, qty: tier.qty })),
    table,
  )
}

/** Project cost for an arbitrary mix of tonnage tiers (e.g. a filtered RTU view). */
export function rcbProjectionFromTierQuantities(
  basis: CostBasis,
  tiers: Array<{ tierKey: number; qty: number }>,
  table: RcbPricingTable = DEFAULT_RCB_PRICING,
): RcbProjectionPoint[] {
  const years = RCB_YEARS[basis] ?? []
  return years.map((year) => {
    let total = 0
    for (const { tierKey, qty } of tiers) {
      const cost = table.pricing[String(tierKey)]?.[basis]?.[year]
      if (cost != null) total += qty * cost
    }
    return { year, total }
  })
}
