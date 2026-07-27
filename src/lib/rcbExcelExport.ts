import ExcelJS from 'exceljs'
import {
  RCB_BUDGET_YEAR_COLUMNS,
  RCB_EXCEL_MONEY_FMT,
  presentationToAllUnitsRows,
  presentationToByBuildingRows,
  type RcbPresentation,
} from '@/lib/rcbPresentation'

/** Brand colors from the QR_RTU_Replacement_Cost_Center styled workbook. */
const NAVY = 'FF1B3A5B'
const NAVY_DEEP = 'FF12293F'
const INK = 'FF2B3440'
const MUTED = 'FF6B7684'
const WASH = 'FFF4F6F9'
const WASH_ALT = 'FFEEF2F6'
const WHITE = 'FFFFFFFF'
const GREEN = 'FF1F7A4D'
const RED = 'FFB42318'

const MONEY = RCB_EXCEL_MONEY_FMT
const PCT = '0.0%'
const INT = '#,##0'

/** Centered + wrapped text so Dashboard headlines stay fully visible. */
const ALIGN_HEADLINE: Partial<ExcelJS.Alignment> = {
  horizontal: 'center',
  vertical: 'middle',
  wrapText: true,
}

function fillSolid(argb: string): ExcelJS.Fill {
  return { type: 'pattern', pattern: 'solid', fgColor: { argb } }
}

function font(opts: Partial<ExcelJS.Font> = {}): Partial<ExcelJS.Font> {
  return { name: 'Arial', size: 10, ...opts }
}

function applyRangeFill(
  sheet: ExcelJS.Worksheet,
  row: number,
  fromCol: number,
  toCol: number,
  fillArgb: string,
  fontOpts?: Partial<ExcelJS.Font>,
) {
  for (let c = fromCol; c <= toCol; c++) {
    const cell = sheet.getCell(row, c)
    cell.fill = fillSolid(fillArgb)
    if (fontOpts) cell.font = font(fontOpts) as ExcelJS.Font
  }
}

function applyHeadlineAlignment(
  sheet: ExcelJS.Worksheet,
  row: number,
  fromCol: number,
  toCol: number,
) {
  for (let c = fromCol; c <= toCol; c++) {
    sheet.getCell(row, c).alignment = { ...ALIGN_HEADLINE }
  }
}

function styleHeaderRow(sheet: ExcelJS.Worksheet, row: number, colCount: number) {
  applyRangeFill(sheet, row, 1, colCount, NAVY, { bold: true, size: 10, color: { argb: WHITE } })
  applyHeadlineAlignment(sheet, row, 1, colCount)
  sheet.getRow(row).height = 36
}

function setColWidths(sheet: ExcelJS.Worksheet, widths: number[]) {
  widths.forEach((w, i) => {
    sheet.getColumn(i + 1).width = w
  })
}

/** Column widths / row heights from the hand-tuned Cost Center sample workbook. */
const DASHBOARD_COL_WIDTHS = [38.57, 22.86, 22.86, 22.86, 22.86, 22.86, 22.86]
const BY_BUILDING_COL_WIDTHS = [
  23.57, 34.86, 33.43, 16.57, 10, 15, 17.14, 34.43, 14.14, 16.57, 16.57, 16.57, 16.57, 16.57,
  16.57, 16.57,
]
const BY_UNIT_SIZE_COL_WIDTHS = [14, 22, 12, 16]
const ALL_UNITS_COL_WIDTHS = [
  // Building, Portfolio, Manager, Unit, Make, Model, Serial, Installed,
  // Age on Repl. Year (narrow so header wraps), Tons, Eligible Year, Est. Cost, Allocation, Notes
  23.57, 34.86, 16.57, 18, 10.43, 36.71, 20.86, 13.29, 9.5, 9.86, 20.43, 15, 14, 47.71,
]

function varianceFontColor(variance: number): string {
  if (variance > 0) return GREEN
  if (variance < 0) return RED
  return INK
}

function alignOf(
  horizontal: ExcelJS.Alignment['horizontal'],
): Partial<ExcelJS.Alignment> {
  return { horizontal, vertical: 'middle', wrapText: true }
}

