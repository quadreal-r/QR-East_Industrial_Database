import * as XLSX from 'xlsx'
import type { Building, Polygon, PortfolioData, Rtu, Utility } from '@/types/domain'
import {
  normalizeLegacyBuilding,
  normalizeLegacyPolygon,
  normalizeLegacyUtility,
  type LegacyBuildingJson,
  type LegacyPolygonJson,
} from '@/types/domain'
import {
  buildPolygonBuildingIndex,
  buildingForPolygon,
  formatSuiteExportLabel,
  parseSuiteImportLabel,
  polygonCentroid,
  tenantPolygonCount,
} from '@/lib/polygonBuildings'
import { loadRtuPictureManifest, rtuPictureKey } from '@/lib/rtuPictures'
import { buildRtuPictureExportBundle } from '@/lib/rtuPictureExport'
import { injectFreezePanes } from '@/lib/xlsxFreeze'
import type { RcbComputeResult } from '@/lib/costEstimator'
import {
  rcbBuildScheduledExport,
  rcbCostForTier,
  rcbProjection,
} from '@/lib/costEstimator'
import type { RcbPricingTable } from '@/lib/costEstimator.pricing'
import { DEFAULT_RCB_PRICING } from '@/lib/costEstimator.pricing'

const FMT_COORD = '0.0000000'
const FMT_INT = '#,##0'

const EXPORT_SHEETS = ['Buildings', 'RTUs', 'Tenant Polygons', 'Utilities'] as const
const POLYGON_SHEET_ALIASES = ['Tenant Polygons', 'Polygons'] as const

/** Column widths from QuadReal_Industrial_Portfolio.xlsx sample export. */
const COL_WIDTHS = {
  buildings: [32.875, 12.875, 28.875, 24.875, 18.875, 10.875, 12.875, 11.875, 16.125, 14.875, 14.875],
  rtus: [32.875, 28.875, 20.875, 18.875, 23.375, 28.875, 16.875, 12.875, 16.875, 22.875, 22.875, 14.875, 18, 44.875, 10, 12, 48, 72],
  rtuPictures: [32.875, 28.875, 20.875, 18.875, 23.375, 36.875, 40.875, 12.875, 28.875, 16, 48, 72],
  polygons: [32.875, 12.875, 28.875, 16.875, 48.875, 36.875, 12.125, 8.875, 14.875, 14.875, 14.875],
  utilities: [20.875, 38.875, 40.875, 14.875, 14.875],
} as const

function str(value: unknown): string {
  return String(value ?? '').trim()
}

/** Sq ft as comma-formatted text (sample stores "48,030" with #,##0). */
export function formatSqftExport(sqft: string | undefined | null): string {
  const raw = str(sqft)
  if (!raw) return ''
  const digits = raw.replace(/[^\d]/g, '')
  if (!digits) return raw
  return Number(digits).toLocaleString('en-US')
}

function flt(value: unknown): number {
  return parseFloat(str(value)) || 0
}

function fmtDate(value: unknown): string {
  if (!value) return ''
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const mo = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    return `${mo[value.getMonth()]} ${String(value.getDate()).padStart(2, '0')}, ${value.getFullYear()}`
  }
  return str(value)
}

function parseInstallFields(desc: string): {
  model: string
  serial: string
  make: string
  installed: string
  heating: string
  cooling: string
} {
  const pick = (re: RegExp) => {
    const m = desc.match(re)
    return m?.[1]?.trim() ?? ''
  }
  return {
    model: pick(/Model[:\s]+([^\r\n]+)/i),
    serial: pick(/Serial[:\s]+([^\r\n]+)/i),
    make: pick(/Make[:\s]+([^\r\n]+)/i),
    installed: pick(/Date Installed[:\s]+([^\r\n]+)/i),
    heating: pick(/Heating(?: Capacity| Data)?[:\s]+([^\r\n]+)/i),
    cooling: pick(/Cooling Capacity[:\s]+([^\r\n]+)/i),
  }
}

const STRUCTURED_RTU_NOTE_KEYS = new Set([
  'building',
  'system',
  'description',
  'model',
  'serial',
  'make',
  'date installed',
  'heating capacity',
  'heating data',
  'heating',
  'cooling capacity',
  'suite',
])

function rtuNoteKey(line: string): string | null {
  const idx = line.indexOf(':')
  if (idx <= 0) return null
  return line.slice(0, idx).trim().toLowerCase()
}

