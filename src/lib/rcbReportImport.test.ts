import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { rcbCompute, rcbReplacementYearKey } from '@/lib/costEstimator'
import { detectExcelWorkbookKind } from '@/lib/excelWorkbookType'
import {
  buildRcbPresentation,
  presentationToAllUnitsRows,
  RCB_ALL_UNITS_HEADERS,
} from '@/lib/rcbPresentation'
import { DEFAULT_RTU_PRICING_ROWS } from '@/lib/rtuPricing.defaults'
import { computeRtuAllInFromComponents } from '@/lib/rtuPricingSheet'
import {
  applyRcbAllUnitsRows,
  importRcbReportWorkbook,
  mergeRcbReportPricingIntoRows,
  parseRcbAllUnitsSheet,
  parseRcbReportPricingSheet,
} from '@/lib/rcbReportImport'
import { normalizeLegacyBuilding, type LegacyBuildingJson } from '@/types/domain'
import legacyBuildings from '../../supabase/data/buildings.json'

const buildings = (legacyBuildings as LegacyBuildingJson[]).map(normalizeLegacyBuilding)

function workbookToBuffer(sheets: Record<string, unknown[][]>): ArrayBuffer {
  const wb = XLSX.utils.book_new()
  for (const [name, rows] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name)
  }
  const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer | Uint8Array | number[]
  if (out instanceof ArrayBuffer) return out
  const bytes = out instanceof Uint8Array ? out : Uint8Array.from(out)
  return bytes.slice().buffer as ArrayBuffer
}

