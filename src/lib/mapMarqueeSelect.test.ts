import { describe, expect, it, beforeEach } from 'vitest'
import {
  clearMarqueeTargets,
  consumeMapClickClearSuppression,
  findMarqueeKeysInScreenRect,
  isSelectionAdditiveClick,
  marqueePointFromLatLng,
  marqueePolygonFromPaths,
  pointInScreenRect,
  polygonIntersectsScreenRect,
  registerMarqueeTarget,
  suppressMapClickClearOnce,
} from '@/lib/mapMarqueeSelect'

function mockProjection(
  positions: Record<string, { x: number; y: number }>,
): { fromLatLngToContainerPixel: (latLng: { lat: number; lng: number }) => { x: number; y: number } | null } {
  return {
    fromLatLngToContainerPixel: (latLng) => {
      const key = `${latLng.lat},${latLng.lng}`
      const px = positions[key]
      return px ? { x: px.x, y: px.y } : null
    },
  }
}

describe('mapMarqueeSelect', () => {
  beforeEach(() => {
    clearMarqueeTargets()
  })

  it('selects point markers inside the screen box', () => {
    registerMarqueeTarget('building:100 Main', marqueePointFromLatLng(43.65, -79.62))
    registerMarqueeTarget('building:200 Main', marqueePointFromLatLng(44, -80))

    const projection = mockProjection({
      '43.65,-79.62': { x: 50, y: 50 },
      '44,-80': { x: 200, y: 200 },
    })
    const keys = findMarqueeKeysInScreenRect(
      projection,
      { left: 40, top: 40, right: 60, bottom: 60 },
      0,
    )
    expect(keys).toEqual(['building:100 Main'])
  })

  it('includes markers near the edge with hit padding', () => {
    registerMarqueeTarget('detail:rtu:RTU-1:addr', marqueePointFromLatLng(1, 1))

    const projection = mockProjection({ '1,1': { x: 65, y: 50 } })
    const withoutPadding = findMarqueeKeysInScreenRect(
      projection,
      { left: 40, top: 40, right: 60, bottom: 60 },
      0,
    )
    const withPadding = findMarqueeKeysInScreenRect(
      projection,
      { left: 40, top: 40, right: 60, bottom: 60 },
      8,
    )
    expect(withoutPadding).toEqual([])
    expect(withPadding).toEqual(['detail:rtu:RTU-1:addr'])
  })

  it('selects polygons when a vertex or centroid is inside the screen box', () => {
    registerMarqueeTarget(
      'polygon:Tenant A\0Suite 1',
      marqueePolygonFromPaths([
        { lat: 43.651, lng: -79.621 },
        { lat: 43.652, lng: -79.621 },
        { lat: 43.652, lng: -79.62 },
      ]),
    )

    const projection = mockProjection({
      '43.651,-79.621': { x: 45, y: 45 },
      '43.652,-79.621': { x: 55, y: 45 },
      '43.652,-79.62': { x: 55, y: 55 },
    })
    const keys = findMarqueeKeysInScreenRect(
      projection,
      { left: 40, top: 40, right: 60, bottom: 60 },
      0,
    )
    expect(keys).toContain('polygon:Tenant A\0Suite 1')
  })

  it('uses live resolve callbacks for marker positions', () => {
    let lat = 43.65
    registerMarqueeTarget('building:moving', {
      kind: 'point',
      resolve: () => ({ lat, lng: -79.62 }),
    })

    const projection = mockProjection({
      '43.65,-79.62': { x: 50, y: 50 },
      '43.7,-79.62': { x: 200, y: 200 },
    })

    expect(
      findMarqueeKeysInScreenRect(
        projection,
        { left: 40, top: 40, right: 60, bottom: 60 },
        0,
      ),
    ).toEqual(['building:moving'])

    lat = 43.7
    expect(
      findMarqueeKeysInScreenRect(
        projection,
        { left: 40, top: 40, right: 60, bottom: 60 },
        0,
      ),
    ).toEqual([])
  })

  it('tests screen rect helpers', () => {
    const rect = { left: 10, top: 10, right: 20, bottom: 20 }
    expect(pointInScreenRect(15, 15, rect)).toBe(true)
    expect(
      polygonIntersectsScreenRect(
        mockProjection({ '5,5': { x: 100, y: 100 } }),
        [{ lat: 5, lng: 5 }],
        rect,
      ),
    ).toBe(false)
  })

  it('keeps map-click clear suppressed until the pointer gesture ends', () => {
    suppressMapClickClearOnce()
    expect(consumeMapClickClearSuppression()).toBe(true)
    expect(consumeMapClickClearSuppression()).toBe(true)
    window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    expect(consumeMapClickClearSuppression()).toBe(false)
  })

  it('resets map-click clear suppression after pointerup', () => {
    suppressMapClickClearOnce()
    expect(consumeMapClickClearSuppression()).toBe(true)
    // jsdom lacks PointerEvent; Event is enough for the capture listener.
    window.dispatchEvent(new Event('pointerup', { bubbles: true }))
    expect(consumeMapClickClearSuppression()).toBe(false)
  })

  it('detects additive selection from the native mouse event', () => {
    window.dispatchEvent(
      new MouseEvent('mousedown', { ctrlKey: true, bubbles: true, cancelable: true }),
    )
    expect(isSelectionAdditiveClick()).toBe(true)
    expect(
      isSelectionAdditiveClick({
        domEvent: new MouseEvent('click'),
      } as google.maps.MapMouseEvent),
    ).toBe(true)
  })
})