function splitNoteLines(notes: string): string[] {
  return notes
    .split(/\s*\|\s*|\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
}

function uniqueNoteLines(lines: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const line of lines) {
    const norm = line.toLowerCase().replace(/\s+/g, ' ').trim()
    if (seen.has(norm)) continue
    seen.add(norm)
    out.push(line)
  }
  return out
}

function isStructuredRtuNoteLine(line: string): boolean {
  const key = rtuNoteKey(line)
  if (!key) return false
  return STRUCTURED_RTU_NOTE_KEYS.has(key)
}

/** Build RTU description on import without duplicating Notes column content. */
export function buildRtuImportDescription(
  row: Record<string, unknown>,
  address: string,
): string {
  const name = str(row['RTU Name'])
  const parts = [
    `Building: ${address}`,
    'System: Roof Top Units',
    name ? `Description: ${name}` : '',
    str(row['Model']) ? `Model: ${str(row['Model'])}` : '',
    str(row['Serial']) ? `Serial: ${str(row['Serial'])}` : '',
    str(row['Make']) ? `Make: ${str(row['Make'])}` : '',
    row['Date Installed'] ? `Date Installed: ${fmtDate(row['Date Installed'])}` : '',
    row['Heating Capacity'] ? `Heating Capacity: ${str(row['Heating Capacity'])}` : '',
    row['Cooling Capacity'] ? `Cooling Capacity: ${str(row['Cooling Capacity'])}` : '',
  ].filter(Boolean)

  const builtKeys = new Set(parts.map((line) => rtuNoteKey(line)).filter((key): key is string => key != null))

  const notesRaw = str(row['Notes'])
  if (!notesRaw) return parts.join('\r\n')

  const noteLines = uniqueNoteLines(splitNoteLines(notesRaw))
  const hasStructuredColumns = Boolean(
    name || str(row['Model']) || str(row['Serial']) || str(row['Make']),
  )

  if (!hasStructuredColumns) return noteLines.join('\r\n')

  const extras: string[] = []
  for (const line of noteLines) {
    const key = rtuNoteKey(line)
    if (!key) {
      extras.push(line)
      continue
    }
    if (isStructuredRtuNoteLine(line)) {
      if (!builtKeys.has(key)) {
        parts.push(line)
        builtKeys.add(key)
      }
      continue
    }
    extras.push(line)
  }

  return [...parts, ...extras].join('\r\n')
}

/** Free-text fragment that merely restates the Heating/Cooling Capacity columns (J/K). */
const CAPACITY_RESTATEMENT_RE = /^(?:heating|cooling)\s+(?:capacity|data)\b/i

/** Drop `;`-separated fragments that duplicate the Heating/Cooling Capacity columns. */
export function stripCapacityRestatement(line: string): string {
  return line
    .split(';')
    .map((fragment) => fragment.trim())
    .filter((fragment) => fragment && !CAPACITY_RESTATEMENT_RE.test(fragment))
    .join('; ')
}

export function rtuNotesForExport(description: string): string {
  const supplemental = uniqueNoteLines(splitNoteLines(description.replace(/\r\n/g, ' | ')))
    .filter((line) => !isStructuredRtuNoteLine(line))
    .map(stripCapacityRestatement)
    .filter(Boolean)
  return supplemental.join(' | ')
}

interface BuildSheetOptions {
  numFmtMap?: Record<number, string>
  /** Autofilter through this many columns (defaults to full width). */
  autofilterCols?: number
}

function buildSheet(
  headers: string[],
  rows: unknown[][],
  colWidths: readonly number[],
  options: BuildSheetOptions = {},
): XLSX.WorkSheet {
  const { numFmtMap = {}, autofilterCols } = options
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows])
  ws['!cols'] = colWidths.map((w) => ({ wch: w }))

  const ref = ws['!ref']
  if (ref) {
    const range = XLSX.utils.decode_range(ref)
    for (let r = 1; r <= range.e.r; r++) {
      for (let c = range.s.c; c <= range.e.c; c++) {
        const addr = XLSX.utils.encode_cell({ r, c })
        const cell = ws[addr]
        if (!cell) continue
        const fmt = numFmtMap[c]
        if (fmt) cell.z = fmt
      }
    }
    const filterEndCol = autofilterCols != null ? autofilterCols - 1 : range.e.c
    const lastCol = XLSX.utils.encode_col(filterEndCol)
    const lastRow = range.e.r + 1
    ws['!autofilter'] = { ref: `A1:${lastCol}${lastRow}` }
  }

  return ws
}

