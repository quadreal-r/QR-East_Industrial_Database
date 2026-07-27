import {
  rcbBuildScheduledExport,
  rcbProjection,
  rcbProjectionFromTierQuantities,
  rcbReplacementYearKey,
  rcbTierBreakdownForItems,
  type RcbBuildingSummary,
  type RcbComputeResult,
  type RcbScheduledLineItem,
  type RcbTierAggregate,
} from '@/lib/costEstimator'
import type { CostBasis } from '@/types/domain'
import { RCB_YEARS, type RcbPricingTable } from '@/lib/costEstimator.pricing'
import { DEFAULT_RCB_PRICING } from '@/lib/costEstimator.pricing'
import {
  buildingBudgetByYearFromPots,
  buildingBudgetByYearFromSharedPots,
  buildingBudgetYearsLabel,
  buildingYearBudgetKey,
} from '@/lib/buildingYearBudget'
import { CAPEX_HVAC_YEAR_COLUMNS } from '@/lib/capexHvacBudgetImport'
import { normalizeRtuName } from '@/lib/rtuMatch'

/** RTU names flagged redundant, disconnected, or do-not-replace in presentation exports. */
export function isRtuFlaggedForReview(rtuName: string): boolean {
  return /redundant|disconnected|do not replace|don'?t replace/i.test(rtuName)
}

/** Full currency with dollar sign and thousands separators (e.g. $5,877,658). */
export function formatMoney(amount: number): string {
  return `$${Math.round(amount || 0).toLocaleString('en-CA')}`
}

/** Percentage with two decimal places (e.g. 38.40%). */
export function formatPercent(value: number): string {
  return `${(value * 100).toFixed(2)}%`
}

