import { ESRI_TILE_URL, IMAGERY_MODES } from '@/lib/constants'
import type { ImageryMode, ImageryModeId } from '@/types/domain'

export type ImageryOverlayRef = { current: google.maps.ImageMapType | null }

export function imageryModeIndexFromId(id: ImageryModeId | null | undefined): number {
  if (!id) return 0
  const index = IMAGERY_MODES.findIndex((mode) => mode.id === id)
  return index >= 0 ? index : 0
}

export function imageryModeIdFromIndex(index: number): ImageryModeId {
  const normalized = ((index % IMAGERY_MODES.length) + IMAGERY_MODES.length) % IMAGERY_MODES.length
  return IMAGERY_MODES[normalized]?.id ?? 'google'
}

function removeImageryOverlay(map: google.maps.Map, overlayRef: ImageryOverlayRef): void {
  if (!overlayRef.current) return
  const idx = map.overlayMapTypes.getArray().indexOf(overlayRef.current)
  if (idx >= 0) map.overlayMapTypes.removeAt(idx)
  overlayRef.current = null
}

function applyTileOverlay(
  map: google.maps.Map,
  overlayRef: ImageryOverlayRef,
  getTileUrl: (coord: google.maps.Point, zoom: number) => string,
  name: string,
): void {
  removeImageryOverlay(map, overlayRef)
  const imgType = new google.maps.ImageMapType({
    getTileUrl: (coord, zoom) => getTileUrl(coord, zoom),
    tileSize: new google.maps.Size(256, 256),
    maxZoom: 20,
    name,
    opacity: 1,
  })
  map.setMapTypeId('roadmap')
  map.overlayMapTypes.insertAt(0, imgType)
  overlayRef.current = imgType
}

/** Apply Google or Esri imagery and return the mode metadata. */
export function applyImageryModeIndex(
  map: google.maps.Map,
  modeIndex: number,
  overlayRef: ImageryOverlayRef,
): ImageryMode {
  const index = imageryModeIndexFromId(imageryModeIdFromIndex(modeIndex))
  if (index === 0) {
    removeImageryOverlay(map, overlayRef)
    // Satellite keeps road labels off; user can enable them via the map type control (hybrid).
    map.setMapTypeId('satellite')
  } else {
    applyTileOverlay(
      map,
      overlayRef,
      (coord, zoom) =>
        ESRI_TILE_URL.replace('{z}', String(zoom))
          .replace('{y}', String(coord.y))
          .replace('{x}', String(coord.x)),
      'Esri',
    )
  }
  return IMAGERY_MODES[index]!
}

export function applyImageryModeId(
  map: google.maps.Map,
  id: ImageryModeId,
  overlayRef: ImageryOverlayRef,
): ImageryMode {
  return applyImageryModeIndex(map, imageryModeIndexFromId(id), overlayRef)
}
