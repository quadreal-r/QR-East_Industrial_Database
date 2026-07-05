import { describe, expect, it } from 'vitest'
import { getBuildingSavedView, hasBuildingSavedView } from '@/lib/buildingMapView'

describe('getBuildingSavedView', () => {
  it('returns a view when center, zoom, and heading are set', () => {
    const view = getBuildingSavedView({
      mapLat: 43.5,
      mapLng: -79.6,
      mapZoom: 20,
      mapHeading: 135,
      mapTilt: 45,
      mapImageryMode: 'esri',
    })
    expect(view).toEqual({
      lat: 43.5,
      lng: -79.6,
      zoom: 20,
      heading: 135,
      tilt: 45,
      imageryMode: 'esri',
    })
  })

  it('defaults tilt to 0 when unset', () => {
    const view = getBuildingSavedView({
      mapLat: 43.5,
      mapLng: -79.6,
      mapZoom: 20,
      mapHeading: 90,
    })
    expect(view?.tilt).toBe(0)
    expect(view?.imageryMode).toBeNull()
  })

  it('returns null when any required camera field is missing', () => {
    expect(getBuildingSavedView({ mapLat: null, mapLng: -79.6, mapZoom: 20, mapHeading: 0 })).toBeNull()
    expect(getBuildingSavedView({ mapLat: 43.5, mapLng: null, mapZoom: 20, mapHeading: 0 })).toBeNull()
    expect(getBuildingSavedView({ mapLat: 43.5, mapLng: -79.6, mapZoom: null, mapHeading: 0 })).toBeNull()
    expect(getBuildingSavedView({ mapLat: 43.5, mapLng: -79.6, mapZoom: 20, mapHeading: null })).toBeNull()
    expect(getBuildingSavedView({})).toBeNull()
  })

  it('preserves saved imagery mode when present', () => {
    const view = getBuildingSavedView({
      mapLat: 1,
      mapLng: 2,
      mapZoom: 18,
      mapHeading: 0,
      mapImageryMode: 'esri',
    })
    expect(view?.imageryMode).toBe('esri')
  })
})

describe('hasBuildingSavedView', () => {
  it('is true only when a full view exists', () => {
    expect(hasBuildingSavedView({ mapLat: 1, mapLng: 2, mapZoom: 18, mapHeading: 0 })).toBe(true)
    expect(hasBuildingSavedView({ mapLat: 1, mapLng: 2, mapZoom: 18, mapHeading: null })).toBe(false)
  })
})
