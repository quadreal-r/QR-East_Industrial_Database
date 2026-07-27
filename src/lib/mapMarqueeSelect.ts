export type MarqueeTarget =
  | { kind: 'point'; resolve: () => { lat: number; lng: number } | null }
  | { kind: 'polygon'; resolve: () => Array<{ lat: number; lng: number }> }

export const MARQUEE_HIT_PADDING_PX = 16

const targets = new Map<string, MarqueeTarget>()

let suppressMapClickClear = false
let suppressMapClickClearResetScheduled = false

const lastPointerModifiers = {
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
}

if (typeof window !== 'undefined') {
  window.addEventListener(
    'mousedown',
    (e) => {
      lastPointerModifiers.ctrlKey = e.ctrlKey
      lastPointerModifiers.metaKey = e.metaKey
      lastPointerModifiers.shiftKey = e.shiftKey
    },
    true,
  )
}

export function registerMarqueeTarget(key: string, target: MarqueeTarget): void {
  targets.set(key, target)
}

export function unregisterMarqueeTarget(key: string): void {
  targets.delete(key)
}

export function clearMarqueeTargets(): void {
  targets.clear()
}

/** Keep map/marker clicks from clearing popups during the current pointer gesture. */
export function suppressMapClickClearOnce(): void {
  suppressMapClickClear = true
  if (suppressMapClickClearResetScheduled) return
  suppressMapClickClearResetScheduled = true

  const finish = (): void => {
    if (!suppressMapClickClearResetScheduled) return
    suppressMapClickClear = false
    suppressMapClickClearResetScheduled = false
    if (typeof window === 'undefined') return
    window.removeEventListener('pointerup', finish, true)
    window.removeEventListener('mouseup', finish, true)
  }

  if (typeof window !== 'undefined') {
    // Survive text-selection / input interaction — microtask was clearing too early
    // and map click would close the InfoWindow mid-edit.
    window.addEventListener('pointerup', finish, { capture: true })
    window.addEventListener('mouseup', finish, { capture: true })
    window.setTimeout(finish, 750)
  } else {
    queueMicrotask(finish)
  }
}

export function consumeMapClickClearSuppression(): boolean {
  return suppressMapClickClear
}

/** Ctrl/Shift+click additive select — gmp-click domEvent may omit modifier keys. */
export function isSelectionAdditiveClick(e?: google.maps.MapMouseEvent): boolean {
  const domEvent = e?.domEvent
  if (domEvent instanceof MouseEvent) {
    if (domEvent.ctrlKey || domEvent.metaKey || domEvent.shiftKey) return true
  }
  return Boolean(
    lastPointerModifiers.ctrlKey ||
      lastPointerModifiers.metaKey ||
      lastPointerModifiers.shiftKey,
  )
}

export function marqueePointFromLatLng(lat: number, lng: number): MarqueeTarget {
  return { kind: 'point', resolve: () => ({ lat, lng }) }
}

export function marqueePolygonFromPaths(
  paths: Array<{ lat: number; lng: number }>,
): MarqueeTarget {
  return { kind: 'polygon', resolve: () => paths }
}

export interface ScreenRect {
  left: number
  top: number
  right: number
  bottom: number
}

export interface MarqueeProjection {
  fromLatLngToContainerPixel(
    latLng: google.maps.LatLngLiteral,
  ): { x: number; y: number } | google.maps.Point | null
}

function pointPixel(
  projection: MarqueeProjection,
  lat: number,
  lng: number,
): { x: number; y: number } | null {
  const px = projection.fromLatLngToContainerPixel({ lat, lng })
  if (!px) return null
  return { x: px.x, y: px.y }
}

export function pointInScreenRect(
  x: number,
  y: number,
  rect: ScreenRect,
  padding = 0,
): boolean {
  return (
    x >= rect.left - padding &&
    x <= rect.right + padding &&
    y >= rect.top - padding &&
    y <= rect.bottom + padding
  )
}

export function polygonIntersectsScreenRect(
  projection: MarqueeProjection,
  paths: Array<{ lat: number; lng: number }>,
  rect: ScreenRect,
  padding = 0,
): boolean {
  for (const pt of paths) {
    const px = pointPixel(projection, pt.lat, pt.lng)
    if (px && pointInScreenRect(px.x, px.y, rect, padding)) return true
  }
  if (paths.length === 0) return false
  const lat = paths.reduce((sum, pt) => sum + pt.lat, 0) / paths.length
  const lng = paths.reduce((sum, pt) => sum + pt.lng, 0) / paths.length
  const centroid = pointPixel(projection, lat, lng)
  return centroid ? pointInScreenRect(centroid.x, centroid.y, rect, padding) : false
}

export function findMarqueeKeysInScreenRect(
  projection: MarqueeProjection,
  rect: ScreenRect,
  padding = MARQUEE_HIT_PADDING_PX,
): string[] {
  const keys: string[] = []
  for (const [key, target] of targets) {
    if (target.kind === 'point') {
      const pos = target.resolve()
      if (!pos) continue
      const px = pointPixel(projection, pos.lat, pos.lng)
      if (px && pointInScreenRect(px.x, px.y, rect, padding)) keys.push(key)
      continue
    }
    const paths = target.resolve()
    if (polygonIntersectsScreenRect(projection, paths, rect, padding)) keys.push(key)
  }
  return keys
}
