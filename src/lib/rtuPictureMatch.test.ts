import { describe, expect, it } from 'vitest'
import {
  buildingStreetNumber,
  extractRtuUnitId,
  findRtuCandidates,
  matchFileToRtu,
  normalizeRtuUnitCore,
  parseBulkRtuPictureFileName,
} from './rtuPictureMatch'
import { buildRtuCatalog } from './rtuBulkPictureImport'
import { normalizeLegacyBuilding, type Building, type LegacyBuildingJson } from '@/types/domain'
import legacyBuildings from '../../supabase/data/buildings.json'

const buildings = (legacyBuildings as LegacyBuildingJson[]).map(normalizeLegacyBuilding)
const catalog = buildRtuCatalog(buildings)

describe('normalizeRtuUnitCore (review criteria)', () => {
  it('strips year and leading zeros from filename units', () => {
    expect(normalizeRtuUnitCore('RTU-06-2024')).toBe('6')
    expect(normalizeRtuUnitCore('RTU-06')).toBe('6')
    expect(normalizeRtuUnitCore('RT-06')).toBe('6')
    expect(normalizeRtuUnitCore('RTU 06')).toBe('6')
  })

  it('strips Hybrid and other DB descriptors', () => {
    expect(normalizeRtuUnitCore('RTU-06 Hybrid')).toBe('6')
    expect(normalizeRtuUnitCore('RTU-16A Hybrid')).toBe('16A')
    expect(normalizeRtuUnitCore('RTU-09 (Air Heater)')).toBe('9')
    expect(normalizeRtuUnitCore('RTU-03 (split AC unit)')).toBe('3')
  })

  it('accepts RTUs- and S- prefix variants', () => {
    expect(normalizeRtuUnitCore('RTUs-01')).toBe('1')
    expect(normalizeRtuUnitCore('S-01')).toBe('1')
  })

  it('does not collapse west suffix into numeric unit', () => {
    expect(normalizeRtuUnitCore('RT-1W')).toBe('1W')
    expect(normalizeRtuUnitCore('RTU-01')).toBe('1')
    expect(normalizeRtuUnitCore('RT-1W')).not.toBe(normalizeRtuUnitCore('RTU-01'))
  })

  it('flags unit 0 for manual review', () => {
    expect(normalizeRtuUnitCore('RTU-0')).toBeNull()
    expect(normalizeRtuUnitCore('RTU-00')).toBeNull()
  })
})

describe('buildingStreetNumber site wings', () => {
  it('keeps plain street numbers', () => {
    expect(buildingStreetNumber('1590 South Gateway Rd.')).toBe('1590')
    expect(buildingStreetNumber('6150 Kennedy Road')).toBe('6150')
  })

  it('appends E/W for Kennedy East/West addresses', () => {
    expect(buildingStreetNumber('6150 Kennedy Rd-East (A)')).toBe('6150E')
    expect(buildingStreetNumber('6150 Kennedy Rd-West (B)')).toBe('6150W')
  })
})

describe('parseBulkRtuPictureFileName', () => {
  it('parses year-in-unit filenames', () => {
    const parsed = parseBulkRtuPictureFileName('1495-RTU-06-2024-2.jpg')
    expect(parsed).toMatchObject({
      buildingNum: '1495',
      unitCore: '6',
      pictureIndex: 2,
      requiresReview: false,
    })
  })

  it('parses East/West site codes in filenames', () => {
    expect(parseBulkRtuPictureFileName('6150E-RTU-01-1.jpg')).toMatchObject({
      buildingNum: '6150E',
      unitCore: '1',
      pictureIndex: 1,
    })
    expect(parseBulkRtuPictureFileName('6150W-RTU-10 (2).jpg')).toMatchObject({
      buildingNum: '6150W',
      unitCore: '10',
      pictureIndex: 2,
    })
  })
})

describe('2320 Bristol Circle RTU-04 filename variants', () => {
  const bristolBuilding: Building = {
    park: 'Test',
    address: '2320 Bristol Circle',
    bu: '1',
    lat: 43.6,
    lng: -79.6,
    sqft: '1',
    cluster: '',
    manager: '',
    rtus: [
      { name: 'RTU-02', description: '', lat: 43.6, lng: -79.6 },
      { name: 'RTU-04', description: '', lat: 43.61, lng: -79.61 },
      { name: 'RTU-04 Hybrid', description: '', lat: 43.611, lng: -79.611 },
      { name: 'RTU-04B', description: '', lat: 43.612, lng: -79.612 },
    ],
  }
  const catalog = buildRtuCatalog([bristolBuilding])

  const rtu04Files = [
    '2320-RTU-04.jpg',
    '2320-RTU-04 (1).jpg',
    '2320-RTU-04 (2).jpg',
    '2320-RTU-04 (3) (2015).jpg',
    '2320-RTU-04 Hybrid.jpg',
    '2320-RTU-04-1.jpg',
    '2320-RTU-04-2.jpg',
    '2320-RTU-04-3.jpg',
    '2320-RTU-04-1(2015).jpg',
    '2320-RTU-04-1(Removed).jpg',
  ]

  it.each(rtu04Files)('matches %s to RTU-04', (fileName) => {
    const parsed = parseBulkRtuPictureFileName(fileName)
    expect(parsed).not.toBeNull()
    const result = matchFileToRtu(catalog, fileName)
    expect(result.error).toBeUndefined()
    expect(result.entry?.rtu.name).toBe('RTU-04')
  })

  it('does not match 2320-RTU-04B to RTU-04', () => {
    const parsed = parseBulkRtuPictureFileName('2320-RTU-04B-1.jpg')!
    const candidates = findRtuCandidates(catalog, parsed)
    expect(candidates.some((c) => c.rtu.name === 'RTU-04')).toBe(false)
    expect(candidates.some((c) => c.rtu.name === 'RTU-04B')).toBe(true)
  })
})

