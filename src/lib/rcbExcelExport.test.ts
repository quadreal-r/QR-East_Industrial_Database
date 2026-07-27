import { describe, expect, it } from 'vitest'
import ExcelJS from 'exceljs'
import * as XLSX from 'xlsx'
import { rcbCompute } from '@/lib/costEstimator'
import { buildStyledRcbWorkbook, rcbExportFilenameScope } from '@/lib/rcbExcelExport'
import {
  buildRcbPresentation,
  RCB_ALL_UNITS_EXPORT_HEADERS,
  RCB_ALL_UNITS_HEADERS,
} from '@/lib/rcbPresentation'
import { parseRcbAllUnitsSheet } from '@/lib/rcbReportImport'
import { normalizeLegacyBuilding, type LegacyBuildingJson } from '@/types/domain'
import legacyBuildings from '../../supabase/data/buildings.json'
import { existsSync, readFileSync } from 'node:fs'

const buildings = (legacyBuildings as LegacyBuildingJson[]).map(normalizeLegacyBuilding)
const SAMPLE =
  'C:/Users/Robert/Downloads/QR_RTU_Replacement_Cost_All_2026 new.xlsx'

describe('rcbExportFilenameScope', () => {
  it('uses manager first name for cluster/park scopes instead of park labels', () => {
    expect(
      rcbExportFilenameScope({
        clusterFilter: 'Meadowvale North',
        parkFilter: 'Meadowvale North Business Park',
        managersInScope: ['Maia Krasowski'],
        fallbackLabel: 'Meadowvale North Business Park · Meadowvale North',
      }),
    ).toBe('Maia')
  })

  it('uses the manager first name when their portfolio is selected', () => {
    expect(
      rcbExportFilenameScope({
        managerFilter: 'Sylvia Zwierkowski',
        parkFilter: 'East Business Park',
        managersInScope: ['Sylvia Zwierkowski'],
      }),
    ).toBe('Sylvia')
  })

  it('uses All for the full portfolio even when many managers are in scope', () => {
    expect(
      rcbExportFilenameScope({
        managersInScope: ['Maia Krasowski', 'Sylvia Zwierkowski', 'Josh Starkey'],
        fallbackLabel: 'All buildings',
      }),
    ).toBe('All')
    expect(rcbExportFilenameScope({ fallbackLabel: 'All buildings' })).toBe('All')
    expect(rcbExportFilenameScope({ fallbackLabel: 'All' })).toBe('All')
  })

  it('drops the word new from non-all fallback labels', () => {
    expect(
      rcbExportFilenameScope({
        clusterFilter: 'West',
        fallbackLabel: 'All new buildings',
      }),
    ).toBe('All buildings')
  })

  it('prefers a selected building address', () => {
    expect(
      rcbExportFilenameScope({
        selectedBuildingAddress: '1850 Derry Road East',
        managerFilter: 'Maia Krasowski',
      }),
    ).toBe('1850 Derry Road East')
  })
})

