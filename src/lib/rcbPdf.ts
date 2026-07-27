import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import type { RcbComputeResult } from '@/lib/costEstimator'
import type { RcbPricingTable } from '@/lib/costEstimator.pricing'
import { DEFAULT_RCB_PRICING } from '@/lib/costEstimator.pricing'
import {
  buildRcbPresentation,
  formatMoney,
  formatPercent,
  isRtuFlaggedForReview,
  rcbExportFilenameBase,
  type BuildRcbPresentationOptions,
  type RcbPresentation,
} from '@/lib/rcbPresentation'

const PAGE_MARGIN = 14
const HEADER_COLOR: [number, number, number] = [30, 64, 120]
const FLAGGED_FILL: [number, number, number] = [255, 243, 205]

function addPageHeader(doc: jsPDF, title: string, presentation: RcbPresentation): void {
  const pageWidth = doc.internal.pageSize.getWidth()
  doc.setFillColor(...HEADER_COLOR)
  doc.rect(0, 0, pageWidth, 18, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.text(title, PAGE_MARGIN, 12)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.text(`Prepared ${presentation.preparedDate}`, pageWidth - PAGE_MARGIN, 12, { align: 'right' })
  doc.setTextColor(0, 0, 0)
}

function ensureSpace(doc: jsPDF, y: number, needed: number): number {
  const pageHeight = doc.internal.pageSize.getHeight()
  if (y + needed > pageHeight - PAGE_MARGIN) {
    doc.addPage()
    return PAGE_MARGIN + 22
  }
  return y
}

function addSectionTitle(doc: jsPDF, y: number, title: string, subtitle?: string): number {
  y = ensureSpace(doc, y, subtitle ? 24 : 14)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(14)
  doc.text(title, PAGE_MARGIN, y)
  y += 6
  if (subtitle) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    const lines = doc.splitTextToSize(subtitle, doc.internal.pageSize.getWidth() - PAGE_MARGIN * 2)
    doc.text(lines, PAGE_MARGIN, y)
    y += lines.length * 4.5 + 4
  } else {
    y += 4
  }
  return y
}

function drawStatCards(
  doc: jsPDF,
  y: number,
  cardW: number,
  cardH: number,
  cards: Array<{ label: string; value: string; note: string }>,
  fill: [number, number, number],
  valueFontSize = 12,
): number {
  cards.forEach((card, index) => {
    const x = PAGE_MARGIN + index * (cardW + 4)
    doc.setDrawColor(210, 210, 210)
    doc.setFillColor(...fill)
    doc.roundedRect(x, y, cardW, cardH, 2, 2, 'FD')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7)
    doc.setTextColor(90, 90, 90)
    doc.text(card.label, x + 4, y + 7)
    doc.setFont('helvetica', 'bold')
    let size = valueFontSize
    doc.setFontSize(size)
    while (size > 8 && doc.getTextWidth(card.value) > cardW - 8) {
      size -= 1
      doc.setFontSize(size)
    }
    doc.setTextColor(20, 20, 20)
    doc.text(card.value, x + 4, y + 17)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7)
    doc.setTextColor(110, 110, 110)
    const noteLines = doc.splitTextToSize(card.note, cardW - 8)
    doc.text(noteLines, x + 4, y + 23)
  })
  doc.setTextColor(0, 0, 0)
  return y + cardH + 8
}

