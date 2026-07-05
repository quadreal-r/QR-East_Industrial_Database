import type { Building, ImageryModeId } from '@/types/domain'

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
