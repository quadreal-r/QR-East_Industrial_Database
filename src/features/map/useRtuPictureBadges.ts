import { useCallback, useRef } from 'react'
import type { MutableRefObject } from 'react'
import { buildRtuPicturesHtml } from '@/lib/mapInfoWindow'
import {
  releaseInfoWindowCloseReset,
  suppressInfoWindowCloseReset,
} from '@/lib/mapPopups'
import type { AppMapMarker } from '@/lib/appMapMarker'
import {
  getRtuPictureCountMap,
  listRtuPictures,
  loadRtuPictureManifest,
  resolveManifestRtuKey,
  revokeRtuPictureUrls,
  rtuPictureKey,
  type RtuPicture,
} from '@/lib/rtuPictures'
import { syncDetailMarkerAppearance } from '@/features/map/mapMarkersState'
import type { ActiveDetailInfo, DetailMarkerEntry } from '@/features/map/mapMarkersState'
import type { PortfolioData, Rtu } from '@/types/domain'
import { useLayerStore } from '@/stores/layerStore'
import { patchDetailMarkerPictureCount } from '@/lib/appMapMarker'

export function useRtuPictureBadges(
  map: google.maps.Map | null,
  _portfolio: Pick<PortfolioData, 'buildings' | 'polygons' | 'utilities'>,
  detailMarkersRef: MutableRefObject<DetailMarkerEntry[]>,
  activeDetailInfoRef: MutableRefObject<ActiveDetailInfo | null>,
  activeRtuPicturesRef: MutableRefObject<RtuPicture[]>,
  activeInfoMarkerRef: MutableRefObject<AppMapMarker | null>,
  infoWindowRef: MutableRefObject<google.maps.InfoWindow | null>,
  refreshDetailVisibility: () => void,
) {
  const refreshPicturesViewLockRef = useRef<Promise<void>>(Promise.resolve())

  const clearActiveRtuPictures = useCallback(() => {
    revokeRtuPictureUrls(activeRtuPicturesRef.current.filter((p) => p.source === 'indexeddb'))
    activeRtuPicturesRef.current = []
  }, [activeRtuPicturesRef])

  const refreshRtuPicturesView = useCallback(async () => {
    const run = async () => {
      const ctx = activeDetailInfoRef.current
      const iw = infoWindowRef.current
      if (!ctx || !iw || ctx.entry.type !== 'rtu' || ctx.view !== 'pictures') return

      const buildingAddress = ctx.entry.building?.address ?? ''
      if (!buildingAddress) return

      suppressInfoWindowCloseReset()
      try {
        clearActiveRtuPictures()
        const pictures = await listRtuPictures(buildingAddress, ctx.entry.data.name)

        const stillOpen = activeDetailInfoRef.current
        if (
          !stillOpen ||
          stillOpen.view !== 'pictures' ||
          stillOpen.entry.type !== 'rtu' ||
          stillOpen.entry.data.name !== ctx.entry.data.name
        ) {
          return
        }

        activeRtuPicturesRef.current = pictures
        if (pictures.length) {
          stillOpen.pictureIndex = Math.min(
            Math.max(stillOpen.pictureIndex, 0),
            pictures.length - 1,
          )
        } else {
          stillOpen.pictureIndex = 0
        }

        iw.setContent(
          buildRtuPicturesHtml(
            stillOpen.entry.data as Rtu,
            buildingAddress,
            pictures,
            stillOpen.pictureIndex,
          ),
        )
      } finally {
        releaseInfoWindowCloseReset()
      }
    }

    const next = refreshPicturesViewLockRef.current.then(run, run)
    refreshPicturesViewLockRef.current = next.catch(() => {})
    await next
  }, [activeDetailInfoRef, activeRtuPicturesRef, infoWindowRef, clearActiveRtuPictures])

  const refreshRtuPictureBadges = useCallback(async () => {
    if (!map) return

    const activeMarker = activeInfoMarkerRef.current

    suppressInfoWindowCloseReset()
    try {
      const [counts, manifest] = await Promise.all([
        getRtuPictureCountMap(),
        loadRtuPictureManifest(),
      ])

      detailMarkersRef.current = detailMarkersRef.current.map((dm) => {
        if (dm.type !== 'rtu' || !dm.building) {
          return { ...dm, pictureCount: 0 }
        }

        const key = rtuPictureKey(dm.building.address, dm.data.name)
        const manifestKey = resolveManifestRtuKey(dm.building.address, dm.data.name, manifest)
        const count = Math.max(counts.get(key) ?? 0, counts.get(manifestKey) ?? 0)
        const updated = { ...dm, pictureCount: count }

        // Avoid rebuilding the anchor marker while its InfoWindow is open — Maps can crash.
        // Still patch the badge text in place so deletes do not leave a stale count.
        if (activeMarker && dm.marker === activeMarker) {
          patchDetailMarkerPictureCount(dm.marker, count)
          return updated
        }

        syncDetailMarkerAppearance(
          updated,
          false,
          useLayerStore.getState().showRtuPictureCount,
        )
        return updated
      })

      const ctx = activeDetailInfoRef.current
      if (ctx && activeMarker) {
        const match = detailMarkersRef.current.find((entry) => entry.marker === activeMarker)
        if (match) ctx.entry = match
      }

      refreshDetailVisibility()
    } finally {
      releaseInfoWindowCloseReset()
    }
  }, [
    map,
    detailMarkersRef,
    refreshDetailVisibility,
    activeDetailInfoRef,
    activeInfoMarkerRef,
  ])

  return { clearActiveRtuPictures, refreshRtuPicturesView, refreshRtuPictureBadges }
}