function applyRowAlignment(
  sheet: ExcelJS.Worksheet,
  row: number,
  fromCol: number,
  toCol: number,
  alignment: Partial<ExcelJS.Alignment>,
) {
  for (let c = fromCol; c <= toCol; c++) {
    sheet.getCell(row, c).alignment = { ...alignment }
  }
}

function writeDashboard(wb: ExcelJS.Workbook, p: RcbPresentation) {
  const a = p.budgetAnalytics
  const cols = 7
  const sheet = wb.addWorksheet('Dashboard', {
    views: [{ state: 'frozen', ySplit: 18 }],
  })
  setColWidths(sheet, DASHBOARD_COL_WIDTHS)

  // Row 1 — title
  sheet.mergeCells(1, 1, 1, cols)
  applyRangeFill(sheet, 1, 1, cols, NAVY, { bold: true, size: 10, color: { argb: WHITE } })
  sheet.getCell('A1').value = 'Rooftop HVAC Unit (RTU) Replacement Plan'
  applyHeadlineAlignment(sheet, 1, 1, cols)
  sheet.getRow(1).height = 44.1

  // Row 2 — subtitle
  sheet.mergeCells(2, 1, 2, cols)
  applyRangeFill(sheet, 2, 1, cols, NAVY_DEEP, { size: 10, color: { argb: WHITE } })
  sheet.getCell('A2').value =
    `Capital forecast — ${p.scopeLabel}   •   Prepared ${p.preparedDate}`
  applyHeadlineAlignment(sheet, 2, 1, cols)
  sheet.getRow(2).height = 27.95

  // Row 3 — TOTAL BUDGET banner
  sheet.mergeCells(3, 1, 3, cols)
  const budgetLabel =
    p.totalsBudget > 0
      ? `TOTAL BUDGET    $${Math.round(p.totalsBudget).toLocaleString('en-CA')}`
      : 'TOTAL BUDGET'
  sheet.getCell('A3').value = budgetLabel
  sheet.getCell('A3').font = font({ bold: true, size: 9, color: { argb: MUTED } }) as ExcelJS.Font
  applyHeadlineAlignment(sheet, 3, 1, cols)
  sheet.getRow(3).height = 24

  // Row 4 — KPI labels
  sheet.getCell('A4').value = 'TOTAL PLANNED COST'
  sheet.mergeCells('B4:C4')
  sheet.getCell('B4').value = 'UNITS TO REPLACE'
  sheet.mergeCells('D4:E4')
  sheet.getCell('D4').value = 'AVERAGE COST / UNIT'
  applyRangeFill(sheet, 4, 1, cols, WASH, { bold: true, size: 9, color: { argb: MUTED } })
  applyHeadlineAlignment(sheet, 4, 1, cols)
  sheet.getRow(4).height = 32.1

  // Row 5 — KPI values
  sheet.getCell('A5').value = p.summary.totalCost
  sheet.getCell('A5').numFmt = MONEY
  sheet.mergeCells('B5:C5')
  sheet.getCell('B5').value = p.totals.units
  sheet.getCell('B5').numFmt = INT
  sheet.mergeCells('D5:E5')
  sheet.getCell('D5').value = p.summary.avgUnitCost
  sheet.getCell('D5').numFmt = MONEY
  applyRangeFill(sheet, 5, 1, cols, WASH, { bold: true, size: 20, color: { argb: NAVY } })
  applyHeadlineAlignment(sheet, 5, 1, cols)
  sheet.getRow(5).height = 42

  sheet.getRow(6).height = 10

  // Row 7 — second KPI labels
  sheet.getCell('A7').value = `DUE NOW (${p.defaultYear})`
  sheet.mergeCells('B7:C7')
  sheet.getCell('B7').value = 'POTENTIAL SAVINGS'
  sheet.mergeCells('D7:E7')
  sheet.getCell('D7').value = 'AVG UNIT AGE'
  applyRangeFill(sheet, 7, 1, cols, WASH, { bold: true, size: 9, color: { argb: MUTED } })
  applyHeadlineAlignment(sheet, 7, 1, cols)
  sheet.getRow(7).height = 32.1

  // Row 8 — second KPI values
  sheet.getCell('A8').value = p.summary.dueNowCost
  sheet.getCell('A8').numFmt = MONEY
  sheet.mergeCells('B8:C8')
  sheet.getCell('B8').value = p.summary.flaggedSavings > 0 ? p.summary.flaggedSavings : ''
  if (p.summary.flaggedSavings > 0) sheet.getCell('B8').numFmt = MONEY
  sheet.mergeCells('D8:E8')
  sheet.getCell('D8').value = p.summary.avgAge != null ? `${p.summary.avgAge} yrs` : ''
  applyRangeFill(sheet, 8, 1, cols, WASH, { bold: true, size: 20, color: { argb: NAVY } })
  applyHeadlineAlignment(sheet, 8, 1, cols)
  sheet.getRow(8).height = 42

  sheet.getRow(9).height = 12

  // Rows 10–14 — Budget vs estimated cost analytics
  sheet.mergeCells(10, 1, 10, cols)
  applyRangeFill(sheet, 10, 1, cols, WASH_ALT, { bold: true, size: 11, color: { argb: NAVY } })
  sheet.getCell('A10').value = 'BUDGET VS ESTIMATED COST'
  applyHeadlineAlignment(sheet, 10, 1, cols)
  sheet.getRow(10).height = 27.95

  sheet.getCell('A11').value = 'TOTAL BUDGET'
  sheet.mergeCells('B11:C11')
  sheet.getCell('B11').value = 'ESTIMATED COST'
  sheet.mergeCells('D11:E11')
  sheet.getCell('D11').value = 'VARIANCE (BUDGET − EST.)'
  sheet.mergeCells('F11:G11')
  sheet.getCell('F11').value = 'BUDGET COVERAGE'
  applyRangeFill(sheet, 11, 1, cols, WASH, { bold: true, size: 9, color: { argb: MUTED } })
  applyHeadlineAlignment(sheet, 11, 1, cols)
  sheet.getRow(11).height = 36

  sheet.getCell('A12').value = a.totalBudget > 0 ? a.totalBudget : ''
  if (a.totalBudget > 0) sheet.getCell('A12').numFmt = MONEY
  sheet.mergeCells('B12:C12')
  sheet.getCell('B12').value = a.totalCost
  sheet.getCell('B12').numFmt = MONEY
  sheet.mergeCells('D12:E12')
  sheet.getCell('D12').value = a.totalBudget > 0 ? a.variance : ''
  if (a.totalBudget > 0) sheet.getCell('D12').numFmt = MONEY
  sheet.mergeCells('F12:G12')
  sheet.getCell('F12').value = a.coverage != null && a.totalBudget > 0 ? a.coverage : ''
  if (a.coverage != null && a.totalBudget > 0) sheet.getCell('F12').numFmt = PCT
  applyRangeFill(sheet, 12, 1, cols, WASH, { bold: true, size: 18, color: { argb: NAVY } })
  applyHeadlineAlignment(sheet, 12, 1, cols)
  if (a.totalBudget > 0) {
    sheet.getCell('D12').font = font({
      bold: true,
      size: 18,
      color: { argb: varianceFontColor(a.variance) },
    }) as ExcelJS.Font
  }
  sheet.getRow(12).height = 39.95

  sheet.getCell('A13').value = 'Buildings with budget'
  sheet.getCell('B13').value = a.buildingsWithBudget
  sheet.getCell('C13').value = 'Over budget'
  sheet.getCell('D13').value = a.buildingsOverBudget
  sheet.getCell('E13').value = 'At / under budget'
  sheet.getCell('F13').value = a.buildingsUnderOrEqual
  sheet.getCell('G13').value = `RTUs w/ budget: ${a.unitsWithBudget}`
  applyRangeFill(sheet, 13, 1, cols, WHITE, { size: 10, color: { argb: INK } })
  applyHeadlineAlignment(sheet, 13, 1, cols)
  if (a.buildingsOverBudget > 0) {
    sheet.getCell('D13').font = font({ bold: true, size: 10, color: { argb: RED } }) as ExcelJS.Font
  }
  sheet.getRow(13).height = 32.1

  sheet.mergeCells(14, 1, 14, cols)
  sheet.getCell('A14').value =
    a.totalBudget > 0
      ? a.variance >= 0
        ? 'Green variance = budget covers (or exceeds) estimated replacement cost.'
        : 'Red variance = estimated cost exceeds Capex / assigned budget.'
      : 'No Capex / assigned budgets in this scope yet — Budget column stays blank until loaded.'
  sheet.getCell('A14').font = font({ size: 9, italic: true, color: { argb: MUTED } }) as ExcelJS.Font
  applyHeadlineAlignment(sheet, 14, 1, cols)
  sheet.getRow(14).height = 27.95

  sheet.getRow(15).height = 12

  // Row 16 — portfolio section
  sheet.mergeCells(16, 1, 16, cols)
  applyRangeFill(sheet, 16, 1, cols, WASH_ALT, { bold: true, size: 11, color: { argb: NAVY } })
  sheet.getCell('A16').value = 'WHERE THE MONEY GOES — BY PORTFOLIO'
  applyHeadlineAlignment(sheet, 16, 1, cols)
  sheet.getRow(16).height = 27.95

  // Row 17 — table header
  const headers = [
    'Portfolio',
    'Manager',
    'Units',
    'Est. Cost',
    'Budget',
    'Variance',
    'Share',
  ]
  headers.forEach((h, i) => {
    sheet.getCell(17, i + 1).value = h
  })
  styleHeaderRow(sheet, 17, cols)

  let r = 18
  for (const row of p.portfolios) {
    sheet.getCell(r, 1).value = row.park
    sheet.getCell(r, 2).value = row.manager
    sheet.getCell(r, 3).value = row.units
    sheet.getCell(r, 3).numFmt = INT
    sheet.getCell(r, 4).value = row.cost
    sheet.getCell(r, 4).numFmt = MONEY
    sheet.getCell(r, 5).value = row.budget > 0 ? row.budget : ''
    if (row.budget > 0) sheet.getCell(r, 5).numFmt = MONEY
    sheet.getCell(r, 6).value = row.budget > 0 ? row.variance : ''
    if (row.budget > 0) {
      sheet.getCell(r, 6).numFmt = MONEY
      sheet.getCell(r, 6).font = font({
        size: 10,
        color: { argb: varianceFontColor(row.variance) },
      }) as ExcelJS.Font
    }
    sheet.getCell(r, 7).value = row.share
    sheet.getCell(r, 7).numFmt = PCT
    applyRangeFill(sheet, r, 1, cols, WHITE, { size: 10, color: { argb: INK } })
    // Re-apply variance font after fill helper overwrote it.
    if (row.budget > 0) {
      sheet.getCell(r, 6).font = font({
        size: 10,
        color: { argb: varianceFontColor(row.variance) },
      }) as ExcelJS.Font
    }
    sheet.getRow(r).height = 27.95
    r++
  }

  sheet.getCell(r, 1).value = 'TOTAL'
  sheet.getCell(r, 3).value = p.totals.units
  sheet.getCell(r, 3).numFmt = INT
  sheet.getCell(r, 4).value = p.totals.cost
  sheet.getCell(r, 4).numFmt = MONEY
  sheet.getCell(r, 5).value = a.totalBudget > 0 ? a.totalBudget : ''
  if (a.totalBudget > 0) sheet.getCell(r, 5).numFmt = MONEY
  sheet.getCell(r, 6).value = a.totalBudget > 0 ? a.variance : ''
  if (a.totalBudget > 0) {
    sheet.getCell(r, 6).numFmt = MONEY
  }
  sheet.getCell(r, 7).value = p.totals.cost ? 1 : ''
  if (p.totals.cost) sheet.getCell(r, 7).numFmt = PCT
  applyRangeFill(sheet, r, 1, cols, WASH_ALT, { bold: true, size: 10, color: { argb: INK } })
  if (a.totalBudget > 0) {
    sheet.getCell(r, 6).font = font({
      bold: true,
      size: 10,
      color: { argb: varianceFontColor(a.variance) },
    }) as ExcelJS.Font
  }

  sheet.autoFilter = {
    from: { row: 17, column: 1 },
    to: { row: Math.max(17, r - 1), column: cols },
  }
}

