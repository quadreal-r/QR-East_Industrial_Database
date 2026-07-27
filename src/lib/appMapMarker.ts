/**
 * Google Maps AdvancedMarkerElement wrapper (replaces deprecated google.maps.Marker).
 */

import { INSPECTION360_MARKER_PX } from '@/lib/constants'

export type AppMapMarker = google.maps.marker.AdvancedMarkerElement

type MarkerListenerEvent = 'click' | 'dragstart' | 'drag' | 'dragend'

interface MarkerMeta {
  attachedMap: google.maps.Map | null
  visible: boolean
}

const markerMeta = new WeakMap<AppMapMarker, MarkerMeta>()

const LISTENER_EVENT: Record<MarkerListenerEvent, string> = {
  click: 'gmp-click',
  dragstart: 'gmp-dragstart',
  drag: 'gmp-drag',
  dragend: 'gmp-dragend',
}

function getMeta(marker: AppMapMarker): MarkerMeta {
  let meta = markerMeta.get(marker)
  if (!meta) {
    meta = { attachedMap: marker.map ?? null, visible: true }
    markerMeta.set(marker, meta)
  }
  return meta
}

function syncMarkerVisibility(marker: AppMapMarker): void {
  const meta = getMeta(marker)
  marker.map = meta.visible ? meta.attachedMap : null
}

function symbolPathD(path: google.maps.Symbol['path']): string {
  if (path === google.maps.SymbolPath.CIRCLE) {
    return 'M 0,0 m -1,0 a 1,1 0 1,0 2,0 a 1,1 0 1,0 -2,0'
  }
  return String(path ?? '')
}

/** Legacy `google.maps.Marker` Symbol diameter in CSS pixels (≈ scale × 2). */
function symbolPixelSize(scale: number): number {
  return Math.max(8, Math.round(scale * 2))
}

function buildSymbolContent(icon: google.maps.Symbol): HTMLElement {
  const scale = icon.scale ?? 5
  const size = symbolPixelSize(scale)
  const wrap = document.createElement('div')
  wrap.style.width = `${size}px`
  wrap.style.height = `${size}px`
  wrap.style.display = 'flex'
  wrap.style.alignItems = 'center'
  wrap.style.justifyContent = 'center'
  wrap.style.pointerEvents = 'auto'
  wrap.style.flexShrink = '0'

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '-1.2 -1.2 2.4 2.4')
  svg.setAttribute('width', String(size))
  svg.setAttribute('height', String(size))
  svg.style.overflow = 'visible'
  svg.style.display = 'block'

  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  path.setAttribute('d', symbolPathD(icon.path))
  path.setAttribute('fill', icon.fillColor ?? '#2563eb')
  path.setAttribute('fill-opacity', String(icon.fillOpacity ?? 1))
  path.setAttribute('stroke', icon.strokeColor ?? '#fff')
  path.setAttribute('stroke-width', String(((icon.strokeWeight ?? 1) * 2.4) / size))
  svg.appendChild(path)
  wrap.appendChild(svg)
  return wrap
}

function buildIconUrlContent(icon: google.maps.Icon): HTMLElement {
  const img = document.createElement('img')
  img.src = icon.url ?? ''
  img.draggable = false
  img.style.display = 'block'
  const w = icon.scaledSize?.width ?? 24
  const h = icon.scaledSize?.height ?? 24
  img.width = w
  img.height = h
  const wrap = document.createElement('div')
  wrap.appendChild(img)
  return wrap
}

