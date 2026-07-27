import { describe, expect, it } from 'vitest'
import {
  buildingAddressKeys,
  findBuildingBySheetAddress,
  buildBuildingAddressIndex,
  normalizeRtuName,
  findRtuInBuilding,
} from '@/lib/rtuMatch'
import { normalizeLegacyBuilding, type LegacyBuildingJson } from '@/types/domain'
import legacyBuildings from '../../supabase/data/buildings.json'

const buildings = (legacyBuildings as LegacyBuildingJson[]).map(normalizeLegacyBuilding)
const index = buildBuildingAddressIndex(buildings)

describe('buildingAddressKeys', () => {
  it('matches way and avenue variants', () => {
    const keys = buildingAddressKeys('101 Exchange Way')
    expect(keys.some((k) => k.includes('exchange'))).toBe(true)
  })

  it('matches drive suffix variants', () => {
    const keys = buildingAddressKeys('1535 Meyerside')
    const keysDrive = buildingAddressKeys('1535 Meyerside Drive')
    expect(keys.some((k) => keysDrive.includes(k)) || keysDrive.some((k) => keys.includes(k))).toBe(
      true,
    )
  })
})

describe('findBuildingBySheetAddress', () => {
  it('finds portfolio building from workbook spelling', () => {
    const building = findBuildingBySheetAddress(index, '101 Exchange Way')
    expect(building?.address).toBe('101 Exchange Avenue')
  })

  it('finds building when street suffix is abbreviated', () => {
    const building = findBuildingBySheetAddress(index, '1535 Meyerside')
    expect(building?.address).toBe('1535 Meyerside Drive')
  })

  it('finds combined address with ampersand', () => {
    const building = findBuildingBySheetAddress(index, '1870 & 1880 Courtneypark Drive')
    expect(building?.address).toBe('1870 - 1880 Courtneypark Drive')
  })

  it('finds 4161 Sladeview when workbook uses Cres abbreviation', () => {
    const building = findBuildingBySheetAddress(index, '4161 Sladeview Cres')
    expect(building?.address).toBe('4161 Sladeview Crescent')
  })
})

describe('normalizeRtuName', () => {
  it('extracts RTU number from long equipment descriptions', () => {
    expect(normalizeRtuName('RTU 01 DX Cooling Gas Fired Htg')).toBe('rtu 01')
    expect(normalizeRtuName('RTU- 01')).toBe('rtu 01')
    expect(normalizeRtuName('RTU 12B DX Cooling Gas Fired Htg')).toBe('rtu 12b')
    expect(normalizeRtuName('RTU- 12B')).toBe('rtu 12b')
  })

  it('matches short RT labels and unpadded numbers', () => {
    expect(normalizeRtuName('RT01')).toBe('rtu 01')
    expect(normalizeRtuName('RT05')).toBe('rtu 05')
    expect(normalizeRtuName('RTU-6')).toBe('rtu 06')
    expect(normalizeRtuName('RTU 1')).toBe('rtu 01')
    expect(normalizeRtuName('RTU-1 Roof Top Unit')).toBe('rtu 01')
    expect(normalizeRtuName('RTU-1A')).toBe('rtu 01a')
  })

  it('matches workbook and portfolio hybrid labels', () => {
    expect(normalizeRtuName('RTU 05  Hybrid')).toBe(normalizeRtuName('RTU- 05 Hybrid'))
    expect(normalizeRtuName('RTU 04  Hybrid')).toBe(normalizeRtuName('RTU- 04 Hybrid'))
  })
})

describe('4161 Sladeview RTU matching', () => {
  const building = findBuildingBySheetAddress(index, '4161 Sladeview Cres')!

  it('matches all workbook RTU labels for the building', () => {
    const labels = [
      'RTU 01 DX Cooling Gas Fired Htg',
      'RTU 02 Hybrid',
      'RTU 03 DX Cooling Gas Fired Htg',
      'RTU 04 Hybrid',
      'RTU 05  Hybrid',
      'RTU 06 DX Cooling Gas Fired Htg',
      'RTU 07 DX Cooling Gas Fired Htg',
      'RTU 08 DX Cooling Gas Fired Htg',
      'RTU 09 DX Cooling Gas Fired Htg',
      'RTU 10 Hybrid',
      'RTU 12 Hybrid',
      'RTU 12B DX Cooling Gas Fired Htg',
      'RTU 14 DX Cooling Gas Fired Htg',
      'RTU 15 DX Cooling Gas Fired Htg',
      'RTU 16 DX Cooling Gas Fired Htg',
      'RTU 17 DX Cooling Gas Fired Htg',
      'RTU 18 DX Cooling Gas Fired Htg',
      'RTU 19 DX Cooling Gas Fired Htg',
      'RTU 20 DX Cooling Gas Fired Htg',
      'RTU 21 DX Cooling Gas Fired Htg',
      'RTU 22 DX Cooling Gas Fired Htg',
    ]

    for (const label of labels) {
      expect(findRtuInBuilding(building, label), label).toBeDefined()
    }
  })
})
