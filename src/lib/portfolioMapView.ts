import type { SavedMapView } from '@/lib/buildingMapView'
import type { ImageryModeId } from '@/types/domain'

/** Park / cluster / manager dropdown values (empty string when unset). */
export interface PortfolioFilterKey {
  park: string
  cluster: string
  manager: string
}

export interface PortfolioMapViewFields {
  mapLat: number | null
  mapLng: number | null
  mapZoom: number | null
  mapHeading: number | null
  mapTilt: number | null
  mapImageryMode: ImageryModeId | null
}

/** Keyed by {@link serializePortfolioFilterKey}. */
export type PortfolioMapViews = Record<string, PortfolioMapViewFields>

export function serializePortfolioFilterKey(filter: PortfolioFilterKey): string {
  return `${filter.park}|${filter.cluster}|${filter.manager}`
}

export function hasActivePortfolioFilter(filter: PortfolioFilterKey): boolean {
  return Boolean(filter.park || filter.cluster || filter.manager)
}

/** Human-readable label for save prompts, e.g. "Park: Dixie, Manager: Jane". */
export function formatPortfolioFilterLabel(filter: PortfolioFilterKey): string {
  const parts: string[] = []
  if (filter.park) parts.push(`Park: ${filter.park}`)
  if (filter.cluster) parts.push(`Cluster: ${filter.cluster}`)
  if (filter.manager) parts.push(`Manager: ${filter.manager}`)
  if (parts.length === 0) return 'All buildings'
  return parts.join(', ')
}

export function getPortfolioSavedView(
  views: PortfolioMapViews,
  filter: PortfolioFilterKey,
): SavedMapView | null {
  const row = views[serializePortfolioFilterKey(filter)]
  if (!row) return null
  const { mapLat, mapLng, mapZoom, mapHeading, mapTilt, mapImageryMode } = row
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

export function hasPortfolioSavedView(
  views: PortfolioMapViews,
  filter: PortfolioFilterKey,
): boolean {
  return getPortfolioSavedView(views, filter) != null
}
