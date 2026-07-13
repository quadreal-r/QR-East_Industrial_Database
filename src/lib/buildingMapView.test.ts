import { describe, expect, it, vi } from 'vitest'
import { focusBuildingCamera, getBuildingSavedView, hasBuildingSavedView, mergeBuildingMapViewsFromBaseline } from '@/lib/buildingMapView'

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

describe('focusBuildingCamera', () => {
  function mockMap(zoom = 14) {
    return {
      getZoom: vi.fn(() => zoom),
      setCenter: vi.fn(),
      setZoom: vi.fn(),
      setHeading: vi.fn(),
      setTilt: vi.fn(),
      panTo: vi.fn(),
      addListener: vi.fn(() => ({ remove: vi.fn() })),
    }
  }

  it('restores the saved camera when the building has a saved view', () => {
    const map = mockMap()
    const building = {
      lat: 43.0,
      lng: -79.0,
      mapLat: 43.5,
      mapLng: -79.6,
      mapZoom: 20,
      mapHeading: 135,
      mapTilt: 45,
      mapImageryMode: 'esri' as const,
    }
    const view = focusBuildingCamera(map as unknown as google.maps.Map, building)
    expect(view).toEqual({
      lat: 43.5,
      lng: -79.6,
      zoom: 20,
      heading: 135,
      tilt: 45,
      imageryMode: 'esri',
    })
    expect(map.setCenter).toHaveBeenCalledWith({ lat: 43.5, lng: -79.6 })
    expect(map.setZoom).toHaveBeenCalledWith(20)
    expect(map.setHeading).toHaveBeenCalledWith(135)
    expect(map.panTo).not.toHaveBeenCalled()
  })

  it('pans to the address pin when there is no saved view', () => {
    const map = mockMap(10)
    const building = {
      lat: 43.1,
      lng: -79.2,
      mapLat: null,
      mapLng: null,
      mapZoom: null,
      mapHeading: null,
    }
    const view = focusBuildingCamera(map as unknown as google.maps.Map, building)
    expect(view).toBeNull()
    expect(map.panTo).toHaveBeenCalledWith({ lat: 43.1, lng: -79.2 })
    expect(map.setCenter).not.toHaveBeenCalled()
  })
})

describe('mergeBuildingMapViewsFromBaseline', () => {
  it('copies newer map camera fields onto override buildings by id', () => {
    const override = {
      buildings: [
        {
          id: 1,
          address: '1 Main',
          park: 'A',
          lat: 1,
          lng: 2,
          mapLat: null,
          mapLng: null,
          mapZoom: null,
          mapHeading: null,
          mapTilt: null,
          mapImageryMode: null,
        },
      ],
    }
    const baseline = {
      buildings: [
        {
          id: 1,
          address: '1 Main',
          park: 'A',
          lat: 1,
          lng: 2,
          mapLat: 43.5,
          mapLng: -79.6,
          mapZoom: 20,
          mapHeading: 90,
          mapTilt: 0,
          mapImageryMode: 'esri' as const,
        },
      ],
    }
    const merged = mergeBuildingMapViewsFromBaseline(override, baseline)
    expect(merged.buildings[0]).toMatchObject({
      mapLat: 43.5,
      mapLng: -79.6,
      mapZoom: 20,
      mapHeading: 90,
      mapImageryMode: 'esri',
    })
  })
})