function buildLabelContent(
  label: google.maps.MarkerLabel,
  labelOffsetY = 0,
): HTMLElement {
  const wrap = document.createElement('div')
  wrap.style.display = 'flex'
  wrap.style.flexDirection = 'column'
  wrap.style.alignItems = 'center'
  wrap.style.pointerEvents = 'none'

  const anchor = document.createElement('div')
  anchor.style.width = '1px'
  anchor.style.height = '1px'
  wrap.appendChild(anchor)

  const span = document.createElement('span')
  span.textContent = label.text ?? ''
  span.style.color = label.color ?? '#fff'
  span.style.fontSize = label.fontSize ?? '11px'
  span.style.fontWeight = label.fontWeight ?? '500'
  span.style.fontFamily = label.fontFamily ?? 'Inter,sans-serif'
  span.style.whiteSpace = 'nowrap'
  span.style.textShadow = '0 0 3px rgba(0,0,0,0.85)'
  span.style.transform = `translateY(${labelOffsetY}px)`
  if (label.className) span.className = label.className
  wrap.appendChild(span)
  return wrap
}

export interface BuildingMarkerLabel {
  text: string
  color?: string
  fontSize?: string
  fontWeight?: string
  fontFamily?: string
  className?: string
}

/** Center the map coordinate on the pin circle (Advanced Marker translate-style anchor). */
const PIN_CENTER_ANCHOR_LEFT = '-50%'
const PIN_CENTER_ANCHOR_TOP = '-50%'

/** Building pin + address label — lat/lng at circle center, label below (legacy behavior). */
export function buildBuildingMarkerContent(
  icon: google.maps.Symbol,
  label: BuildingMarkerLabel,
  gap = 4,
): HTMLElement {
  const pinSize = symbolPixelSize(icon.scale ?? 11)

  const root = document.createElement('div')
  root.style.position = 'relative'
  root.style.width = `${pinSize}px`
  root.style.height = `${pinSize}px`
  root.style.pointerEvents = 'auto'
  root.style.cursor = 'pointer'
  root.style.lineHeight = '0'

  const pinWrap = document.createElement('div')
  pinWrap.style.width = '100%'
  pinWrap.style.height = '100%'
  pinWrap.style.display = 'flex'
  pinWrap.style.alignItems = 'center'
  pinWrap.style.justifyContent = 'center'
  pinWrap.appendChild(buildSymbolContent(icon))
  root.appendChild(pinWrap)

  const span = document.createElement('span')
  span.textContent = label.text
  span.style.color = label.color ?? '#fff'
  span.style.fontSize = label.fontSize ?? '11px'
  span.style.fontWeight = label.fontWeight ?? '500'
  span.style.fontFamily = label.fontFamily ?? 'Inter,sans-serif'
  span.style.whiteSpace = 'nowrap'
  span.style.lineHeight = '1.2'
  span.style.position = 'absolute'
  span.style.left = '50%'
  span.style.top = '100%'
  span.style.transform = 'translateX(-50%)'
  span.style.marginTop = `${gap}px`
  span.style.pointerEvents = 'auto'
  if (label.className) span.className = label.className
  root.appendChild(span)

  return root
}

export function buildingMarkerPinHeight(icon: google.maps.Symbol): number {
  return symbolPixelSize(icon.scale ?? 11)
}

export function setBuildingMarkerContent(
  marker: AppMapMarker,
  icon: google.maps.Symbol,
  label: BuildingMarkerLabel,
  gap = 4,
): void {
  marker.content = buildBuildingMarkerContent(icon, label, gap)
  marker.anchorLeft = PIN_CENTER_ANCHOR_LEFT
  marker.anchorTop = PIN_CENTER_ANCHOR_TOP
  marker.gmpClickable = true
}

export interface DetailMarkerContentOptions {
  icon: google.maps.Symbol
  label?: google.maps.MarkerLabel
  labelOffsetY?: number
  pictureCount?: number
}