function resolvePolygonSheetName(sheetNames: string[]): string | null {
  for (const name of POLYGON_SHEET_ALIASES) {
    if (sheetNames.includes(name)) return name
  }
  return null
}

/** `QuadReal_Industrial_DB_Export_2026.06.25.xlsx` using local calendar date. */
export function exportDatabaseExcelFilename(date = new Date()): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `QuadReal_Industrial_DB_Export_${year}.${month}.${day}.xlsx`
}

/** Export portfolio data to an Excel workbook (legacy-compatible sheets + RTU pictures). */
export async function exportPortfolioExcel(
  data: PortfolioData,
  filename = exportDatabaseExcelFilename(),
): Promise<void> {
  const { buildings, utilities, polygons } = data
  const polygonIndex = buildPolygonBuildingIndex(buildings, polygons)
  const manifest = await loadRtuPictureManifest()
  const pictureExport = buildRtuPictureExportBundle(data, manifest)

  const buildingsRows: unknown[][] = []
  const rtusRows: unknown[][] = []
  let rtuCount = 0

  for (const b of buildings) {
    buildingsRows.push([
      b.address,
      b.bu ?? '',
      b.park,
      b.cluster ?? '',
      b.manager ?? '',
      formatSqftExport(b.sqft),
      b.sold ? 'SOLD' : 'Active',
      b.rtus?.length ?? 0,
      tenantPolygonCount(polygonIndex, b.address),
      parseFloat(b.lat.toFixed(7)),
      parseFloat(b.lng.toFixed(7)),
    ])

    for (const r of b.rtus ?? []) {
      rtuCount += 1
      const fields = parseInstallFields(r.description)
      const pictureSummary = pictureExport.summaryByKey.get(rtuPictureKey(b.address, r.name)) ?? {
        count: 0,
        fileNames: '',
        pictureUrls: '',
      }
      rtusRows.push([
        b.address,
        b.park,
        b.cluster ?? '',
        b.manager ?? '',
        r.name,
        fields.model,
        fields.serial,
        fields.make,
        fields.installed,
        fields.heating,
        fields.cooling,
        parseFloat(r.lat.toFixed(7)),
        parseFloat(r.lng.toFixed(7)),
        rtuNotesForExport(r.description),
        rtuCount,
        pictureSummary.count,
        pictureSummary.fileNames,
        pictureSummary.pictureUrls,
      ])
    }
  }

  const polygonsRows = polygons.map((p) => {
    const c = polygonCentroid(p.paths)
    const b = buildingForPolygon(buildings, p)
    const address = b?.address ?? ''
    return [
      address,
      b?.park ?? '',
      b?.cluster ?? '',
      b?.manager ?? '',
      formatSuiteExportLabel(p.name, address),
      p.description,
      p.paths.length,
      p.color,
      JSON.stringify(p.paths),
      parseFloat(c.lat.toFixed(7)),
      parseFloat(c.lng.toFixed(7)),
    ]
  })

  const utilitiesRows = utilities.map((u) => [
    u.utility_type,
    u.name,
    u.description,
    parseFloat(u.lat.toFixed(7)),
    parseFloat(u.lng.toFixed(7)),
  ])

  const rtuPictureDetailRows = pictureExport.rows.map((row) => [
    row.buildingAddress,
    row.park,
    row.cluster,
    row.manager,
    row.rtuName,
    row.manifestKey,
    row.pictureIndex,
    row.fileName,
    row.storage,
    row.pictureUrl,
  ])

  const rtuPictureSheetRows: unknown[][] = [
    ['RTU picture references (Cloudflare R2)'],
    ['Pictures base URL', pictureExport.picturesBaseUrl],
    ['Manifest JSON URL', pictureExport.manifestUrl],
    ['Picture rows', pictureExport.rows.length],
    [
      'RTUs with pictures',
      [...pictureExport.summaryByKey.values()].filter((summary) => summary.count > 0).length,
    ],
    [],
    [
      'Building Address',
      'Portfolio',
      'Cluster',
      'Manager',
      'RTU Name',
      'Manifest Key',
      'Picture Index',
      'File Name',
      'Storage',
      'Picture URL (Cloudflare)',
    ],
    ...rtuPictureDetailRows,
  ]

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(
    wb,
    buildSheet(
      [
        'Building Address',
        'BU #',
        'Portfolio',
        'Cluster',
        'Manager',
        'Sq Ft',
        'Status',
        'RTU Count',
        'Tenant Polygons',
        'Latitude',
        'Longitude',
      ],
      buildingsRows,
      COL_WIDTHS.buildings,
      { numFmtMap: { 5: FMT_INT, 7: FMT_INT, 8: FMT_INT, 9: FMT_COORD, 10: FMT_COORD } },
    ),
    'Buildings',
  )
  XLSX.utils.book_append_sheet(
    wb,
    buildSheet(
      [
        'Building Address',
        'Portfolio',
        'Cluster',
        'Manager',
        'RTU Name',
        'Model',
        'Serial',
        'Make',
        'Date Installed',
        'Heating Capacity',
        'Cooling Capacity',
        'Latitude',
        'Longitude',
        'Notes',
        'Count',
        'Picture Count',
        'Picture Files',
        'Picture URLs (Cloudflare)',
      ],
      rtusRows,
      COL_WIDTHS.rtus,
      {
        numFmtMap: { 11: FMT_COORD, 12: FMT_COORD },
        autofilterCols: 18,
      },
    ),
    'RTUs',
  )
  XLSX.utils.book_append_sheet(
    wb,
    (() => {
      const ws = XLSX.utils.aoa_to_sheet(rtuPictureSheetRows)
      ws['!cols'] = COL_WIDTHS.rtuPictures.map((wch) => ({ wch }))
      const lastRow = rtuPictureSheetRows.length
      ws['!autofilter'] = { ref: `A7:J${lastRow}` }
      return ws
    })(),
    'RTU Pictures',
  )
  XLSX.utils.book_append_sheet(
    wb,
    buildSheet(
      [
        'Building Address',
        'Portfolio',
        'Cluster',
        'Manager',
        'Suite',
        'Tenant Name',
        'Point Count',
        'Color',
        'Paths (JSON)',
        'Centroid Lat',
        'Centroid Lng',
      ],
      polygonsRows,
      COL_WIDTHS.polygons,
      { numFmtMap: { 9: FMT_COORD, 10: FMT_COORD } },
    ),
    'Tenant Polygons',
  )
  XLSX.utils.book_append_sheet(
    wb,
    buildSheet(
      ['Type', 'Name', 'Description', 'Latitude', 'Longitude'],
      utilitiesRows,
      COL_WIDTHS.utilities,
      { numFmtMap: { 3: FMT_COORD, 4: FMT_COORD } },
    ),
    'Utilities',
  )

  // SheetJS can't emit frozen panes, so write to a buffer, inject them, then download.
  const raw = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
  const frozen = injectFreezePanes(new Uint8Array(raw), {
    Buildings: 1,
    RTUs: 1,
    'RTU Pictures': 7,
    'Tenant Polygons': 1,
    Utilities: 1,
  })
  downloadXlsx(frozen, filename)
}

