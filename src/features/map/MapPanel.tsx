import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AddMarkerPanel } from '@/features/map/AddMarkerPanel'
import { AddInspection360Panel } from '@/features/map/AddInspection360Panel'
import { VersionStamp } from '@/components/VersionStamp/VersionStamp'
import { PolygonDrawPanel } from '@/features/polygons/PolygonDrawPanel'
import { useMapMarkers } from '@/features/map/useMapMarkers'
import { usePendingPictureMarkers } from '@/features/map/usePendingPictureMarkers'
import { useSearchHitCircles } from '@/features/map/useSearchHitCircles'
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
import type { Building, LayerKey, Polygon, PortfolioData, Rtu, SuiteEntrance, Utility } from '@/types/domain'
import { matchesSuiteEntrance } from '@/lib/suiteEntrances'
import type { ImageryMode } from '@/types/domain'
import { useFilterStore } from '@/stores/filterStore'
import { usePortfolioStore } from '@/stores/portfolioStore'
import { useSelectionStore } from '@/stores/selectionStore'
import { useUiStore } from '@/stores/uiStore'
import { usePendingRtuPictureStore } from '@/stores/pendingRtuPictureStore'
import { useAuth } from '@/hooks/useAuth'
import { useMapViewStore } from '@/stores/mapViewStore'
import { useMapRotationStore } from '@/stores/mapRotationStore'
import { useMapSavePositionStore } from '@/stores/mapSavePositionStore'
import { usePortfolioMapViewStore } from '@/stores/portfolioMapViewStore'
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
  addInspection360Open?: boolean
  onAddInspection360Close?: () => void
  /** Compact topbar for phones — search + All Buildings first. */
  layout?: 'desktop' | 'mobile'
  onOpenSearch?: () => void
}

