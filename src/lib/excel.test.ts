import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import {
  buildRtuImportDescription,
  columnWidthsFromRows,
  formatSqftExport,
  importPortfolioExcel,
  PORTFOLIO_BUILDINGS_HEADERS,
  PORTFOLIO_POLYGONS_HEADERS,
  PORTFOLIO_RTUS_HEADERS,
  PORTFOLIO_UTILITIES_HEADERS,
  rtuNotesForExport,
  stripCapacityRestatement,
} from '@/lib/excel'

function portfolioWorkbookBuffer(sheets: Record<string, unknown[][]>): ArrayBuffer {
  const wb = XLSX.utils.book_new()
  for (const [name, rows] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name)
  }
  const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer | Uint8Array | number[]
  if (out instanceof ArrayBuffer) return out
  const bytes = out instanceof Uint8Array ? out : Uint8Array.from(out)
  return bytes.slice().buffer as ArrayBuffer
}

describe('formatSqftExport', () => {
  it('formats numeric sqft with thousands separators', () => {
    expect(formatSqftExport('48030')).toBe('48,030')
    expect(formatSqftExport('51814')).toBe('51,814')
  })

  it('preserves already formatted values', () => {
    expect(formatSqftExport('48,030')).toBe('48,030')
  })

  it('returns empty for blank input', () => {
    expect(formatSqftExport('')).toBe('')
    expect(formatSqftExport(undefined)).toBe('')
  })
})

describe('buildRtuImportDescription', () => {
  const baseRow = {
    'RTU Name': 'RTU-05',
    Model: 'PGD430040K000C1',
    Serial: 'C102888078',
    Make: 'ICP',
    'Date Installed': 'Jul 01, 2010',
    'Heating Capacity': '70,000 BTU',
    'Cooling Capacity': '30,000 BTU (2.5 Ton)',
  }

  it('does not duplicate structured fields from Notes', () => {
    const notes = [
      'Building: 1850 Derry Road East',
      'System: Roof Top Units',
      'Description: RTU-05',
      'Model: PGD430040K000C1',
      'R22 Refrigerant',
    ].join(' | ')

    const desc = buildRtuImportDescription({ ...baseRow, Notes: notes }, '1850 Derry Road East')
    const lines = desc.split(/\r?\n/)

    expect(lines.filter((l) => l.startsWith('Building:'))).toHaveLength(1)
    expect(lines.filter((l) => l.startsWith('Model:'))).toHaveLength(1)
    expect(desc).toContain('R22 Refrigerant')
  })

  it('dedupes repeated note blocks from legacy exports', () => {
    const tripled = [
      'Building: 1850 Derry Road East',
      'System: Roof Top Units',
      'Description: RTU-05',
      'Building: 1850 Derry Road East',
      'System: Roof Top Units',
      'Description: RTU-05',
      'Building: 1850 Derry Road East',
      'System: Roof Top Units',
      'Description: RTU-05',
    ].join(' | ')

    const desc = buildRtuImportDescription({ ...baseRow, Notes: tripled }, '1850 Derry Road East')
    expect(desc.split(/\r?\n/).filter((l) => l.startsWith('Building:'))).toHaveLength(1)
  })

  it('keeps suite lines that only appear in Notes', () => {
    const desc = buildRtuImportDescription(
      { ...baseRow, Notes: 'Suite: Single Tenant | R22 Refrigerant' },
      '1850 Derry Road East',
    )
    expect(desc).toContain('Suite: Single Tenant')
    expect(desc).toContain('R22 Refrigerant')
  })
})

describe('stripCapacityRestatement', () => {
  it('drops a bare heating/cooling capacity restatement', () => {
    expect(stripCapacityRestatement("Heating Capacity 125,000 BTU's")).toBe('')
    expect(stripCapacityRestatement('Cooling Capacity: 60,000 BTU (5 Ton)')).toBe('')
  })

  it('drops capacity fragments but keeps genuine notes on the same line', () => {
    expect(
      stripCapacityRestatement(
        'Missing Lamicoid; Cooling Capacity: 48,000 BTU (4 Ton); Heating Capacity: 150,000 BTU/H',
      ),
    ).toBe('Missing Lamicoid')
    expect(
      stripCapacityRestatement("Heating Capacity 180,000 BTU's; Cooling Capacity: 90,000 BTU (7.5 Ton)"),
    ).toBe('')
  })

  it('leaves lines without capacity text untouched', () => {
    expect(stripCapacityRestatement('was missing from WB1')).toBe('was missing from WB1')
    expect(stripCapacityRestatement('-updated by Marcus Ganhao August 2, 2023')).toBe(
      '-updated by Marcus Ganhao August 2, 2023',
    )
  })
})

