import { useCallback } from 'react'
import type { MutableRefObject } from 'react'
import { IMAGERY_MODES } from '@/lib/constants'
import { applyImageryModeIndex, type ImageryOverlayRef } from '@/lib/imageryMode'

export function useImageryMode(
  map: google.maps.Map | null,
  imageryModeRef: MutableRefObject<number>,
  imageryOverlayRef: MutableRefObject<google.maps.ImageMapType | null>,
) {
  const overlayRef: ImageryOverlayRef = imageryOverlayRef

  const applyMode = useCallback(
    (modeIndex: number) => {
      if (!map) return null
      imageryModeRef.current = modeIndex
      return applyImageryModeIndex(map, modeIndex, overlayRef)
    },
    [map, imageryModeRef, overlayRef],
  )

  const cycleImagery = useCallback(() => {
    if (!map) return null
    const next = (imageryModeRef.current + 1) % IMAGERY_MODES.length
    return applyMode(next)
  }, [map, imageryModeRef, applyMode])

  return { cycleImagery, applyMode }
}
