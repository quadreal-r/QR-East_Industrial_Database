import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AddMarkerPanel } from '@/features/map/AddMarkerPanel'
import { VersionStamp } from '@/components/VersionStamp/VersionStamp'
import { PolygonDrawPanel } from '@/features/polygons/PolygonDrawPanel'
import { useMapMarkers } from '@/features/map/useMapMarkers'
import { usePendingPictureMarkers } from '@/features/map/usePendingPictureMarkers'
import { usePolygons } from '@/features/polygons/usePolygons'
import { useMapRotation } from '@/hooks/useMapRotation'
import { useMapMarqueeSelect } from '@/hooks/useMapMarqueeSelect'
import { readGoogleMapsEnv, loadGoogleMaps } from '@/lib/googleMaps'
import { IMAGERY_MODES, MAP_MAX_ZOOM, MAP_DETAIL_ZOOM } from '@/lib/constants'
import { matchesUtility } from '@/lib/dragSelection'
import { tenantPolygonCount, buildPolygonBuildingIndex } from '@/lib/polygonBuildings'
import { installMapAddMarkerPick } from '@/lib/mapAddMarkerPick'
import { fitBoundsPreserveRotation, panToPreserveRotation, applyStoredRotation } from '@/lib/mapRotation'
import {
  applyHardRefreshViewToMap,
  HARD_REFRESH_VIEW_KEY,
  markHardRefreshViewApplied,
  readHardRefreshViewState,
  registerLiveMapViewReader,
  suppressNextBuildingMapFocus,
} from '@/lib/hardRefresh'
import { enableMapDigitalZoom } from '@/lib/mapDigitalZoom'
import { confirm } from '@/stores/confirmStore'
import { showToastError, showToastSuccess } from '@/lib/toast'
import {
  applyRtuTextChangeInPortfolio,
  migrateRtuAssociatedData,
} from '@/lib/rtuPortfolioEdit'
import { notifyRtuPicturesChanged } from '@/lib/rtuPictures'
import type { Building, LayerKey, Polygon, PortfolioData, Rtu, Utility } from '@/types/domain'
import type { ImageryMode } from '@/types/domain'
import { useFilterStore } from '@/stores/filterStore'
import { usePortfolioStore } from '@/stores/portfolioStore'
import { useSelectionStore } from '@/stores/selectionStore'
import { useUiStore } from '@/stores/uiStore'
import { usePendingRtuPictureStore } from '@/stores/pendingRtuPictureStore'
import { useMapViewStore } from '@/stores/mapViewStore'
import { useMapRotationStore } from '@/stores/mapRotationStore'
import { useMapSavePositionStore } from '@/stores/mapSavePositionStore'
import { useSaveBuildingMapView } from '@/hooks/usePortfolioData'
import { hasBuildingSavedView } from '@/lib/buildingMapView'
import styles from './MapPanel.module.css'

export interface MapPanelProps {
  portfolio: PortfolioData
  mapBuildings: Building[]
  onPortfolioImport: (data: PortfolioData) => void
  onPortfolioPatch: (data: PortfolioData) => void
  polygonDrawOpen?: boolean
  onPolygonDrawClose?: () => void
  addMarkerOpen?: boolean
  onAddMarkerClose?: () => void
}

