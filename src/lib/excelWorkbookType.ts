/** Detect portfolio export, RCB cost report, or Capital RTU Replacement workbook. */
export type ExcelWorkbookKind = 'portfolio' | 'rcbReport' | 'capital'

export function detectExcelWorkbookKind(sheetNames: string[]): ExcelWorkbookKind {
  const names = sheetNames.map((name) => name.trim())
  const hasBuildings = names.includes('Buildings')
  const hasRtus = names.includes('RTUs')
  const hasUtilities = names.includes('Utilities')
  const hasPolygons = names.some(
    (name) => /^tenant polygons$/i.test(name) || name === 'Polygons',
  )

  if (hasBuildings && hasRtus && hasUtilities && hasPolygons) {
    return 'portfolio'
  }

  const hasEquipment = names.some((name) => /^equipment$/i.test(name))
  const hasPricing = names.some((name) => /^rtu pricing$/i.test(name))
  const hasAllUnits = names.some((name) => /^all units$/i.test(name))
  const hasDashboard = names.some((name) => /^dashboard$/i.test(name))

  // RTU Replacement Cost Center Excel export (report) — before Capital, both share “RTU Pricing”.
  if (hasPricing && hasAllUnits && (hasDashboard || !hasEquipment)) {
    return 'rcbReport'
  }

  if (hasEquipment || hasPricing) {
    return 'capital'
  }

  throw new Error(
    'Unrecognized workbook. Use the exported portfolio Excel (Buildings, RTUs, Tenant Polygons, Utilities), the RTU Replacement Cost Center Excel export, or the Capital RTU Replacement workbook (Equipment and RTU Pricing sheets).',
  )
}
