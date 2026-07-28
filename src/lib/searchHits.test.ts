import { describe, expect, it } from 'vitest'
import legacyBuildings from '../../supabase/data/buildings.json'
import legacyPolygons from '../../supabase/data/polygons.json'
import { collectSearchHits } from '@/lib/searchHits'
import {
  normalizeLegacyBuilding,
  normalizeLegacyPolygon,
  type LegacyBuildingJson,
  type LegacyPolygonJson,
} from '@/types/domain'

const buildings = (legacyBuildings as LegacyBuildingJson[]).map(normalizeLegacyBuilding)
const polygons = (legacyPolygons as LegacyPolygonJson[]).map(normalizeLegacyPolygon)

describe('collectSearchHits', () => {
  it('finds tenant polygon for Baxter', () => {
    const hits = collectSearchHits(buildings, polygons, 'Baxter')
    const baxterPolygon = hits.find(
      (hit) =>
        hit.kind === 'polygon' &&
        (/Baxter/i.test(hit.polygonDescription ?? '') || /Baxter/i.test(hit.label)),
    )
    expect(baxterPolygon).toBeDefined()
    expect(baxterPolygon!.polygonName).toMatch(/#\s*3/i)
    expect(baxterPolygon!.polygonDescription).toMatch(/Baxter/i)
  })

  it('finds RTU detail hits when search is not a building metadata match', () => {
    const hits = collectSearchHits(buildings, polygons, 'RTU- 01')
    expect(hits.some((h) => h.kind === 'rtu')).toBe(true)
  })

  it('finds RTU hits by serial number', () => {
    const withSerial = [
      {
        ...buildings[0]!,
        address: 'Serial Search Building',
        bu: 'SER-BU',
        cluster: 'Serial Cluster Unique XYZ',
        manager: 'Serial Manager Unique XYZ',
        rtus: [
          {
            name: 'RTU-A',
            description: '',
            lat: 43.71,
            lng: -79.71,
            serial: 'UNIQUE-SER-7788',
          },
        ],
      },
    ]
    const hits = collectSearchHits(withSerial, [], 'UNIQUE-SER-7788')
    expect(hits).toEqual([
      expect.objectContaining({
        kind: 'rtu',
        detailName: 'RTU-A',
        buildingAddress: 'Serial Search Building',
      }),
    ])
  })

  it('finds building hits for address search', () => {
    const hits = collectSearchHits(buildings, polygons, '6975 Creditview')
    expect(hits.length).toBeGreaterThan(0)
    expect(hits[0]!.kind).toBe('building')
    expect(hits[0]!.address).toContain('6975 Creditview')
  })

  it('finds building by BU # with or without BU prefix', () => {
    const byDigits = collectSearchHits(buildings, polygons, '50454')
    expect(byDigits.some((h) => h.kind === 'building' && /50 Leek/i.test(h.address ?? ''))).toBe(
      true,
    )
    const byPrefixed = collectSearchHits(buildings, polygons, 'BU50454')
    expect(
      byPrefixed.some((h) => h.kind === 'building' && /50 Leek/i.test(h.address ?? '')),
    ).toBe(true)
    const bySpaced = collectSearchHits(buildings, polygons, 'BU #50454')
    expect(bySpaced.some((h) => h.kind === 'building' && /50 Leek/i.test(h.address ?? ''))).toBe(
      true,
    )
  })
})
