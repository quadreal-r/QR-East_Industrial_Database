import { useEffect, type RefObject } from 'react'
import { applyStoredRotation, installRotationGuard, resetMapRotationPreserveView } from '@/lib/mapRotation'
import { useMapRotationStore } from '@/stores/mapRotationStore'
import { useSelectionStore } from '@/stores/selectionStore'
import { useFilterStore } from '@/stores/filterStore'
import { useMapSavePositionStore } from '@/stores/mapSavePositionStore'

/** Minimum heading change (deg) during a gesture before offering to save the position. */
const SAVE_PROMPT_MIN_HEADING_DELTA = 1

function offerSavePositionAfterRotation(startHeading: number, endHeading: number): void {
  let delta = Math.abs(endHeading - startHeading) % 360
  if (delta > 180) delta = 360 - delta
  if (delta < SAVE_PROMPT_MIN_HEADING_DELTA) return
  const address = useSelectionStore.getState().currentBuilding?.address
  if (address) {
    useMapSavePositionStore.getState().requestBuildingPrompt(address)
    return
  }
  const { park, cluster, manager } = useFilterStore.getState()
  useMapSavePositionStore.getState().requestPortfolioPrompt({ park, cluster, manager })
}

const ROT_SCALE = 0.3
/** Degrees of rotation per pixel of horizontal Ctrl+drag (HTML used 0.5). */
const DRAG_ROT_SENSITIVITY = 0.15

function touchAngle(touches: TouchList): number {
  return (Math.atan2(touches[1]!.clientY - touches[0]!.clientY, touches[1]!.clientX - touches[0]!.clientX) * 180) / Math.PI
}

function touchDist(touches: TouchList): number {
  const dx = touches[1]!.clientX - touches[0]!.clientX
  const dy = touches[1]!.clientY - touches[0]!.clientY
  return Math.sqrt(dx * dx + dy * dy) || 1
}

/** Ctrl+drag to rotate; Ctrl+dblclick to reset heading/tilt (matches legacy HTML). */
export function useMapRotation(
  map: google.maps.Map | null,
  mapRef: RefObject<HTMLDivElement | null>,
): void {
  useEffect(() => {
    const mapDiv = mapRef.current
    if (!map || !mapDiv) return

    let isDragging = false
    let startX = 0
    let startHeading = 0

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Control') mapDiv.style.cursor = 'ew-resize'
    }

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Control') {
        mapDiv.style.cursor = ''
        isDragging = false
      }
    }

    const onMouseDown = (e: MouseEvent) => {
      if (!e.ctrlKey || e.button !== 0) return
      e.preventDefault()
      e.stopPropagation()
      isDragging = true
      startX = e.clientX
      startHeading = map.getHeading() || 0
    }

    const onMouseMove = (e: MouseEvent) => {
      if (!isDragging) return
      const newHeading =
        ((startHeading + (e.clientX - startX) * DRAG_ROT_SENSITIVITY) % 360 + 360) % 360
      map.setHeading(newHeading)
      useMapRotationStore.getState().setHeading(newHeading)
    }

    const onMouseUp = () => {
      if (isDragging) {
        isDragging = false
        offerSavePositionAfterRotation(startHeading, map.getHeading() || 0)
      }
    }

    const onDblClick = (e: MouseEvent) => {
      if (!e.ctrlKey) return
      e.preventDefault()
      e.stopPropagation()
      resetMapRotationPreserveView(map)
    }

    const rg = { on: false, a0: 0, h0: 0, d0: 1 }

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        rg.on = true
        rg.a0 = touchAngle(e.touches)
        rg.d0 = touchDist(e.touches)
        rg.h0 = map.getHeading() || 0
      } else {
        rg.on = false
      }
    }

    const onTouchMove = (e: TouchEvent) => {
      if (!rg.on || e.touches.length !== 2) return
      let da = touchAngle(e.touches) - rg.a0
      while (da > 180) da -= 360
      while (da < -180) da += 360
      if (Math.abs(da) < 2) return
      e.preventDefault()
      const newHeading = rg.h0 - da * ROT_SCALE
      map.setHeading(newHeading)
      useMapRotationStore.getState().setHeading(newHeading)
    }

    const onTouchEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) {
        if (rg.on) {
          const endHeading = map.getHeading() || 0
          offerSavePositionAfterRotation(rg.h0, endHeading)
          rg.h0 = endHeading
        }
        rg.on = false
      }
    }

    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('keyup', onKeyUp)
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
    mapDiv.addEventListener('mousedown', onMouseDown, true)
    mapDiv.addEventListener('dblclick', onDblClick, true)
    mapDiv.addEventListener('touchstart', onTouchStart, { passive: true, capture: true })
    mapDiv.addEventListener('touchmove', onTouchMove, { passive: false, capture: true })
    mapDiv.addEventListener('touchend', onTouchEnd, { passive: true, capture: true })

    applyStoredRotation(map)
    const rotationGuard = installRotationGuard(map)

    return () => {
      google.maps.event.removeListener(rotationGuard)
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('keyup', onKeyUp)
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
      mapDiv.removeEventListener('mousedown', onMouseDown, true)
      mapDiv.removeEventListener('dblclick', onDblClick, true)
      mapDiv.removeEventListener('touchstart', onTouchStart, true)
      mapDiv.removeEventListener('touchmove', onTouchMove, true)
      mapDiv.removeEventListener('touchend', onTouchEnd, true)
      mapDiv.style.cursor = ''
    }
  }, [map, mapRef])
}
