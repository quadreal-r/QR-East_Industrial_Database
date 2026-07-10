import { describe, expect, it } from 'vitest'
import { facadeEntrancePosition } from '@/lib/polygonFacade'
import type { Building, Polygon } from '@/types/domain'

const building: Building = {
  id: 1,
  park: 'Test Park',
  address: '100 Main St',
  bu: 'BU1',
  lat: 43.602,
  lng: -79.6025,
  sqft: '1000',
  cluster: 'A',
  manager: 'Manager 1',
}

function suitePolygon(id: number, name: string, south: number, north: number): Polygon {
  return {
    id,
    name,
    description: 'Tenant',
    color: '#60a5fa',
    paths: [
      { lat: south, lng: -79.603 },
      { lat: north, lng: -79.603 },
      { lat: north, lng: -79.602 },
      { lat: south, lng: -79.602 },
    ],
  }
}

function suitePolygonRect(
  id: number,
  name: string,
  rect: { south: number; north: number; west: number; east: number },
): Polygon {
  return {
    id,
    name,
    description: 'Tenant',
    color: '#60a5fa',
    paths: [
      { lat: rect.south, lng: rect.west },
      { lat: rect.north, lng: rect.west },
      { lat: rect.north, lng: rect.east },
      { lat: rect.south, lng: rect.east },
    ],
  }
}