function addDashboardPage(doc: jsPDF, presentation: RcbPresentation): void {
  const pageWidth = doc.internal.pageSize.getWidth()
  const { summary: s, totals: T, budgetAnalytics: a } = presentation
  let y = PAGE_MARGIN

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(18)
  doc.text('Rooftop HVAC Unit (RTU) Replacement Plan', PAGE_MARGIN, y)
  y += 8
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.setTextColor(80, 80, 80)
  doc.text(`Capital forecast — ${presentation.scopeLabel}   •   Prepared ${presentation.preparedDate}`, PAGE_MARGIN, y)
  y += 10
  doc.setTextColor(0, 0, 0)

  const intro =
    `This plan covers rooftop heating & cooling units that have reached the end of their ${presentation.threshold}-year service life. Replacing them on schedule protects tenant comfort, avoids emergency breakdown costs, and spreads spending over several years.`
  const introLines = doc.splitTextToSize(intro, pageWidth - PAGE_MARGIN * 2)
  doc.setFontSize(9)
  doc.text(introLines, PAGE_MARGIN, y)
  y += introLines.length * 4.5 + 8

  const cardW = (pageWidth - PAGE_MARGIN * 2 - 8) / 3
  const cardH = 28
  y = drawStatCards(
    doc,
    y,
    cardW,
    cardH,
    [
      { label: 'TOTAL PLANNED COST', value: formatMoney(s.totalCost), note: 'Scheduled replacement (CAD)' },
      { label: 'UNITS TO REPLACE', value: String(T.units), note: `across ${T.bldgCount} buildings` },
      {
        label: 'AVG COST / UNIT',
        value: T.units > 0 ? formatMoney(s.avgUnitCost || Math.round(T.cost / T.units)) : '—',
        note: 'installed, all-in',
      },
    ],
    [248, 250, 252],
    14,
  )

  const hasBudget = a.totalBudget > 0
  const varianceNote = !hasBudget
    ? 'No budget entered yet'
    : a.variance > 0
      ? 'Budget covers estimate (surplus)'
      : a.variance < 0
        ? 'Estimate exceeds budget'
        : 'Budget matches estimate'
  y = drawStatCards(
    doc,
    y,
    cardW,
    cardH,
    [
      {
        label: 'TOTAL BUDGET',
        value: hasBudget ? formatMoney(a.totalBudget) : '—',
        note: hasBudget
          ? `${a.buildingsWithBudget} buildings · ${a.unitsWithBudget} RTUs`
          : 'Enter Capex / RTU budgets',
      },
      {
        label: 'VARIANCE (BUDGET − EST.)',
        value: hasBudget ? formatMoney(a.variance) : '—',
        note: varianceNote,
      },
      {
        label: 'AVG UNIT AGE',
        value: s.avgAge != null ? `${s.avgAge} yrs` : '—',
        note: `service limit is ${presentation.threshold} yrs`,
      },
    ],
    [255, 255, 255],
  )

  y = addSectionTitle(doc, y, 'Budget vs Estimated Cost')
  autoTable(doc, {
    startY: y,
    margin: { left: PAGE_MARGIN, right: PAGE_MARGIN },
    head: [['Total Budget', 'Estimated Cost', 'Variance (Budget − Est.)', 'Budget Coverage']],
    body: [
      [
        hasBudget ? formatMoney(a.totalBudget) : '—',
        formatMoney(a.totalCost),
        hasBudget ? formatMoney(a.variance) : '—',
        hasBudget && a.coverage != null ? formatPercent(a.coverage) : '—',
      ],
      [
        `Buildings with budget: ${a.buildingsWithBudget}`,
        `Over budget: ${a.buildingsOverBudget}`,
        `At/under budget: ${a.buildingsUnderOrEqual}`,
        `RTUs with budget: ${a.unitsWithBudget}`,
      ],
    ],
    styles: { fontSize: 8, cellPadding: 2.5 },
    headStyles: { fillColor: HEADER_COLOR, textColor: 255 },
  })
  y = (doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y
  y += 10

  y = addSectionTitle(doc, y, 'Where the Money Goes — By Portfolio')

  autoTable(doc, {
    startY: y,
    margin: { left: PAGE_MARGIN, right: PAGE_MARGIN },
    head: [['Portfolio', 'Manager', 'Units', 'Cost', 'Budget', 'Variance']],
    body: [
      ...presentation.portfolios.map((row) => [
        row.park,
        row.manager,
        String(row.units),
        formatMoney(row.cost),
        row.budget > 0 ? formatMoney(row.budget) : '—',
        row.budget > 0 ? formatMoney(row.variance) : '—',
      ]),
      [
        'TOTAL',
        '',
        String(T.units),
        formatMoney(T.cost),
        hasBudget ? formatMoney(a.totalBudget) : '—',
        hasBudget ? formatMoney(a.variance) : '—',
      ],
    ],
    styles: { fontSize: 8, cellPadding: 2.5 },
    headStyles: { fillColor: HEADER_COLOR, textColor: 255 },
    footStyles: { fillColor: [240, 240, 240], textColor: 0, fontStyle: 'bold' },
  })
}

function addByBuildingSection(doc: jsPDF, presentation: RcbPresentation): void {
  doc.addPage()
  addPageHeader(doc, 'Cost by Building', presentation)
  let y = PAGE_MARGIN + 22
  y = addSectionTitle(
    doc,
    y,
    'Cost by Building',
    'Every building with units due for replacement, ranked by total cost.',
  )

  autoTable(doc, {
    startY: y,
    margin: { left: PAGE_MARGIN, right: PAGE_MARGIN },
    head: [
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
      ],
    ],
    body: [
      ...presentation.buildings.map((row) => [
        row.address,
        row.park,
        row.cluster || '—',
        row.manager,
        String(row.units),
        formatMoney(row.cost),
        row.budget > 0 ? formatMoney(row.budget) : '—',
        row.budgetYears || '—',
        row.removedBudgetYears.join(' · ') || '—',
      ]),
      [
        'TOTAL',
        '',
        '',
        '',
        String(presentation.totals.units),
        formatMoney(presentation.totals.cost),
        presentation.totalsBudget > 0 ? formatMoney(presentation.totalsBudget) : '—',
        '',
        '',
      ],
    ],
    styles: { fontSize: 7, cellPadding: 1.8 },
    headStyles: { fillColor: HEADER_COLOR, textColor: 255 },
    columnStyles: {
      0: { cellWidth: 30 },
      2: { cellWidth: 22 },
      5: { halign: 'right' },
      6: { halign: 'right' },
      7: { cellWidth: 22 },
      8: { cellWidth: 18 },
      9: { halign: 'right' },
    },
  })
}

