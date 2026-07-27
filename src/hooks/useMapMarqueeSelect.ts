import { useEffect, useRef } from 'react'
import {
  findMarqueeKeysInScreenRect,
  suppressMapClickClearOnce,
} from '@/lib/mapMarqueeSelect'
import { useSelectionStore } from '@/stores/selectionStore'
import styles from '@/features/map/MapPanel.module.css'

const DRAG_THRESHOLD_PX = 4

export function useMapMarqueeSelect(
  map: google.maps.Map | null,
  dragMode: boolean,
): void {
  const overlayRef = useRef<google.maps.OverlayView | null>(null)

  useEffect(() => {
    if (!map || !dragMode) return

    map.setOptions({ draggable: false, draggableCursor: 'crosshair', draggingCursor: 'crosshair' })

    const container = map.getDiv()
    container.style.userSelect = 'none'
    container.style.cursor = 'crosshair'

    const box = document.createElement('div')
    box.className = styles.marqueeBox ?? 'map-marquee-box'
    box.style.display = 'none'
    container.appendChild(box)

    const overlay = new google.maps.OverlayView()
    overlay.onAdd = () => {}
    overlay.draw = () => {}
    overlay.setMap(map)
    overlayRef.current = overlay

    let session: { startX: number; startY: number } | null = null
    let marqueeActive = false
    let panSession: { lastX: number; lastY: number } | null = null

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
          'button, a, input, textarea, select, label, .gm-bundled-control, .gm-style-cc, .gm-style-iw-c, .gm-style-iw, [data-pending-picture-marker]',
        )
      ) {
        return
      }
      session = { startX: e.clientX, startY: e.clientY }
      marqueeActive = false
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
      if (!marqueeActive && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return

      marqueeActive = true
      e.preventDefault()

      const rect = container.getBoundingClientRect()
      const left = Math.min(session.startX, e.clientX) - rect.left
      const top = Math.min(session.startY, e.clientY) - rect.top

      box.style.display = 'block'
      box.style.left = `${left}px`
      box.style.top = `${top}px`
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

      if (!marqueeActive) return

      e.preventDefault()
      e.stopPropagation()
      suppressMapClickClearOnce()

      const projection = overlay.getProjection()
      if (!projection) return

      const rect = container.getBoundingClientRect()
      const screenRect = {
        left: Math.min(start.startX, e.clientX) - rect.left,
        top: Math.min(start.startY, e.clientY) - rect.top,
        right: Math.max(start.startX, e.clientX) - rect.left,
        bottom: Math.max(start.startY, e.clientY) - rect.top,
      }

      const additive = Boolean(e.ctrlKey || e.metaKey || e.shiftKey)
      const keys = findMarqueeKeysInScreenRect(projection, screenRect)
      useSelectionStore.getState().setDragSelect(keys, additive)
    }

    container.addEventListener('mousedown', onMouseDown)
    container.addEventListener('contextmenu', onContextMenu)
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)

    return () => {
      map.setOptions({ draggable: true, draggableCursor: null, draggingCursor: null })
      container.style.userSelect = ''
      container.style.cursor = ''
      container.removeEventListener('mousedown', onMouseDown)
      container.removeEventListener('contextmenu', onContextMenu)
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
      box.remove()
      overlay.setMap(null)
      overlayRef.current = null
    }
  }, [map, dragMode])
}
