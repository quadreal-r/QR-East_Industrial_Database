import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import * as XLSX from 'xlsx'
import {
  buildCapexBuildingYearBudgets,
  buildCapexBuildingYearNotes,
  buildCapexRtuNotesFromDescriptions,
  collectCapexRtuDescriptionsByAddressYear,
  collectCapexStatusesByMoneyYear,
  extractYearFromCapexDescription,
  formatCapexImportedNote,
  sumCapexHvacBudgetsByAddressYear,
  type CapexItemRow,
} from '@/lib/capexHvacBudgetImport'
import { buildingYearBudgetKey } from '@/lib/buildingYearBudget'
import { rcbReplacementYearKey } from '@/lib/costEstimator'
import type { Building } from '@/types/domain'

const SAMPLE = 'C:/Users/Robert/Downloads/Capex_Report_RTU_Repl_2026.xlsx'

function ay(address: string, year: string) {
  return `${address}\0${year}`
}

describe('sumCapexHvacBudgetsByAddressYear', () => {
  it('keeps Approved/Submitted HVAC amounts keyed by address + Capex year', () => {
    const rows: CapexItemRow[] = [
      {
        'Job Project Type': 'HVAC',
        Status: 'Submitted',
        'DB Building Address': '3165 Unity Drive',
        '2029': 1000,
      },
      {
        'Job Project Type': 'HVAC',
        Status: 'Approved',
        'DB Building Address': '3165 Unity Drive',
        '2031': 500.4,
      },
      {
        'Job Project Type': 'HVAC',
        Status: 'Rejected',
        'DB Building Address': '3165 Unity Drive',
        '2028': 99999,
      },
    ]
    const { byAddressYear, stats } = sumCapexHvacBudgetsByAddressYear(rows)
    expect(stats.hvacRows).toBe(3)
    expect(stats.keptRows).toBe(2)
    expect(stats.skippedStatus).toBe(1)
    expect(byAddressYear.get(ay('3165 Unity Drive', '2029'))?.total).toBe(1000)
    expect(byAddressYear.get(ay('3165 Unity Drive', '2031'))?.total).toBe(500)
    expect(byAddressYear.size).toBe(2)
  })

  it('parses the Capex RTU replacement workbook when present', () => {
    if (!existsSync(SAMPLE)) return
    const wb = XLSX.read(readFileSync(SAMPLE), { type: 'buffer' })
    const rows = XLSX.utils.sheet_to_json(wb.Sheets['Capex Items']!, {
      defval: null,
    }) as CapexItemRow[]
    const { byAddressYear, stats } = sumCapexHvacBudgetsByAddressYear(rows)
    expect(stats.keptRows).toBeGreaterThan(100)
    expect(byAddressYear.size).toBeGreaterThan(50)
    expect(stats.portfolioTotal).toBeGreaterThan(1_000_000)
  })
})

