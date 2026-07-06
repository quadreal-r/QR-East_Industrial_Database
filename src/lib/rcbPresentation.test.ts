import { describe, expect, it } from 'vitest'
import legacyBuildings from '../../supabase/data/buildings.json'
import { rcbCompute } from '@/lib/costEstimator'
import {
  buildRcbPresentation,
  formatCompactMoney,
  formatMoney,
  formatPercent,
  isRtuFlaggedForReview,
  presentationToByBuildingRows,
  presentationToDashboardRows,
  presentationToPricingRows,
  rcbShareBar,
} from '@/lib/rcbPresentation'
import { normalizeLegacyBuilding, type LegacyBuildingJson } from '@/types/domain'

const buildings = (legacyBuildings as LegacyBuildingJson[]).map(normalizeLegacyBuilding)

describe('isRtuFlaggedForReview', () => {
  it('flags redundant, disconnected, and do-not-replace RTU names', () => {
    expect(isRtuFlaggedForReview('RTU-02 REDUNDANT. DO NOT REPLACE')).toBe(true)
    expect(isRtuFlaggedForReview('RTU- 12 (Disconnected)')).toBe(true)
    expect(isRtuFlaggedForReview('RTU-04 Redundant')).toBe(true)
    expect(isRtuFlaggedForReview('RTU-01')).toBe(false)
  })
})

describe('formatMoney', () => {
  it('formats with dollar sign and thousands separators', () => {
    expect(formatMoney(5_877_658)).toBe('$5,877,658')
    expect(formatMoney(47_021)).toBe('$47,021')
    expect(formatMoney(0)).toBe('$0')
  })
})

describe('formatPercent', () => {
  it('formats with two decimal places', () => {
    expect(formatPercent(0.384)).toBe('38.40%')
    expect(formatPercent(0.050001840609444015)).toBe('5.00%')
    expect(formatPercent(1)).toBe('100.00%')
  })
})

describe('formatCompactMoney', () => {
  it('formats millions, thousands, and smaller amounts', () => {
    expect(formatCompactMoney(5_877_658)).toBe('$5.88M')
    expect(formatCompactMoney(315_209)).toBe('$315K')
    expect(formatCompactMoney(999)).toBe('$999')
  })
})

describe('rcbShareBar', () => {
  it('renders proportional block bars', () => {
    expect(rcbShareBar(0)).toBe('')
    expect(rcbShareBar(0.5).length).toBe(10)
    expect(rcbShareBar(1).length).toBe(20)
  })
})

describe('buildRcbPresentation', () => {
  it('builds dashboard rows with portfolio totals', () => {
    const subset = buildings.filter((b) => b.address === '1850 Derry Road East')
    const result = rcbCompute(subset, {
      basis: 'hyb',
      year: '2026',
      threshold: 10,
      currentYear: 2026,
    })
    const presentation = buildRcbPresentation(result, 'Test scope', {
      today: '2026-07-06',
      preparedDate: 'July 6, 2026',
    })
    const rows = presentationToDashboardRows(presentation)

    expect(rows[0]?.[0]).toBe('Rooftop HVAC Unit (RTU) Replacement Plan')
    expect(rows[3]?.[0]).toBe('TOTAL PLANNED COST')
    expect(rows.some((row) => String(row[0] ?? '').includes('This plan covers'))).toBe(false)
    expect(rows.some((row) => String(row[0] ?? '').includes('Scheduled replacement cost'))).toBe(
      false,
    )
    expect(presentationToByBuildingRows(presentation)[1]).toEqual([
      'Building',
      'Portfolio',
      'Manager',
      'Units',
      'Cost (CAD)',
    ])
    const pricingRows = presentationToPricingRows(presentation)
    expect(pricingRows[0]?.[0]).toBe('RTU Pricing by Tonnage')
    expect(pricingRows[3]?.[0]).toBe('Unit Size')
    expect(pricingRows[3]?.length).toBeGreaterThan(1)
    expect(String(pricingRows[4]?.[1] ?? '')).toMatch(/^\$[\d,]+$/)
    expect(presentation.pricing.rows.length).toBeGreaterThan(0)
    expect(presentation.totals.units).toBeGreaterThan(0)
    expect(presentation.buildings.length).toBeGreaterThan(0)
    expect(presentation.unitSizes.length).toBeGreaterThan(0)
  })
})
