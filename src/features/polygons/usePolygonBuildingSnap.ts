import { useEffect, useRef } from 'react'
import { fetchBuildingFootprintInSelection, normalizeBounds } from '@/lib/buildingFootprint'
import type { LatLng } from '@/types/domain'
import styles from '@/features/map/MapPanel.module.css'

const DRAG_THRESHOLD_PX = 4

export interface UsePolygonBuildingSnapOptions {
  map: google.maps.Map | null
  active: boolean
  onFootprint: (points: LatLng[]) => void
  onStatus: (message: string) => void
  onLoadingChange?: (loading: boolean) => void
}

export function usePolygonBuildingSnap({
  map,
  active,
  onFootprint,
  onStatus,
  onLoadingChange,
}: UsePolygonBuildingSnapOptions): void {
  const callbacksRef = useRef({ onFootprint, onStatus, onLoadingChange })

  useEffect(() => {
    callbacksRef.current = { onFootprint, onStatus, onLoadingChange }
  }, [onFootprint, onLoadingChange, onStatus])

  useEffect(() => {
    if (!map || !active) return

    map.setOptions({ draggable: false, draggableCursor: 'crosshair', draggingCursor: 'crosshair' })

    const container = map.getDiv()
    container.style.userSelect = 'none'

    const box = document.createElement('div')
    box.className = styles.marqueeBox ?? 'map-marquee-box'
    box.style.display = 'none'
    container.appendChild(box)

    const overlay = new google.maps.OverlayView()
    overlay.onAdd = () => {}
    overlay.draw = () => {}
    overlay.setMap(map)

    let session: { startX: number; startY: number } | null = null
    let dragActive = false
    let panSession: { lastX: number; lastY: number } | null = null
    let lookupToken = 0

    const hideBox = (): void => {
      box.style.display = 'none'
    }

    const onContextMenu = (e: MouseEvent): void => {
      e.preventDefault()
    }

    const onMouseDown = (e: MouseEvent): void => {
      if (e.button === 2) {
        panSession = { lastX: e.clientX, lastY: e.clientY }
        container.style.cursor = 'grabbing'
        e.preventDefault()
        return
      }
      if (e.button !== 0) return
      const target = e.target as HTMLElement
      if (
        target.closest(
          'button, a, .gm-bundled-control, .gm-style-cc, [data-polygon-draw-panel], [data-pending-picture-marker]',
        )
      ) {
        return
      }
      session = { startX: e.clientX, startY: e.clientY }
      dragActive = false
    }

    const onMouseMove = (e: MouseEvent): void => {
      if (panSession) {
        const dx = e.clientX - panSession.lastX
        const dy = e.clientY - panSession.lastY
        panSession.lastX = e.clientX
        panSession.lastY = e.clientY
        if (dx !== 0 || dy !== 0) {
          map.panBy(-dx, -dy)
        }
        e.preventDefault()
        return
      }

      if (!session) return
      const dx = e.clientX - session.startX
      const dy = e.clientY - session.startY
      if (!dragActive && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return

      dragActive = true
      e.preventDefault()

      const rect = container.getBoundingClientRect()
      box.style.display = 'block'
      box.style.left = `${Math.min(session.startX, e.clientX) - rect.left}px`
      box.style.top = `${Math.min(session.startY, e.clientY) - rect.top}px`
      box.style.width = `${Math.abs(dx)}px`
      box.style.height = `${Math.abs(dy)}px`
    }

    const onMouseUp = (e: MouseEvent): void => {
      if (e.button === 2 && panSession) {
        panSession = null
        container.style.cursor = 'crosshair'
        return
      }

      if (!session) return
      const start = session
      session = null
      hideBox()

      if (!dragActive) return

      e.preventDefault()
      e.stopPropagation()

      const projection = overlay.getProjection()
      if (!projection) {
        callbacksRef.current.onStatus('Map is still loading — try again.')
        return
      }

      const rect = container.getBoundingClientRect()
      const nw = projection.fromContainerPixelToLatLng(
        new google.maps.Point(
          Math.min(start.startX, e.clientX) - rect.left,
          Math.min(start.startY, e.clientY) - rect.top,
        ),
      )
      const se = projection.fromContainerPixelToLatLng(
        new google.maps.Point(
          Math.max(start.startX, e.clientX) - rect.left,
          Math.max(start.startY, e.clientY) - rect.top,
        ),
      )
      if (!nw || !se) {
        callbacksRef.current.onStatus('Could not read map coordinates — try again.')
        return
      }

      const selection = normalizeBounds(
        { lat: nw.lat(), lng: nw.lng() },
        { lat: se.lat(), lng: se.lng() },
      )

      const token = ++lookupToken
      callbacksRef.current.onLoadingChange?.(true)
      callbacksRef.current.onStatus('Looking up building shape…')

      void fetchBuildingFootprintInSelection(selection)
        .then((points) => {
          if (token !== lookupToken) return
          callbacksRef.current.onLoadingChange?.(false)
          if (!points || points.length < 3) {
            callbacksRef.current.onStatus(
              'No building outline found — zoom in closer and drag again, or use click mode.',
            )
            return
          }
          callbacksRef.current.onFootprint(points)
          callbacksRef.current.onStatus(
            'Drag the shape to move it, or drag corner dots to adjust. Save when ready.',
          )
        })
        .catch(() => {
          if (token !== lookupToken) return
          callbacksRef.current.onLoadingChange?.(false)
          callbacksRef.current.onStatus('Building lookup failed — try again or use click mode.')
        })
    }

    container.addEventListener('mousedown', onMouseDown)
    container.addEventListener('contextmenu', onContextMenu)
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)

    return () => {
      lookupToken += 1
      map.setOptions({ draggable: true, draggableCursor: null, draggingCursor: null })
      container.style.userSelect = ''
      container.style.cursor = ''
      container.removeEventListener('mousedown', onMouseDown)
      container.removeEventListener('contextmenu', onContextMenu)
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
      hideBox()
      box.remove()
      overlay.setMap(null)
      callbacksRef.current.onLoadingChange?.(false)
    }
  }, [active, map])
}