function downloadXlsx(bytes: Uint8Array, filename: string): void {
  const buffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.rel = 'noopener noreferrer'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function sheetToObjects(ws: XLSX.WorkSheet): Record<string, unknown>[] {
  const raw = XLSX.utils.sheet_to_json<(string | number | Date)[]>(ws, {
    header: 1,
    defval: '',
    raw: false,
  })
  if (raw.length < 2) return []
  const headers = raw[0]!.map((h) => str(h))
  return raw
    .slice(1)
    .filter((row) => row.some((v) => v !== ''))
    .map((row) => {
      const obj: Record<string, unknown> = {}
      headers.forEach((h, i) => {
        obj[h] = row[i] !== undefined ? row[i] : ''
      })
      return obj
    })
}

/** Parse an imported workbook into normalized portfolio data. */
export function importPortfolioExcel(buffer: ArrayBuffer): PortfolioData {
  const wb = XLSX.read(buffer, { type: 'array', cellDates: true })

  for (const name of EXPORT_SHEETS) {
    if (name === 'Tenant Polygons') continue
    if (!wb.SheetNames.includes(name)) {
      throw new Error(`Missing sheet: "${name}". Please use the exported file format.`)
    }
  }

  const polygonSheetName = resolvePolygonSheetName(wb.SheetNames)
  if (!polygonSheetName) {
    throw new Error('Missing sheet: "Tenant Polygons". Please use the exported file format.')
  }

  const buildingRows = sheetToObjects(wb.Sheets['Buildings']!)
  const rtuRows = sheetToObjects(wb.Sheets['RTUs']!)
  const polygonRows = sheetToObjects(wb.Sheets[polygonSheetName]!)
  const utilityRows = sheetToObjects(wb.Sheets['Utilities']!)

  const rtusByAddress = new Map<string, Rtu[]>()
  for (const row of rtuRows) {
    const address = str(row['Building Address'])
    if (!address) continue

    const rtu: Rtu = {
      name: str(row['RTU Name']),
      description: buildRtuImportDescription(row, address),
      lat: flt(row['Latitude']),
      lng: flt(row['Longitude']),
    }
    const list = rtusByAddress.get(address) ?? []
    list.push(rtu)
    rtusByAddress.set(address, list)
  }

  const buildings: Building[] = buildingRows.map((row) => {
    const address = str(row['Building Address'])
    const legacy: LegacyBuildingJson = {
      park: str(row['Portfolio']),
      address,
      bu: str(row['BU #']),
      lat: flt(row['Latitude']),
      lng: flt(row['Longitude']),
      sqft: str(row['Sq Ft']),
      cluster: str(row['Cluster']),
      manager: str(row['Manager']),
      sold: str(row['Status']).toUpperCase() === 'SOLD',
      rtus: (rtusByAddress.get(address) ?? []).map((r) => ({
        name: r.name,
        desc: r.description,
        lat: r.lat,
        lng: r.lng,
      })),
    }
    return normalizeLegacyBuilding(legacy)
  })

  const polygons: Polygon[] = polygonRows
    .map((row) => {
      let paths: Polygon['paths']
      try {
        paths = JSON.parse(str(row['Paths (JSON)'])) as Polygon['paths']
      } catch {
        paths = []
      }
      const legacy: LegacyPolygonJson = {
        name: parseSuiteImportLabel(str(row['Suite']) || str(row['Tenant Name']) || 'Polygon'),
        desc: str(row['Tenant Name']),
        color: str(row['Color']) || '#60a5fa',
        paths,
      }
      return normalizeLegacyPolygon(legacy)
    })
    .filter((p) => p.paths.length >= 3)

  const utilities: Utility[] = utilityRows.map((row) =>
    normalizeLegacyUtility({
      type: str(row['Type']) as Utility['utility_type'],
      name: str(row['Name']),
      desc: str(row['Description']),
      lat: flt(row['Latitude']),
      lng: flt(row['Longitude']),
    }),
  )

  return { buildings, utilities, polygons }
}

/** Export RTU replacement cost estimate (RCB) to Excel. */
export function exportRcbExcel(
  result: RcbComputeResult,
  scopeLabel: string,
  options: {
    replacementYearByRtu?: Record<string, string>
    pricingTable?: RcbPricingTable
  } = {},
): void {
  const pricingTable = options.pricingTable ?? DEFAULT_RCB_PRICING
  const scheduled = rcbBuildScheduledExport(
    result,
    options.replacementYearByRtu ?? {},
    pricingTable,
  )
  const T = scheduled.totals
  const global = result.totals
  const basisLbl =
    result.basis === 'hyb'
      ? 'Hybrid Lennox (all-in installed)'
      : 'Standard Efficiency / Lennox Xion (all-in installed)'
  const today = new Date().toISOString().slice(0, 10)
  const hasCustomSchedule = scheduled.customizedCount > 0

  const sum: unknown[][] = [
    ['RTU Replacement Cost Estimate'],
    ['Generated', today],
    ['Selection (scope)', scopeLabel],
    ['Age threshold', `≥ ${result.threshold} years (by install date)`],
    ['Pricing basis', basisLbl],
    ['Global replacement year (default)', scheduled.defaultYear],
  ]

  if (hasCustomSchedule) {
    sum.push(
      ['RTUs with custom replacement year', scheduled.customizedCount],
      [
        'Global estimate — all units at default year (CAD)',
        Math.round(global.cost),
      ],
      ['Scheduled estimate — per-RTU replacement years (CAD)', Math.round(T.cost)],
    )
  }

  sum.push(
    [],
    ['Buildings with qualifying RTUs', T.bldgCount],
    ['Qualifying RTUs', T.units],
    ['Average cost per unit', T.units ? Math.round(T.cost / T.units) : 0],
    [
      hasCustomSchedule
        ? 'TOTAL SCHEDULED REPLACEMENT COST (CAD)'
        : 'TOTAL ESTIMATED REPLACEMENT COST (CAD)',
      Math.round(T.cost),
    ],
    [],
    ['Aged units excluded (no rated tonnage)', result.totals.excludedOld],
    [],
    [
      'Note',
      hasCustomSchedule
        ? 'Scheduled costs use each RTU’s assigned replacement year (see By RTU). Projection by Year still shows uniform-year scenarios for comparison.'
        : 'Budgetary estimate only — not a vendor quote. Tonnage rounded up to nearest supplied tier (2–50 ton).',
    ],
  )

  const bldg: unknown[][] = [
    [
      'Building Address',
      'Portfolio',
      'Cluster',
      'Manager',
      'Qualifying RTUs',
      'Scheduled Replacement Cost (CAD)',
    ],
  ]
  for (const r of scheduled.perBldg) {
    bldg.push([r.address, r.park, r.cluster, r.manager, r.units, Math.round(r.cost)])
  }
  bldg.push(['TOTAL', '', '', '', T.units, Math.round(T.cost)])

  const li: unknown[][] = [
    [
      'Building Address',
      'Portfolio',
      'Cluster',
      'Manager',
      'RTU',
      'Model',
      'Serial',
      'Make',
      'Suite',
      'Installed',
      'Age (yr)',
      'Cooling Tons',
      'Priced Tier',
      'Replacement Year',
      'Unit Cost (CAD)',
      'vs Global Year',
    ],
  ]
  for (const r of [...scheduled.items].sort((a, b) =>
    a.address < b.address ? -1 : a.address > b.address ? 1 : a.rtu.localeCompare(b.rtu),
  )) {
    const globalUnitCost =
      rcbCostForTier(r.tierKey, result.basis, scheduled.defaultYear, pricingTable) ?? r.cost
    const vsGlobal =
      r.replacementYear === scheduled.defaultYear ? '—' : Math.round(r.cost - globalUnitCost)
    li.push([
      r.address,
      r.park,
      r.cluster,
      r.manager,
      r.rtu,
      r.model || '',
      r.serial || '',
      r.make || '',
      r.suite || '',
      r.year,
      r.age,
      r.tons,
      r.tier,
      r.replacementYear,
      Math.round(r.cost),
      vsGlobal,
    ])
  }

  const tier: unknown[][] = [
    ['Tonnage Tier', 'Avg Unit Cost (CAD)', 'Qty', 'Extended Cost (CAD)'],
  ]
  for (const t of scheduled.tiers) {
    tier.push([t.label, Math.round(t.unit), t.qty, Math.round(t.ext)])
  }
  tier.push(['TOTAL', '', T.units, Math.round(T.cost)])

  const pj = rcbProjection(result, pricingTable)
  const proj: unknown[][] = [
    [
      'Replacement Year',
      'Est. Total Cost — all units same year (CAD)',
      `vs ${pj[0]?.year ?? ''} (CAD)`,
    ],
  ]
  for (const p of pj) {
    proj.push([p.year, Math.round(p.total), Math.round(p.total - (pj[0]?.total ?? 0))])
  }
  if (hasCustomSchedule) {
    proj.push([])
    proj.push([
      'Scheduled mix (per-RTU years)',
      Math.round(T.cost),
      Math.round(T.cost - (pj.find((p) => p.year === scheduled.defaultYear)?.total ?? global.cost)),
    ])
  }

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sum), 'Summary')
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(bldg), 'By Building')
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(li), 'By RTU')
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(tier), 'By Tonnage Tier')
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(proj), 'Projection by Year')

  const safe = (scopeLabel === 'All buildings' ? 'All' : scopeLabel)
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40)
  const scheduleTag = hasCustomSchedule ? '_scheduled' : ''
  XLSX.writeFile(
    wb,
    `RTU_Replacement_Estimate_${safe}_${scheduled.defaultYear}${scheduleTag}_${today}.xlsx`,
    { compression: true },
  )
}