/** RTU / utility marker DOM — label above pin, optional picture-count badge centered on pin. */
export function buildDetailMarkerContent(options: DetailMarkerContentOptions): HTMLElement {
  const labelOffset = options.labelOffsetY ?? -7
  const pinSize = symbolPixelSize((options.icon.scale as number | undefined) ?? 5)

  const root = document.createElement('div')
  root.style.position = 'relative'
  root.style.width = `${pinSize}px`
  root.style.height = `${pinSize}px`
  root.style.display = 'flex'
  root.style.alignItems = 'center'
  root.style.justifyContent = 'center'
  root.style.pointerEvents = 'auto'
  root.style.cursor = 'pointer'
  root.style.lineHeight = '0'

  root.appendChild(buildSymbolContent(options.icon))

  if (options.label?.text) {
    const span = document.createElement('span')
    span.textContent = options.label.text
    span.style.color = options.label.color ?? '#fbbf24'
    span.style.fontSize = options.label.fontSize ?? '11px'
    span.style.fontWeight = options.label.fontWeight ?? '500'
    span.style.fontFamily = options.label.fontFamily ?? 'Inter,sans-serif'
    span.style.whiteSpace = 'nowrap'
    span.style.lineHeight = '1.2'
    span.style.position = 'absolute'
    span.style.left = '50%'
    span.style.top = '50%'
    // Legacy Marker labelOrigin (0.5, -15): label sits on top edge of pin
    span.style.transform = `translate(-50%, calc(-100% + ${labelOffset}px))`
    span.style.pointerEvents = 'auto'
    if (options.label.className) span.className = options.label.className
    root.appendChild(span)
  }

  const count = options.pictureCount ?? 0
  if (count > 0) {
    const badge = document.createElement('span')
    badge.textContent = count > 99 ? '99+' : String(count)
    badge.className = 'rtu-pic-badge'
    badge.style.position = 'absolute'
    badge.style.left = '50%'
    badge.style.top = '50%'
    badge.style.transform = 'translate(-50%, -50%)'
    badge.style.pointerEvents = 'none'
    root.appendChild(badge)
  }

  return root
}

export function setDetailMarkerContent(
  marker: AppMapMarker,
  options: DetailMarkerContentOptions,
): void {
  marker.content = buildDetailMarkerContent(options)
  marker.anchorLeft = PIN_CENTER_ANCHOR_LEFT
  marker.anchorTop = PIN_CENTER_ANCHOR_TOP
  marker.gmpClickable = true
}

/** Update only the numeric badge so an open InfoWindow does not force a full marker rebuild. */
export function patchDetailMarkerPictureCount(marker: AppMapMarker, count: number): void {
  const root = marker.content
  if (!(root instanceof HTMLElement)) return
  let badge = root.querySelector('.rtu-pic-badge') as HTMLElement | null
  if (count <= 0) {
    badge?.remove()
    return
  }
  if (!badge) {
    badge = document.createElement('span')
    badge.className = 'rtu-pic-badge'
    badge.style.position = 'absolute'
    badge.style.left = '50%'
    badge.style.top = '50%'
    badge.style.transform = 'translate(-50%, -50%)'
    badge.style.pointerEvents = 'none'
    root.appendChild(badge)
  }
  badge.textContent = count > 99 ? '99+' : String(count)
}

export interface Inspection360MarkerContentOptions {
  fillColor: string
  strokeColor: string
  sizePx?: number
  label?: google.maps.MarkerLabel
  labelOffsetY?: number
  selected?: boolean
}

