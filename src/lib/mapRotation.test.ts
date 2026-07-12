import { describe, expect, it, vi } from 'vitest'
import {
  applyStoredRotation,
  panToPreserveRotation,
  resetMapRotationPreserveView,
  resolveBuildingClickZoom,
} from '@/lib/mapRotation'
import { useMapRotationStore } from '@/stores/mapRotationStore'

describe('mapRotation', () => {
  it('applyStoredRotation sets map heading and tilt from store', () => {
    useMapRotationStore.setState({ heading: 45, tilt: 10 })
    let heading = 0
    let tilt = 0
    const map = {
      setHeading: (h: number) => {
        heading = h
      },
      setTilt: (t: number) => {
        tilt = t
      },
    } as unknown as google.maps.Map

    applyStoredRotation(map)
    expect(heading).toBe(45)
    expect(tilt).toBe(10)
  })

  it('panToPreserveRotation with onlyZoomIn does not zoom out', () => {
    const panTo = vi.fn()
    const setZoom = vi.fn()
    const map = {
      panTo,
      setZoom,
      getZoom: () => 21,
      setHeading: vi.fn(),
      setTilt: vi.fn(),
      addListener: vi.fn(() => ({ remove: vi.fn() })),
    } as unknown as google.maps.Map

    panToPreserveRotation(map, { lat: 1, lng: 2 }, 21, { onlyZoomIn: true })

    expect(panTo).toHaveBeenCalledWith({ lat: 1, lng: 2 })
    expect(setZoom).not.toHaveBeenCalled()
  })

  it('panToPreserveRotation with onlyZoomIn zooms in when below target', () => {
    const setZoom = vi.fn()
    const map = {
      panTo: vi.fn(),
      setZoom,
      getZoom: () => 18,
      setHeading: vi.fn(),
      setTilt: vi.fn(),
      addListener: vi.fn(() => ({ remove: vi.fn() })),
    } as unknown as google.maps.Map

    panToPreserveRotation(map, { lat: 1, lng: 2 }, 21, { onlyZoomIn: true })

    expect(setZoom).toHaveBeenCalledWith(21)
  })

  it('resolveBuildingClickZoom skips zoom when already close in', () => {
    expect(resolveBuildingClickZoom(21)).toBeUndefined()
    expect(resolveBuildingClickZoom(20)).toBeUndefined()
    expect(resolveBuildingClickZoom(18)).toBeUndefined()
  })

  it('resolveBuildingClickZoom zooms to detail−1 after 4+ levels out', () => {
    expect(resolveBuildingClickZoom(17)).toBe(20)
    expect(resolveBuildingClickZoom(14)).toBe(20)
    expect(resolveBuildingClickZoom(10)).toBe(20)
  })

  it('resetMapRotationPreserveView clears rotation but keeps center and zoom', () => {
    useMapRotationStore.setState({ heading: 90, tilt: 15 })
    const center = { lat: () => 43.5, lng: () => -79.6 }
    let heading = 90
    let tilt = 15
    let setCenterArg: google.maps.LatLng | null = null
    const map = {
      getCenter: () => center,
      getZoom: () => 17,
      setHeading: (h: number) => {
        heading = h
      },
      setTilt: (t: number) => {
        tilt = t
      },
      setCenter: (c: google.maps.LatLng) => {
        setCenterArg = c
      },
      setZoom: vi.fn(),
    } as unknown as google.maps.Map

    resetMapRotationPreserveView(map)

    expect(heading).toBe(0)
    expect(tilt).toBe(0)
    expect(useMapRotationStore.getState().heading).toBe(0)
    expect(useMapRotationStore.getState().tilt).toBe(0)
    expect(setCenterArg).toBe(center)
    expect(map.setZoom).toHaveBeenCalledWith(17)
  })
})