function writeDataSheet(
  wb: ExcelJS.Workbook,
  name: string,
  rows: unknown[][],
  options: {
    titleRows: number
    headerRow: number
    moneyCols: number[]
    percentCols?: number[]
    freezeRows: number
    colWidths?: number[]
    /** Override title row heights (1-based index within titleRows). */
    titleRowHeights?: number[]
    /** Override header row height (default 36). */
    headerRowHeight?: number
    titleAlign?: ExcelJS.Alignment['horizontal']
    headerAlign?: ExcelJS.Alignment['horizontal']
    dataAlign?: ExcelJS.Alignment['horizontal']
  },
) {
  const sheet = wb.addWorksheet(name, {
    views: [{ state: 'frozen', ySplit: options.freezeRows }],
  })
  const colCount = Math.max(...rows.map((row) => row.length), 1)
  if (options.colWidths?.length) setColWidths(sheet, options.colWidths)

  const titleAlign = alignOf(options.titleAlign ?? 'center')
  const headerAlign = alignOf(options.headerAlign ?? 'left')
  const dataAlign = alignOf(options.dataAlign ?? 'left')

  rows.forEach((row, r0) => {
    const r = r0 + 1
    row.forEach((value, c0) => {
      const cell = sheet.getCell(r, c0 + 1)
      cell.value = value as ExcelJS.CellValue
      const isHeader = r0 === options.headerRow
      const isTitle = r0 < options.titleRows
      if (isHeader) {
        cell.fill = fillSolid(NAVY)
        cell.font = font({ bold: true, size: 10, color: { argb: WHITE } }) as ExcelJS.Font
        cell.alignment = { ...headerAlign }
      } else if (isTitle) {
        cell.font = font({
          bold: true,
          size: 10,
          color: { argb: INK },
        }) as ExcelJS.Font
        cell.alignment = { ...titleAlign }
      } else {
        cell.font = font({ size: 10, color: { argb: INK } }) as ExcelJS.Font
        cell.alignment = { ...dataAlign }
        if (options.moneyCols.includes(c0) && typeof value === 'number') cell.numFmt = MONEY
        if (options.percentCols?.includes(c0) && typeof value === 'number') cell.numFmt = PCT
      }
    })
    if (r0 === options.headerRow) {
      sheet.getRow(r).height = options.headerRowHeight ?? 36
    } else if (r0 < options.titleRows) {
      const override = options.titleRowHeights?.[r0]
      sheet.getRow(r).height = override ?? (r0 === 0 ? 27.95 : 21.95)
    }
  })

  // Merge each title row across the sheet when it is a single label cell.
  for (let t = 0; t < options.titleRows; t++) {
    const titleRow = rows[t]
    if (!titleRow?.length) continue
    const hasOnlyFirstCell = titleRow.length === 1 || titleRow.slice(1).every((v) => v == null || v === '')
    if (hasOnlyFirstCell && colCount > 1) {
      sheet.mergeCells(t + 1, 1, t + 1, colCount)
      applyRowAlignment(sheet, t + 1, 1, colCount, titleAlign)
    }
  }

  if (!options.colWidths?.length) {
    for (let c = 1; c <= colCount; c++) {
      let max = 12
      const headerText = String(rows[options.headerRow]?.[c - 1] ?? '')
      // Prefer readable header width when wrap is on (avoid tiny columns).
      max = Math.max(max, Math.min(22, headerText.length + 2))
      for (const row of rows) {
        max = Math.max(max, Math.min(42, String(row[c - 1] ?? '').length + 2))
      }
      sheet.getColumn(c).width = Math.min(42, max)
    }
  }
  // When colWidths are provided, keep them exact (sample workbook sizes).

  const lastDataRow = rows.length
  if (lastDataRow > options.headerRow + 1) {
    sheet.autoFilter = {
      from: { row: options.headerRow + 1, column: 1 },
      to: { row: lastDataRow, column: colCount },
    }
  }
}