/** 3D-style sphere marker for QR-360° suite entrance gates. */
export function buildSphereMarkerContent(options: Inspection360MarkerContentOptions): HTMLElement {
  const size = options.sizePx ?? INSPECTION360_MARKER_PX
  const labelOffset = options.labelOffsetY ?? -10
  const fill = options.fillColor
  const stroke = options.strokeColor
  const highlight = options.selected ? '#ffffff' : '#e0f2fe'

  const root = document.createElement('div')
  root.style.position = 'relative'
  root.style.width = `${size}px`
  root.style.height = `${size}px`
  root.style.display = 'flex'
  root.style.alignItems = 'center'
  root.style.justifyContent = 'center'
  root.style.pointerEvents = 'auto'
  root.style.cursor = 'pointer'
  root.style.lineHeight = '0'
  root.style.overflow = 'visible'

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('width', String(size))
  svg.setAttribute('height', String(size))
  svg.style.display = 'block'
  svg.style.overflow = 'visible'
  svg.style.filter = options.selected
    ? 'drop-shadow(0 0 6px rgba(56, 189, 248, 0.85))'
    : 'drop-shadow(0 1px 2px rgba(0,0,0,0.45))'

  const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs')
  const grad = document.createElementNS('http://www.w3.org/2000/svg', 'radialGradient')
  grad.setAttribute('id', `sphere-grad-${Math.random().toString(36).slice(2, 9)}`)
  grad.setAttribute('cx', '35%')
  grad.setAttribute('cy', '30%')
  grad.setAttribute('r', '65%')

  const stop1 = document.createElementNS('http://www.w3.org/2000/svg', 'stop')
  stop1.setAttribute('offset', '0%')
  stop1.setAttribute('stop-color', highlight)
  stop1.setAttribute('stop-opacity', '0.95')
  const stop2 = document.createElementNS('http://www.w3.org/2000/svg', 'stop')
  stop2.setAttribute('offset', '55%')
  stop2.setAttribute('stop-color', fill)
  stop2.setAttribute('stop-opacity', '0.95')
  const stop3 = document.createElementNS('http://www.w3.org/2000/svg', 'stop')
  stop3.setAttribute('offset', '100%')
  stop3.setAttribute('stop-color', stroke)
  stop3.setAttribute('stop-opacity', '1')

  grad.appendChild(stop1)
  grad.appendChild(stop2)
  grad.appendChild(stop3)
  defs.appendChild(grad)
  svg.appendChild(defs)

  const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle')
  circle.setAttribute('cx', '12')
  circle.setAttribute('cy', '12')
  circle.setAttribute('r', options.selected ? '10.5' : '9.5')
  circle.setAttribute('fill', `url(#${grad.id})`)
  circle.setAttribute('stroke', options.selected ? '#ffffff' : stroke)
  circle.setAttribute('stroke-width', options.selected ? '2' : '1.2')
  svg.appendChild(circle)
  root.appendChild(svg)

  if (options.label?.text) {
    const span = document.createElement('span')
    span.textContent = options.label.text
    span.style.color = options.label.color ?? fill
    span.style.fontSize = options.label.fontSize ?? '10px'
    span.style.fontWeight = options.label.fontWeight ?? '700'
    span.style.fontFamily = options.label.fontFamily ?? 'Inter,sans-serif'
    span.style.whiteSpace = 'nowrap'
    span.style.lineHeight = '1.2'
    span.style.position = 'absolute'
    span.style.left = '50%'
    span.style.top = '50%'
    span.style.transform = `translate(-50%, calc(-100% + ${labelOffset}px))`
    span.style.pointerEvents = 'none'
    if (options.label.className) span.className = options.label.className
    root.appendChild(span)
  }

  return root
}

export function setInspection360MarkerContent(
  marker: AppMapMarker,
  options: Inspection360MarkerContentOptions,
): void {
  marker.content = buildSphereMarkerContent(options)
  marker.anchorLeft = PIN_CENTER_ANCHOR_LEFT
  marker.anchorTop = PIN_CENTER_ANCHOR_TOP
  marker.gmpClickable = true
}

export interface CreateAppMarkerOptions {
  map?: google.maps.Map | null
  position: google.maps.LatLngLiteral
  title?: string
  zIndex?: number
  draggable?: boolean
  clickable?: boolean
  icon?: google.maps.Symbol | google.maps.Icon
  label?: google.maps.MarkerLabel
  /** Pixels below anchor for label-only markers (building labels ≈ 22). */
  labelOffsetY?: number
  content?: HTMLElement
  /** Advanced marker anchor offset from content top-left (default bottom-center). */
  anchorLeft?: string
  anchorTop?: string
  collisionBehavior?: google.maps.CollisionBehavior
}