describe('buildCapexBuildingYearBudgets', () => {
  it('assigns Capex year money to the building pot (not RTUs)', () => {
    const buildings: Building[] = [
      {
        park: 'West',
        address: '3165 Unity Drive',
        bu: '50301',
        lat: 0,
        lng: 0,
        sqft: '',
        cluster: '',
        manager: '',
        rtus: [
          { name: 'RTU-01', description: '', lat: 0, lng: 0 },
          { name: 'RTU-02', description: '', lat: 0, lng: 0 },
        ],
      },
    ]
    const byAddressYear = new Map([
      [
        ay('3165 Unity Drive', '2029'),
        { address: '3165 Unity Drive', year: '2029', total: 1000, lineCount: 1 },
      ],
      [
        ay('3165 Unity Drive', '2031'),
        { address: '3165 Unity Drive', year: '2031', total: 400, lineCount: 1 },
      ],
    ])
    const { buildingYearBudgets, stats } = buildCapexBuildingYearBudgets(
      byAddressYear,
      buildings,
    )
    expect(stats.matchedBuildingYears).toBe(2)
    expect(buildingYearBudgets[buildingYearBudgetKey('3165 Unity Drive', '2029')]).toBe(1000)
    expect(buildingYearBudgets[buildingYearBudgetKey('3165 Unity Drive', '2031')]).toBe(400)
  })

  it('splits a pipe-joined Kennedy Capex address across East and West buildings', () => {
    const kennedy: Building[] = [
      {
        park: 'East',
        address: '6150 Kennedy Rd-East (A)',
        bu: '50402',
        lat: 0,
        lng: 0,
        sqft: '',
        cluster: '',
        manager: '',
        rtus: [{ name: 'RTU-01', description: '', lat: 0, lng: 0 }],
      },
      {
        park: 'East',
        address: '6150 Kennedy Rd-West (B)',
        bu: '50402',
        lat: 0,
        lng: 0,
        sqft: '',
        cluster: '',
        manager: '',
        rtus: [{ name: 'RTU-02', description: '', lat: 0, lng: 0 }],
      },
    ]
    const byAddressYear = new Map([
      [
        ay('6150 Kennedy Rd-East (A) | 6150 Kennedy Rd-West (B)', '2025'),
        {
          address: '6150 Kennedy Rd-East (A) | 6150 Kennedy Rd-West (B)',
          year: '2025',
          total: 53550,
          lineCount: 1,
        },
      ],
    ])
    const { buildingYearBudgets, stats } = buildCapexBuildingYearBudgets(
      byAddressYear,
      kennedy,
    )
    // Same BU → one shared pot on the primary address (not equal-split).
    expect(stats.matchedBuildingYears).toBe(1)
    expect(
      buildingYearBudgets[buildingYearBudgetKey('6150 Kennedy Rd-East (A)', '2025')],
    ).toBe(53550)
    expect(
      buildingYearBudgets[buildingYearBudgetKey('6150 Kennedy Rd-West (B)', '2025')],
    ).toBeUndefined()
  })

  it('stores a shared Capex pot for multi-building BU labels like Ridgeway', () => {
    const ridgeway: Building[] = [
      {
        park: 'East',
        address: '3150 Ridgeway Drive',
        bu: '50311',
        lat: 0,
        lng: 0,
        sqft: '',
        cluster: '',
        manager: '',
        rtus: [],
      },
      {
        park: 'East',
        address: '3170 Ridgeway Drive',
        bu: '50311',
        lat: 0,
        lng: 0,
        sqft: '',
        cluster: '',
        manager: '',
        rtus: [],
      },
    ]
    const byAddressYear = new Map([
      [
        ay('3150-3170 Ridgeway Dr (2 Bldgs) (BU 50311)', '2026'),
        {
          address: '3150-3170 Ridgeway Dr (2 Bldgs) (BU 50311)',
          year: '2026',
          total: 200_000,
          lineCount: 1,
        },
      ],
    ])
    const { buildingYearBudgets, stats } = buildCapexBuildingYearBudgets(
      byAddressYear,
      ridgeway,
    )
    expect(stats.unmatchedAddresses).toEqual([])
    expect(stats.matchedBuildingYears).toBe(1)
    expect(buildingYearBudgets[buildingYearBudgetKey('3150 Ridgeway Drive', '2026')]).toBe(
      200_000,
    )
    expect(
      buildingYearBudgets[buildingYearBudgetKey('3170 Ridgeway Drive', '2026')],
    ).toBeUndefined()
  })
})

describe('extractYearFromCapexDescription', () => {
  it('reads the year after the property code', () => {
    expect(extractYearFromCapexDescription('50301 2031 HVAC RTU Replacement')).toBe('2031')
    expect(extractYearFromCapexDescription('50304 2025 HVAC RTU Replacement')).toBe('2025')
  })
})

describe('formatCapexImportedNote', () => {
  it('prefixes property-code + year Capex lines with the Capex stamp', () => {
    expect(formatCapexImportedNote('50454 2027 BAS Upgrade')).toBe(
      '(From CAPEX 07.2026) 50454 2027 BAS Upgrade',
    )
    expect(
      formatCapexImportedNote('50454 2026 HVAC Replacement\n50454 2026 BB System Uplift'),
    ).toBe(
      '(From CAPEX 07.2026) 50454 2026 HVAC Replacement\n(From CAPEX 07.2026) 50454 2026 BB System Uplift',
    )
  })

  it('does not double-stamp an already tagged line', () => {
    expect(formatCapexImportedNote('(From CAPEX 07.2026) 50454 2027 BAS Upgrade')).toBe(
      '(From CAPEX 07.2026) 50454 2027 BAS Upgrade',
    )
  })
})

