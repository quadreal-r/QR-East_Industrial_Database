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

    map.setOptions({ draggable: false, draggableCursor: 'default', draggingCursor: 'grabbing' })

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
    overlayRef.current = overlay

    let session: { startX: number; startY: number } | null = null
    let marqueeActive = false

    const hideBox = (): void => {
      box.style.display = 'none'
    }

    const onMouseDown = (e: MouseEvent): void => {
      if (e.button !== 0) return
      const target = e.target as HTMLElement
      if (
        target.closest(
          'button, a, .gm-bundled-control, .gm-style-cc, [data-pending-picture-marker]',
        )
      ) {
        return
      }
      session = { startX: e.clientX, startY: e.clientY }
      marqueeActive = false
    }

    const onMouseMove = (e: MouseEvent): void => {
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
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)

    return () => {
      map.setOptions({ draggable: true, draggableCursor: null, draggingCursor: null })
      container.style.userSelect = ''
      container.removeEventListener('mousedown', onMouseDown)
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
      box.remove()
      overlay.setMap(null)
      overlayRef.current = null
    }
  }, [map, dragMode])
}
