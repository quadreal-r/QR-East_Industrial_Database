import { describe, expect, it } from 'vitest'
import {
  applyBuildingOperatorSheet,
  buildBuildingOperatorExportRows,
  collectBuildingOperatorFilterOptions,
  isBuildingOperatorDataRow,
  parseBuildingOperatorSheetRow,
} from '@/lib/buildingOperators'
import type { Building } from '@/types/domain'

function building(partial: Partial<Building> & Pick<Building, 'address'>): Building {
  return {
    park: 'Park',
    bu: '',
    lat: 0,
    lng: 0,
    sqft: '',
    cluster: '',
    manager: '',
    ...partial,
  }
}

describe('isBuildingOperatorDataRow', () => {
  it('rejects footer summary rows', () => {
    expect(
      isBuildingOperatorDataRow(
        parseBuildingOperatorSheetRow({
          'Building Address': 'Buildings per operator:',
          'BU #': '',
          'Building Operator': '',
        }),
      ),
    ).toBe(false)

    expect(
      isBuildingOperatorDataRow(
        parseBuildingOperatorSheetRow({
          'Building Address': 'Christopher Peles',
          'BU #': '20',
          Portfolio: '',
          'Property Manager': '',
          'Building Operator': '',
        }),
      ),
    ).toBe(false)
  })
})

describe('applyBuildingOperatorSheet', () => {
  it('matches by BU and copies operator fields', () => {
    const buildings = [
      building({ address: '2300 Bristol Circle', bu: '51201', manager: 'Manager 1' }),
      building({ address: 'Other', bu: '99999' }),
    ]
    const next = applyBuildingOperatorSheet(buildings, [
      parseBuildingOperatorSheetRow({
        'Building Address': '2300 Bristol Circle',
        'BU #': '51201',
        Portfolio: 'Western Business Park',
        'Property Manager': 'Josh Starkey',
        'Building Operator': 'TBD',
        'Operator Phone': '(416) 688-5075',
        'Ops Manager (Region)': 'Eldin Shima (West)',
        'GM Ops': 'Joseph Pimentel',
        VP: 'Carl Lam',
      }),
    ])
    expect(next[0]).toMatchObject({
      buildingOperator: 'TBD',
      operatorPhone: '(416) 688-5075',
      opsManager: 'Eldin Shima (West)',
      gmOps: 'Joseph Pimentel',
      vp: 'Carl Lam',
    })
    expect(next[1]?.buildingOperator).toBeUndefined()
  })
})

describe('buildBuildingOperatorExportRows', () => {
  it('exports roster columns with display manager names', () => {
    const rows = buildBuildingOperatorExportRows(
      [
        building({
          address: '100 Leek Crescent',
          bu: '50450',
          park: 'East Business Park',
          manager: 'Manager 1',
          buildingOperator: 'Aaron Meecham',
          operatorPhone: '555',
          opsManager: 'Matt Arsenault (East)',
          gmOps: 'Joseph Pimentel',
          vp: 'Carl Lam',
        }),
      ],
      { 'Manager 1': 'Sylvia Zwierkowski' },
    )
    expect(rows).toEqual([
      [
        '100 Leek Crescent',
        '50450',
        'East Business Park',
        'Sylvia Zwierkowski',
        'Aaron Meecham',
        '555',
        'Matt Arsenault (East)',
        'Joseph Pimentel',
        'Carl Lam',
      ],
    ])
  })
})

describe('collectBuildingOperatorFilterOptions', () => {
  it('lists unique operators from the portfolio, not a hardcoded roster', () => {
    const options = collectBuildingOperatorFilterOptions([
      building({ address: 'A', buildingOperator: 'Aaron Meecham' }),
      building({ address: 'B', buildingOperator: 'TBD' }),
      building({ address: 'C', buildingOperator: 'Aaron Meecham' }),
      building({ address: 'D', buildingOperator: 'Unassigned (no colour match)' }),
      building({ address: 'E', buildingOperator: null }),
    ])
    expect(options).toEqual(['Aaron Meecham', 'TBD', 'Unassigned (no colour match)'])
    expect(options).not.toContain('Ramesh Ramnarine')
  })

  it('returns an empty list when no buildings have operators', () => {
    expect(collectBuildingOperatorFilterOptions([building({ address: 'A' })])).toEqual([])
  })
})