export function MapPanel({
  portfolio,
  mapBuildings,
  onPortfolioPatch,
  polygonDrawOpen = false,
  onPolygonDrawClose,
  addMarkerOpen = false,
  onAddMarkerClose,
}: MapPanelProps) {
  const mapRef = useRef<HTMLDivElement>(null)
  const hardRefreshMapAppliedRef = useRef(false)
  const [map, setMap] = useState<google.maps.Map | null>(null)
  const [mapError, setMapError] = useState<string | null>(null)
  const [imageryMode, setImageryMode] = useState<ImageryMode>(IMAGERY_MODES[0]!)
  const [digitalZoomScale, setDigitalZoomScale] = useState(1)

  const currentBuilding = useSelectionStore((s) => s.currentBuilding)
  const selectBuilding = useSelectionStore((s) => s.selectBuilding)
  const clearSelection = useSelectionStore((s) => s.clearSelection)
  const dragMode = useSelectionStore((s) => s.dragMode)
  const setDragMode = useSelectionStore((s) => s.setDragMode)
  const resetFilters = useFilterStore((s) => s.resetFilters)
  const openSettings = useUiStore((s) => s.openSettings)
  const setMapViewSnapshot = useMapViewStore((s) => s.setSnapshot)

  const { mapId, isConfigured: mapsConfigured } = readGoogleMapsEnv()

  useMapRotation(map, mapRef)
  useMapMarqueeSelect(map, dragMode)

  useEffect(() => {
    usePortfolioStore.setState({ portfolio })
  }, [portfolio])

  const handleSelectBuilding = useCallback(
    (building: Building) => {
      selectBuilding(building)
    },
    [selectBuilding],
  )

  const handleBuildingMoved = useCallback(
    (building: Building, lat: number, lng: number) => {
      onPortfolioPatch({
        ...portfolio,
        buildings: portfolio.buildings.map((b) =>
          b.address === building.address ? { ...b, lat, lng } : b,
        ),
      })
    },
    [onPortfolioPatch, portfolio],
  )

  const handleDetailMoved = useCallback(
    (
      layerKey: LayerKey,
      data: Rtu | Utility,
      lat: number,
      lng: number,
      building: Building | null,
    ) => {
      if (layerKey === 'rtu' && building) {
        onPortfolioPatch({
          ...portfolio,
          buildings: portfolio.buildings.map((b) =>
            b.address === building.address
              ? {
                  ...b,
                  rtus: b.rtus?.map((r) =>
                    r.name === data.name ? { ...r, lat, lng } : r,
                  ),
                }
              : b,
          ),
        })
      } else if ('utility_type' in data) {
        onPortfolioPatch({
          ...portfolio,
          utilities: portfolio.utilities.map((u) =>
            matchesUtility(u, data) ? { ...u, lat, lng } : u,
          ),
        })
      }
    },
    [onPortfolioPatch, portfolio],
  )

  const handleDeleteDetail = useCallback(
    (layerKey: LayerKey, data: Rtu | Utility, building: Building | null) => {
      if (layerKey === 'rtu' && building) {
        onPortfolioPatch({
          ...portfolio,
          buildings: portfolio.buildings.map((b) =>
            b.address === building.address
              ? { ...b, rtus: b.rtus?.filter((r) => r.name !== data.name) }
              : b,
          ),
        })
      } else if ('utility_type' in data) {
        onPortfolioPatch({
          ...portfolio,
          utilities: portfolio.utilities.filter((u) => !matchesUtility(u, data)),
        })
      }
    },
    [onPortfolioPatch, portfolio],
  )

  const handleEditDetail = useCallback(
    async (
      layerKey: LayerKey,
      building: Building,
      oldName: string,
      updates: { name: string; description: string },
    ) => {
      if (layerKey !== 'rtu') return
      try {
        const { portfolio: next, rename } = applyRtuTextChangeInPortfolio(
          portfolio,
          building.address,
          oldName,
          updates,
        )
        if (rename) {
          await migrateRtuAssociatedData(rename)
          notifyRtuPicturesChanged()
          const viewer = useUiStore.getState().rtuPictureViewer
          if (
            viewer?.buildingAddress === building.address &&
            viewer.rtuName === oldName
          ) {
            useUiStore.setState({
              rtuPictureViewer: { ...viewer, rtuName: rename.newName },
            })
          }
        }
        onPortfolioPatch(next)
        showToastSuccess(
          rename
            ? `✓ RTU renamed to ${rename.newName}`
            : '✓ RTU text updated',
        )
      } catch (error) {
        showToastError(error instanceof Error ? error.message : 'Could not update RTU')
        throw error
      }
    },
    [onPortfolioPatch, portfolio],
  )

  const handlePolygonUpdated = useCallback(
    (polygon: Polygon) => {
      onPortfolioPatch({
        ...portfolio,
        polygons: portfolio.polygons.map((p) =>
          p.name === polygon.name && p.description === polygon.description ? polygon : p,
        ),
      })
    },
    [onPortfolioPatch, portfolio],
  )

  const handlePolygonDeleted = useCallback(
    (polygon: Polygon) => {
      onPortfolioPatch({
        ...portfolio,
        polygons: portfolio.polygons.filter(
          (p) => !(p.name === polygon.name && p.description === polygon.description),
        ),
      })
    },
    [onPortfolioPatch, portfolio],
  )

  const handleGroupMoved = useCallback(
    (next: PortfolioData) => {
      onPortfolioPatch(next)
    },
    [onPortfolioPatch],
  )

  const handleAddMarkerClose = useCallback(() => {
    onAddMarkerClose?.()
  }, [onAddMarkerClose])

  const handlePolygonDrawClose = useCallback(() => {
    onPolygonDrawClose?.()
  }, [onPolygonDrawClose])

  const { showAllMarkers, cycleImagery } = useMapMarkers({
    map,
    buildings: portfolio.buildings,
    mapBuildings,
    utilities: portfolio.utilities,
    polygons: portfolio.polygons,
    onSelectBuilding: handleSelectBuilding,
    onBuildingMoved: handleBuildingMoved,
    onDetailMoved: handleDetailMoved,
    onDeleteDetail: handleDeleteDetail,
    onEditDetail: handleEditDetail,
    onGroupMoved: handleGroupMoved,
  })

  usePendingPictureMarkers(map, portfolio.buildings)

  const pendingStageRevision = usePendingRtuPictureStore((s) => s.stageRevision)
  const pendingPictures = usePendingRtuPictureStore((s) => s.items)
  const clearPendingPictures = usePendingRtuPictureStore((s) => s.clear)
  const pendingPictureCount = pendingPictures.length

  const handleClearPendingPictures = useCallback(() => {
    if (pendingPictureCount === 0) return
    void confirm(
      `Remove ${pendingPictureCount} photo marker${pendingPictureCount === 1 ? '' : 's'} from the map and start over?`,
    ).then((ok) => {
      if (!ok) return
      clearPendingPictures()
      showToastSuccess('Photo markers cleared — upload again from Settings when ready.')
    })
  }, [clearPendingPictures, pendingPictureCount])

  const savePromptAddress = useMapSavePositionStore((s) => s.promptAddress)
  const dismissSavePrompt = useMapSavePositionStore((s) => s.dismiss)
  const saveMapViewMutation = useSaveBuildingMapView()

  // Only prompt while the rotated building is still the focused one.
  const savePromptBuilding =
    savePromptAddress != null && savePromptAddress === currentBuilding?.address
      ? portfolio.buildings.find((b) => b.address === savePromptAddress)
      : undefined

  const handleSaveMapPosition = useCallback(() => {
    if (!map || savePromptBuilding?.id == null) return
    const center = map.getCenter()
    if (!center) return
    saveMapViewMutation.mutate(
      {
        buildingId: savePromptBuilding.id,
        view: {
          lat: center.lat(),
          lng: center.lng(),
          zoom: map.getZoom() ?? MAP_DETAIL_ZOOM,
          heading: map.getHeading() || 0,
          tilt: map.getTilt() || 0,
        },
      },
      {
        onSuccess: () => {
          dismissSavePrompt()
          showToastSuccess('✓ Map position saved for this building')
        },
        onError: (error) =>
          showToastError(error instanceof Error ? error.message : 'Could not save map position'),
      },
    )
  }, [map, savePromptBuilding, saveMapViewMutation, dismissSavePrompt])

  const handleClearMapPosition = useCallback(() => {
    if (savePromptBuilding?.id == null) return
    saveMapViewMutation.mutate(
      { buildingId: savePromptBuilding.id, view: null },
      {
        onSuccess: () => {
          dismissSavePrompt()
          showToastSuccess('Saved map position cleared')
        },
        onError: (error) =>
          showToastError(error instanceof Error ? error.message : 'Could not clear map position'),
      },
    )
  }, [savePromptBuilding, saveMapViewMutation, dismissSavePrompt])

  // Drop a stale "Save map position" prompt when the focused building changes.
  useEffect(() => {
    const address = currentBuilding?.address ?? null
    const { promptAddress, dismiss } = useMapSavePositionStore.getState()
    if (promptAddress && promptAddress !== address) dismiss()
  }, [currentBuilding?.address])

  useEffect(() => {
    if (!map) return
    const items = usePendingRtuPictureStore.getState().items
    if (items.length === 0) return
    const bounds = new google.maps.LatLngBounds()
    for (const item of items) {
      bounds.extend({ lat: item.lat, lng: item.lng })
    }
    fitBoundsPreserveRotation(map, bounds, 80)
    // Only pan when a new batch is staged — not when individual photos are assigned.
  }, [map, pendingStageRevision])

  usePolygons({
    map,
    buildings: portfolio.buildings,
    utilities: portfolio.utilities,
    polygons: portfolio.polygons,
    onPolygonUpdated: handlePolygonUpdated,
    onPolygonDeleted: handlePolygonDeleted,
    onGroupMoved: handleGroupMoved,
  })

  useEffect(() => {
    if (!map) return
    return installMapAddMarkerPick(map)
  }, [map])

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ lat: number; lng: number; zoom?: number }>).detail
      if (!map) return
      panToPreserveRotation(map, { lat: detail.lat, lng: detail.lng }, detail.zoom, { onlyZoomIn: true })
    }
    window.addEventListener('map:panTo', handler)
    return () => window.removeEventListener('map:panTo', handler)
  }, [map])

  useEffect(() => {
    if (!mapsConfigured || !mapRef.current) return
    let cancelled = false
    let cleanupDigitalZoom: (() => void) | null = null
    loadGoogleMaps()
      .then((google) => {
        if (cancelled || !mapRef.current) return
        const instance = new google.maps.Map(mapRef.current, {
          mapId,
          center: { lat: 43.65, lng: -79.62 },
          zoom: 10,
          maxZoom: MAP_MAX_ZOOM,
          mapTypeId: 'satellite',
          mapTypeControl: true,
          streetViewControl: true,
          fullscreenControl: true,
          zoomControl: true,
          rotateControl: true,
          headingInteractionEnabled: true,
          tiltInteractionEnabled: true,
          isFractionalZoomEnabled: true,
          // Heading/tilt (Ctrl+drag rotate) require vector rendering with a mapId.
          renderingType: google.maps.RenderingType.VECTOR,
        })
        cleanupDigitalZoom = enableMapDigitalZoom(instance, mapRef.current, {
          onScaleChange: setDigitalZoomScale,
        })
        setMap(instance)
      })
      .catch((err: Error) => setMapError(err.message))
    return () => {
      cancelled = true
      cleanupDigitalZoom?.()
      setDigitalZoomScale(1)
    }
  }, [mapsConfigured, mapId])

  useEffect(() => {
    if (!map) return
    const snapshotView = () => {
      const center = map.getCenter()
      if (!center) return
      setMapViewSnapshot({
        lat: center.lat(),
        lng: center.lng(),
        zoom: map.getZoom() ?? 10,
      })
    }
    snapshotView()
    const listeners = [
      map.addListener('idle', snapshotView),
      map.addListener('center_changed', snapshotView),
      map.addListener('zoom_changed', snapshotView),
    ]
    return () => listeners.forEach((listener) => google.maps.event.removeListener(listener))
  }, [map, setMapViewSnapshot])

  useEffect(() => {
    if (!map) return
    return registerLiveMapViewReader(() => {
      const center = map.getCenter()
      if (!center) return null
      const { heading, tilt } = useMapRotationStore.getState()
      const buildingAddress = useSelectionStore.getState().currentBuilding?.address ?? null
      return {
        lat: center.lat(),
        lng: center.lng(),
        zoom: map.getZoom() ?? 10,
        heading,
        tilt,
        buildingAddress,
      }
    })
  }, [map])

  useEffect(() => {
    if (!map) return
    const restored = readHardRefreshViewState()
    if (!restored) return

    const applyView = () => {
      applyHardRefreshViewToMap(map, restored)
      applyStoredRotation(map)
    }

    if (!hardRefreshMapAppliedRef.current) {
      applyView()
      markHardRefreshViewApplied()
      hardRefreshMapAppliedRef.current = true
      google.maps.event.addListenerOnce(map, 'idle', applyView)
    }

    if (restored.buildingAddress) {
      if (!portfolio.buildings.length) return
      const building = portfolio.buildings.find((b) => b.address === restored.buildingAddress)
      if (building) {
        suppressNextBuildingMapFocus()
        selectBuilding(building)
      }
    }

    sessionStorage.removeItem(HARD_REFRESH_VIEW_KEY)
  }, [map, portfolio.buildings, selectBuilding])

  const handleCycleImagery = () => {
    const mode = cycleImagery()
    if (mode) setImageryMode(mode)
  }

  const handleShowAll = () => {
    clearSelection()
    resetFilters()
    showAllMarkers()
  }

  const polygonIndex = useMemo(
    () => buildPolygonBuildingIndex(portfolio.buildings, portfolio.polygons),
    [portfolio.buildings, portfolio.polygons],
  )

  const mapTitle = currentBuilding?.address ?? 'Industrial Portfolio — Ontario'
  const subtitle = currentBuilding
    ? [
        currentBuilding.cluster || currentBuilding.park,
        currentBuilding.sqft ? `${currentBuilding.sqft} sf` : null,
        `${currentBuilding.rtus?.length ?? 0} RTUs`,
        `${tenantPolygonCount(polygonIndex, currentBuilding.address)} tenant polygons`,
        currentBuilding.manager,
      ]
        .filter(Boolean)
        .join(' · ')
    : `${portfolio.buildings.length} buildings · Click a marker or address to focus`

  return (
    <div className="map-panel">
      <div className="map-topbar">
        <div className={styles.topbarLeft}>
          <div className="map-address" id="map-address">
            {mapTitle}
          </div>
          <div className="map-subtitle" id="map-subtitle">
            {subtitle}
          </div>
        </div>
        <div className="map-actions">
          <button type="button" className="btn-action" style={{ background: '#16a34a', color: '#fff', borderColor: '#16a34a' }} onClick={handleShowAll}>
            All Buildings
          </button>
          <button
            type="button"
            id="imagery-btn"
            className="btn-action"
            onClick={handleCycleImagery}
            style={{ borderColor: imageryMode.borderColor, color: imageryMode.color }}
            title="Switch satellite imagery: Google / Esri / USGS"
          >
            {imageryMode.label}
          </button>
          <button type="button" className="btn-action" onClick={openSettings} title="Settings — themes &amp; manager names" style={{ borderColor: 'var(--accent)', color: 'var(--accent)' }}>
            Settings
          </button>
          <VersionStamp />
        </div>
      </div>

      <div className={styles.mapWrap}>
        {dragMode ? (
          <div className={styles.dragNotice} role="status">
            <span className={styles.dragNoticeText}>
              Edit positions — drag a box to select · right-drag to pan · click to toggle · Ctrl/Shift+click or drag to add ·{' '}
              <span className={styles.dragNoticeMuted}>click empty map to clear</span>
            </span>
            <button
              type="button"
              className={styles.dragNoticeOff}
              onClick={() => setDragMode(false)}
              title="Turn off edit positions"
            >
              Turn off
            </button>
          </div>
        ) : null}
        {pendingPictureCount > 0 ? (
          <div
            className={`${styles.pendingNotice}${dragMode ? ` ${styles.pendingNoticeBelowDrag}` : ''}`}
            role="status"
          >
            <span className={styles.pendingNoticeText}>
              {pendingPictureCount} photo marker{pendingPictureCount === 1 ? '' : 's'} waiting — drag onto an RTU pin
              or click the RTU → Assign pending photo
            </span>
            <button
              type="button"
              className={styles.pendingNoticeAction}
              onClick={handleClearPendingPictures}
              title="Remove all pending photo markers from the map"
            >
              Clear &amp; start over
            </button>
          </div>
        ) : null}
        {savePromptBuilding ? (
          <div className={styles.savePosNotice} role="status">
            <span className={styles.savePosNoticeText}>
              Save this rotation &amp; zoom as the default view for{' '}
              <strong>{savePromptBuilding.address}</strong>?
            </span>
            {hasBuildingSavedView(savePromptBuilding) ? (
              <button
                type="button"
                className={styles.savePosNoticeGhost}
                onClick={handleClearMapPosition}
                disabled={saveMapViewMutation.isPending}
                title="Remove the saved map position for this building"
              >
                Clear saved
              </button>
            ) : null}
            <button
              type="button"
              className={styles.savePosNoticeGhost}
              onClick={dismissSavePrompt}
              disabled={saveMapViewMutation.isPending}
            >
              Dismiss
            </button>
            <button
              type="button"
              className={styles.savePosNoticeAction}
              onClick={handleSaveMapPosition}
              disabled={saveMapViewMutation.isPending}
              title="Save the current center, zoom, and rotation for this building"
            >
              {saveMapViewMutation.isPending ? 'Saving…' : 'Save map position'}
            </button>
          </div>
        ) : null}
        {!mapsConfigured || mapError ? (
          <div className={styles.mapPlaceholder} id="map">
            <div>
              <p>
                <strong>Map placeholder</strong>
              </p>
              <p style={{ marginTop: 8, fontSize: 12 }}>
                {mapError ?? 'Set VITE_GOOGLE_MAPS_API_KEY in .env.local to enable the interactive map.'}
              </p>
            </div>
          </div>
        ) : (
          <>
            <div ref={mapRef} id="map" className={styles.mapCanvas} />
            {digitalZoomScale > 1.01 ? (
              <div className={styles.digitalZoomNotice} role="status">
                Digital zoom {Math.round(digitalZoomScale * 100)}% — scroll out or press Esc to reset
              </div>
            ) : null}
          </>
        )}
      </div>

      <AddMarkerPanel
        open={addMarkerOpen}
        onClose={handleAddMarkerClose}
        portfolio={portfolio}
        map={map}
        onAdded={onPortfolioPatch}
        defaultBuildingAddress={currentBuilding?.address}
      />
      <PolygonDrawPanel
        open={polygonDrawOpen}
        onClose={handlePolygonDrawClose}
        map={map}
        onSaved={(polygon) =>
          onPortfolioPatch({ ...portfolio, polygons: [...portfolio.polygons, polygon] })
        }
      />
    </div>
  )
}