export function MapPanel({
  portfolio,
  mapBuildings,
  onPortfolioPatch,
  polygonDrawOpen = false,
  onPolygonDrawClose,
  addMarkerOpen = false,
  onAddMarkerClose,
  addInspection360Open = false,
  onAddInspection360Close,
  layout = 'desktop',
  onOpenSearch,
}: MapPanelProps) {
  const isMobileLayout = layout === 'mobile'
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
  const {
    isAuthenticated,
    isLoading: authLoading,
    role,
    canEdit,
    user,
    email: authEmail,
    error: authError,
    signOut,
    signInAtAccessWall,
    signInAsLocal,
    isLocalDev,
  } = useAuth()
  const resetFilters = useFilterStore((s) => s.resetFilters)
  const openSettings = useUiStore((s) => s.openSettings)
  const setMapViewSnapshot = useMapViewStore((s) => s.setSnapshot)

  const signedInLabel = useMemo(() => {
    const email = authEmail?.trim() || user?.email?.trim()
    if (email) return email
    const metaName =
      typeof user?.user_metadata?.full_name === 'string'
        ? user.user_metadata.full_name.trim()
        : ''
    return metaName || 'Signed in'
  }, [authEmail, user])

  const roleLabel = role === 'admin' ? 'Admin' : role === 'viewer' ? 'Viewer' : '…'

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
      data: Rtu | Utility | SuiteEntrance,
      lat: number,
      lng: number,
      building: Building | null,
    ) => {
      if (layerKey === 'inspection360' && !('utility_type' in data)) {
        const entrance = data as SuiteEntrance
        let matched = false
        const suiteEntrances = portfolio.suiteEntrances.map((item) => {
          if (!matchesSuiteEntrance(item, entrance)) return item
          matched = true
          return { ...item, lat, lng, auto_placed: false }
        })
        if (!matched) {
          suiteEntrances.push({
            ...entrance,
            building_id: entrance.building_id ?? building?.id,
            lat,
            lng,
            auto_placed: false,
          })
        }
        onPortfolioPatch({
          ...portfolio,
          suiteEntrances,
        })
        return
      }
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
    (layerKey: LayerKey, data: Rtu | Utility | SuiteEntrance, building: Building | null) => {
      if (layerKey === 'inspection360' && !('utility_type' in data)) {
        const entrance = data as SuiteEntrance
        onPortfolioPatch({
          ...portfolio,
          suiteEntrances: portfolio.suiteEntrances.filter(
            (item) => !matchesSuiteEntrance(item, entrance),
          ),
        })
        return
      }
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
        polygons: portfolio.polygons.map((p) => {
          if (polygon.id != null && p.id != null) {
            return p.id === polygon.id ? polygon : p
          }
          return p.name === polygon.name && p.description === polygon.description ? polygon : p
        }),
      })
    },
    [onPortfolioPatch, portfolio],
  )

  const handlePolygonDeleted = useCallback(
    (polygon: Polygon) => {
      onPortfolioPatch({
        ...portfolio,
        polygons: portfolio.polygons.filter((p) => {
          if (polygon.id != null && p.id != null) return p.id !== polygon.id
          return !(p.name === polygon.name && p.description === polygon.description)
        }),
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

  const handleAddInspection360Close = useCallback(() => {
    onAddInspection360Close?.()
  }, [onAddInspection360Close])

  const handlePolygonDrawClose = useCallback(() => {
    onPolygonDrawClose?.()
  }, [onPolygonDrawClose])

  const { showAllBuildingsView, showCategoryFilterOverview, cycleImagery } = useMapMarkers({
    map,
    buildings: portfolio.buildings,
    mapBuildings,
    utilities: portfolio.utilities,
    suiteEntrances: portfolio.suiteEntrances,
    polygons: portfolio.polygons,
    onSelectBuilding: handleSelectBuilding,
    onBuildingMoved: handleBuildingMoved,
    onDetailMoved: handleDetailMoved,
    onDeleteDetail: handleDeleteDetail,
    onEditDetail: handleEditDetail,
    onGroupMoved: handleGroupMoved,
    onImageryModeChange: setImageryMode,
  })

  useSearchHitCircles(
    map,
    portfolio.buildings,
    mapBuildings,
    portfolio.polygons,
    portfolio.suiteEntrances,
    showCategoryFilterOverview,
  )

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

  const savePromptKind = useMapSavePositionStore((s) => s.promptKind)
  const savePromptAddress = useMapSavePositionStore((s) => s.promptAddress)
  const dismissSavePrompt = useMapSavePositionStore((s) => s.dismiss)
  const saveMapViewMutation = useSaveBuildingMapView()
  const portfolioMapView = usePortfolioMapViewStore((s) => s.view)
  const persistPortfolioMapView = usePortfolioMapViewStore((s) => s.persist)
  const [portfolioMapViewSaving, setPortfolioMapViewSaving] = useState(false)

  // Only prompt while the rotated building is still the focused one.
  const savePromptBuilding =
    savePromptKind === 'building' &&
    savePromptAddress != null &&
    savePromptAddress === currentBuilding?.address
      ? portfolio.buildings.find((b) => b.address === savePromptAddress)
      : undefined
  const showPortfolioSavePrompt =
    canEdit && savePromptKind === 'portfolio' && currentBuilding == null
  const showBuildingSavePrompt = canEdit && savePromptBuilding != null
  const mapViewSaving = saveMapViewMutation.isPending || portfolioMapViewSaving

  const handleSaveMapPosition = useCallback(() => {
    if (!map) return
    const center = map.getCenter()
    if (!center) return
    const view = {
      lat: center.lat(),
      lng: center.lng(),
      zoom: map.getZoom() ?? MAP_DETAIL_ZOOM,
      heading: map.getHeading() || 0,
      tilt: map.getTilt() || 0,
      imageryMode: imageryMode.id,
    }

    if (savePromptKind === 'portfolio') {
      setPortfolioMapViewSaving(true)
      void persistPortfolioMapView(view)
        .then(() => {
          dismissSavePrompt()
          showToastSuccess('✓ Map position saved for All Buildings')
        })
        .catch((error) =>
          showToastError(error instanceof Error ? error.message : 'Could not save map position'),
        )
        .finally(() => setPortfolioMapViewSaving(false))
      return
    }

    if (savePromptBuilding?.id == null) return
    saveMapViewMutation.mutate(
      { buildingId: savePromptBuilding.id, view },
      {
        onSuccess: () => {
          dismissSavePrompt()
          showToastSuccess('✓ Map position saved for this building')
        },
        onError: (error) =>
          showToastError(error instanceof Error ? error.message : 'Could not save map position'),
      },
    )
  }, [
    map,
    savePromptKind,
    savePromptBuilding,
    saveMapViewMutation,
    persistPortfolioMapView,
    dismissSavePrompt,
    imageryMode.id,
  ])

  const handleClearMapPosition = useCallback(() => {
    if (savePromptKind === 'portfolio') {
      setPortfolioMapViewSaving(true)
      void persistPortfolioMapView(null)
        .then(() => {
          dismissSavePrompt()
          showToastSuccess('Saved All Buildings map position cleared')
        })
        .catch((error) =>
          showToastError(error instanceof Error ? error.message : 'Could not clear map position'),
        )
        .finally(() => setPortfolioMapViewSaving(false))
      return
    }
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
  }, [
    savePromptKind,
    savePromptBuilding,
    saveMapViewMutation,
    persistPortfolioMapView,
    dismissSavePrompt,
  ])

  // Drop a stale "Save map position" prompt when focus changes.
  useEffect(() => {
    const address = currentBuilding?.address ?? null
    const { promptKind, promptAddress, dismiss } = useMapSavePositionStore.getState()
    if (promptKind === 'building' && promptAddress && promptAddress !== address) dismiss()
    if (promptKind === 'portfolio' && address) dismiss()
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
    suiteEntrances: portfolio.suiteEntrances,
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
          mapTypeControlOptions: {
            style: google.maps.MapTypeControlStyle.HORIZONTAL_BAR,
            position: google.maps.ControlPosition.TOP_RIGHT,
            mapTypeIds: ['hybrid', 'satellite', 'roadmap', 'terrain'],
          },
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
    if (!map || typeof google === 'undefined') return
    map.setOptions({
      mapTypeControlOptions: {
        style: isMobileLayout
          ? google.maps.MapTypeControlStyle.DROPDOWN_MENU
          : google.maps.MapTypeControlStyle.HORIZONTAL_BAR,
        position: isMobileLayout
          ? google.maps.ControlPosition.LEFT_BOTTOM
          : google.maps.ControlPosition.TOP_RIGHT,
        mapTypeIds: ['hybrid', 'satellite', 'roadmap', 'terrain'],
      },
      fullscreenControl: !isMobileLayout,
      rotateControl: !isMobileLayout,
    })
  }, [map, isMobileLayout])

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
    showAllBuildingsView()
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
    <div className={`map-panel${isMobileLayout ? ` ${styles.mapPanelMobile}` : ''}`}>
      <div className={`map-topbar${isMobileLayout ? ` ${styles.topbarMobile}` : ''}`}>
        {isMobileLayout ? (
          <>
            <div className={styles.topbarLeft}>
              <div className="map-address" id="map-address">
                {mapTitle}
              </div>
              <div className={`map-subtitle ${styles.subtitleMobile}`} id="map-subtitle">
                {currentBuilding
                  ? [
                      currentBuilding.cluster || currentBuilding.park,
                      currentBuilding.sqft ? `${currentBuilding.sqft} sf` : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')
                  : `${portfolio.buildings.length} buildings`}
              </div>
            </div>
            <div className={`map-actions ${styles.actionsMobile}`}>
              <button
                type="button"
                className="btn-action"
                onClick={onOpenSearch}
                title="Search buildings"
                style={{ borderColor: 'var(--accent)', color: 'var(--accent)' }}
              >
                Search
              </button>
              <button
                type="button"
                className="btn-action"
                style={{ background: '#16a34a', color: '#fff', borderColor: '#16a34a' }}
                onClick={handleShowAll}
              >
                All
              </button>
              {!isAuthenticated && !authLoading ? (
                <button
                  type="button"
                  className={styles.authChipSignIn}
                  onClick={() => (isLocalDev ? signInAsLocal('viewer') : signInAtAccessWall())}
                  title="Sign in"
                >
                  Sign in
                </button>
              ) : null}
              <button
                type="button"
                className="btn-action"
                onClick={openSettings}
                title="Settings"
                style={{ borderColor: 'var(--accent)', color: 'var(--accent)' }}
              >
                ⋮
              </button>
              <VersionStamp />
            </div>
          </>
        ) : (
          <>
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
              {isAuthenticated ? (
                <div
                  className={styles.authChip}
                  title={`${signedInLabel} · ${roleLabel}`}
                >
                  <span className={styles.authChipUser}>{signedInLabel}</span>
                  <span
                    className={`${styles.authChipRole}${
                      role === 'admin' ? ` ${styles.authChipRoleAdmin}` : ''
                    }`}
                  >
                    {roleLabel}
                  </span>
                  <button
                    type="button"
                    className={styles.authChipLogout}
                    onClick={() => void signOut()}
                    title="Sign out and return to Cloudflare Access"
                  >
                    Logout
                  </button>
                </div>
              ) : authLoading ? (
                <span>Connecting…</span>
              ) : (
                <>
                  {authError ? (
                    <span
                      className={styles.authChipError}
                      title={typeof authError === 'string' ? authError : 'Session error'}
                    >
                      {(() => {
                        const text =
                          typeof authError === 'string'
                            ? authError
                            : 'Could not connect your session'
                        return text.length > 42 ? `${text.slice(0, 40)}…` : text
                      })()}
                    </span>
                  ) : null}
                  {isLocalDev ? (
                    <div className={styles.authChipSignInGroup}>
                      <button
                        type="button"
                        className={styles.authChipSignIn}
                        onClick={() => signInAsLocal('admin')}
                        title="Local sign-in as an Admin from Manage users"
                      >
                        Sign in as Admin
                      </button>
                      <button
                        type="button"
                        className={styles.authChipSignInViewer}
                        onClick={() => signInAsLocal('viewer')}
                        title="Local sign-in as a Viewer from Manage users"
                      >
                        Sign in as Viewer
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className={styles.authChipSignIn}
                      onClick={() => signInAtAccessWall()}
                      title={
                        typeof authError === 'string'
                          ? authError
                          : 'Sign in with Cloudflare Access'
                      }
                    >
                      Sign in
                    </button>
                  )}
                </>
              )}
              <button
                type="button"
                id="imagery-btn"
                className="btn-action"
                onClick={handleCycleImagery}
                style={{ borderColor: imageryMode.borderColor, color: imageryMode.color }}
                title="Switch satellite imagery: Google / Esri"
              >
                {imageryMode.label}
              </button>
              <button type="button" className="btn-action" onClick={openSettings} title="Settings — themes &amp; manager names" style={{ borderColor: 'var(--accent)', color: 'var(--accent)' }}>
                Settings
              </button>
              <VersionStamp />
            </div>
          </>
        )}
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
        {showBuildingSavePrompt || showPortfolioSavePrompt ? (
          <div className={styles.savePosNotice} role="status">
            <span className={styles.savePosNoticeText}>
              {showPortfolioSavePrompt ? (
                <>
                  Save this rotation &amp; zoom as the default view for{' '}
                  <strong>All Buildings</strong>?
                </>
              ) : (
                <>
                  Save this rotation &amp; zoom as the default view for{' '}
                  <strong>{savePromptBuilding!.address}</strong>?
                </>
              )}
            </span>
            {(showPortfolioSavePrompt && portfolioMapView != null) ||
            (savePromptBuilding && hasBuildingSavedView(savePromptBuilding)) ? (
              <button
                type="button"
                className={styles.savePosNoticeGhost}
                onClick={handleClearMapPosition}
                disabled={mapViewSaving}
                title={
                  showPortfolioSavePrompt
                    ? 'Remove the saved All Buildings map position'
                    : 'Remove the saved map position for this building'
                }
              >
                Clear saved
              </button>
            ) : null}
            <button
              type="button"
              className={styles.savePosNoticeGhost}
              onClick={dismissSavePrompt}
              disabled={mapViewSaving}
            >
              Dismiss
            </button>
            <button
              type="button"
              className={styles.savePosNoticeAction}
              onClick={handleSaveMapPosition}
              disabled={mapViewSaving}
              title={
                showPortfolioSavePrompt
                  ? 'Save the current center, zoom, and rotation for All Buildings'
                  : 'Save the current center, zoom, and rotation for this building'
              }
            >
              {mapViewSaving ? 'Saving…' : 'Save map position'}
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
      <AddInspection360Panel
        open={addInspection360Open}
        onClose={handleAddInspection360Close}
        portfolio={portfolio}
        map={map}
        onAdded={onPortfolioPatch}
        defaultBuildingAddress={currentBuilding?.address}
      />
      <PolygonDrawPanel
        open={polygonDrawOpen}
        onClose={handlePolygonDrawClose}
        map={map}
        polygons={portfolio.polygons}
        onSaved={(polygon) =>
          onPortfolioPatch({ ...portfolio, polygons: [...portfolio.polygons, polygon] })
        }
      />
    </div>
  )
}
