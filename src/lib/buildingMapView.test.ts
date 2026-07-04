import { describe, expect, it } from 'vitest'
import { getBuildingSavedView, hasBuildingSavedView } from '@/lib/buildingMapView'

describe('getBuildingSavedView', () => {
  it('returns the saved camera when center, zoom, and heading are set', () => {
    const view = getBuildingSavedView({
      mapLat: 43.5,
      mapLng: -79.6,
      mapZoom: 20,
      mapHeading: 135,
      mapTilt: 45,
    })
    expect(view).toEqual({ lat: 43.5, lng: -79.6, zoom: 20, heading: 135, tilt: 45 })
  })

  it('defaults tilt to 0 when absent', () => {
    const view = getBuildingSavedView({
      mapLat: 43.5,
      mapLng: -79.6,
      mapZoom: 20,
      mapHeading: 90,
      mapTilt: null,
    })
    expect(view?.tilt).toBe(0)
  })

  it('returns null when any required field is missing', () => {
    expect(getBuildingSavedView({ mapLat: null, mapLng: -79.6, mapZoom: 20, mapHeading: 0 })).toBeNull()
    expect(getBuildingSavedView({ mapLat: 43.5, mapLng: null, mapZoom: 20, mapHeading: 0 })).toBeNull()
    expect(getBuildingSavedView({ mapLat: 43.5, mapLng: -79.6, mapZoom: null, mapHeading: 0 })).toBeNull()
    expect(getBuildingSavedView({ mapLat: 43.5, mapLng: -79.6, mapZoom: 20, mapHeading: null })).toBeNull()
    expect(getBuildingSavedView({})).toBeNull()
  })

  it('treats heading 0 as a valid saved view', () => {
    const view = getBuildingSavedView({ mapLat: 1, mapLng: 2, mapZoom: 18, mapHeading: 0 })
    expect(view).toEqual({ lat: 1, lng: 2, zoom: 18, heading: 0, tilt: 0 })
  })
})

describe('hasBuildingSavedView', () => {
  it('reflects presence of a saved view', () => {
    expect(hasBuildingSavedView({ mapLat: 1, mapLng: 2, mapZoom: 18, mapHeading: 0 })).toBe(true)
    expect(hasBuildingSavedView({})).toBe(false)
  })
})