/**
 * Build a styled RTU Replacement Cost Center workbook matching the fancy Dashboard template.
 * Returns an ArrayBuffer suitable for download.
 */
export async function buildStyledRcbWorkbook(presentation: RcbPresentation): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'QR East Industrial Database'
  wb.created = new Date()

  writeDashboard(wb, presentation)

  writeDataSheet(wb, 'RTU Pricing', [
    ['RTU Pricing by Tonnage'],
    [`Pricing basis: ${presentation.pricing.basisLabel}`],
    ['Unit Size', ...presentation.pricing.years.map((year) => year)],
    ...presentation.pricing.rows.map((row) => [
      row.label,
      ...presentation.pricing.years.map((year) => row.costsByYear[year] ?? 0),
    ]),
  ], {
    titleRows: 2,
    headerRow: 2,
    moneyCols: presentation.pricing.years.map((_, i) => i + 1),
    freezeRows: 3,
    colWidths: [20, ...presentation.pricing.years.map(() => 13)],
    headerAlign: 'center',
    dataAlign: 'right',
  })

  writeDataSheet(wb, 'By Building', presentationToByBuildingRows(presentation), {
    titleRows: 1,
    headerRow: 1,
    // Cost, Budget Total, then Budget 2025… (Cluster / Removed are text).
    moneyCols: [5, 6, ...RCB_BUDGET_YEAR_COLUMNS.map((_, i) => 9 + i)],
    freezeRows: 2,
    colWidths: BY_BUILDING_COL_WIDTHS.slice(
      0,
      9 + RCB_BUDGET_YEAR_COLUMNS.length,
    ),
    titleRowHeights: [39],
  })

  writeDataSheet(wb, 'By Unit Size', [
    ['Cost by Unit Size'],
    ['Unit Size', 'Avg Cost / Unit', 'Quantity', 'Total Cost'],
    ...presentation.unitSizes.map((row) => [row.label, row.avgCost, row.qty, row.total]),
    [
      'TOTAL',
      presentation.totals.units ? presentation.summary.avgUnitCost : '',
      presentation.totals.units,
      presentation.totals.cost,
    ],
  ], {
    titleRows: 1,
    headerRow: 1,
    moneyCols: [1, 3],
    freezeRows: 2,
    colWidths: BY_UNIT_SIZE_COL_WIDTHS,
    titleAlign: 'right',
    headerAlign: 'center',
    dataAlign: 'right',
  })

  writeDataSheet(wb, 'All Units', presentationToAllUnitsRows(presentation), {
    titleRows: 1,
    headerRow: 1,
    moneyCols: [11, 12],
    freezeRows: 2,
    colWidths: ALL_UNITS_COL_WIDTHS,
    titleRowHeights: [47.25],
    headerRowHeight: 44.25,
  })

  const buffer = await wb.xlsx.writeBuffer()
  if (buffer instanceof ArrayBuffer) return buffer
  const bytes = new Uint8Array(buffer as ArrayBuffer | Uint8Array | Buffer)
  const copy = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(copy).set(bytes)
  return copy
}

