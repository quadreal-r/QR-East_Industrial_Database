import { describe, expect, it } from 'vitest'
import {
  ensureSuiteEntrances,
  normalizeSuiteName,
  matchesSuiteEntrance,
  suiteNumberSignature,
} from '@/lib/suiteEntrances'
import { polygonCentroid } from '@/lib/polygonBuildings'
import type { Building, Polygon, SuiteEntrance } from '@/types/domain'

const building: Building = {
  id: 1,
  park: 'Test Park',
  address: '100 Main St',
  bu: 'BU1',
  lat: 43.6,
  lng: -79.6,
  sqft: '1000',
  cluster: 'A',
  manager: 'Manager 1',
}

const polygon: Polygon = {
  id: 10,
  name: 'Suite # 7',
  description: 'Acme Corp',
  color: '#60a5fa',
  paths: [
    { lat: 43.601, lng: -79.601 },
    { lat: 43.602, lng: -79.601 },
    { lat: 43.602, lng: -79.602 },
  ],
}

describe('normalizeSuiteName', () => {
  it('strips suite prefixes for matching', () => {
    expect(normalizeSuiteName('Suite # 7')).toBe('7')
    expect(normalizeSuiteName('Suite 7')).toBe('7')
    expect(normalizeSuiteName('Suites # 9,10-12')).toBe('91012')
  })
})

describe('suiteNumberSignature', () => {
  it('matches renamed suite groups by number pattern', () => {
    expect(suiteNumberSignature('Suite 9,10,11,12')).toBe('9101112')
    expect(suiteNumberSignature('Suites # 9,10-12')).toBe('91012')
  })
})