describe('6150 Kennedy East/West picture matching', () => {
  const east: Building = {
    park: 'Test',
    address: '6150 Kennedy Rd-East (A)',
    bu: '1',
    lat: 43.6,
    lng: -79.6,
    sqft: '1',
    cluster: '',
    manager: '',
    rtus: [{ name: 'RTU- 01', description: '', lat: 43.6, lng: -79.6 }],
  }
  const west: Building = {
    park: 'Test',
    address: '6150 Kennedy Rd-West (B)',
    bu: '2',
    lat: 43.61,
    lng: -79.61,
    sqft: '1',
    cluster: '',
    manager: '',
    rtus: [{ name: 'RTU- 10', description: '', lat: 43.61, lng: -79.61 }],
  }
  const splitCatalog = buildRtuCatalog([east, west])
  const legacyCatalog = buildRtuCatalog([
    {
      ...east,
      address: '6150 Kennedy Road',
      rtus: [
        { name: 'RTU- 01', description: '', lat: 43.6, lng: -79.6 },
        { name: 'RTU- 10', description: '', lat: 43.61, lng: -79.61 },
      ],
    },
  ])

  it('matches 6150E / 6150W filenames to East / West buildings', () => {
    const eastHit = matchFileToRtu(splitCatalog, '6150E-RTU-01-1.jpg')
    expect(eastHit.error).toBeUndefined()
    expect(eastHit.entry?.building.address).toBe('6150 Kennedy Rd-East (A)')
    expect(eastHit.entry?.rtu.name).toBe('RTU- 01')

    const westHit = matchFileToRtu(splitCatalog, '6150W-RTU-10-1.jpg')
    expect(westHit.error).toBeUndefined()
    expect(westHit.entry?.building.address).toBe('6150 Kennedy Rd-West (B)')
    expect(westHit.entry?.rtu.name).toBe('RTU- 10')
  })

  it('does not cross-match East filename onto West', () => {
    const result = matchFileToRtu(splitCatalog, '6150E-RTU-10-1.jpg')
    expect(result.error).toBeDefined()
  })

  it('matches winged filenames to legacy bare 6150 portfolio address', () => {
    const result = matchFileToRtu(legacyCatalog, '6150E-RTU-01-1.jpg')
    expect(result.error).toBeUndefined()
    expect(result.entry?.building.address).toBe('6150 Kennedy Road')
    expect(result.entry?.rtu.name).toBe('RTU- 01')
  })

  it('does not guess bare 6150 when both East and West exist', () => {
    const result = matchFileToRtu(splitCatalog, '6150-RTU-01-1.jpg')
    expect(result.error).toBeDefined()
  })
})

describe('matchFileToRtu against portfolio', () => {
  it('matches 1495-RTU-06-2024-2.jpg to RTU-06 when both RTU-06 and Hybrid exist', () => {
    const result = matchFileToRtu(catalog, '1495-RTU-06-2024-2.jpg')
    expect(result.error).toBeUndefined()
    expect(result.entry?.rtu.name).toMatch(/^RTU-06( Hybrid)?$/)
    expect(result.pictureIndex).toBe(2)
  })

  it('matches RTUs-01 to RTU-01', () => {
    const parsed = parseBulkRtuPictureFileName('150-RTUs-01-1.jpg')
    expect(parsed).not.toBeNull()
    const candidates = findRtuCandidates(catalog, parsed!)
    expect(candidates.some((c) => c.rtu.name === 'RTU-01')).toBe(true)
  })

  it('rejects RTU-0 bulk dumps', () => {
    const result = matchFileToRtu(catalog, '150-RTU-0-1.jpg')
    expect(result.error).toContain('manual review')
  })

  it('does not match RT-1W to RTU-01', () => {
    const parsed = parseBulkRtuPictureFileName('150-RT-1W-1.jpg')!
    const candidates = findRtuCandidates(catalog, parsed)
    expect(candidates.some((c) => normalizeRtuUnitCore(c.rtu.name) === '1')).toBe(false)
  })
})

describe('extractRtuUnitId', () => {
  it('handles prefix variants', () => {
    expect(extractRtuUnitId('RT-04')).toBe('04')
    expect(extractRtuUnitId('RTU- 04')).toBe('04')
    expect(extractRtuUnitId('RTUs-01')).toBe('01')
    expect(extractRtuUnitId('S-01')).toBe('01')
  })
})