/** First name only for export filenames (e.g. "Maia Krasowski" → "Maia"). */
export function managerFirstNameForFilename(fullName: string): string {
  const first = fullName.trim().split(/\s+/)[0]
  return first || fullName.trim()
}

/**
 * Filename scope for cost Excel:
 * - All-buildings mode → "All"
 * - Cluster / park (or manager filter) → manager first name when possible
 * Omits filler words like "new".
 */
export function rcbExportFilenameScope(input: {
  selectedBuildingAddress?: string | null
  managerFilter?: string
  clusterFilter?: string
  parkFilter?: string
  /** Distinct managers in the current export scope. */
  managersInScope?: string[]
  fallbackLabel?: string
}): string {
  const building = input.selectedBuildingAddress?.trim()
  if (building) return building

  const managerFilter = input.managerFilter?.trim()
  if (managerFilter) return managerFirstNameForFilename(managerFilter)

  const narrowed =
    Boolean(input.clusterFilter?.trim()) || Boolean(input.parkFilter?.trim())

  // Full portfolio — never put a manager name in the file.
  if (!narrowed) {
    const fallback = (input.fallbackLabel ?? 'All').trim() || 'All'
    if (/^all(\s+buildings)?$/i.test(fallback)) return 'All'
    return fallback.replace(/\bnew\b/gi, '').replace(/\s+/g, ' ').trim() || 'All'
  }

  const uniqueManagers = [
    ...new Set((input.managersInScope ?? []).map((m) => m.trim()).filter(Boolean)),
  ]
  if (uniqueManagers.length === 1) return managerFirstNameForFilename(uniqueManagers[0]!)
  if (uniqueManagers.length > 1) {
    return `${managerFirstNameForFilename(uniqueManagers[0]!)}_plus_${uniqueManagers.length - 1}`
  }

  const fallback = (input.fallbackLabel ?? 'All').trim() || 'All'
  if (/^all(\s+buildings)?$/i.test(fallback)) return 'All'
  return fallback.replace(/\bnew\b/gi, '').replace(/\s+/g, ' ').trim() || 'All'
}