describe('facadeEntrancePosition', () => {
  it('lines stacked suites on one facade row, centered between suite walls', () => {
    const suite14 = suitePolygon(14, 'Suite # 14', 43.601, 43.6018)
    const suite15 = suitePolygon(15, 'Suite # 15', 43.6018, 43.6026)
    const suite16 = suitePolygon(16, 'Suite # 16', 43.6026, 43.6034)
    const buildingPolygons = [suite14, suite15, suite16]

    const pos14 = facadeEntrancePosition(suite14, building, buildingPolygons)
    const pos15 = facadeEntrancePosition(suite15, building, buildingPolygons)
    const pos16 = facadeEntrancePosition(suite16, building, buildingPolygons)

    expect(pos14.lng).toBeCloseTo(-79.602, 5)
    expect(pos15.lng).toBeCloseTo(-79.602, 5)
    expect(pos16.lng).toBeCloseTo(-79.602, 5)

    expect(pos14.lat).toBeCloseTo((43.601 + 43.6018) / 2, 5)
    expect(pos15.lat).toBeCloseTo((43.6018 + 43.6026) / 2, 5)
    expect(pos16.lat).toBeCloseTo((43.6026 + 43.6034) / 2, 5)
  })

  it('faces outward, away from a separated neighbour wing', () => {
    // The two wings sit side by side with a small gap between them.
    // On real industrial buildings the parking is on the outside, so the
    // gate should be on the OUTER wall of each wing, not the shared alley.
    const leftWing = suitePolygon(1, 'Suite # 1', 43.601, 43.602)
    const rightWing = suitePolygon(2, 'Suite # 2', 43.601, 43.602)
    rightWing.paths = rightWing.paths.map((point) => ({ lat: point.lat, lng: point.lng + 0.002 }))

    const leftPos = facadeEntrancePosition(leftWing, building, [leftWing, rightWing])
    const rightPos = facadeEntrancePosition(rightWing, building, [leftWing, rightWing])

    expect(leftPos.lng).toBeCloseTo(-79.603, 5)
    expect(rightPos.lng).toBeCloseTo(-79.6, 5)
    expect(leftPos.lat).toBeCloseTo((43.601 + 43.602) / 2, 5)
    expect(rightPos.lat).toBeCloseTo((43.601 + 43.602) / 2, 5)
  })

  it('does not snap to polygon vertices on jagged outlines', () => {
    const jagged: Polygon = {
      id: 3,
      name: 'Suite # 3',
      description: 'Tenant',
      color: '#60a5fa',
      paths: [
        { lat: 43.601, lng: -79.603 },
        { lat: 43.6014, lng: -79.6028 },
        { lat: 43.6018, lng: -79.603 },
        { lat: 43.6018, lng: -79.602 },
        { lat: 43.601, lng: -79.602 },
      ],
    }

    const pos = facadeEntrancePosition(jagged, building, [jagged])
    const onVertex = jagged.paths.some(
      (vertex) =>
        Math.abs(vertex.lat - pos.lat) < 1e-8 && Math.abs(vertex.lng - pos.lng) < 1e-8,
    )

    expect(onVertex).toBe(false)
    expect(pos.lat).toBeGreaterThanOrEqual(43.601)
    expect(pos.lat).toBeLessThanOrEqual(43.6018)
    expect(pos.lng).toBeGreaterThanOrEqual(-79.603)
    expect(pos.lng).toBeLessThanOrEqual(-79.602)
  })

  it('places U-shaped building gates on each wing\'s outer wall', () => {
    // Reproduces the 4181 Sladeview layout: three wings around a central
    // courtyard. Every gate should sit on the wall that faces the parking
    // lot (outward), not the interior courtyard.
    const northWing = [
      suitePolygonRect(101, 'Suite # 33', { south: 43.605, north: 43.606, west: -79.610, east: -79.609 }),
      suitePolygonRect(102, 'Suite # 34', { south: 43.605, north: 43.606, west: -79.609, east: -79.608 }),
      suitePolygonRect(103, 'Suite # 35', { south: 43.605, north: 43.606, west: -79.608, east: -79.607 }),
      suitePolygonRect(104, 'Suite # 36', { south: 43.605, north: 43.606, west: -79.607, east: -79.606 }),
    ]
    const westWing = [
      suitePolygonRect(201, 'Suite # 30', { south: 43.603, north: 43.604, west: -79.610, east: -79.609 }),
      suitePolygonRect(202, 'Suite # 29', { south: 43.602, north: 43.603, west: -79.610, east: -79.609 }),
      suitePolygonRect(203, 'Suite # 28', { south: 43.601, north: 43.602, west: -79.610, east: -79.609 }),
    ]
    const eastWing = [
      suitePolygonRect(301, 'Suite # 43', { south: 43.603, north: 43.604, west: -79.607, east: -79.606 }),
      suitePolygonRect(302, 'Suite # 44', { south: 43.602, north: 43.603, west: -79.607, east: -79.606 }),
      suitePolygonRect(303, 'Suite # 45', { south: 43.601, north: 43.602, west: -79.607, east: -79.606 }),
    ]
    const buildingPolygons = [...northWing, ...westWing, ...eastWing]
    const uShaped: Building = { ...building, lat: 43.603, lng: -79.6085 }

    for (const suite of northWing) {
      const pos = facadeEntrancePosition(suite, uShaped, buildingPolygons)
      expect(pos.lat).toBeCloseTo(43.606, 5)
    }
    for (const suite of westWing) {
      const pos = facadeEntrancePosition(suite, uShaped, buildingPolygons)
      expect(pos.lng).toBeCloseTo(-79.610, 5)
    }
    for (const suite of eastWing) {
      const pos = facadeEntrancePosition(suite, uShaped, buildingPolygons)
      expect(pos.lng).toBeCloseTo(-79.606, 5)
    }
  })

  it('stays on the suite polygon boundary even when it does not reach a taller neighbor\'s edge', () => {
    const tallNeighbor = suitePolygon(1, 'Suite # 1', 43.601, 43.603)
    const setBackSuite: Polygon = {
      id: 2,
      name: 'Suite # 2',
      description: 'Tenant',
      color: '#60a5fa',
      paths: [
        { lat: 43.603, lng: -79.6032 },
        { lat: 43.605, lng: -79.6032 },
        { lat: 43.605, lng: -79.6022 },
        { lat: 43.603, lng: -79.6022 },
      ],
    }
    const buildingPolygons = [tallNeighbor, setBackSuite]

    const pos = facadeEntrancePosition(setBackSuite, building, buildingPolygons)

    expect(pos.lat).toBeGreaterThanOrEqual(43.603)
    expect(pos.lat).toBeLessThanOrEqual(43.605)
    expect(pos.lng).toBeGreaterThanOrEqual(-79.6032)
    expect(pos.lng).toBeLessThanOrEqual(-79.6022)
  })
})
