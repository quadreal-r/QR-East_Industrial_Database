import { describe, expect, it } from 'vitest'
import { remapSuiteEntrancePolygonId } from '@/data/portfolioApi'
import type { Polygon, SuiteEntrance } from '@/types/domain'

describe('remapSuiteEntrancePolygonId', () => {
  const baselinePolygon: Polygon = {
    id: 100,
    name: 'Suite # 8',
    description: 'Tenant',
    color: '#60a5fa',
    paths: [
      { lat: 1, lng: 1 },
      { lat: 2, lng: 1 },
      { lat: 2, lng: 2 },
    ],
  }

  const entrance: SuiteEntrance = {
    id: 5,
    building_id: 1,
    polygon_id: 100,
    name: 'Suite # 8',
    description: 'Tenant',
    lat: 1.5,
    lng: 1.5,
  }

  it('leaves gates alone when their polygon is not being deleted', () => {
    const result = remapSuiteEntrancePolygonId(entrance, {
      deletedPolygonIds: new Set([999]),
      baselinePolygonById: new Map([[100, baselinePolygon]]),
      savedPolygonIdByKey: new Map(),
    })
    expect(result.polygon_id).toBe(100)
  })

  it('repoints gates from a deleted polygon to the replacement id', () => {
    const result = remapSuiteEntrancePolygonId(entrance, {
      deletedPolygonIds: new Set([100]),
      baselinePolygonById: new Map([[100, baselinePolygon]]),
      savedPolygonIdByKey: new Map([['Suite # 8\0Tenant', 200]]),
    })
    expect(result.polygon_id).toBe(200)
  })

  it('clears the link when no replacement polygon exists', () => {
    const result = remapSuiteEntrancePolygonId(entrance, {
      deletedPolygonIds: new Set([100]),
      baselinePolygonById: new Map([[100, baselinePolygon]]),
      savedPolygonIdByKey: new Map(),
    })
    expect(result.polygon_id).toBeNull()
  })
})