function addByUnitSizeSection(doc: jsPDF, presentation: RcbPresentation): void {
  doc.addPage()
  addPageHeader(doc, 'Cost by Unit Size', presentation)
  let y = PAGE_MARGIN + 22
  y = addSectionTitle(
    doc,
    y,
    'Cost by Unit Size',
    'Bigger rooftop units cost more to replace. Grouped by cooling capacity (tons).',
  )

  autoTable(doc, {
    startY: y,
    margin: { left: PAGE_MARGIN, right: PAGE_MARGIN },
    head: [['Unit Size', 'Avg Cost / Unit', 'Quantity', 'Total Cost']],
    body: [
      ...presentation.unitSizes.map((row) => [
        row.label,
        formatMoney(row.avgCost),
        String(row.qty),
        formatMoney(row.total),
      ]),
      [
        'TOTAL',
        presentation.totals.units
          ? formatMoney(presentation.summary.avgUnitCost)
          : '—',
        String(presentation.totals.units),
        formatMoney(presentation.totals.cost),
      ],
    ],
    styles: { fontSize: 9, cellPadding: 3 },
    headStyles: { fillColor: HEADER_COLOR, textColor: 255 },
    columnStyles: {
      1: { halign: 'right' },
      2: { halign: 'right' },
      3: { halign: 'right' },
    },
  })
}

function addPricingSection(doc: jsPDF, presentation: RcbPresentation): void {
  doc.addPage('a4', presentation.pricing.years.length > 4 ? 'landscape' : 'portrait')
  addPageHeader(doc, 'RTU Pricing by Tonnage', presentation)
  let y = PAGE_MARGIN + 22
  y = addSectionTitle(doc, y, 'RTU Pricing by Tonnage', `Pricing basis: ${presentation.pricing.basisLabel}`)

  autoTable(doc, {
    startY: y,
    margin: { left: PAGE_MARGIN, right: PAGE_MARGIN },
    head: [['Unit Size', ...presentation.pricing.years.map((year) => year)]],
    body: presentation.pricing.rows.map((row) => [
      row.label,
      ...presentation.pricing.years.map((year) => formatMoney(row.costsByYear[year] ?? 0)),
    ]),
    styles: { fontSize: presentation.pricing.years.length > 4 ? 7 : 8.5, cellPadding: 2.5 },
    headStyles: { fillColor: HEADER_COLOR, textColor: 255 },
    columnStyles: Object.fromEntries(
      presentation.pricing.years.map((_, index) => [index + 1, { halign: 'right' as const }]),
    ),
  })
}

