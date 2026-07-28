import legacyBuildings from '../../supabase/data/buildings.json'
import {
  normalizeLegacyBuilding,
  type LegacyBuildingJson,
  type Rtu,
} from '@/types/domain'
import { getRtuAge, getRtuYear, oldestRtuAge, parseRtuMeta, rcbGetTons, ageAtCalendarYear } from '@/lib/rtu'

const sampleBuildings = (legacyBuildings as LegacyBuildingJson[])
  .slice(0, 3)
  .map(normalizeLegacyBuilding)

describe('getRtuYear', () => {
  it('parses year from description', () => {
    const rtu = sampleBuildings[0]?.rtus?.[1]
    expect(rtu).toBeDefined()
    expect(getRtuYear(rtu!)).toBe(2021)
  })

  it('prefers install_year column when present', () => {
    const rtu = {
      name: 'RTU-X',
      description: 'Date Installed: Jan 01, 2010',
      lat: 0,
      lng: 0,
      install_year: 2024,
    }
    expect(getRtuYear(rtu)).toBe(2024)
  })
})

describe('getRtuAge', () => {
  it('computes age from install year', () => {
    const rtu = sampleBuildings[0]?.rtus?.[2]
    expect(rtu).toBeDefined()
    expect(getRtuAge(rtu!, 2026)).toBe(14)
  })
})

describe('ageAtCalendarYear', () => {
  it('computes Age Today and Age on Repl. Year from install year', () => {
    // Installed 2007 → Age Today in 2026 is 19; Age on Repl. Year 2028 is 21.
    expect(ageAtCalendarYear(2007, 2026)).toBe(19)
    expect(ageAtCalendarYear(2007, '2028')).toBe(21)
    expect(ageAtCalendarYear(null, 2028)).toBeNull()
  })
})

describe('oldestRtuAge', () => {
  it('returns max age across RTUs', () => {
    const building = sampleBuildings[0]
    expect(building).toBeDefined()
    expect(oldestRtuAge(building!, 2026)).toBeGreaterThanOrEqual(14)
  })
})

describe('parseRtuMeta', () => {
  it('parses model and serial from legacy description', () => {
    const rtu = sampleBuildings[0]?.rtus?.[4]
    expect(rtu).toBeDefined()
    const meta = parseRtuMeta(rtu!)
    expect(meta.model).toBe('PGD430040K000C1')
    expect(meta.serial).toBe('C102888078')
    expect(meta.make).toBe('ICP')
  })
})

describe('rcbGetTons', () => {
  it('parses tonnage from parenthetical', () => {
    const rtu = sampleBuildings[0]?.rtus?.[0]
    expect(rtu).toBeDefined()
    expect(rcbGetTons(rtu!)).toBe(5)
  })

  it('derives tonnage from BTU when needed', () => {
    const rtu: Rtu = {
      name: 'RTU-test',
      description: 'Cooling Capacity: 60,000 BTU',
      lat: 0,
      lng: 0,
    }
    expect(rcbGetTons(rtu)).toBe(5)
  })
})