export function createAppMarker(options: CreateAppMarkerOptions): AppMapMarker {
  const { AdvancedMarkerElement } = google.maps.marker

  let content = options.content
  if (!content) {
    if (options.label && !options.icon) {
      content = buildLabelContent(options.label, options.labelOffsetY ?? 0)
    } else if (options.icon && 'url' in options.icon && options.icon.url) {
      content = buildIconUrlContent(options.icon)
    } else if (options.icon) {
      content = buildSymbolContent(options.icon as google.maps.Symbol)
    } else {
      content = document.createElement('div')
    }
  }

  if (options.clickable === false) {
    content.style.pointerEvents = 'none'
  }

  const clickable = options.clickable !== false

  const marker = new AdvancedMarkerElement({
    map: options.map ?? undefined,
    position: options.position,
    title: options.title,
    zIndex: options.zIndex,
    gmpDraggable: options.draggable ?? false,
    gmpClickable: clickable,
    content,
    anchorLeft: options.anchorLeft,
    anchorTop: options.anchorTop,
    collisionBehavior: options.collisionBehavior,
  })

  markerMeta.set(marker, {
    attachedMap: options.map ?? null,
    visible: true,
  })

  return marker
}

export function getAppMarkerPosition(marker: AppMapMarker): google.maps.LatLng | null {
  const pos = marker.position
  if (!pos) return null
  if (pos instanceof google.maps.LatLng) return pos
  return new google.maps.LatLng(pos.lat, pos.lng)
}

export function setAppMarkerPosition(
  marker: AppMapMarker,
  lat: number,
  lng: number,
): void {
  marker.position = { lat, lng }
}

export function setAppMarkerMap(marker: AppMapMarker, map: google.maps.Map | null): void {
  const meta = getMeta(marker)
  meta.attachedMap = map
  syncMarkerVisibility(marker)
}

export function setAppMarkerVisible(marker: AppMapMarker, visible: boolean): void {
  const meta = getMeta(marker)
  meta.visible = visible
  syncMarkerVisibility(marker)
}

export function setAppMarkerDraggable(marker: AppMapMarker, draggable: boolean): void {
  marker.gmpDraggable = draggable
}

export function setAppMarkerZIndex(marker: AppMapMarker, zIndex: number): void {
  marker.zIndex = zIndex
}

export function setAppMarkerIcon(
  marker: AppMapMarker,
  icon: google.maps.Symbol | google.maps.Icon,
): void {
  marker.content =
    'url' in icon && icon.url ? buildIconUrlContent(icon) : buildSymbolContent(icon as google.maps.Symbol)
}

export function setAppMarkerLabel(marker: AppMapMarker, label: google.maps.MarkerLabel): void {
  marker.content = buildLabelContent(label, 0)
}

export function setAppMarkerCursor(marker: AppMapMarker, cursor: string | null): void {
  const el = marker.content
  if (el instanceof HTMLElement) {
    el.style.cursor = cursor ?? ''
    for (const child of el.querySelectorAll<HTMLElement>('*')) {
      child.style.cursor = cursor ?? ''
    }
  }
}

export function setAppMarkerClickable(marker: AppMapMarker, clickable: boolean): void {
  marker.gmpClickable = clickable
  const el = marker.content
  if (el instanceof HTMLElement) {
    el.style.pointerEvents = clickable ? 'auto' : 'none'
  }
}

export function addAppMarkerListener(
  marker: AppMapMarker,
  event: MarkerListenerEvent,
  handler: (e: google.maps.MapMouseEvent) => void,
): google.maps.MapsEventListener {
  const eventName = LISTENER_EVENT[event]
  const wrapped = (e: google.maps.MapMouseEvent) => {
    if (event === 'click') {
      e.stop?.()
      e.domEvent?.stopPropagation()
    }
    handler(e)
  }
  return marker.addListener(eventName, wrapped)
}