describe('rtuNotesForExport', () => {
  it('excludes capacity restatements already captured in columns J and K', () => {
    const description = [
      'Building: 1645 Bonhill Road',
      'System: Roof Top Units',
      'Description: RTU-01',
      'Model: 4YCC4036A1070AC',
      'Serial: 212513486L',
      'Make: TRANE',
      'Date Installed: Sep 28, 2021',
      "Heating Capacity: 80,000 BTU's",
      'Cooling Capacity: 36,000 BTU (3 Ton)',
      "Heating Capacity 80,000 BTU's",
      '-updated by Marcus Ganhao August 9, 2023',
    ].join('\r\n')

    expect(rtuNotesForExport(description)).toBe('-updated by Marcus Ganhao August 9, 2023')
  })

  it('keeps genuine notes while removing semicolon-joined capacity duplicates', () => {
    const description = [
      'Building: 1715 Meyerside Drive',
      'System: Roof Top Units',
      'Description: RTU-01',
      'Heating Capacity: 150,000 BTU',
      'Cooling Capacity: 60,000 BTU (5 Ton)',
      "Heating Capacity 150,000 BTU's; Cooling Capacity: 60,000 BTU (5 Ton)",
      'was missing from WB1',
    ].join('\r\n')

    expect(rtuNotesForExport(description)).toBe('was missing from WB1')
  })
})

describe('columnWidthsFromRows', () => {
  it('sizes each column to the longest cell value', () => {
    const widths = columnWidthsFromRows([
      ['Building', 'Cost (CAD)'],
      ['441 Courtneypark', '$891,390'],
      ['TOTAL', '$5,877,658'],
    ])
    expect(widths[0]?.wch).toBeGreaterThanOrEqual('441 Courtneypark'.length)
    expect(widths[1]?.wch).toBeGreaterThanOrEqual('Cost (CAD)'.length)
  })
})

describe('importPortfolioExcel headers', () => {
  it('rejects Buildings sheets with missing headers', () => {
    const buffer = portfolioWorkbookBuffer({
      Buildings: [['Building Address', 'Portfolio'], ['100 Test Rd', 'Park']],
      RTUs: [[...PORTFOLIO_RTUS_HEADERS], ['100 Test Rd', '', '', '', 'RTU-01']],
      'Tenant Polygons': [[...PORTFOLIO_POLYGONS_HEADERS]],
      Utilities: [[...PORTFOLIO_UTILITIES_HEADERS]],
    })
    expect(() => importPortfolioExcel(buffer)).toThrow(/Buildings.*headers do not match/i)
  })

  it('accepts a workbook with the full export headers', () => {
    const buffer = portfolioWorkbookBuffer({
      Buildings: [
        [...PORTFOLIO_BUILDINGS_HEADERS],
        ['100 Test Rd', '1', 'Park', 'C', 'Mgr', '1000', 'Active', 1, 0, 43.1, -79.1],
      ],
      RTUs: [
        [...PORTFOLIO_RTUS_HEADERS],
        [
          '100 Test Rd',
          'Park',
          'C',
          'Mgr',
          'RTU-01',
          'M',
          'S',
          'Make',
          '',
          '',
          '',
          43.1,
          -79.1,
          '',
          1,
          0,
          '',
          '',
        ],
      ],
      'Tenant Polygons': [[...PORTFOLIO_POLYGONS_HEADERS]],
      Utilities: [[...PORTFOLIO_UTILITIES_HEADERS]],
    })
    const data = importPortfolioExcel(buffer)
    expect(data.buildings).toHaveLength(1)
    expect(data.buildings[0]?.address).toBe('100 Test Rd')
  })
})