function addAllUnitsSection(doc: jsPDF, presentation: RcbPresentation): void {
  doc.addPage('a4', 'landscape')
  addPageHeader(doc, 'All Units — Full Detail', presentation)
  const y = PAGE_MARGIN + 22

  const tableFontSize = 6
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(tableFontSize)
  const modelPad = 3
  let modelWidth = doc.getTextWidth('Model') + modelPad
  for (const item of presentation.units) {
    const text = item.model?.trim() || ''
    if (!text) continue
    modelWidth = Math.max(modelWidth, doc.getTextWidth(text) + modelPad)
  }
  // Cap so long models wrap instead of crushing other columns
  const pageWidth = doc.internal.pageSize.getWidth()
  const maxModelWidth = Math.min(48, pageWidth * 0.18)
  modelWidth = Math.min(Math.max(modelWidth, 12), maxModelWidth)

  autoTable(doc, {
    startY: y,
    margin: { left: PAGE_MARGIN, right: PAGE_MARGIN },
    head: [
      [
        'Building',
        'Portfolio',
        'Manager',
        'Unit',
        'Make',
        'Model',
        'Installed',
        'Age on Repl. Year',
        'Tons',
        'Eligible Year',
        'Estimated Cost',
        'RTU $ Allocation',
      ],
    ],
    body: presentation.units.map((item) => [
      item.address,
      item.park,
      item.manager,
      item.rtu,
      item.make || '',
      item.model || '',
      item.year != null ? String(item.year) : '',
      item.age != null ? String(item.age) : '',
      item.tons != null ? String(item.tons) : '',
      item.replacementYear,
      formatMoney(item.cost),
      item.budget != null && item.budget > 0 ? formatMoney(item.budget) : '—',
    ]),
    styles: { fontSize: tableFontSize, cellPadding: 1.5, overflow: 'linebreak' },
    headStyles: { fillColor: HEADER_COLOR, textColor: 255 },
    columnStyles: {
      0: { cellWidth: 28 },
      3: { cellWidth: 22 },
      5: { cellWidth: modelWidth, overflow: 'linebreak' },
      10: { halign: 'right' },
      11: { halign: 'right' },
    },
    didParseCell(data) {
      if (data.section !== 'body') return
      const unitName = presentation.units[data.row.index]?.rtu
      if (unitName && isRtuFlaggedForReview(unitName)) {
        data.cell.styles.fillColor = FLAGGED_FILL
      }
    },
  })
}

function addPageNumbers(doc: jsPDF): void {
  const total = doc.getNumberOfPages()
  for (let page = 1; page <= total; page++) {
    doc.setPage(page)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(120, 120, 120)
    const pageWidth = doc.internal.pageSize.getWidth()
    const pageHeight = doc.internal.pageSize.getHeight()
    doc.text(`Page ${page} of ${total}`, pageWidth - PAGE_MARGIN, pageHeight - 8, { align: 'right' })
  }
  doc.setTextColor(0, 0, 0)
}

/** Export RTU replacement cost estimate (RCB) to a presentation PDF. */
export function exportRcbPdf(
  result: RcbComputeResult,
  scopeLabel: string,
  options: {
    replacementYearByRtu?: Record<string, string>
    replacementNotesByRtu?: BuildRcbPresentationOptions['replacementNotesByRtu']
    pricingTable?: RcbPricingTable
    includeScheduledUnit?: BuildRcbPresentationOptions['includeScheduledUnit']
    rtuBudgets?: BuildRcbPresentationOptions['rtuBudgets']
    buildingYearBudgets?: BuildRcbPresentationOptions['buildingYearBudgets']
    buildingYearNotes?: BuildRcbPresentationOptions['buildingYearNotes']
    excludedBudgets?: BuildRcbPresentationOptions['excludedBudgets']
    shareAddressesFor?: BuildRcbPresentationOptions['shareAddressesFor']
    budgetDedupeKeyFor?: BuildRcbPresentationOptions['budgetDedupeKeyFor']
    filenameScope?: string
    filenameYear?: string
  } = {},
): void {
  const presentation = buildRcbPresentation(result, scopeLabel, {
    replacementYearByRtu: options.replacementYearByRtu,
    replacementNotesByRtu: options.replacementNotesByRtu,
    pricingTable: options.pricingTable ?? DEFAULT_RCB_PRICING,
    includeScheduledUnit: options.includeScheduledUnit,
    rtuBudgets: options.rtuBudgets,
    buildingYearBudgets: options.buildingYearBudgets,
    buildingYearNotes: options.buildingYearNotes,
    excludedBudgets: options.excludedBudgets,
    shareAddressesFor: options.shareAddressesFor,
    budgetDedupeKeyFor: options.budgetDedupeKeyFor,
  })

  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' })
  addDashboardPage(doc, presentation)
  addByBuildingSection(doc, presentation)
  addByUnitSizeSection(doc, presentation)
  addPricingSection(doc, presentation)
  addAllUnitsSection(doc, presentation)
  addPageNumbers(doc)

  const scopeForName = options.filenameScope ?? scopeLabel
  const yearForName = options.filenameYear ?? presentation.defaultYear
  doc.save(`${rcbExportFilenameBase(scopeForName, yearForName)}.pdf`)
}
