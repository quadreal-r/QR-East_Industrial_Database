import type { Building, ImageryModeId } from '@/types/domain'
import { MAP_DETAIL_ZOOM } from '@/lib/constants'
import { applySavedMapView, panToPreserveRotation, resolveBuildingClickZoom } from '@/lib/mapRotation'

/** A fully-specified saved map camera for a building. */
export interface SavedMapView {
  lat: number
  lng: number
  zoom: number
  heading: number
  tilt: number
  imageryMode: ImageryModeId | null
}

/**
 * A building has a saved map view only when center, zoom, and heading are all set.
 * Tilt defaults to 0 (north-up flat) when absent.
 */
export function getBuildingSavedView(
  building: Pick<
    Building,
    'mapLat' | 'mapLng' | 'mapZoom' | 'mapHeading' | 'mapTilt' | 'mapImageryMode'
  >,
): SavedMapView | null {
  const { mapLat, mapLng, mapZoom, mapHeading, mapTilt, mapImageryMode } = building
  if (mapLat == null || mapLng == null || mapZoom == null || mapHeading == null) return null
  return {
    lat: mapLat,
    lng: mapLng,
    zoom: mapZoom,
    heading: mapHeading,
    tilt: mapTilt ?? 0,
    imageryMode: mapImageryMode ?? null,
  }
}

export function hasBuildingSavedView(
  building: Pick<
    Building,
    'mapLat' | 'mapLng' | 'mapZoom' | 'mapHeading' | 'mapTilt' | 'mapImageryMode'
  >,
): boolean {
  return getBuildingSavedView(building) != null
}

/**
 * Move the map to a building: restore its saved camera when present, otherwise
 * pan to the address pin (same behavior for marker click, sidebar, and search).
 */
export function focusBuildingCamera(
  map: google.maps.Map,
  building: Pick<
    Building,
    'lat' | 'lng' | 'mapLat' | 'mapLng' | 'mapZoom' | 'mapHeading' | 'mapTilt' | 'mapImageryMode'
  >,
): SavedMapView | null {
  const savedView = getBuildingSavedView(building)
  if (savedView) {
    applySavedMapView(map, savedView)
    return savedView
  }
  const currentZoom = map.getZoom() ?? 0
  panToPreserveRotation(
    map,
    { lat: building.lat, lng: building.lng },
    resolveBuildingClickZoom(currentZoom, MAP_DETAIL_ZOOM),
    { onlyZoomIn: true },
  )
  return null
}

type BuildingMapViewFields = Pick<
  Building,
  'id' | 'mapLat' | 'mapLng' | 'mapZoom' | 'mapHeading' | 'mapTilt' | 'mapImageryMode'
>

/** Copy saved map-camera fields from baseline onto matching override buildings. */
export function mergeBuildingMapViewsFromBaseline<T extends { buildings: BuildingMapViewFields[] }>(
  override: T,
  baseline: { buildings: BuildingMapViewFields[] },
): T {
  let changed = false
  const buildings = override.buildings.map((building) => {
    const fresh = baseline.buildings.find((b) => b.id != null && b.id === building.id)
    if (!fresh) return building
    if (
      building.mapLat === fresh.mapLat &&
      building.mapLng === fresh.mapLng &&
      building.mapZoom === fresh.mapZoom &&
      building.mapHeading === fresh.mapHeading &&
      building.mapTilt === fresh.mapTilt &&
      building.mapImageryMode === fresh.mapImageryMode
    ) {
      return building
    }
    changed = true
    return {
      ...building,
      mapLat: fresh.mapLat,
      mapLng: fresh.mapLng,
      mapZoom: fresh.mapZoom,
      mapHeading: fresh.mapHeading,
      mapTilt: fresh.mapTilt,
      mapImageryMode: fresh.mapImageryMode,
    }
  })
  return changed ? { ...override, buildings } : override
}
