import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import * as XLSX from 'xlsx'
import { rcbReplacementYearKey } from '@/lib/costEstimator'
import { importCostExcelFile } from '@/lib/costExcelImport'
import { RCB_ALL_UNITS_HEADERS } from '@/lib/rcbPresentation'
import { parseRcbAllUnitsSheet } from '@/lib/rcbReportImport'
import { DEFAULT_RTU_PRICING_ROWS } from '@/lib/rtuPricing.defaults'
import type { RcbAllUnitsImportResult } from '@/lib/rcbReportImport'
import { normalizeLegacyBuilding, type LegacyBuildingJson } from '@/types/domain'
import legacyBuildings from '../../supabase/data/buildings.json'

const SAMPLE_COST_REPORT =
  'C:/Users/Robert/Downloads/QR_RTU_Replacement_Cost_All_2026 new.xlsx'

const buildings = (legacyBuildings as LegacyBuildingJson[]).map(normalizeLegacyBuilding)

function workbookToBuffer(sheets: Record<string, unknown[][]>): ArrayBuffer {
  const wb = XLSX.utils.book_new()
  for (const [sheetName, rows] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), sheetName)
  }
  const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer | Uint8Array | number[]
  if (out instanceof ArrayBuffer) return out
  const bytes = out instanceof Uint8Array ? out : Uint8Array.from(out)
  return bytes.slice().buffer as ArrayBuffer
}

describe('importCostExcelFile', () => {
  it('imports RCB cost report notes and budgets', async () => {
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
          5000,
          'From cost bar import',
        ],
      ],
    })

    const applyRcbReportMerge = vi.fn(async (_result: RcbAllUnitsImportResult) => undefined)
    const applyBudgetMerge = vi.fn()
    const applyRcbReportPricingMerge = vi.fn(async () => undefined)

    const result = await importCostExcelFile(buffer, 'cost-report.xlsx', {
      buildings,
      pricingRows: DEFAULT_RTU_PRICING_ROWS,
      applyRcbReportMerge,
      applyBudgetMerge,
      applyRcbReportPricingMerge,
      applyEquipmentImport: vi.fn(async () => undefined),
      applyPricingImport: vi.fn(async () => undefined),
      importPricingWorkbook: vi.fn(async () => ({ rowCount: 0 })),
    } satisfies Parameters<typeof importCostExcelFile>[2])

    const key = rcbReplacementYearKey(leek.address, 'RTU- 01')
    expect(applyRcbReportMerge).toHaveBeenCalledOnce()
    const mergeArg = applyRcbReportMerge.mock.calls[0]![0]
    expect(mergeArg.notes[key]).toBe('From cost bar import')
    expect(applyBudgetMerge).toHaveBeenCalledWith(expect.objectContaining({ [key]: 5000 }))
    expect(result.message).toMatch(/notes/i)
  })

  it('rejects portfolio exports with a clear message', async () => {
    const buffer = workbookToBuffer({
      Buildings: [['Address']],
      RTUs: [['Name']],
      Utilities: [['Type']],
      'Tenant Polygons': [['id']],
    })

    await expect(
      importCostExcelFile(buffer, 'portfolio.xlsx', {
        buildings,
        pricingRows: DEFAULT_RTU_PRICING_ROWS,
        applyRcbReportMerge: vi.fn(async () => undefined),
        applyBudgetMerge: vi.fn(),
        applyRcbReportPricingMerge: vi.fn(async () => undefined),
        applyEquipmentImport: vi.fn(async () => undefined),
        applyPricingImport: vi.fn(async () => undefined),
        importPricingWorkbook: vi.fn(async () => ({ rowCount: 0 })),
      }),
    ).rejects.toThrow(/portfolio database export/i)
  })

  it('accepts the QR_RTU_Replacement_Cost_All_2026 sample workbook headers', async () => {
    if (!existsSync(SAMPLE_COST_REPORT)) return

    const bytes = readFileSync(SAMPLE_COST_REPORT)
    const ab = new ArrayBuffer(bytes.byteLength)
    new Uint8Array(ab).set(bytes)

    const rows = parseRcbAllUnitsSheet(ab)
    expect(rows.length).toBeGreaterThan(50)
    const withNotes = rows.find((row) => row.notes.toLowerCase().includes('replacement due'))
    expect(withNotes?.replacementYear).toBe('2027')
    expect(RCB_ALL_UNITS_HEADERS[10]).toBe('Eligible/Assigned Replacement Year')

    const applyRcbReportMerge = vi.fn(async () => undefined)
    const result = await importCostExcelFile(ab, 'QR_RTU_Replacement_Cost_All_2026.xlsx', {
      buildings,
      pricingRows: DEFAULT_RTU_PRICING_ROWS,
      applyRcbReportMerge,
      applyBudgetMerge: vi.fn(),
      applyRcbReportPricingMerge: vi.fn(async () => undefined),
      applyEquipmentImport: vi.fn(async () => undefined),
      applyPricingImport: vi.fn(async () => undefined),
      importPricingWorkbook: vi.fn(async () => ({ rowCount: 0 })),
    })
    expect(applyRcbReportMerge).toHaveBeenCalledOnce()
    expect(result.message).toMatch(/replacement years|notes/i)
  })
})
