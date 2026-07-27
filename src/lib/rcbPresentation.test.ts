import { describe, expect, it } from 'vitest'
import legacyBuildings from '../../supabase/data/buildings.json'
import { rcbCompute } from '@/lib/costEstimator'
import {
  buildRcbPresentation,
  compareRcbAllUnitsExportOrder,
  formatCompactMoney,
  formatMoney,
  formatPercent,
  isRtuFlaggedForReview,
  presentationToAllUnitsRows,
  presentationToByBuildingRows,
  presentationToDashboardRows,
  presentationToPricingRows,
  rcbExportFilenameBase,
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
    const byBuildingHeader = presentationToByBuildingRows(presentation)[1]
    expect(byBuildingHeader?.slice(0, 9)).toEqual([
      'Building',
      'Portfolio',
      'Cluster',
      'Manager',
      'Units',
      'Cost',
      'Budget Total',
      'Budget Years',
      'Removed',
    ])
    expect(byBuildingHeader).toContain('Budget 2026')
    expect(byBuildingHeader).toContain('Budget 2029')
    expect(byBuildingHeader?.every((h) => !String(h).includes('(CAD)'))).toBe(true)
    const pricingRows = presentationToPricingRows(presentation)
    expect(pricingRows[0]?.[0]).toBe('RTU Pricing by Tonnage')
    expect(pricingRows[3]?.[0]).toBe('Unit Size')
    expect(pricingRows[3]?.length).toBeGreaterThan(1)
    expect(typeof pricingRows[4]?.[1]).toBe('number')
    expect(Number(pricingRows[4]?.[1])).toBeGreaterThan(0)
    expect(presentation.pricing.rows.length).toBeGreaterThan(0)
    expect(presentation.totals.units).toBeGreaterThan(0)
    expect(presentation.buildings.length).toBeGreaterThan(0)
    expect(presentation.unitSizes.length).toBeGreaterThan(0)
  })

  it('keeps only the RTUs currently in view when a unit filter is provided', () => {
    const subset = buildings.filter((b) => b.address === '1850 Derry Road East')
    const result = rcbCompute(subset, {
      basis: 'hyb',
      year: '2026',
      threshold: 10,
      currentYear: 2026,
    })
    const keep = result.lineItems.slice(0, 1)
    expect(keep.length).toBe(1)
    const presentation = buildRcbPresentation(result, keep[0]!.address, {
      includeScheduledUnit: (item) =>
        item.address === keep[0]!.address && item.rtu === keep[0]!.rtu,
    })
    expect(presentation.units).toHaveLength(1)
    expect(presentation.units[0]?.rtu).toBe(keep[0]!.rtu)
    expect(presentation.totals.units).toBe(1)
    expect(presentation.buildings).toHaveLength(1)
  })

  it('scopes By Building / unit-size rollups to an address filter (current Cost Center view)', () => {
    const subset = buildings.slice(0, 40)
    const result = rcbCompute(subset, {
      basis: 'hyb',
      year: '2026',
      threshold: 10,
      currentYear: 2026,
    })
    expect(result.perBldg.length).toBeGreaterThan(1)
    const keepAddress = result.perBldg[0]!.address
    const presentation = buildRcbPresentation(result, keepAddress, {
      includeScheduledUnit: (item) => item.address === keepAddress,
    })
    expect(presentation.buildings.every((row) => row.address === keepAddress)).toBe(true)
    expect(presentation.units.every((unit) => unit.address === keepAddress)).toBe(true)
    expect(presentation.totals.units).toBe(
      result.lineItems.filter((item) => item.address === keepAddress).length,
    )
    expect(presentation.unitSizes.reduce((sum, row) => sum + row.qty, 0)).toBe(
      presentation.totals.units,
    )
  })

  it('scopes export to RTUs scheduled for a specific Repl. year', () => {
    const subset = buildings.filter((b) => b.address === '1850 Derry Road East')
    const result = rcbCompute(subset, {
      basis: 'hyb',
      year: '2026',
      threshold: 10,
      currentYear: 2026,
    })
    expect(result.lineItems.length).toBeGreaterThan(1)
    const first = result.lineItems[0]!
    const second = result.lineItems[1]!
    const key1 = `${first.address}::${first.rtu}`
    const key2 = `${second.address}::${second.rtu}`
    const presentation = buildRcbPresentation(result, 'FY 2027 view', {
      replacementYearByRtu: { [key1]: '2027', [key2]: '2028' },
      includeScheduledUnit: (item) => item.replacementYear === '2027',
    })
    expect(presentation.units.length).toBe(1)
    expect(presentation.units[0]?.rtu).toBe(first.rtu)
    expect(presentation.units[0]?.replacementYear).toBe('2027')
    expect(presentation.totals.units).toBe(1)
  })

  it('export building count matches the filtered on-screen set (not the full portfolio)', () => {
    const subset = buildings.slice(0, 40)
    const result = rcbCompute(subset, {
      basis: 'hyb',
      year: '2026',
      threshold: 10,
      currentYear: 2026,
    })
    expect(result.perBldg.length).toBeGreaterThan(2)
    const keep = new Set(result.perBldg.slice(0, 2).map((row) => row.address))
    const presentation = buildRcbPresentation(result, 'On-screen buildings', {
      includeScheduledUnit: (item) => keep.has(item.address),
      buildingYearBudgets: {
        [`${[...keep][0]}::2027`]: 50_000,
        [`${result.perBldg[5]?.address}::2027`]: 999_000,
      },
    })
    expect(presentation.buildings).toHaveLength(2)
    expect(presentation.buildings.every((row) => keep.has(row.address))).toBe(true)
    expect(presentation.totals.bldgCount).toBe(2)
    // Capex pot for a building not on screen must not inflate totals.
    expect(presentation.totalsBudget).toBe(50_000)
  })

  it('attaches RTU budgets to units; falls back to RTU rollup when no Capex pots', () => {
    const subset = buildings.filter((b) => b.address === '1850 Derry Road East')
    const result = rcbCompute(subset, {
      basis: 'hyb',
      year: '2026',
      threshold: 10,
      currentYear: 2026,
    })
    const first = result.lineItems[0]
    expect(first).toBeTruthy()
    const key = `${first!.address}::${first!.rtu}`
    const presentation = buildRcbPresentation(result, first!.address, {
      rtuBudgets: { [key]: 12_500 },
      replacementYearByRtu: { [key]: '2029' },
    })
    expect(presentation.units.find((u) => u.rtu === first!.rtu)?.budget).toBe(12_500)
    expect(presentation.buildings[0]?.budget).toBeGreaterThanOrEqual(12_500)
    expect(presentation.buildings[0]?.budgetByYear['2029']).toBe(12_500)
    expect(presentation.buildings[0]?.budgetYears).toContain('2029')
    expect(presentation.totalsBudget).toBeGreaterThanOrEqual(12_500)
    expect(presentation.budgetAnalytics.totalBudget).toBeGreaterThanOrEqual(12_500)
    expect(presentation.budgetAnalytics.variance).toBe(
      presentation.budgetAnalytics.totalBudget - presentation.budgetAnalytics.totalCost,
    )
    expect(presentation.portfolios.some((row) => row.budget >= 12_500)).toBe(true)
    const dash = presentationToDashboardRows(presentation)
    expect(dash[2]?.[0]).toBe('TOTAL BUDGET')
    expect(dash[2]?.[1]).toBe(12_500)
    expect(dash.some((row) => row[0] === 'BUDGET VS ESTIMATED COST')).toBe(true)
    expect(
      dash.some((row) => Array.isArray(row) && row.includes('Est. Cost')),
    ).toBe(true)
    const byBuilding = presentationToByBuildingRows(presentation)
    const header = byBuilding[1] as string[]
    expect(header).toContain('Cluster')
    expect(header).toContain('Removed')
    const yearCol = header.indexOf('Budget 2029')
    expect(yearCol).toBeGreaterThan(0)
    const dataRow = byBuilding.find((row) => row[0] === first!.address)
    expect(dataRow?.[yearCol]).toBe(12_500)
  })

  it('excludes Removed Capex pots from budget totals and marks year cells', () => {
    const subset = buildings.filter((b) => b.address === '1850 Derry Road East')
    const result = rcbCompute(subset, {
      basis: 'hyb',
      year: '2026',
      threshold: 10,
      currentYear: 2026,
    })
    const first = result.lineItems[0]
    expect(first).toBeTruthy()
    const potKey = `${first!.address}::2029`
    const presentation = buildRcbPresentation(result, first!.address, {
      buildingYearBudgets: { [potKey]: 50_000 },
      excludedBudgets: [potKey],
      replacementYearByRtu: {
        [`${first!.address}::${first!.rtu}`]: '2029',
      },
    })
    expect(presentation.buildings[0]?.budget).toBe(0)
    expect(presentation.buildings[0]?.removedBudgetYears).toEqual(['2029'])
    expect(presentation.totalsBudget).toBe(0)
    const byBuilding = presentationToByBuildingRows(presentation)
    const header = byBuilding[1] as string[]
    const yearCol = header.indexOf('Budget 2029')
    const dataRow = byBuilding.find((row) => row[0] === first!.address)
    expect(dataRow?.[yearCol]).toBe('Removed')
    const allUnits = presentationToAllUnitsRows(presentation)
    const unitHeader = allUnits[1] as string[]
    expect(unitHeader).not.toContain('Capex Status')
    expect(unitHeader).not.toContain('Type')
  })

  it('prefers Capex building-year pots over RTU allocations for building budget', () => {
    const subset = buildings.filter((b) => b.address === '1850 Derry Road East')
    const result = rcbCompute(subset, {
      basis: 'hyb',
      year: '2026',
      threshold: 10,
      currentYear: 2026,
    })
    const first = result.lineItems[0]
    expect(first).toBeTruthy()
    const key = `${first!.address}::${first!.rtu}`
    const potKey = `${first!.address}::2029`
    const presentation = buildRcbPresentation(result, first!.address, {
      rtuBudgets: { [key]: 12_500 },
      buildingYearBudgets: { [potKey]: 50_000 },
      replacementYearByRtu: { [key]: '2029' },
    })
    expect(presentation.units.find((u) => u.rtu === first!.rtu)?.budget).toBe(12_500)
    expect(presentation.buildings[0]?.budget).toBe(50_000)
    expect(presentation.buildings[0]?.budgetByYear['2029']).toBe(50_000)
    expect(presentation.totalsBudget).toBe(50_000)
    const allUnits = presentationToAllUnitsRows(presentation)
    const unitRow = allUnits.find((row) => row[3] === first!.rtu)
    const header = allUnits[1] as string[]
    const allocCol = header.indexOf('RTU $ Allocation')
    expect(allocCol).toBeGreaterThan(0)
    expect(unitRow?.[allocCol]).toBe(12_500)
    expect(header).not.toContain('Equal Budget Share (CAD)')
  })

  it('adds every replacement note to its RTU export row', () => {
    const subset = buildings.filter((b) => b.address === '1850 Derry Road East')
    const result = rcbCompute(subset, {
      basis: 'hyb',
      year: '2026',
      threshold: 10,
      currentYear: 2026,
    })
    const first = result.lineItems[0]
    expect(first).toBeTruthy()
    const key = `${first!.address}::${first!.rtu}`
    const presentation = buildRcbPresentation(result, first!.address, {
      replacementNotesByRtu: { [key]: 'Replace curb adapter and disconnect.' },
    })
    const rows = presentationToAllUnitsRows(presentation)

    expect(rows[1]?.[10]).toBe('Eligible/Assigned Replacement Year')
    expect(rows[1]).toContain('Notes')
    expect(rows[1]?.at(-1)).toBe('Notes')
    const notesCol = (rows[1] as string[]).indexOf('Notes')
    const unitRow = rows.find((row) => row[3] === first!.rtu)
    expect(unitRow?.[notesCol]).toBe('Replace curb adapter and disconnect.')
  })

  it('falls back to Capex building-year notes when RTU has no own note', () => {
    const subset = buildings.filter((b) => b.address === '1850 Derry Road East')
    const result = rcbCompute(subset, {
      basis: 'hyb',
      year: '2026',
      threshold: 10,
      currentYear: 2026,
    })
    const first = result.lineItems[0]
    expect(first).toBeTruthy()
    const key = `${first!.address}::${first!.rtu}`
    const potKey = `${first!.address}::2027`
    const presentation = buildRcbPresentation(result, first!.address, {
      replacementYearByRtu: { [key]: '2027' },
      buildingYearNotes: { [potKey]: '(From CAPEX) HVAC RTU Repl' },
    })
    const unit = presentation.units.find((row) => row.rtu === first!.rtu)
    expect(unit?.notes).toBe('(From CAPEX) HVAC RTU Repl')
    const rows = presentationToAllUnitsRows(presentation)
    const notesCol = (rows[1] as string[]).indexOf('Notes')
    const unitRow = rows.find((row) => row[3] === first!.rtu)
    expect(unitRow?.[notesCol]).toBe('(From CAPEX) HVAC RTU Repl')
  })

  it('sorts All Units by manager, then address, then RTU number 1–10', () => {
    expect(
      compareRcbAllUnitsExportOrder(
        { manager: 'Maia', address: 'B St', rtu: 'RTU-10' },
        { manager: 'Evelyn', address: 'A St', rtu: 'RTU-1' },
      ),
    ).toBeGreaterThan(0)
    expect(
      compareRcbAllUnitsExportOrder(
        { manager: 'Evelyn', address: 'B St', rtu: 'RTU-1' },
        { manager: 'Evelyn', address: 'A St', rtu: 'RTU-10' },
      ),
    ).toBeGreaterThan(0)
    expect(
      compareRcbAllUnitsExportOrder(
        { manager: 'Evelyn', address: 'A St', rtu: 'RTU-2' },
        { manager: 'Evelyn', address: 'A St', rtu: 'RTU-10' },
      ),
    ).toBeLessThan(0)

    const subset = buildings.slice(0, 80)
    const result = rcbCompute(subset, {
      basis: 'hyb',
      year: '2026',
      threshold: 10,
      currentYear: 2026,
    })
    expect(result.lineItems.length).toBeGreaterThan(3)
    const presentation = buildRcbPresentation(result, 'Sort check')
    for (let i = 1; i < presentation.units.length; i++) {
      expect(
        compareRcbAllUnitsExportOrder(presentation.units[i - 1]!, presentation.units[i]!),
      ).toBeLessThanOrEqual(0)
    }
  })
})

describe('rcbExportFilenameBase', () => {
  it('builds a short content-based workbook name', () => {
    expect(rcbExportFilenameBase('All buildings', '2026')).toBe(
      'QR_RTU_Replacement_Cost_Center_All_2026',
    )
    expect(rcbExportFilenameBase('1850 Derry Road East', 'FY2027')).toBe(
      'QR_RTU_Replacement_Cost_Center_1850_Derry_Road_East_FY2027',
    )
    expect(rcbExportFilenameBase('Airport East · Mgr: Pat', '2026').length).toBeLessThan(60)
  })
})