describe('buildStyledRcbWorkbook', () => {
  it('exports All Units headers that the importer accepts', async () => {
    const subset = buildings.filter((b) => b.address.includes('Leek')).slice(0, 1)
    const result = rcbCompute(subset, {
      basis: 'hyb',
      year: '2026',
      threshold: 10,
      currentYear: 2026,
    })
    const presentation = buildRcbPresentation(result, 'All buildings')
    const buffer = await buildStyledRcbWorkbook(presentation)
    const wb = XLSX.read(buffer, { type: 'array' })
    expect(wb.SheetNames).toEqual([
      'Dashboard',
      'RTU Pricing',
      'By Building',
      'By Unit Size',
      'All Units',
    ])
    const matrix = XLSX.utils.sheet_to_json(wb.Sheets['All Units']!, {
      header: 1,
      defval: '',
    }) as unknown[][]
    expect(matrix[1]).toEqual([...RCB_ALL_UNITS_EXPORT_HEADERS])
    expect(matrix[1]).toContain('Estimated Cost')
    expect(matrix[1]).toContain('RTU $ Allocation')
    expect(matrix[1]).not.toContain('Equal Budget Share (CAD)')
    expect(matrix[1]).not.toContain('Budget (CAD)')
    expect(matrix[1]).not.toContain('Cost (CAD)')
    expect(parseRcbAllUnitsSheet(buffer).length).toBeGreaterThan(0)
    expect(RCB_ALL_UNITS_HEADERS).toContain('RTU $ Allocation')
    expect(RCB_ALL_UNITS_HEADERS).toContain('Estimated Cost')
    expect(RCB_ALL_UNITS_HEADERS).not.toContain('Equal Budget Share (CAD)')
  })

  it('imports the fancy sample workbook from Downloads', () => {
    if (!existsSync(SAMPLE)) return
    const bytes = readFileSync(SAMPLE)
    const ab = new ArrayBuffer(bytes.byteLength)
    new Uint8Array(ab).set(bytes)
    const rows = parseRcbAllUnitsSheet(ab)
    expect(rows.length).toBeGreaterThan(50)
    expect(RCB_ALL_UNITS_HEADERS[10]).toBe('Eligible/Assigned Replacement Year')
  })

  it('matches the hand-tuned sample column widths and title merges', async () => {
    const subset = buildings.filter((b) => b.address.includes('Leek')).slice(0, 1)
    const result = rcbCompute(subset, {
      basis: 'hyb',
      year: '2026',
      threshold: 10,
      currentYear: 2026,
    })
    const presentation = buildRcbPresentation(result, 'All buildings')
    const buffer = await buildStyledRcbWorkbook(presentation)
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(buffer)

    const dash = wb.getWorksheet('Dashboard')!
    expect(dash.getColumn(1).width).toBeCloseTo(38.57, 1)
    expect(dash.getColumn(2).width).toBeCloseTo(22.86, 1)

    const byBuilding = wb.getWorksheet('By Building')!
    expect(byBuilding.getColumn(1).width).toBeCloseTo(23.57, 1)
    expect(byBuilding.getColumn(2).width).toBeCloseTo(34.86, 1)
    expect(byBuilding.model.merges).toContain('A1:P1')

    const bySize = wb.getWorksheet('By Unit Size')!
    expect(bySize.getColumn(3).width).toBe(12)
    expect(bySize.model.merges).toContain('A1:D1')

    const allUnits = wb.getWorksheet('All Units')!
    expect(allUnits.getColumn(1).width).toBeCloseTo(23.57, 1)
    expect(allUnits.getColumn(11).width).toBeCloseTo(20.43, 1)
    expect(allUnits.getColumn(4).width).toBeCloseTo(18, 1)
    expect(allUnits.getColumn(14).width).toBeCloseTo(47.71, 1)
    expect(allUnits.getRow(1).height).toBeCloseTo(47.25, 1)
    expect(allUnits.getRow(2).height).toBeCloseTo(44.25, 1)
    expect(allUnits.model.merges).toContain('A1:N1')

    const pricing = wb.getWorksheet('RTU Pricing')!
    expect(pricing.model.merges).toEqual(expect.arrayContaining(['A1:H1', 'A2:H2']))
    expect(pricing.getRow(3).getCell(1).value).toBe('Unit Size')
  })

  it('centers Dashboard; left-aligns column fields on other sheets', async () => {
    const subset = buildings.filter((b) => b.address.includes('Leek')).slice(0, 1)
    const result = rcbCompute(subset, {
      basis: 'hyb',
      year: '2026',
      threshold: 10,
      currentYear: 2026,
    })
    const presentation = buildRcbPresentation(result, 'All buildings')
    const buffer = await buildStyledRcbWorkbook(presentation)
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(buffer)

    const dash = wb.getWorksheet('Dashboard')!
    expect(dash.getCell('A1').alignment?.wrapText).toBe(true)
    expect(dash.getCell('A1').alignment?.horizontal).toBe('center')
    expect(dash.getCell('A1').font?.size).toBe(10)
    expect(dash.getCell('A11').alignment?.wrapText).toBe(true)
    expect(dash.getCell('D11').alignment?.horizontal).toBe('center')
    expect(dash.getCell('A17').alignment?.wrapText).toBe(true)
    expect(dash.getCell('D17').alignment?.horizontal).toBe('center')

    for (const name of [
      'Dashboard',
      'RTU Pricing',
      'By Building',
      'By Unit Size',
      'All Units',
    ]) {
      expect(wb.getWorksheet(name)!.getCell('A1').font?.size).toBe(10)
    }

    const allUnits = wb.getWorksheet('All Units')!
    const headerRow = allUnits.getRow(2)
    expect(headerRow.getCell(1).alignment?.wrapText).toBe(true)
    expect(headerRow.getCell(1).alignment?.horizontal).toBe('left')
    expect(headerRow.height).toBeGreaterThanOrEqual(30)
    expect(allUnits.getRow(3).getCell(1).alignment?.horizontal).toBe('left')

    const byBuilding = wb.getWorksheet('By Building')!
    expect(byBuilding.getRow(2).getCell(1).alignment?.horizontal).toBe('left')
    expect(byBuilding.getRow(3).getCell(1).alignment?.horizontal).toBe('left')

    const pricing = wb.getWorksheet('RTU Pricing')!
    expect(pricing.getRow(3).getCell(1).alignment?.horizontal).toBe('center')
    expect(pricing.getRow(4).getCell(1).alignment?.horizontal).toBe('right')
    // Sheet titles stay centered.
    expect(pricing.getRow(1).getCell(1).alignment?.horizontal).toBe('center')

    const byUnitSize = wb.getWorksheet('By Unit Size')!
    expect(byUnitSize.getRow(1).getCell(1).alignment?.horizontal).toBe('right')
    expect(byUnitSize.getRow(2).getCell(1).alignment?.horizontal).toBe('center')
    expect(byUnitSize.getRow(3).getCell(1).alignment?.horizontal).toBe('right')
  })
})