describe('rcbReportImport', () => {
  it('parses All Units replace year, budget, and notes', () => {
    const leek = buildings.find((b) => b.address.includes('Leek'))!
    const buffer = workbookToBuffer({
      'All Units': [
        ['All Units — Full Detail'],
        [...RCB_ALL_UNITS_HEADERS],
        [
          leek.address,
          'East Business Park',
          'Mgr',
          'RTU- 02',
          'ICP',
          'M',
          'S',
          1994,
          32,
          7.5,
          2028,
          50000,
          12000,
          'Bring forward',
        ],
      ],
    })

    const rows = parseRcbAllUnitsSheet(buffer)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.replacementYear).toBe('2028')
    expect(rows[0]?.budget).toBe(12000)
    expect(rows[0]?.notes).toBe('Bring forward')

    const applied = applyRcbAllUnitsRows(rows, buildings)
    const key = rcbReplacementYearKey(leek.address, 'RTU- 02')
    expect(applied.replacementYears[key]).toBe('2028')
    expect(applied.notes[key]).toBe('Bring forward')
    expect(applied.budgets[key]).toBe(12000)
    expect(applied.stats.matchedYears).toBe(1)
  })

  it('leaves unmatched RTUs alone and does not invent years for empty cells', () => {
    const leek = buildings.find((b) => b.address.includes('Leek'))!
    const applied = applyRcbAllUnitsRows(
      [
        {
          building: leek.address,
          unit: 'RTU- 02',
          replacementYear: null,
          budget: null,
          notes: '',
          hasBudgetCell: false,
          hasNotesCell: true,
          hasYearCell: false,
        },
        {
          building: 'No Such Building 999',
          unit: 'RTU- 01',
          replacementYear: '2029',
          budget: 1,
          notes: 'x',
          hasBudgetCell: true,
          hasNotesCell: true,
          hasYearCell: true,
        },
      ],
      buildings,
    )

    expect(Object.keys(applied.replacementYears)).toHaveLength(0)
    expect(applied.stats.unmatchedBuilding).toBe(1)
    const key = rcbReplacementYearKey(leek.address, 'RTU- 02')
    expect(applied.notes[key]).toBeNull()
  })

  it('merges report pricing into Cost DB by adjusting hybrid supply only', () => {
    const base = DEFAULT_RTU_PRICING_ROWS.find((r) => r.tonnageKey === 5)!
    const targetAllIn = computeRtuAllInFromComponents(base, 'hyb') + 1000
    const untouched = DEFAULT_RTU_PRICING_ROWS.find((r) => r.tonnageKey === 10)!

    const merged = mergeRcbReportPricingIntoRows(
      DEFAULT_RTU_PRICING_ROWS,
      [{ tonnageKey: 5, label: '5 Ton', baseYear: '2026', baseAllIn: targetAllIn }],
      'hyb',
    )

    const next5 = merged.rows.find((r) => r.tonnageKey === 5)!
    const next10 = merged.rows.find((r) => r.tonnageKey === 10)!
    expect(computeRtuAllInFromComponents(next5, 'hyb')).toBe(targetAllIn)
    expect(next5.install).toBe(base.install)
    expect(next10.supplyHyb).toBe(untouched.supplyHyb)
    expect(merged.stats.matchedTiers).toBe(1)
    expect(merged.stats.updatedTiers).toBe(1)
  })

  it('parses RCB report pricing sheet unit-size layout', () => {
    const buffer = workbookToBuffer({
      'RTU Pricing': [
        ['RTU Pricing by Tonnage'],
        ['Pricing basis: Hybrid Lennox (all-in installed)'],
        [],
        ['Unit Size', '2026 (CAD)', '2027 (CAD)'],
        ['5 Ton', 35000, 36750],
        ['10 Ton', 56000, 58800],
      ],
    })

    const { basis, rows } = parseRcbReportPricingSheet(buffer)
    expect(basis).toBe('hyb')
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ tonnageKey: 5, baseYear: '2026', baseAllIn: 35000 })
  })

  it('imports full report workbook with merge semantics', () => {
    const leek = buildings.find((b) => b.address.includes('Leek'))!
    const buffer = workbookToBuffer({
      Dashboard: [['Rooftop HVAC Unit (RTU) Replacement Plan']],
      'RTU Pricing': [
        ['RTU Pricing by Tonnage'],
        ['Pricing basis: Hybrid Lennox (all-in installed)'],
        [],
        ['Unit Size', '2026 (CAD)'],
        ['5 Ton', 40000],
      ],
      'All Units': [
        ['All Units — Full Detail'],
        [...RCB_ALL_UNITS_HEADERS],
        [
          leek.address,
          'Park',
          'Mgr',
          'RTU- 01',
          '',
          '',
          '',
          '',
          '',
          '',
          2030,
          1,
          '',
          'From report',
        ],
      ],
    })

    expect(
      detectExcelWorkbookKind(['Dashboard', 'RTU Pricing', 'All Units']),
    ).toBe('rcbReport')

    const result = importRcbReportWorkbook(buffer, buildings, DEFAULT_RTU_PRICING_ROWS)
    const key = rcbReplacementYearKey(leek.address, 'RTU- 01')
    expect(result.allUnits.replacementYears[key]).toBe('2030')
    expect(result.allUnits.notes[key]).toBe('From report')
    expect(result.pricing?.stats.matchedTiers).toBe(1)
    const five = result.pricing!.rows.find((r) => r.tonnageKey === 5)!
    expect(computeRtuAllInFromComponents(five, 'hyb')).toBe(40000)
  })

  it('rejects All Units sheets missing Budget/Notes headers', () => {
    const leek = buildings.find((b) => b.address.includes('Leek'))!
    const buffer = workbookToBuffer({
      'All Units': [
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
          'Eligible/Assigned Replacement Year',
          'Cost (CAD)',
        ],
        [leek.address, 'Park', 'Mgr', 'RTU- 02', '', '', '', '', '', '', 2028, 50000],
      ],
    })

    expect(() => parseRcbAllUnitsSheet(buffer)).toThrow(/headers do not match/i)
  })

  it('rejects the legacy Replace Yr header name', () => {
    const leek = buildings.find((b) => b.address.includes('Leek'))!
    const buffer = workbookToBuffer({
      'All Units': [
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
          'Budget (CAD)',
          'Notes',
        ],
        [
          leek.address,
          'Park',
          'Mgr',
          'RTU- 02',
          '',
          '',
          '',
          '',
          '',
          '',
          2028,
          50000,
          12000,
          'note',
        ],
      ],
    })

    expect(() => parseRcbAllUnitsSheet(buffer)).toThrow(/Eligible\/Assigned Replacement Year/i)
  })

  it('round-trips All Units export rows through import (budget + notes)', () => {
    const subset = buildings.filter((b) => b.address === '1850 Derry Road East')
    const result = rcbCompute(subset, {
      basis: 'hyb',
      year: '2026',
      threshold: 10,
      currentYear: 2026,
    })
    const first = result.lineItems[0]
    expect(first).toBeTruthy()
    const key = rcbReplacementYearKey(first!.address, first!.rtu)
    const presentation = buildRcbPresentation(result, first!.address, {
      rtuBudgets: { [key]: 12_500 },
      replacementNotesByRtu: { [key]: 'Round-trip note' },
    })
    const allUnitsRows = presentationToAllUnitsRows(presentation)
    expect(allUnitsRows[1]?.includes('RTU $ Allocation')).toBe(true)
    expect(allUnitsRows[1]?.includes('Estimated Cost')).toBe(true)
    expect(allUnitsRows[1]?.includes('Equal Budget Share (CAD)')).toBe(false)
    expect(allUnitsRows[1]?.includes('Budget (CAD)')).toBe(false)
    expect(allUnitsRows[1]?.includes('Cost (CAD)')).toBe(false)
    for (const required of RCB_ALL_UNITS_HEADERS) {
      expect(allUnitsRows[1]).toContain(required)
    }

    const buffer = workbookToBuffer({
      Dashboard: [['Rooftop HVAC Unit (RTU) Replacement Plan']],
      'RTU Pricing': [
        ['RTU Pricing by Tonnage'],
        ['Pricing basis: Hybrid Lennox (all-in installed)'],
        [],
        ['Unit Size', '2026 (CAD)'],
        ['5 Ton', 35000],
      ],
      'All Units': allUnitsRows,
    })

    const imported = importRcbReportWorkbook(buffer, buildings, DEFAULT_RTU_PRICING_ROWS)
    expect(imported.allUnits.notes[key]).toBe('Round-trip note')
    expect(imported.allUnits.budgets[key]).toBe(12_500)
  })
})