/** Compact currency for dashboard headlines (e.g. $5.88M). */
export function formatCompactMoney(amount: number): string {
  const n = Math.round(amount || 0)
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`
  return `$${n.toLocaleString('en-CA')}`
}

/** Proportional block bar for share-of-plan columns in presentation exports. */
export function rcbShareBar(share: number, maxChars = 20): string {
  if (share <= 0) return ''
  const filled = Math.max(1, Math.round(share * maxChars))
  return '█'.repeat(Math.min(filled, maxChars))
}

export function formatPresentationDate(date = new Date()): string {
  return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}

/**
 * Short download basename reflecting the current cost scope + replacement year.
 * Example: `QR_RTU_Replacement_Cost_Center_All_2026`
 */
export function rcbExportFilenameBase(scopeLabel: string, defaultYear: string, _today?: string): string {
  const safe = (scopeLabel === 'All buildings' ? 'All' : scopeLabel)
    .replace(/["']/g, '')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 32)
  return `QR_RTU_Replacement_Cost_Center_${safe || 'Selection'}_${defaultYear}`
}

export interface RcbPortfolioRow {
  park: string
  manager: string
  units: number
  cost: number
  budget: number
  /** Budget minus estimated cost (positive = under plan / surplus). */
  variance: number
  share: number
}

/** Portfolio-level budget vs estimated-cost snapshot for Dashboard analytics. */
export interface RcbBudgetAnalytics {
  totalBudget: number
  totalCost: number
  /** Budget − estimated cost (positive = budget covers estimate). */
  variance: number
  /** Budget ÷ estimated cost when cost > 0; otherwise null. */
  coverage: number | null
  buildingsWithBudget: number
  buildingsOverBudget: number
  buildingsUnderOrEqual: number
  unitsWithBudget: number
}

/** Capex HVAC year columns mirrored on the By Building budget breakdown. */
export const RCB_BUDGET_YEAR_COLUMNS = CAPEX_HVAC_YEAR_COLUMNS

export interface RcbBuildingRow {
  address: string
  park: string
  cluster: string
  manager: string
  units: number
  cost: number
  budget: number
  /** Budget dollars rolled up by eligible replacement year (Capex match year). */
  budgetByYear: Record<string, number>
  /** Short label of years that have budget, e.g. "2026 · 2029". */
  budgetYears: string
  /** Capex years unchecked via Remove in Cost Center (excluded from totals). */
  removedBudgetYears: string[]
  share: number
  /**
   * When false, this row's Capex pot is shared with an earlier row and must not be
   * added again into Dashboard / By Building TOTAL budget columns.
   */
  countsTowardBudgetTotal?: boolean
}

export interface RcbUnitExportRow extends RcbScheduledLineItem {
  budget: number | null
  notes: string
}

export interface RcbWaitingRow {
  year: number
  total: number
  extra: number
  pctMore: number
}

export interface RcbUnitSizeRow {
  label: string
  avgCost: number
  qty: number
  total: number
}

export interface RcbPricingTierRow {
  label: string
  costsByYear: Record<string, number>
}

export interface RcbPricingSection {
  basis: CostBasis
  basisLabel: string
  years: string[]
  rows: RcbPricingTierRow[]
}

export function rcbPricingBasisLabel(basis: CostBasis): string {
  return basis === 'hyb'
    ? 'Hybrid Lennox (all-in installed)'
    : 'Standard Efficiency / Lennox Xion (all-in installed)'
}

export interface RcbPresentation {
  scopeLabel: string
  preparedDate: string
  today: string
  defaultYear: string
  threshold: number
  hasCustomSchedule: boolean
  basis: CostBasis
  pricing: RcbPricingSection
  totals: {
    bldgCount: number
    units: number
    cost: number
  }
  summary: {
    totalCost: number
    avgUnitCost: number
    dueNowCost: number
    dueNowUnits: number
    flaggedCount: number
    flaggedSavings: number
    avgAge: number | null
  }
  portfolios: RcbPortfolioRow[]
  buildings: RcbBuildingRow[]
  waiting: {
    baseYear: string
    rows: RcbWaitingRow[]
    phasedNote: string | null
  }
  unitSizes: RcbUnitSizeRow[]
  units: RcbUnitExportRow[]
  totalsBudget: number
  budgetAnalytics: RcbBudgetAnalytics
  /** Capex building-year pots used for By Building Budget columns / Equal Share. */
  buildingYearBudgets: Record<string, number>
}

function rollupByPortfolio(items: RcbUnitExportRow[]): RcbPortfolioRow[] {
  const map = new Map<string, RcbPortfolioRow>()
  for (const item of items) {
    const key = item.park || '—'
    let row = map.get(key)
    if (!row) {
      row = {
        park: key,
        manager: item.manager,
        units: 0,
        cost: 0,
        budget: 0,
        variance: 0,
        share: 0,
      }
      map.set(key, row)
    }
    row.units++
    row.cost += item.cost
    if (item.budget != null && item.budget > 0) row.budget += item.budget
  }
  return [...map.values()]
    .map((row) => ({
      ...row,
      cost: Math.round(row.cost),
      budget: Math.round(row.budget),
      variance: Math.round(row.budget) - Math.round(row.cost),
    }))
    .sort((a, b) => b.cost - a.cost)
}

export function buildRcbBudgetAnalytics(
  totalBudget: number,
  totalCost: number,
  buildings: RcbBuildingRow[],
  units: RcbUnitExportRow[],
): RcbBudgetAnalytics {
  let buildingsWithBudget = 0
  let buildingsOverBudget = 0
  let buildingsUnderOrEqual = 0
  for (const building of buildings) {
    if (!(building.budget > 0)) continue
    buildingsWithBudget++
    if (building.cost > building.budget) buildingsOverBudget++
    else buildingsUnderOrEqual++
  }
  const unitsWithBudget = units.filter((u) => u.budget != null && u.budget > 0).length
  return {
    totalBudget: Math.round(totalBudget),
    totalCost: Math.round(totalCost),
    variance: Math.round(totalBudget) - Math.round(totalCost),
    coverage: totalCost > 0 ? totalBudget / totalCost : null,
    buildingsWithBudget,
    buildingsOverBudget,
    buildingsUnderOrEqual,
    unitsWithBudget,
  }
}

/** Roll RTU budgets into building totals keyed by eligible replacement year. */
export function rollupBuildingBudgetByYear(
  units: Array<{ address: string; replacementYear: string; budget: number | null }>,
  address: string,
): Record<string, number> {
  const byYear: Record<string, number> = {}
  for (const unit of units) {
    if (unit.address !== address) continue
    if (!(unit.budget != null && unit.budget > 0)) continue
    const year = String(unit.replacementYear ?? '').trim()
    if (!year) continue
    byYear[year] = (byYear[year] ?? 0) + unit.budget
  }
  for (const year of Object.keys(byYear)) {
    byYear[year] = Math.round(byYear[year]!)
  }
  return byYear
}

export function formatBudgetYearsLabel(budgetByYear: Record<string, number>): string {
  return Object.keys(budgetByYear)
    .filter((year) => (budgetByYear[year] ?? 0) > 0)
    .sort()
    .join(' · ')
}

/** Drop Capex pots the user removed from Cost Center totals. */
export function filterExcludedBuildingYearBudgets(
  pots: Record<string, number>,
  excluded: Set<string>,
): Record<string, number> {
  if (!excluded.size) return pots
  const next: Record<string, number> = {}
  for (const [key, amount] of Object.entries(pots)) {
    if (excluded.has(key)) continue
    next[key] = amount
  }
  return next
}

function buildBuildingRows(
  perBldg: RcbBuildingSummary[],
  totalCost: number,
  buildingYearBudgets: Record<string, number>,
  units: RcbUnitExportRow[],
  excludedBudgets: Set<string> = new Set(),
  shareAddressesFor?: (address: string) => string[],
  budgetDedupeKeyFor?: (address: string) => string,
): RcbBuildingRow[] {
  const countedPots = new Set<string>()
  return perBldg.map((row) => {
    const costShare = totalCost ? row.cost / totalCost : 0
    const potAddresses = shareAddressesFor?.(row.address) ?? [row.address]
    // Prefer Capex building-year pots (shared by BU when provided); fall back to RTU rollups.
    const fromPotsRaw = shareAddressesFor
      ? buildingBudgetByYearFromSharedPots(buildingYearBudgets, potAddresses)
      : buildingBudgetByYearFromPots(buildingYearBudgets, row.address)
    const removedBudgetYears = Object.keys(fromPotsRaw)
      .filter((year) =>
        potAddresses.some((address) =>
          excludedBudgets.has(buildingYearBudgetKey(address, year)),
        ),
      )
      .sort()
    const fromPots: Record<string, number> = {}
    for (const [year, amount] of Object.entries(fromPotsRaw)) {
      if (
        potAddresses.some((address) =>
          excludedBudgets.has(buildingYearBudgetKey(address, year)),
        )
      ) {
        continue
      }
      fromPots[year] = amount
    }
    const budgetByYear =
      Object.keys(fromPotsRaw).length > 0
        ? fromPots
        : rollupBuildingBudgetByYear(units, row.address)
    const budget =
      Object.keys(fromPotsRaw).length > 0
        ? Object.values(fromPots).reduce((s, n) => s + n, 0)
        : Object.values(budgetByYear).reduce((s, n) => s + n, 0)
    const dedupeKey = budgetDedupeKeyFor?.(row.address) ?? `addr:${row.address}`
    const countsTowardBudgetTotal = !countedPots.has(dedupeKey)
    if (countsTowardBudgetTotal) countedPots.add(dedupeKey)
    return {
      address: row.address,
      park: row.park,
      cluster: row.cluster,
      manager: row.manager,
      units: row.units,
      cost: Math.round(row.cost),
      budget: Math.round(budget),
      budgetByYear,
      budgetYears:
        formatBudgetYearsLabel(budgetByYear) ||
        buildingBudgetYearsLabel(
          filterExcludedBuildingYearBudgets(buildingYearBudgets, excludedBudgets),
          row.address,
        ),
      removedBudgetYears,
      share: costShare,
      countsTowardBudgetTotal,
    }
  })
}

function buildUnitSizeRows(tiers: RcbTierAggregate[]): RcbUnitSizeRow[] {
  return [...tiers]
    .sort((a, b) => b.ext - a.ext)
    .map((tier) => {
      const qty = tier.qty
      const total = Math.round(tier.ext)
      const avgCost = qty > 0 ? Math.round(total / qty) : Math.round(tier.unit || 0)
      return {
        label: tier.label,
        avgCost,
        qty,
        total,
      }
    })
}

function buildPricingSection(
  pricingTable: RcbPricingTable,
  basis: CostBasis,
): RcbPricingSection {
  const years = RCB_YEARS[basis] ?? []
  const rows: RcbPricingTierRow[] = pricingTable.tiers.map((tier) => {
    const unit = pricingTable.pricing[String(tier)]
    const costsByYear: Record<string, number> = {}
    for (const year of years) {
      const cost = unit?.[basis]?.[year]
      costsByYear[year] = cost != null ? Math.round(cost) : 0
    }
    return {
      label: unit?.l ?? `${tier} Ton`,
      costsByYear,
    }
  })
  return {
    basis,
    basisLabel: rcbPricingBasisLabel(basis),
    years,
    rows,
  }
}

export interface BuildRcbPresentationOptions {
  replacementYearByRtu?: Record<string, string>
  /** Replacement notes keyed by `address::rtu`. */
  replacementNotesByRtu?: Record<string, string>
  pricingTable?: RcbPricingTable
  preparedDate?: string
  today?: string
  /** Local RTU budget allocations keyed by `address::rtu`. */
  rtuBudgets?: Record<string, number>
  /** Capex building-year pots keyed by `address::year`. */
  buildingYearBudgets?: Record<string, number>
  /**
   * Capex pots unchecked via Remove in Cost Center (`address::year`).
   * Excluded from Budget totals / analytics; year cells show "Removed".
   */
  excludedBudgets?: Set<string> | string[]
  /**
   * Keep only RTUs currently in view (e.g. one building, or one FY filter).
   * Applied after schedule years are assigned.
   */
  includeScheduledUnit?: (item: RcbScheduledLineItem) => boolean
  /**
   * Resolve Capex share-group addresses for a building (shared BU pots).
   * When set, By Building budgets match Cost Center shared pots.
   */
  shareAddressesFor?: (address: string) => string[]
  /**
   * Dedupe key for Capex pot totals (shared BU pots count once in Dashboard totals).
   */
  budgetDedupeKeyFor?: (address: string) => string
  /**
   * Capex building-year notes keyed by `address::year` (Cost Center Notes fallback).
   */
  buildingYearNotes?: Record<string, string>
}

function toExcludedBudgetSet(
  excluded: BuildRcbPresentationOptions['excludedBudgets'],
): Set<string> {
  if (!excluded) return new Set()
  if (excluded instanceof Set) return excluded
  return new Set(excluded)
}

/**
 * All Units report order: Manager A–Z, then address A–Z, then RTU number 1…10
 * (numeric, so RTU-2 before RTU-10).
 */
export function compareRcbAllUnitsExportOrder(
  a: { manager?: string; address: string; rtu: string },
  b: { manager?: string; address: string; rtu: string },
): number {
  const managerCmp = (a.manager ?? '').localeCompare(b.manager ?? '', undefined, {
    sensitivity: 'base',
  })
  if (managerCmp !== 0) return managerCmp
  const addressCmp = a.address.localeCompare(b.address, undefined, { sensitivity: 'base' })
  if (addressCmp !== 0) return addressCmp
  return normalizeRtuName(a.rtu).localeCompare(normalizeRtuName(b.rtu), undefined, {
    numeric: true,
    sensitivity: 'base',
  })
}

function resolveExportUnitNotes(
  address: string,
  rtu: string,
  replacementYear: string,
  rtuNotes: Record<string, string>,
  potNotes: Record<string, string>,
  shareAddressesFor?: (address: string) => string[],
): string {
  const rtuNote = rtuNotes[rcbReplacementYearKey(address, rtu)]?.trim() ?? ''
  if (rtuNote) return rtuNote
  const year = String(replacementYear ?? '').trim()
  if (!/^\d{4}$/.test(year)) return ''
  const addresses = shareAddressesFor?.(address) ?? [address]
  for (const addr of addresses) {
    const pot = potNotes[buildingYearBudgetKey(addr, year)]?.trim()
    if (pot) return pot
  }
  return ''
}

/** Build structured presentation data shared by Excel and PDF exports. */
export function buildRcbPresentation(
  result: RcbComputeResult,
  scopeLabel: string,
  options: BuildRcbPresentationOptions = {},
): RcbPresentation {
  const pricingTable = options.pricingTable ?? DEFAULT_RCB_PRICING
  const scheduled = rcbBuildScheduledExport(
    result,
    options.replacementYearByRtu ?? {},
    pricingTable,
  )
  const include = options.includeScheduledUnit
  const items = include ? scheduled.items.filter(include) : scheduled.items
  // Any explicit unit filter means the export is a view slice — rebuild rollups from it.
  const viewIsFiltered = include != null
  const excludedBudgets = toExcludedBudgetSet(options.excludedBudgets)
  const countedBuildingYearBudgets = filterExcludedBuildingYearBudgets(
    options.buildingYearBudgets ?? {},
    excludedBudgets,
  )

  const today = options.today ?? new Date().toISOString().slice(0, 10)
  const preparedDate = options.preparedDate ?? formatPresentationDate()
  const tiers = viewIsFiltered ? rcbTierBreakdownForItems(items) : scheduled.tiers
  const perBldg = viewIsFiltered
    ? (() => {
        const map = new Map<string, RcbBuildingSummary>()
        for (const item of items) {
          let row = map.get(item.address)
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
            map.set(item.address, row)
          }
          row.units++
          row.tons += item.tons ?? 0
          row.cost += item.cost
        }
        return [...map.values()].sort((a, b) => b.cost - a.cost)
      })()
    : scheduled.perBldg
  const totalCost = Math.round(items.reduce((sum, item) => sum + item.cost, 0))
  const dueNowItems = items.filter((item) => item.replacementYear === scheduled.defaultYear)
  const flaggedItems = items.filter((item) => isRtuFlaggedForReview(item.rtu))
  const ages = items.map((item) => item.age).filter((age): age is number => age != null)
  const projection = viewIsFiltered
    ? rcbProjectionFromTierQuantities(
        result.basis,
        tiers.map((tier) => ({ tierKey: tier.tier, qty: tier.qty })),
        pricingTable,
      )
    : rcbProjection(result, pricingTable)
  const base = projection[0]
  const baseTotal = base?.total ?? 0
  const baseYear = base?.year ?? scheduled.defaultYear
  const scheduledTotal = totalCost
  const customizedCount = items.filter((item) => item.replacementYear !== scheduled.defaultYear).length
  const hasCustomSchedule = customizedCount > 0

  let phasedNote: string | null = null
  if (hasCustomSchedule && baseTotal > 0) {
    const phasedExtra = scheduledTotal - Math.round(baseTotal)
    phasedNote = `Our phased plan (mixing years per unit) totals ${formatMoney(scheduledTotal)} — only ${formatMoney(Math.abs(phasedExtra))} ${phasedExtra >= 0 ? 'above' : 'below'} a hypothetical all-${baseYear} replacement, while smoothing the annual budget.`
  }

  const rtuBudgets = options.rtuBudgets ?? {}
  const buildingYearBudgets = options.buildingYearBudgets ?? {}
  const replacementNotes = options.replacementNotesByRtu ?? {}
  const buildingYearNotes = options.buildingYearNotes ?? {}
  const units: RcbUnitExportRow[] = [...items]
    .sort(compareRcbAllUnitsExportOrder)
    .map((item) => {
      const key = rcbReplacementYearKey(item.address, item.rtu)
      const raw = rtuBudgets[key]
      const budget =
        typeof raw === 'number' && Number.isFinite(raw) ? Math.round(raw) : null
      return {
        ...item,
        budget,
        notes: resolveExportUnitNotes(
          item.address,
          item.rtu,
          item.replacementYear,
          replacementNotes,
          buildingYearNotes,
          options.shareAddressesFor,
        ),
      }
    })
  const buildings = buildBuildingRows(
    perBldg,
    totalCost,
    buildingYearBudgets,
    units,
    excludedBudgets,
    options.shareAddressesFor,
    options.budgetDedupeKeyFor,
  )
  const totalsBudget = buildings.reduce((sum, row) => {
    if (row.countsTowardBudgetTotal === false) return sum
    return sum + (row.budget > 0 ? row.budget : 0)
  }, 0)
  const portfolios = rollupByPortfolio(units).map((row) => ({
    ...row,
    share: totalCost ? row.cost / totalCost : 0,
  }))
  // Portfolio budget: sum building Capex pots for parks in that portfolio (deduped).
  for (const portfolio of portfolios) {
    portfolio.budget = buildings
      .filter((b) => b.park === portfolio.park && b.countsTowardBudgetTotal !== false)
      .reduce((sum, b) => sum + b.budget, 0)
    portfolio.variance = portfolio.budget - portfolio.cost
  }
  const budgetAnalytics = buildRcbBudgetAnalytics(totalsBudget, totalCost, buildings, units)

  return {
    scopeLabel,
    preparedDate,
    today,
    defaultYear: scheduled.defaultYear,
    threshold: result.threshold,
    hasCustomSchedule,
    basis: result.basis,
    pricing: buildPricingSection(pricingTable, result.basis),
    // Counted pots only (Remove checkboxes applied) for Equal Share / analytics.
    buildingYearBudgets: countedBuildingYearBudgets,
    totals: {
      bldgCount: perBldg.length,
      units: items.length,
      cost: totalCost,
    },
    totalsBudget,
    budgetAnalytics,
    summary: {
      totalCost,
      avgUnitCost: items.length ? Math.round(totalCost / items.length) : 0,
      dueNowCost: Math.round(dueNowItems.reduce((sum, item) => sum + item.cost, 0)),
      dueNowUnits: dueNowItems.length,
      flaggedCount: flaggedItems.length,
      flaggedSavings: Math.round(flaggedItems.reduce((sum, item) => sum + item.cost, 0)),
      avgAge: ages.length
        ? Math.round(ages.reduce((sum, age) => sum + age, 0) / ages.length)
        : null,
    },
    portfolios,
    buildings,
    waiting: {
      baseYear,
      rows: projection.map((point) => {
        const extra = point.total - baseTotal
        return {
          year: Number(point.year),
          total: Math.round(point.total),
          extra: Math.round(extra),
          pctMore: baseTotal ? extra / baseTotal : 0,
        }
      }),
      phasedNote,
    },
    unitSizes: buildUnitSizeRows(tiers),
    units,
  }
}

/** Excel currency format (CAD-style thousands). */
export const RCB_EXCEL_MONEY_FMT = '$#,##0'
/** Excel percent format. */
export const RCB_EXCEL_PCT_FMT = '0.00%'

export function presentationToDashboardRows(p: RcbPresentation): unknown[][] {
  const { summary: s, totals: T, budgetAnalytics: a } = p
  const rows: unknown[][] = [
    ['Rooftop HVAC Unit (RTU) Replacement Plan'],
    [`Capital forecast — ${p.scopeLabel}   •   Prepared ${p.preparedDate}`],
    ['TOTAL BUDGET', p.totalsBudget > 0 ? p.totalsBudget : ''],
    ['TOTAL PLANNED COST', 'UNITS TO REPLACE', '', 'AVERAGE COST / UNIT'],
    [s.totalCost, T.units, '', s.avgUnitCost],
    [],
    [`DUE NOW (${p.defaultYear})`, 'POTENTIAL SAVINGS', '', 'AVG UNIT AGE'],
    [
      s.dueNowCost,
      s.flaggedSavings > 0 ? s.flaggedSavings : '',
      '',
      s.avgAge != null ? `${s.avgAge} yrs` : '',
    ],
    [],
    ['BUDGET VS ESTIMATED COST'],
    ['Total Budget', 'Estimated Cost', 'Variance (Budget − Est.)', 'Budget Coverage'],
    [
      a.totalBudget > 0 ? a.totalBudget : '',
      a.totalCost,
      a.totalBudget > 0 ? a.variance : '',
      a.coverage != null && a.totalBudget > 0 ? a.coverage : '',
    ],
    [
      'Buildings with budget',
      a.buildingsWithBudget,
      'Over budget',
      a.buildingsOverBudget,
      'At/under budget',
      a.buildingsUnderOrEqual,
      'RTUs with budget',
      a.unitsWithBudget,
    ],
    [],
    ['WHERE THE MONEY GOES — BY PORTFOLIO'],
    ['Portfolio', 'Manager', 'Units', 'Est. Cost', 'Budget', 'Variance', 'Share'],
  ]

  for (const row of p.portfolios) {
    rows.push([
      row.park,
      row.manager,
      row.units,
      row.cost,
      row.budget > 0 ? row.budget : '',
      row.budget > 0 ? row.variance : '',
      row.share,
    ])
  }
  rows.push([
    'TOTAL',
    '',
    T.units,
    T.cost,
    a.totalBudget > 0 ? a.totalBudget : '',
    a.totalBudget > 0 ? a.variance : '',
    T.cost ? 1 : '',
  ])

  return rows
}

export function presentationToPricingRows(p: RcbPresentation): unknown[][] {
  const { pricing } = p
  const rows: unknown[][] = [
    ['RTU Pricing by Tonnage'],
    [`Pricing basis: ${pricing.basisLabel}`],
    [],
    ['Unit Size', ...pricing.years.map((year) => year)],
  ]

  for (const row of pricing.rows) {
    rows.push([
      row.label,
      ...pricing.years.map((year) => row.costsByYear[year] ?? 0),
    ])
  }

  return rows
}

export function presentationToByBuildingRows(p: RcbPresentation): unknown[][] {
  const yearTotals: Record<string, number> = {}
  for (const year of RCB_BUDGET_YEAR_COLUMNS) yearTotals[year] = 0

  const rows: unknown[][] = [
    [
      'Cost by Building — Budget Total is Capex HVAC money (Remove in Cost Center excludes that year from totals; cell shows Removed)',
    ],
    [
      'Building',
      'Portfolio',
      'Cluster',
      'Manager',
      'Units',
      'Cost',
      'Budget Total',
      'Budget Years',
      'Removed',
      ...RCB_BUDGET_YEAR_COLUMNS.map((year) => `Budget ${year}`),
    ],
  ]

  for (const row of p.buildings) {
    const removed = new Set(row.removedBudgetYears)
    if (row.countsTowardBudgetTotal !== false) {
      for (const year of RCB_BUDGET_YEAR_COLUMNS) {
        yearTotals[year] = (yearTotals[year] ?? 0) + (row.budgetByYear[year] ?? 0)
      }
    }
    rows.push([
      row.address,
      row.park,
      row.cluster || '',
      row.manager,
      row.units,
      row.cost,
      row.budget > 0 ? row.budget : '',
      row.budgetYears || '',
      row.removedBudgetYears.join(' · ') || '',
      ...RCB_BUDGET_YEAR_COLUMNS.map((year) => {
        if (removed.has(year)) return 'Removed'
        const amount = row.budgetByYear[year] ?? 0
        return amount > 0 ? amount : ''
      }),
    ])
  }
  rows.push([
    'TOTAL',
    '',
    '',
    '',
    p.totals.units,
    p.totals.cost,
    p.totalsBudget > 0 ? p.totalsBudget : '',
    '',
    '',
    ...RCB_BUDGET_YEAR_COLUMNS.map((year) => {
      const amount = yearTotals[year] ?? 0
      return amount > 0 ? amount : ''
    }),
  ])

  return rows
}

export function presentationToCostOfWaitingRows(p: RcbPresentation): unknown[][] {
  const rows: unknown[][] = [
    ['The Cost of Waiting'],
    [
      'If replaced in…',
      'Total Cost',
      `Extra vs. ${p.waiting.baseYear}`,
      '% More Expensive',
    ],
  ]

  for (const row of p.waiting.rows) {
    rows.push([row.year, row.total, row.extra, row.pctMore])
  }

  return rows
}

export function presentationToByUnitSizeRows(p: RcbPresentation): unknown[][] {
  const rows: unknown[][] = [
    ['Cost by Unit Size'],
    ['Unit Size', 'Avg Cost / Unit', 'Quantity', 'Total Cost'],
  ]

  for (const row of p.unitSizes) {
    rows.push([row.label, row.avgCost, row.qty, row.total])
  }
  rows.push([
    'TOTAL',
    p.totals.units ? p.summary.avgUnitCost : '',
    p.totals.units,
    p.totals.cost,
  ])

  return rows
}

/**
 * Required All Units headers for import (extra export-only columns are allowed).
 * Keep in sync with parseRcbAllUnitsSheet name lookups.
 */
/** All Units year column — also accept legacy / typo aliases on import. */
export const RCB_ELIGIBLE_YEAR_HEADER = 'Eligible/Assigned Replacement Year'
export const RCB_ELIGIBLE_YEAR_HEADER_ALIASES = [
  RCB_ELIGIBLE_YEAR_HEADER,
  'Eligible Replacement Year',
  'Eligible/Asigned Replacement Year',
] as const

/** All Units estimated-cost column — also accept legacy export header on import. */
export const RCB_ESTIMATED_COST_HEADER = 'Estimated Cost'
export const RCB_ESTIMATED_COST_HEADER_ALIASES = [
  RCB_ESTIMATED_COST_HEADER,
  'Cost (CAD)',
] as const

/** All Units age column — also accept legacy export header on import. */
export const RCB_AGE_ON_REPL_YEAR_HEADER = 'Age on Repl. Year'
export const RCB_AGE_ON_REPL_YEAR_HEADER_ALIASES = [
  RCB_AGE_ON_REPL_YEAR_HEADER,
  'Age (yr)',
] as const

/** All Units RTU allocation column — also accept legacy export header on import. */
export const RCB_RTU_ALLOCATION_HEADER = 'RTU $ Allocation'
export const RCB_RTU_ALLOCATION_HEADER_ALIASES = [
  RCB_RTU_ALLOCATION_HEADER,
  'Budget (CAD)',
] as const

/** Full All Units export / required import header row. */
export const RCB_ALL_UNITS_EXPORT_HEADERS = [
  'Building',
  'Portfolio',
  'Manager',
  'Unit',
  'Make',
  'Model',
  'Serial',
  'Installed',
  RCB_AGE_ON_REPL_YEAR_HEADER,
  'Tons',
  RCB_ELIGIBLE_YEAR_HEADER,
  RCB_ESTIMATED_COST_HEADER,
  RCB_RTU_ALLOCATION_HEADER,
  'Notes',
] as const

/** Required All Units headers for import (aliases normalized before assert). */
export const RCB_ALL_UNITS_HEADERS = RCB_ALL_UNITS_EXPORT_HEADERS

export function presentationToAllUnitsRows(p: RcbPresentation): unknown[][] {
  const rows: unknown[][] = [
    [
      'All Units — RTU $ Allocation is the amount entered per unit in Cost Center. Notes = RTU note, or Capex pot note for that building year when the RTU has none.',
    ],
    [...RCB_ALL_UNITS_EXPORT_HEADERS],
  ]

  for (const item of p.units) {
    rows.push([
      item.address,
      item.park,
      item.manager,
      item.rtu,
      item.make || '',
      item.model || '',
      item.serial || '',
      item.year ?? '',
      item.age ?? '',
      item.tons ?? '',
      item.replacementYear,
      Math.round(item.cost),
      item.budget != null && item.budget > 0 ? item.budget : '',
      item.notes,
    ])
  }

  return rows
}
