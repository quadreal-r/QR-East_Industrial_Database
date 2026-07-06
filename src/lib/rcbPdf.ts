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

function addDashboardPage(doc: jsPDF, presentation: RcbPresentation): void {
  const pageWidth = doc.internal.pageSize.getWidth()
  const { summary: s, totals: T } = presentation
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
  const cards = [
    { label: 'TOTAL PLANNED COST', value: formatMoney(s.totalCost), note: 'Scheduled replacement (CAD)' },
    { label: 'UNITS TO REPLACE', value: String(T.units), note: `across ${T.bldgCount} buildings` },
    { label: 'AVERAGE COST / UNIT', value: formatMoney(s.avgUnitCost), note: 'installed, all-in' },
  ]

  cards.forEach((card, index) => {
    const x = PAGE_MARGIN + index * (cardW + 4)
    doc.setDrawColor(210, 210, 210)
    doc.setFillColor(248, 250, 252)
    doc.roundedRect(x, y, cardW, cardH, 2, 2, 'FD')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7)
    doc.setTextColor(90, 90, 90)
    doc.text(card.label, x + 4, y + 7)
    doc.setFontSize(14)
    doc.setTextColor(20, 20, 20)
    doc.text(card.value, x + 4, y + 17)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7)
    doc.setTextColor(110, 110, 110)
    doc.text(card.note, x + 4, y + 24)
  })
  y += cardH + 8
  doc.setTextColor(0, 0, 0)

  const dueCards = [
    {
      label: `DUE NOW (${presentation.defaultYear})`,
      value: formatMoney(s.dueNowCost),
      note: `${s.dueNowUnits} units at/over age limit`,
    },
    {
      label: 'POTENTIAL SAVINGS',
      value: s.flaggedSavings > 0 ? formatMoney(s.flaggedSavings) : '—',
      note:
        s.flaggedCount > 0
          ? `${s.flaggedCount} units flagged redundant / disconnected`
          : 'No flagged units',
    },
    {
      label: 'AVG UNIT AGE',
      value: s.avgAge != null ? `${s.avgAge} yrs` : '—',
      note: `service limit is ${presentation.threshold} yrs`,
    },
  ]

  dueCards.forEach((card, index) => {
    const x = PAGE_MARGIN + index * (cardW + 4)
    doc.setDrawColor(210, 210, 210)
    doc.setFillColor(255, 255, 255)
    doc.roundedRect(x, y, cardW, cardH, 2, 2, 'FD')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7)
    doc.setTextColor(90, 90, 90)
    doc.text(card.label, x + 4, y + 7)
    doc.setFontSize(12)
    doc.setTextColor(20, 20, 20)
    doc.text(card.value, x + 4, y + 17)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7)
    doc.setTextColor(110, 110, 110)
    const noteLines = doc.splitTextToSize(card.note, cardW - 8)
    doc.text(noteLines, x + 4, y + 23)
  })
  y += cardH + 10

  y = addSectionTitle(doc, y, 'Where the Money Goes — By Portfolio')

  autoTable(doc, {
    startY: y,
    margin: { left: PAGE_MARGIN, right: PAGE_MARGIN },
    head: [['Portfolio', 'Manager', 'Units', 'Cost (CAD)', 'Share']],
    body: [
      ...presentation.portfolios.map((row) => [
        row.park,
        row.manager,
        String(row.units),
        formatMoney(row.cost),
        formatPercent(row.share),
      ]),
      ['TOTAL', '', String(T.units), formatMoney(T.cost), T.cost ? formatPercent(1) : '—'],
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
    head: [['Building', 'Portfolio', 'Manager', 'Units', 'Cost (CAD)', 'Share']],
    body: [
      ...presentation.buildings.map((row) => [
        row.address,
        row.park,
        row.manager,
        String(row.units),
        formatMoney(row.cost),
        formatPercent(row.share),
      ]),
      ['TOTAL', '', '', String(presentation.totals.units), formatMoney(presentation.totals.cost), ''],
    ],
    styles: { fontSize: 7.5, cellPadding: 2 },
    headStyles: { fillColor: HEADER_COLOR, textColor: 255 },
    columnStyles: {
      0: { cellWidth: 42 },
      4: { halign: 'right' },
      5: { halign: 'right' },
    },
  })
}

function addCostOfWaitingSection(doc: jsPDF, presentation: RcbPresentation): void {
  doc.addPage()
  addPageHeader(doc, 'The Cost of Waiting', presentation)
  let y = PAGE_MARGIN + 22
  y = addSectionTitle(
    doc,
    y,
    'The Cost of Waiting',
    'If we delayed and replaced ALL units in a single future year, prices climb with inflation.',
  )

  autoTable(doc, {
    startY: y,
    margin: { left: PAGE_MARGIN, right: PAGE_MARGIN },
    head: [
      [
        'If replaced in…',
        'Total Cost (CAD)',
        `Extra vs. ${presentation.waiting.baseYear}`,
        '% More Expensive',
      ],
    ],
    body: presentation.waiting.rows.map((row) => [
      String(row.year),
      formatMoney(row.total),
      formatMoney(row.extra),
      formatPercent(row.pctMore),
    ]),
    styles: { fontSize: 9, cellPadding: 3 },
    headStyles: { fillColor: HEADER_COLOR, textColor: 255 },
    columnStyles: {
      1: { halign: 'right' },
      2: { halign: 'right' },
      3: { halign: 'right' },
    },
  })

  if (presentation.waiting.phasedNote) {
    const finalY = (doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y + 20
    doc.setFont('helvetica', 'italic')
    doc.setFontSize(8.5)
    const lines = doc.splitTextToSize(presentation.waiting.phasedNote, doc.internal.pageSize.getWidth() - PAGE_MARGIN * 2)
    doc.text(lines, PAGE_MARGIN, finalY + 10)
  }
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
    head: [['Unit Size', 'Avg Cost / Unit (CAD)', 'Quantity', 'Total Cost (CAD)']],
    body: [
      ...presentation.unitSizes.map((row) => [
        row.label,
        formatMoney(row.avgCost),
        String(row.qty),
        formatMoney(row.total),
      ]),
      ['TOTAL', '', String(presentation.totals.units), formatMoney(presentation.totals.cost)],
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

function addAllUnitsSection(doc: jsPDF, presentation: RcbPresentation): void {
  doc.addPage('a4', 'landscape')
  addPageHeader(doc, 'All Units — Full Detail', presentation)
  const y = PAGE_MARGIN + 22

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
        'Age',
        'Tons',
        'Replace Yr',
        'Cost (CAD)',
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
    ]),
    styles: { fontSize: 6.5, cellPadding: 1.8, overflow: 'linebreak' },
    headStyles: { fillColor: HEADER_COLOR, textColor: 255 },
    columnStyles: {
      0: { cellWidth: 34 },
      3: { cellWidth: 28 },
      5: { cellWidth: 30 },
      10: { halign: 'right' },
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
    pricingTable?: RcbPricingTable
  } = {},
): void {
  const presentation = buildRcbPresentation(result, scopeLabel, {
    replacementYearByRtu: options.replacementYearByRtu,
    pricingTable: options.pricingTable ?? DEFAULT_RCB_PRICING,
  })

  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' })
  addDashboardPage(doc, presentation)
  addByBuildingSection(doc, presentation)
  addCostOfWaitingSection(doc, presentation)
  addByUnitSizeSection(doc, presentation)
  addAllUnitsSection(doc, presentation)
  addPageNumbers(doc)

  doc.save(`${rcbExportFilenameBase(scopeLabel, presentation.defaultYear, presentation.today)}.pdf`)
}
