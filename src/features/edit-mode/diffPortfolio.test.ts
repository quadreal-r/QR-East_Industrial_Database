import { describe, expect, it } from 'vitest'
import { computePortfolioChanges, countPortfolioChanges, diffPortfolio } from '@/features/edit-mode/diffPortfolio'
import type { PortfolioData } from '@/types/domain'

const baseline: PortfolioData = {
  buildings: [
    {
      id: 1,
      park: 'North',
      address: '100 Main St',
      bu: 'A',
      lat: 40,
      lng: -75,
      sqft: '1000',
      cluster: 'C1',
      manager: 'Alice',
      notes: 'Original note',
      rtus: [
        {
          id: 10,
          name: 'RTU-1',
          description: 'Roof unit',
          lat: 40.001,
          lng: -75.001,
        },
      ],
    },
  ],
  utilities: [
    {
      id: 20,
      utility_type: 'Fire Hydrants',
      name: 'Hydrant A',
      description: 'Front lot',
      lat: 40.002,
      lng: -75.002,
    },
  ],
  polygons: [
    {
      id: 30,
      name: 'Zone A',
      description: 'Parking',
      color: '#ff0000',
      paths: [
        { lat: 40, lng: -75 },
        { lat: 40.01, lng: -75 },
        { lat: 40.01, lng: -75.01 },
      ],
    },
  ],
}

describe('diffPortfolio', () => {
  it('detects grouped marker and polygon changes', () => {
    const pending: PortfolioData = {
      buildings: [
        {
          ...baseline.buildings[0]!,
          lat: 40.1,
          lng: -75.1,
          notes: 'Updated note',
          rtus: [
            {
              ...baseline.buildings[0]!.rtus![0]!,
              lat: 40.11,
              lng: -75.11,
            },
            {
              name: 'RTU-2',
              description: 'New unit',
              lat: 40.2,
              lng: -75.2,
            },
          ],
        },
      ],
      utilities: baseline.utilities,
      polygons: [
        {
          ...baseline.polygons[0]!,
          paths: [
            { lat: 40, lng: -75 },
            { lat: 40.02, lng: -75 },
            { lat: 40.02, lng: -75.02 },
          ],
          color: '#00ff00',
        },
        {
          name: 'Zone B',
          description: 'New zone',
          color: '#0000ff',
          paths: [{ lat: 41, lng: -76 }],
        },
      ],
    }

    const summary = diffPortfolio(baseline, pending)

    expect(summary.total).toBeGreaterThan(0)
    expect(summary.groups.map((group) => group.label)).toEqual(
      expect.arrayContaining([
        'Markers moved',
        'Markers edited',
        'Markers added',
        'Polygons moved',
        'Polygons edited',
        'Polygons added',
      ]),
    )
  })

  it('detects deletions', () => {
    const pending: PortfolioData = {
      buildings: [
        {
          ...baseline.buildings[0]!,
          rtus: [],
        },
      ],
      utilities: [],
      polygons: [],
    }

    const summary = diffPortfolio(baseline, pending)
    const labels = summary.groups.map((group) => group.label)

    expect(labels).toContain('Markers deleted')
    expect(labels).toContain('Polygons deleted')
  })

  it('computePortfolioChanges only includes changed entities', () => {
    const pending: PortfolioData = {
      buildings: [
        {
          ...baseline.buildings[0]!,
          rtus: [
            {
              ...baseline.buildings[0]!.rtus![0]!,
              lat: 40.11,
              lng: -75.11,
            },
          ],
        },
      ],
      utilities: baseline.utilities,
      polygons: baseline.polygons,
    }

    const changes = computePortfolioChanges(baseline, pending)

    expect(countPortfolioChanges(changes)).toBe(1)
    expect(changes.rtusToUpsert).toHaveLength(1)
    expect(changes.buildingsToUpdate).toHaveLength(0)
    expect(changes.buildingsToInsert).toHaveLength(0)
  })

  it('treats new polygons without database ids as inserts', () => {
    const pending: PortfolioData = {
      ...baseline,
      polygons: [
        ...baseline.polygons,
        {
          name: 'Unit # 99',
          description: 'New tenant',
          color: '#60a5fa',
          paths: [
            { lat: 43.66, lng: -79.65 },
            { lat: 43.661, lng: -79.65 },
            { lat: 43.661, lng: -79.649 },
          ],
        },
      ],
    }

    const changes = computePortfolioChanges(baseline, pending)

    expect(changes.polygonsToUpsert).toHaveLength(1)
    expect(changes.polygonsToUpsert[0]?.id).toBeUndefined()
    expect(changes.polygonIdsToDelete).toHaveLength(0)
  })
})
