import { useMapRotationStore } from '@/stores/mapRotationStore'
import type { SavedMapView } from '@/lib/buildingMapView'

function headingDiff(a: number, b: number): number {
  let d = Math.abs(a - b) % 360
  if (d > 180) d = 360 - d
  return d
}

export function applyStoredRotation(map: google.maps.Map): void {
  const { heading, tilt } = useMapRotationStore.getState()
  map.setHeading(heading)
  map.setTilt(tilt)
}

/** Reset heading/tilt to north-up while keeping the current map center and zoom. */
export function resetMapRotationPreserveView(map: google.maps.Map): void {
  const center = map.getCenter()
  const zoom = map.getZoom()
  useMapRotationStore.getState().resetRotation()
  map.setHeading(0)
  map.setTilt(0)
  if (center) map.setCenter(center)
  if (zoom != null) map.setZoom(zoom)
}

/** Keep map aligned with stored rotation when Maps resets heading (e.g. InfoWindow auto-pan). */
export function installRotationGuard(map: google.maps.Map): google.maps.MapsEventListener {
  const enforce = () => {
    const { heading, tilt } = useMapRotationStore.getState()
    const currentH = map.getHeading() || 0
    const currentT = map.getTilt() || 0
    if (headingDiff(currentH, heading) > 0.5) map.setHeading(heading)
    if (Math.abs(currentT - tilt) > 0.5) map.setTilt(tilt)
  }
  return map.addListener('idle', enforce)
}

/** Re-apply rotation after pan/zoom/fitBounds/InfoWindow (Maps may reset heading on idle). */
export function afterMapViewChange(map: google.maps.Map): void {
  applyStoredRotation(map)
  const listener = map.addListener('idle', () => {
    applyStoredRotation(map)
    google.maps.event.removeListener(listener)
  })
}

export interface PanToOptions {
  /** Only call setZoom when the map is currently zoomed out farther than the target. */
  onlyZoomIn?: boolean
}

/**
 * Zoom for a building click when the map is far enough out.
 * Returns undefined when already close in (do not zoom more).
 * Zooms to detail − 1 only after zooming out at least 4 levels from detail.
 */
export function resolveBuildingClickZoom(
  currentZoom: number,
  detailZoom = 21,
  zoomOutThreshold = 4,
): number | undefined {
  if (currentZoom <= detailZoom - zoomOutThreshold) return detailZoom - 1
  return undefined
}

export function panToPreserveRotation(
  map: google.maps.Map,
  center: google.maps.LatLngLiteral,
  zoom?: number,
  options?: PanToOptions,
): void {
  map.panTo(center)
  if (zoom != null) {
    const current = map.getZoom() ?? 0
    if (!options?.onlyZoomIn || current < zoom) {
      map.setZoom(zoom)
    }
  }
  afterMapViewChange(map)
}

/** Restore a building's saved camera: center, zoom, heading, and tilt (updates the rotation store too). */
export function applySavedMapView(map: google.maps.Map, view: SavedMapView): void {
  const rotation = useMapRotationStore.getState()
  rotation.setHeading(view.heading)
  rotation.setTilt(view.tilt)
  map.setCenter({ lat: view.lat, lng: view.lng })
  map.setZoom(view.zoom)
  map.setHeading(view.heading)
  map.setTilt(view.tilt)
  afterMapViewChange(map)
}

export function fitBoundsPreserveRotation(
  map: google.maps.Map,
  bounds: google.maps.LatLngBounds,
  padding?: number | google.maps.Padding,
): void {
  map.fitBounds(bounds, padding)
  afterMapViewChange(map)
}