describe('collectCapexRtuDescriptionsByAddressYear', () => {
  it('keeps Approved/Submitted/Rejected HVAC note descriptions with status', () => {
    const rows: CapexItemRow[] = [
      {
        'Job Project Type': 'HVAC',
        Status: 'Submitted',
        'DB Building Address': '3165 Unity Drive',
        Description: '50301 2031 HVAC RTU Replacement',
      },
      {
        'Job Project Type': 'HVAC',
        Status: 'Approved',
        'DB Building Address': '3165 Unity Drive',
        Description: '50301 2029 HVAC RTU Replacement',
      },
      {
        'Job Project Type': 'HVAC',
        Status: 'Rejected',
        'DB Building Address': '3165 Unity Drive',
        Description: '50301 2028 HVAC RTU Replacement',
      },
      {
        'Job Project Type': 'HVAC',
        Status: 'Submitted',
        'DB Building Address': '50 Leek Crescent',
        Description: '50454 2027 BAS Upgrade',
      },
      {
        'Job Project Type': 'Garage / Parkade',
        Status: 'Submitted',
        'DB Building Address': '3165 Unity Drive',
        Description: '50301 2026 Asphalt Replacement',
      },
      {
        'Job Project Type': 'HVAC',
        Status: 'Planning',
        'DB Building Address': '3165 Unity Drive',
        Description: '50301 2026 HVAC RTU Replacement',
      },
    ]
    const { byAddressYear, stats } = collectCapexRtuDescriptionsByAddressYear(rows)
    expect(stats.hvacRows).toBe(5)
    expect(stats.keptRows).toBe(4)
    expect(stats.skippedStatus).toBe(1)
    expect(byAddressYear.get(ay('3165 Unity Drive', '2031'))?.status).toBe('Submitted')
    expect(byAddressYear.get(ay('3165 Unity Drive', '2029'))?.status).toBe('Approved')
    expect(byAddressYear.get(ay('3165 Unity Drive', '2028'))?.status).toBe('Rejected')
    expect(byAddressYear.get(ay('50 Leek Crescent', '2027'))?.description).toBe(
      '50454 2027 BAS Upgrade',
    )
  })

  it('keeps every HVAC Job Project Type row (including BB System Uplift)', () => {
    const rows: CapexItemRow[] = [
      {
        'Job Project Type': 'HVAC',
        Status: 'Approved',
        'DB Building Address': '6160 Kenway Drive',
        Description: '50403 2025 HVAC',
      },
      {
        'Job Project Type': 'HVAC',
        Status: 'Approved',
        'DB Building Address': '50 Leek Crescent',
        Description: '50454 2026 HVAC Replacement',
      },
      {
        'Job Project Type': 'HVAC',
        Status: 'Approved',
        'DB Building Address': '50 Leek Crescent',
        Description: '50454 2026 BB System Uplift',
      },
      {
        'Job Project Type': 'Roof',
        Status: 'Approved',
        'DB Building Address': '50 Leek Crescent',
        Description: '50454 2026 Roof Replacement',
      },
    ]
    const { byAddressYear } = collectCapexRtuDescriptionsByAddressYear(rows)
    expect(byAddressYear.get(ay('6160 Kenway Drive', '2025'))?.description).toBe(
      '50403 2025 HVAC',
    )
    expect(byAddressYear.get(ay('6160 Kenway Drive', '2025'))?.status).toBe('Approved')
    expect(byAddressYear.get(ay('50 Leek Crescent', '2026'))?.description).toBe(
      '50454 2026 HVAC Replacement\n50454 2026 BB System Uplift',
    )
    expect(byAddressYear.has(ay('50 Leek Crescent', '2026'))).toBe(true)
    // Non-HVAC Job Project Type rows are never imported into Cost Center notes.
    expect(byAddressYear.get(ay('50 Leek Crescent', '2026'))?.description).not.toContain(
      'Roof Replacement',
    )
  })
})

describe('buildCapexBuildingYearNotes', () => {
  it('attaches Capex Description to the building-year pot key', () => {
    const buildings: Building[] = [
      {
        park: 'East',
        address: '50 Leek Crescent',
        bu: '50454',
        lat: 0,
        lng: 0,
        sqft: '',
        cluster: '',
        manager: '',
        rtus: [{ name: 'RTU-01', description: '', lat: 0, lng: 0 }],
      },
    ]
    const byAddressYear = new Map([
      [
        ay('50 Leek Crescent', '2027'),
        {
          address: '50 Leek Crescent',
          year: '2027',
          description: '50454 2027 BAS Upgrade',
          status: 'Submitted',
          jobProjectType: 'HVAC',
        },
      ],
    ])
    const { notes, statuses, jobTypes, stats } = buildCapexBuildingYearNotes(
      byAddressYear,
      buildings,
    )
    expect(stats.notesWritten).toBe(1)
    expect(notes[buildingYearBudgetKey('50 Leek Crescent', '2027')]).toBe(
      '(From CAPEX 07.2026) 50454 2027 BAS Upgrade',
    )
    expect(statuses[buildingYearBudgetKey('50 Leek Crescent', '2027')]).toBe('Submitted')
    expect(jobTypes[buildingYearBudgetKey('50 Leek Crescent', '2027')]).toBe('HVAC')
  })

  it('keeps Approved status and HVAC job type for bare HVAC pot notes (6160 Kenway 2025)', () => {
    const buildings: Building[] = [
      {
        park: 'East',
        address: '6160 Kenway Drive',
        bu: '50403',
        lat: 0,
        lng: 0,
        sqft: '',
        cluster: '',
        manager: '',
        rtus: [{ name: 'RTU-01', description: '', lat: 0, lng: 0 }],
      },
    ]
    const rows: CapexItemRow[] = [
      {
        'Job Project Type': 'HVAC',
        Status: 'Approved',
        'DB Building Address': '6160 Kenway Drive',
        Description: '50403 2025 HVAC',
        '2025': 42400,
      },
    ]
    const { byAddressYear } = collectCapexRtuDescriptionsByAddressYear(rows)
    const statusByMoneyYear = collectCapexStatusesByMoneyYear(rows)
    const { notes, statuses, jobTypes } = buildCapexBuildingYearNotes(
      byAddressYear,
      buildings,
      statusByMoneyYear,
      new Map([[ay('6160 Kenway Drive', '2025'), 'HVAC']]),
    )
    const key = buildingYearBudgetKey('6160 Kenway Drive', '2025')
    expect(notes[key]).toBe('(From CAPEX 07.2026) 50403 2025 HVAC')
    expect(statuses[key]).toBe('Approved')
    expect(jobTypes[key]).toBe('HVAC')
    expect(statusByMoneyYear.get(ay('6160 Kenway Drive', '2025'))).toBe('Approved')
  })
})