describe('ensureSuiteEntrances', () => {
  it('creates a gate for each suite polygon without one', () => {
    const result = ensureSuiteEntrances([building], [polygon], [])
    expect(result).toHaveLength(1)
    expect(result[0]?.name).toBe('Suite # 7')
    expect(result[0]?.building_id).toBe(1)
    expect(result[0]?.polygon_id).toBe(10)
    expect(result[0]?.lng).not.toBeCloseTo(polygonCentroid(polygon.paths).lng, 5)
  })

  it('keeps manually placed tenant entrance coordinates', () => {
    const existing: SuiteEntrance = {
      id: 5,
      building_id: 1,
      name: 'Suite 7',
      description: 'Acme Corp',
      lat: 43.6619515,
      lng: -79.6541663,
      auto_placed: false,
    }
    const result = ensureSuiteEntrances([building], [polygon], [existing])
    expect(result).toHaveLength(1)
    expect(result[0]?.lat).toBe(43.6619515)
    expect(result[0]?.id).toBe(5)
  })

  it('re-snaps gates that are still auto-placed (including DB rows with no flag yet)', () => {
    const existing: SuiteEntrance = {
      id: 5,
      building_id: 1,
      name: 'Suite 7',
      description: 'Acme Corp',
      lat: 43.6619515,
      lng: -79.6541663,
    }
    const result = ensureSuiteEntrances([building], [polygon], [existing])
    expect(result).toHaveLength(1)
    expect(result[0]?.lat).not.toBeCloseTo(43.6619515, 5)
    expect(result[0]?.auto_placed).toBe(true)
  })

  it('creates auto-placed gates that keep re-snapping until moved', () => {
    const autoPlaced = ensureSuiteEntrances([building], [polygon], [])
    const created = autoPlaced[0]!
    expect(created.id).toBeUndefined()
    expect(created.auto_placed).toBe(true)

    // Still untouched — a later portfolio update may legitimately recompute
    // the facade position (e.g. the polygon shape changed).
    const stillAuto = ensureSuiteEntrances([building], [polygon], [created])
    expect(stillAuto[0]?.auto_placed).toBe(true)
  })

  it('keeps a manual drag on an unsaved gate (no id yet) instead of snapping back', () => {
    const autoPlaced = ensureSuiteEntrances([building], [polygon], [])
    const created = autoPlaced[0]!
    expect(created.id).toBeUndefined()

    // Simulate the app clearing auto_placed the moment a user drags the
    // still-unsaved gate to a real door position — even a tiny nudge nearby.
    const dragged: SuiteEntrance = {
      ...created,
      lat: created.lat + 0.00002,
      lng: created.lng + 0.00002,
      auto_placed: false,
    }

    const result = ensureSuiteEntrances([building], [polygon], [dragged])
    expect(result).toHaveLength(1)
    expect(result[0]?.lat).toBe(dragged.lat)
    expect(result[0]?.lng).toBe(dragged.lng)
    expect(result[0]?.id).toBeUndefined()
    expect(result[0]?.auto_placed).toBe(false)
  })

  it('matches legacy tenant names to renamed suite polygons', () => {
    const renamedPolygon: Polygon = {
      id: 112,
      name: 'Suites # 9,10-12',
      description: 'Power Steel Construction Ltd. / LeMaitre Vascular ULC',
      color: '#60a5fa',
      paths: polygon.paths,
    }
    const legacy: SuiteEntrance = {
      id: 112,
      building_id: 1,
      name: 'Suite 9,10,11,12',
      description: 'Home Reno Direct',
      lat: 43.662675,
      lng: -79.6560035,
      auto_placed: false,
    }
    const result = ensureSuiteEntrances([building], [renamedPolygon], [legacy])
    expect(result).toHaveLength(1)
    expect(result[0]?.id).toBe(112)
    expect(result[0]?.lat).toBe(43.662675)
    expect(result[0]?.polygon_id).toBe(112)
  })

  it('creates a gate for vacant suites and does not reuse Suite 1 for Suite 10', () => {
    const suite1: Polygon = {
      id: 1,
      name: 'Suite # 1',
      description: 'Occupied tenant',
      color: '#60a5fa',
      paths: polygon.paths,
    }
    const suite10: Polygon = {
      id: 10,
      name: 'Suite # 10',
      description: 'Vacant',
      color: '#60a5fa',
      paths: [
        { lat: 43.603, lng: -79.603 },
        { lat: 43.604, lng: -79.603 },
        { lat: 43.604, lng: -79.604 },
      ],
    }
    const existing: SuiteEntrance = {
      id: 1,
      building_id: 1,
      name: 'Suite 1',
      description: 'Occupied tenant',
      lat: 43.6619515,
      lng: -79.6541663,
      polygon_id: 1,
      auto_placed: false,
    }
    const result = ensureSuiteEntrances([building], [suite1, suite10], [existing])
    expect(result).toHaveLength(2)
    const vacantGate = result.find((item) => item.polygon_id === 10)
    expect(vacantGate).toBeDefined()
    expect(vacantGate?.description).toBe('Vacant')
    expect(vacantGate?.id).toBeUndefined()
  })

  it('creates one gate per polygon even when only one tenant row exists in the database', () => {
    const polygonsForBuilding: Polygon[] = [
      { ...polygon, id: 1, name: 'Suite # 1', description: 'Tenant A' },
      {
        ...polygon,
        id: 2,
        name: 'Suite # 2',
        description: 'Vacant',
        paths: [
          { lat: 43.603, lng: -79.603 },
          { lat: 43.604, lng: -79.603 },
          { lat: 43.604, lng: -79.604 },
        ],
      },
    ]
    const result = ensureSuiteEntrances([building], polygonsForBuilding, [])
    expect(result).toHaveLength(2)
    expect(result.every((item) => Number.isFinite(item.lat) && Number.isFinite(item.lng))).toBe(true)
  })
})

describe('matchesSuiteEntrance', () => {
  it('matches by id when present', () => {
    const a: SuiteEntrance = { id: 1, building_id: 1, name: 'A', description: '', lat: 0, lng: 0 }
    const b: SuiteEntrance = { id: 1, building_id: 1, name: 'B', description: '', lat: 0, lng: 0 }
    expect(matchesSuiteEntrance(a, b)).toBe(true)
  })

  it('matches renamed suite groups by loose name', () => {
    const a: SuiteEntrance = {
      id: 112,
      building_id: 1,
      name: 'Suite 9,10,11,12',
      description: '',
      lat: 0,
      lng: 0,
    }
    const b: SuiteEntrance = {
      building_id: 1,
      name: 'Suites # 9,10-12',
      description: '',
      lat: 0,
      lng: 0,
      polygon_id: 112,
    }
    expect(matchesSuiteEntrance(a, b)).toBe(true)
  })
})
