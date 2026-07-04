import type { Building } from '@/types/domain'

/** A fully-specified saved map camera for a building. */
export interface SavedMapView {
  lat: number
  lng: number
  zoom: number
  heading: number
  tilt: number
}

/**
 * A building has a saved map view only when center, zoom, and heading are all set.
 * Tilt defaults to 0 (north-up flat) when absent.
 */
export function getBuildingSavedView(
  building: Pick<Building, 'mapLat' | 'mapLng' | 'mapZoom' | 'mapHeading' | 'mapTilt'>,
): SavedMapView | null {
  const { mapLat, mapLng, mapZoom, mapHeading, mapTilt } = building
  if (mapLat == null || mapLng == null || mapZoom == null || mapHeading == null) return null
  return { lat: mapLat, lng: mapLng, zoom: mapZoom, heading: mapHeading, tilt: mapTilt ?? 0 }
}

export function hasBuildingSavedView(
  building: Pick<Building, 'mapLat' | 'mapLng' | 'mapZoom' | 'mapHeading' | 'mapTilt'>,
): boolean {
  return getBuildingSavedView(building) != null
}
