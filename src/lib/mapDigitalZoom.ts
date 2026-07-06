import { MAP_EXTRA_ZOOM_LEVELS, MAP_MAX_DIGITAL_SCALE, MAP_MAX_ZOOM } from '@/lib/constants'
import { isInsideMapInfoWindow } from '@/lib/mapPopups'

export interface MapDigitalZoomOptions {
  onScaleChange?: (scale: number) => void
}

/**
 * Google satellite often caps below our desired zoom — especially on vector maps.
 * Raise maxZoom when possible, then allow scroll-wheel digital zoom past the native cap.
 */
export function enableMapDigitalZoom(
  map: google.maps.Map,
  mapEl: HTMLElement,
  options: MapDigitalZoomOptions = {},
): () => void {
  const maxZoomService = new google.maps.MaxZoomService()
  let nativeMax = 20
  let digitalScale = 1
  const wheelTarget = mapEl.parentElement ?? mapEl

  const notifyScale = (): void => {
    options.onScaleChange?.(digitalScale)
  }

  const applyDigitalScale = (): void => {
    if (digitalScale <= 1.001) {
      mapEl.style.transform = ''
      mapEl.style.transformOrigin = ''
      notifyScale()
      return
    }
    mapEl.style.transform = `scale(${digitalScale})`
    mapEl.style.transformOrigin = '50% 50%'
    notifyScale()
  }

  const resetDigital = (): void => {
    digitalScale = 1
    applyDigitalScale()
  }

  const updateNativeMax = (): void => {
    const center = map.getCenter()
    if (!center) return

    maxZoomService.getMaxZoomAtLatLng(center, (result) => {
      if (result.status === google.maps.MaxZoomStatus.OK) {
        nativeMax = result.zoom
      }
      map.setOptions({
        maxZoom: Math.min(MAP_MAX_ZOOM, nativeMax + MAP_EXTRA_ZOOM_LEVELS),
      })
    })
  }

  const onWheel = (event: WheelEvent): void => {
    if (isInsideMapInfoWindow(event.target)) return

    const zoom = map.getZoom() ?? 0
    const zoomingIn = event.deltaY < 0
    const zoomingOut = event.deltaY > 0

    if (zoomingIn && zoom >= nativeMax - 0.05) {
      event.preventDefault()
      event.stopPropagation()
      if (zoom < nativeMax) {
        map.setZoom(Math.min(MAP_MAX_ZOOM, nativeMax))
      }
      digitalScale = Math.min(MAP_MAX_DIGITAL_SCALE, digitalScale * 1.12)
      applyDigitalScale()
      return
    }

    if (zoomingOut && digitalScale > 1.001) {
      event.preventDefault()
      event.stopPropagation()
      digitalScale = Math.max(1, digitalScale / 1.12)
      applyDigitalScale()
    }
  }

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' && digitalScale > 1.001) {
      resetDigital()
    }
  }

  const zoomListener = map.addListener('zoom_changed', () => {
    const zoom = map.getZoom() ?? 0
    if (zoom < nativeMax - 0.1) {
      resetDigital()
    }
  })

  const idleListener = map.addListener('idle', updateNativeMax)

  wheelTarget.addEventListener('wheel', onWheel, { passive: false, capture: true })
  window.addEventListener('keydown', onKeyDown)
  map.setOptions({ maxZoom: MAP_MAX_ZOOM })
  updateNativeMax()

  return () => {
    wheelTarget.removeEventListener('wheel', onWheel, { capture: true })
    window.removeEventListener('keydown', onKeyDown)
    google.maps.event.removeListener(zoomListener)
    google.maps.event.removeListener(idleListener)
    resetDigital()
  }
}