describe('buildCapexRtuNotesFromDescriptions', () => {
  it('writes Capex Description to RTU notes only when replacement years match', () => {
    const buildings: Building[] = [
      {
        park: 'West',
        address: '3165 Unity Drive',
        bu: '50301',
        lat: 0,
        lng: 0,
        sqft: '',
        cluster: '',
        manager: '',
        rtus: [
          { name: 'RTU-01', description: '', lat: 0, lng: 0 },
          { name: 'RTU-02', description: '', lat: 0, lng: 0 },
          { name: 'RTU-03', description: '', lat: 0, lng: 0 },
        ],
      },
    ]
    const byAddressYear = new Map([
      [
        ay('3165 Unity Drive', '2031'),
        {
          address: '3165 Unity Drive',
          year: '2031',
          description: '50301 2031 HVAC RTU Replacement',
          status: 'Submitted',
          jobProjectType: 'HVAC',
        },
      ],
      [
        ay('3165 Unity Drive', '2029'),
        {
          address: '3165 Unity Drive',
          year: '2029',
          description: '50301 2029 HVAC RTU Replacement',
          status: 'Approved',
          jobProjectType: 'HVAC',
        },
      ],
    ])
    const replacementYearByRtu = {
      [rcbReplacementYearKey('3165 Unity Drive', 'RTU-01')]: '2031',
      [rcbReplacementYearKey('3165 Unity Drive', 'RTU-02')]: '2029',
      // RTU-03 unset → defaults to 2026, no Capex row for 2026
    }
    const { notes, stats } = buildCapexRtuNotesFromDescriptions(
      byAddressYear,
      buildings,
      replacementYearByRtu,
      '2026',
    )
    expect(stats.notesWritten).toBe(2)
    expect(stats.capexRowsMatched).toBe(2)
    expect(notes[rcbReplacementYearKey('3165 Unity Drive', 'RTU-01')]).toBe(
      '(From CAPEX 07.2026) 50301 2031 HVAC RTU Replacement',
    )
    expect(notes[rcbReplacementYearKey('3165 Unity Drive', 'RTU-02')]).toBe(
      '(From CAPEX 07.2026) 50301 2029 HVAC RTU Replacement',
    )
    expect(notes[rcbReplacementYearKey('3165 Unity Drive', 'RTU-03')]).toBeUndefined()
  })

  it('treats unset RTU years as the Cost Center default year', () => {
    const buildings: Building[] = [
      {
        park: 'West',
        address: '3165 Unity Drive',
        bu: '50301',
        lat: 0,
        lng: 0,
        sqft: '',
        cluster: '',
        manager: '',
        rtus: [{ name: 'RTU-01', description: '', lat: 0, lng: 0 }],
      },
    ]
    const byAddressYear = new Map([
      [
        ay('3165 Unity Drive', '2026'),
        {
          address: '3165 Unity Drive',
          year: '2026',
          description: '50301 2026 HVAC RTU Replacement',
          status: 'Approved',
          jobProjectType: 'HVAC',
        },
      ],
    ])
    const { notes, stats } = buildCapexRtuNotesFromDescriptions(
      byAddressYear,
      buildings,
      {},
      '2026',
    )
    expect(stats.notesWritten).toBe(1)
    expect(notes[rcbReplacementYearKey('3165 Unity Drive', 'RTU-01')]).toBe(
      '(From CAPEX 07.2026) 50301 2026 HVAC RTU Replacement',
    )
  })
})
