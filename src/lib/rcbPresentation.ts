import {
  rcbBuildScheduledExport,
  rcbProjection,
  type RcbBuildingSummary,
  type RcbComputeResult,
  type RcbScheduledLineItem,
  type RcbTierAggregate,
} from '@/lib/costEstimator'
import type { RcbPricingTable } from '@/lib/costEstimator.pricing'
import { DEFAULT_RCB_PRICING } from '@/lib/costEstimator.pricing'

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

export function rcbExportFilenameBase(scopeLabel: string, defaultYear: string, today: string): string {
  const safe = (scopeLabel === 'All buildings' ? 'All' : scopeLabel)
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40)
  return `RTU_Replacement_Estimate_${safe}_${defaultYear}_Presentation_${today}`
}

export interface RcbPortfolioRow {
  park: string
  manager: string
  units: number
  cost: number
  share: number
}

export interface RcbBuildingRow {
  address: string
  park: string
  manager: string
  units: number
  cost: number
  share: number
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

export interface RcbPresentation {
  scopeLabel: string
  preparedDate: string
  today: string
  defaultYear: string
  threshold: number
  hasCustomSchedule: boolean
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
  units: RcbScheduledLineItem[]
}

function rollupByPortfolio(items: RcbScheduledLineItem[]): RcbPortfolioRow[] {
  const map = new Map<string, RcbPortfolioRow>()
  for (const item of items) {
    const key = item.park || '—'
    let row = map.get(key)
    if (!row) {
      row = { park: key, manager: item.manager, units: 0, cost: 0, share: 0 }
      map.set(key, row)
    }
    row.units++
    row.cost += item.cost
  }
  return [...map.values()].sort((a, b) => b.cost - a.cost)
}

function buildBuildingRows(
  perBldg: RcbBuildingSummary[],
  totalCost: number,
): RcbBuildingRow[] {
  return perBldg.map((row) => {
    const share = totalCost ? row.cost / totalCost : 0
    return {
      address: row.address,
      park: row.park,
      manager: row.manager,
      units: row.units,
      cost: Math.round(row.cost),
      share,
    }
  })
}

function buildUnitSizeRows(tiers: RcbTierAggregate[]): RcbUnitSizeRow[] {
  return [...tiers]
    .sort((a, b) => b.ext - a.ext)
    .map((tier) => ({
      label: tier.label,
      avgCost: Math.round(tier.unit),
      qty: tier.qty,
      total: Math.round(tier.ext),
    }))
}

/** Build structured presentation data shared by Excel and PDF exports. */
export function buildRcbPresentation(
  result: RcbComputeResult,
  scopeLabel: string,
  options: {
    replacementYearByRtu?: Record<string, string>
    pricingTable?: RcbPricingTable
    preparedDate?: string
    today?: string
  } = {},
): RcbPresentation {
  const pricingTable = options.pricingTable ?? DEFAULT_RCB_PRICING
  const scheduled = rcbBuildScheduledExport(
    result,
    options.replacementYearByRtu ?? {},
    pricingTable,
  )
  const today = options.today ?? new Date().toISOString().slice(0, 10)
  const preparedDate = options.preparedDate ?? formatPresentationDate()
  const totalCost = Math.round(scheduled.totals.cost)
  const dueNowItems = scheduled.items.filter((item) => item.replacementYear === scheduled.defaultYear)
  const flaggedItems = scheduled.items.filter((item) => isRtuFlaggedForReview(item.rtu))
  const ages = scheduled.items.map((item) => item.age).filter((age): age is number => age != null)
  const projection = rcbProjection(result, pricingTable)
  const base = projection[0]
  const baseTotal = base?.total ?? 0
  const baseYear = base?.year ?? scheduled.defaultYear
  const scheduledTotal = Math.round(scheduled.totals.cost)
  const hasCustomSchedule = scheduled.customizedCount > 0

  let phasedNote: string | null = null
  if (hasCustomSchedule && baseTotal > 0) {
    const phasedExtra = scheduledTotal - Math.round(baseTotal)
    phasedNote = `Our phased plan (mixing years per unit) totals ${formatMoney(scheduledTotal)} — only ${formatMoney(Math.abs(phasedExtra))} ${phasedExtra >= 0 ? 'above' : 'below'} a hypothetical all-${baseYear} replacement, while smoothing the annual budget.`
  }

  const portfolios = rollupByPortfolio(scheduled.items).map((row) => ({
    ...row,
    cost: Math.round(row.cost),
    share: totalCost ? row.cost / totalCost : 0,
  }))

  return {
    scopeLabel,
    preparedDate,
    today,
    defaultYear: scheduled.defaultYear,
    threshold: result.threshold,
    hasCustomSchedule,
    totals: {
      bldgCount: scheduled.totals.bldgCount,
      units: scheduled.totals.units,
      cost: totalCost,
    },
    summary: {
      totalCost,
      avgUnitCost: scheduled.totals.units
        ? Math.round(scheduled.totals.cost / scheduled.totals.units)
        : 0,
      dueNowCost: Math.round(dueNowItems.reduce((sum, item) => sum + item.cost, 0)),
      dueNowUnits: dueNowItems.length,
      flaggedCount: flaggedItems.length,
      flaggedSavings: Math.round(flaggedItems.reduce((sum, item) => sum + item.cost, 0)),
      avgAge: ages.length
        ? Math.round(ages.reduce((sum, age) => sum + age, 0) / ages.length)
        : null,
    },
    portfolios,
    buildings: buildBuildingRows(scheduled.perBldg, totalCost),
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
    unitSizes: buildUnitSizeRows(scheduled.tiers),
    units: [...scheduled.items].sort((a, b) =>
      a.address < b.address ? -1 : a.address > b.address ? 1 : a.rtu.localeCompare(b.rtu),
    ),
  }
}

export function presentationToDashboardRows(p: RcbPresentation): unknown[][] {
  const { summary: s, totals: T } = p
  const rows: unknown[][] = [
    ['Rooftop HVAC Unit (RTU) Replacement Plan'],
    [`Capital forecast — ${p.scopeLabel}   •   Prepared ${p.preparedDate}`],
    [],
    ['TOTAL PLANNED COST', '', 'UNITS TO REPLACE', '', 'AVERAGE COST / UNIT'],
    [formatMoney(s.totalCost), '', T.units, '', formatMoney(s.avgUnitCost)],
    [],
    [`DUE NOW (${p.defaultYear})`, '', 'POTENTIAL SAVINGS', '', 'AVG UNIT AGE'],
    [
      formatMoney(s.dueNowCost),
      '',
      s.flaggedSavings > 0 ? formatMoney(s.flaggedSavings) : '',
      '',
      s.avgAge != null ? `${s.avgAge} yrs` : '',
    ],
    [],
    ['WHERE THE MONEY GOES — BY PORTFOLIO'],
    ['Portfolio', 'Manager', 'Units', 'Cost (CAD)', 'Share'],
  ]

  for (const row of p.portfolios) {
    rows.push([row.park, row.manager, row.units, formatMoney(row.cost), formatPercent(row.share)])
  }
  rows.push(['TOTAL', '', T.units, formatMoney(T.cost), T.cost ? formatPercent(1) : ''])

  return rows
}

export function presentationToByBuildingRows(p: RcbPresentation): unknown[][] {
  const rows: unknown[][] = [
    ['Cost by Building'],
    ['Building', 'Portfolio', 'Manager', 'Units', 'Cost (CAD)'],
  ]

  for (const row of p.buildings) {
    rows.push([row.address, row.park, row.manager, row.units, formatMoney(row.cost)])
  }
  rows.push(['TOTAL', '', '', p.totals.units, formatMoney(p.totals.cost)])

  return rows
}

export function presentationToCostOfWaitingRows(p: RcbPresentation): unknown[][] {
  const rows: unknown[][] = [
    ['The Cost of Waiting'],
    [
      'If replaced in…',
      'Total Cost (CAD)',
      `Extra vs. ${p.waiting.baseYear}`,
      '% More Expensive',
    ],
  ]

  for (const row of p.waiting.rows) {
    rows.push([row.year, formatMoney(row.total), formatMoney(row.extra), formatPercent(row.pctMore)])
  }

  return rows
}

export function presentationToByUnitSizeRows(p: RcbPresentation): unknown[][] {
  const rows: unknown[][] = [
    ['Cost by Unit Size'],
    ['Unit Size', 'Avg Cost / Unit (CAD)', 'Quantity', 'Total Cost (CAD)'],
  ]

  for (const row of p.unitSizes) {
    rows.push([row.label, formatMoney(row.avgCost), row.qty, formatMoney(row.total)])
  }
  rows.push(['TOTAL', '', p.totals.units, formatMoney(p.totals.cost)])

  return rows
}

export function presentationToAllUnitsRows(p: RcbPresentation): unknown[][] {
  const rows: unknown[][] = [
    ['All Units — Full Detail'],
    [
      'Building',
      'Portfolio',
      'Manager',
      'Unit',
      'Make',
      'Model',
      'Serial',
      'Installed',
      'Age (yr)',
      'Tons',
      'Replace Yr',
      'Cost (CAD)',
    ],
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
      formatMoney(item.cost),
    ])
  }

  return rows
}
