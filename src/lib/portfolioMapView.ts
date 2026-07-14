import type { ImageryModeId } from '@/types/domain'
import type { SavedMapView } from '@/lib/buildingMapView'

/** Parse a stored All Buildings overview camera, or null if incomplete. */
export function parsePortfolioMapView(value: unknown): SavedMapView | null {
  if (!value || typeof value !== 'object') return null
  const v = value as Record<string, unknown>
  const lat = typeof v.lat === 'number' ? v.lat : null
  const lng = typeof v.lng === 'number' ? v.lng : null
  const zoom = typeof v.zoom === 'number' ? v.zoom : null
  const heading = typeof v.heading === 'number' ? v.heading : null
  if (lat == null || lng == null || zoom == null || heading == null) return null
  const tilt = typeof v.tilt === 'number' ? v.tilt : 0
  const imageryMode =
    v.imageryMode === 'google' || v.imageryMode === 'esri'
      ? (v.imageryMode as ImageryModeId)
      : null
  return { lat, lng, zoom, heading, tilt, imageryMode }
}

export function hasPortfolioMapView(view: SavedMapView | null | undefined): boolean {
  return view != null
}
