import { useCallback, useEffect, useMemo, useRef } from 'react'
import {
  addAppMarkerListener,
  createAppMarker,
  getAppMarkerPosition,
  setAppMarkerClickable,
  setAppMarkerCursor,
  setAppMarkerDraggable,
  setAppMarkerMap,
  setAppMarkerPosition,
  setAppMarkerVisible,
  type AppMapMarker,
} from '@/lib/appMapMarker'
import { isLegacySuiteMarkerName } from '@/lib/legacySuiteMarkers'
import { MAP_DETAIL_ZOOM, UTILITY_LAYER_MAP } from '@/lib/constants'
import {
  applyGroupDragDelta,
  isGroupDragActive,
  registerGroupDragVisuals,
  setNativeDragKey,
} from '@/lib/mapGroupDragSession'
import {
  buildingDragKey,
  detailDragKey,
  utilityDragKey,
} from '@/lib/dragSelection'
import { buildPolygonBuildingIndex } from '@/lib/polygonBuildings'
import {
  consumeMapClickClearSuppression,
  isSelectionAdditiveClick,
  registerMarqueeTarget,
  suppressMapClickClearOnce,
  unregisterMarqueeTarget,
} from '@/lib/mapMarqueeSelect'
import { tryConsumeMapAddMarkerPick } from '@/lib/mapAddMarkerPick'
import { applySavedMapView, panToPreserveRotation, resolveBuildingClickZoom } from '@/lib/mapRotation'
import { getBuildingSavedView } from '@/lib/buildingMapView'
import { getPortfolioSavedView } from '@/lib/portfolioMapView'
import { imageryModeIndexFromId } from '@/lib/imageryMode'
import {
  consumeSuppressBuildingMapFocus,
  hasPendingHardRefreshView,
  wasHardRefreshViewApplied,
} from '@/lib/hardRefresh'
import {
  clearAllRtuDropTargets,
  registerRtuDropTarget,
  rtuDropTargetKey,
  unregisterRtuDropTarget,
} from '@/features/map/rtuDropTargetHighlight'
import {
  closeAllMapPopups,
  MAP_CLOSE_POPUPS_EVENT,
  shouldSuppressInfoWindowCloseReset,
} from '@/lib/mapPopups'
import { collectSearchHits } from '@/lib/searchHits'
import {
  loadRtuPictureManifest,
  onRtuPicturesChanged,
  type RtuPicture,
} from '@/lib/rtuPictures'
import { areAllLayersHidden, useLayerStore } from '@/stores/layerStore'
import { useFilterStore } from '@/stores/filterStore'
import { useSelectionStore } from '@/stores/selectionStore'
import { useUiStore } from '@/stores/uiStore'
import {
  fitMapToBuildingMarkers,
  syncDetailMarkerPositions,
  applyPendingMarkerPositions,
  buildMarkerStructureKey,
  syncMarkersFromPortfolio,
  syncBuildingMarkerAppearance,
  syncDetailMarkerAppearance,
  markMarkerDragJustEnded,
  shouldSuppressMarkerClick,
} from '@/features/map/mapMarkersState'
import type {
  ActiveDetailInfo,
  BuildingMarkerEntry,
  DetailMarkerEntry,
  MapMarkersCallbacks,
  SoloMoveSession,
} from '@/features/map/mapMarkersState'
import { useImageryMode } from '@/features/map/useImageryMode'
import { useMarkerVisibility } from '@/features/map/useMarkerVisibility'
import { useRtuPictureBadges } from '@/features/map/useRtuPictureBadges'
import { useMarkerDrag } from '@/features/map/useMarkerDrag'
import { useInfoWindowActions } from '@/features/map/useInfoWindowActions'
import type { Building, ImageryMode, LayerKey, Polygon, PortfolioMapViewFields, Rtu, SuiteEntrance, Utility } from '@/types/domain'
import { buildingForSuiteEntrance } from '@/lib/suiteEntrances'

export interface UseMapMarkersOptions {
  map: google.maps.Map | null
  buildings: Building[]
  mapBuildings: Building[]
  utilities: Utility[]
  suiteEntrances: SuiteEntrance[]
  polygons: Polygon[]
  portfolioMapViews: Record<string, PortfolioMapViewFields>
  onSelectBuilding: (building: Building) => void
  onBuildingMoved?: (building: Building, lat: number, lng: number) => void
  onDetailMoved?: (
    layerKey: LayerKey,
    data: Rtu | Utility | SuiteEntrance,
    lat: number,
    lng: number,
    building: Building | null,
  ) => void
  onDeleteDetail?: (layerKey: LayerKey, data: Rtu | Utility | SuiteEntrance, building: Building | null) => void
  onEditDetail?: (
    layerKey: LayerKey,
    building: Building,
    oldName: string,
    updates: { name: string; description: string },
  ) => void | Promise<void>
  onGroupMoved?: (portfolio: {
    buildings: Building[]
    utilities: Utility[]
    polygons: Polygon[]
    suiteEntrances: SuiteEntrance[]
  }) => void
  onImageryModeChange?: (mode: ImageryMode) => void
}

export function useMapMarkers({
  map,
  buildings,
  mapBuildings,
  utilities,
  suiteEntrances,
  polygons,
  portfolioMapViews,
  onSelectBuilding,
  onBuildingMoved,
  onDetailMoved,
  onDeleteDetail,
  onEditDetail,
  onGroupMoved,
  onImageryModeChange,
}: UseMapMarkersOptions) {
  const layers = useLayerStore((s) => s.layers)
  const search = useFilterStore((s) => s.search)
  const park = useFilterStore((s) => s.park)
  const cluster = useFilterStore((s) => s.cluster)
  const manager = useFilterStore((s) => s.manager)
  const currentBuilding = useSelectionStore((s) => s.currentBuilding)
  const dragMode = useSelectionStore((s) => s.dragMode)
  const dragSelectedKeys = useSelectionStore((s) => s.dragSelectedKeys)
  const setLastDragUndo = useSelectionStore((s) => s.setLastDragUndo)

  // ------------------------------------------------------------
  const portfolioRef = useRef({ buildings, utilities, polygons, suiteEntrances })
  const polygonIndexRef = useRef(buildPolygonBuildingIndex(buildings, polygons))
  const buildingMarkersRef = useRef<BuildingMarkerEntry[]>([])
  const detailMarkersRef = useRef<DetailMarkerEntry[]>([])
  const hasInitialBuildingFitRef = useRef(false)
  const infoWindowRef = useRef<google.maps.InfoWindow | null>(null)
  const activeInfoMarkerRef = useRef<AppMapMarker | null>(null)
  const activeDetailInfoRef = useRef<ActiveDetailInfo | null>(null)
  const activeRtuPicturesRef = useRef<RtuPicture[]>([])
  const imageryModeRef = useRef(0)
  const imageryOverlayRef = useRef<google.maps.ImageMapType | null>(null)
  const soloMoveRef = useRef<SoloMoveSession | null>(null)
  const soloMoveListenerRef = useRef<google.maps.MapsEventListener | null>(null)
  const soloMoveDragStartListenerRef = useRef<google.maps.MapsEventListener | null>(null)
  const prevDragModeRef = useRef(dragMode)
  const isDraggingMarkerRef = useRef(false)
  const markerStructureKey = useMemo(
    () => buildMarkerStructureKey(buildings, utilities, suiteEntrances),
    [buildings, utilities, suiteEntrances],
  )

  const callbacksRef = useRef<MapMarkersCallbacks>({
    onSelectBuilding,
    onBuildingMoved,
    onDetailMoved,
    onDeleteDetail,
    onEditDetail,
  })

  useEffect(() => {
    portfolioRef.current = { buildings, utilities, polygons, suiteEntrances }
    polygonIndexRef.current = buildPolygonBuildingIndex(buildings, polygons)
  }, [buildings, utilities, polygons, suiteEntrances])

  useEffect(() => {
    callbacksRef.current = {
      onSelectBuilding,
      onBuildingMoved,
      onDetailMoved,
      onDeleteDetail,
      onEditDetail,
    }
  }, [onSelectBuilding, onBuildingMoved, onDetailMoved, onDeleteDetail, onEditDetail])

  useEffect(() => {
    void loadRtuPictureManifest()
  }, [])

  // ------------------------------------------------------------
  const { cycleImagery, applyMode } = useImageryMode(
    map,
    imageryModeRef,
    imageryOverlayRef,
  )

  const {
    refreshDetailVisibility,
    refreshDragSelectionStyles,
    highlightBuilding,
    fitAllMarkers,
    showAllMarkers,
  } = useMarkerVisibility(
    map,
    mapBuildings,
    buildingMarkersRef,
    detailMarkersRef,
  )

  useEffect(() => {
    return useLayerStore.subscribe((state, prevState) => {
      if (state.layers === prevState.layers) {
        return
      }
      refreshDetailVisibility()
      if (areAllLayersHidden(state.layers)) {
        closeAllMapPopups()
      }
    })
  }, [refreshDetailVisibility])

  useEffect(() => {
    return useLayerStore.subscribe((state, prevState) => {
      if (state.showRtuPictureCount === prevState.showRtuPictureCount) return
      const showPictureCount = state.showRtuPictureCount
      const activeMarker = activeInfoMarkerRef.current
      for (const entry of detailMarkersRef.current) {
        if (entry.type !== 'rtu') continue
        if (activeMarker && entry.marker === activeMarker) continue
        syncDetailMarkerAppearance(entry, false, showPictureCount)
      }
      refreshDetailVisibility()
    })
  }, [refreshDetailVisibility])

  const { clearActiveRtuPictures, refreshRtuPicturesView, refreshRtuPictureBadges } =
    useRtuPictureBadges(
      map,
      { buildings, polygons, utilities },
      detailMarkersRef,
      activeDetailInfoRef,
      activeRtuPicturesRef,
      activeInfoMarkerRef,
      infoWindowRef,
      refreshDetailVisibility,
    )

  const { commitGroupDrag, beginDragSession } = useMarkerDrag(
    portfolioRef,
    onGroupMoved,
    setLastDragUndo,
  )

  const { stopSoloMove, commitSoloMove, openBuildingInfo, openDetailInfo, attachInfoWindowActions } =
    useInfoWindowActions(
      map,
      detailMarkersRef,
      buildingMarkersRef,
      infoWindowRef,
      activeInfoMarkerRef,
      activeDetailInfoRef,
      activeRtuPicturesRef,
      soloMoveRef,
      soloMoveListenerRef,
      soloMoveDragStartListenerRef,
      callbacksRef,
      polygonIndexRef,
      clearActiveRtuPictures,
      refreshRtuPicturesView,
    )

  // ------------------------------------------------------------
  useEffect(() => {
    registerGroupDragVisuals({
      setBuildingPosition: (address, lat, lng) => {
        const entry = buildingMarkersRef.current.find((m) => m.building.address === address)
        if (!entry) return
        setAppMarkerPosition(entry.marker, lat, lng)
        setAppMarkerVisible(entry.marker, true)
      },
      setDetailPosition: (key, lat, lng) => {
        const entry = detailMarkersRef.current.find((m) => m.dragKey === key)
        if (!entry) return
        syncDetailMarkerPositions(entry, lat, lng)
        setAppMarkerVisible(entry.marker, true)
      },
    })
    return () => {
      registerGroupDragVisuals({
        setBuildingPosition: undefined,
        setDetailPosition: undefined,
      })
    }
  }, [])

  // ------------------------------------------------------------
  useEffect(() => {
    refreshDragSelectionStyles()
  }, [dragMode, dragSelectedKeys, refreshDragSelectionStyles])

  // ------------------------------------------------------------
  useEffect(() => {
    if (!map) return

    infoWindowRef.current = new google.maps.InfoWindow({ maxWidth: 360, disableAutoPan: true })
    infoWindowRef.current.addListener('closeclick', () => {
      if (shouldSuppressInfoWindowCloseReset()) return
      const marker = activeInfoMarkerRef.current
      if (marker) {
        const entry = detailMarkersRef.current.find((e) => e.marker === marker)
        if (entry) {
          syncDetailMarkerAppearance(entry, false, useLayerStore.getState().showRtuPictureCount)
        }
      }
      activeInfoMarkerRef.current = null
      activeDetailInfoRef.current = null
      clearActiveRtuPictures()
    })
    infoWindowRef.current.addListener('content_changed', attachInfoWindowActions)

    buildingMarkersRef.current = []
    detailMarkersRef.current = []

    for (const b of buildings) {
      const marker = createAppMarker({
        map,
        position: { lat: b.lat, lng: b.lng },
        title: b.address,
        zIndex: 10,
        draggable: false,
      })
      const entry: BuildingMarkerEntry = { building: b, marker }
      syncBuildingMarkerAppearance(entry, false)

      addAppMarkerListener(marker, 'click', (e: google.maps.MapMouseEvent) => {
        suppressMapClickClearOnce()
        if (shouldSuppressMarkerClick()) return
        if (useUiStore.getState().addMarkerPickMode || useUiStore.getState().polygonDrawMode) return
        if (useSelectionStore.getState().dragMode) {
          const additive = isSelectionAdditiveClick(e)
          useSelectionStore.getState().toggleDragSelect(buildingDragKey(b.address), additive)
          refreshDragSelectionStyles()
          return
        }
        callbacksRef.current.onSelectBuilding(b)
        openBuildingInfo(b, marker)
      })

      addAppMarkerListener(marker, 'dragstart', () => {
        isDraggingMarkerRef.current = true
        const startPos = getAppMarkerPosition(marker)
        if (!startPos) return
        const startLat = startPos.lat()
        const startLng = startPos.lng()
        const anchorKey = buildingDragKey(b.address)
        beginDragSession(anchorKey, startLat, startLng)
        if (isGroupDragActive()) {
          setNativeDragKey(anchorKey)
        }
        if (!isGroupDragActive()) {
          setLastDragUndo(() => {
            setAppMarkerPosition(marker, startLat, startLng)
            callbacksRef.current.onBuildingMoved?.(b, startLat, startLng)
          })
        }
      })

      addAppMarkerListener(marker, 'drag', () => {
        const pos = getAppMarkerPosition(marker)
        if (!pos) return
        if (isGroupDragActive()) {
          applyGroupDragDelta({ lat: pos.lat(), lng: pos.lng() })
        }
      })

      addAppMarkerListener(marker, 'dragend', () => {
        setNativeDragKey(null)
        if (isGroupDragActive()) {
          const pos = getAppMarkerPosition(marker)
          if (pos) applyGroupDragDelta({ lat: pos.lat(), lng: pos.lng() })
          commitGroupDrag()
          isDraggingMarkerRef.current = false
          markMarkerDragJustEnded()
          return
        }
        const pos = getAppMarkerPosition(marker)
        if (!pos) {
          isDraggingMarkerRef.current = false
          return
        }
        const lat = pos.lat()
        const lng = pos.lng()
        callbacksRef.current.onBuildingMoved?.(b, lat, lng)
        isDraggingMarkerRef.current = false
        markMarkerDragJustEnded()
      })

      buildingMarkersRef.current.push(entry)
      registerMarqueeTarget(buildingDragKey(b.address), {
        kind: 'point',
        resolve: () => {
          const pos = getAppMarkerPosition(marker)
          return pos ? { lat: pos.lat(), lng: pos.lng() } : null
        },
      })
    }

    const makeDetailMarker = (
      lat: number,
      lng: number,
      layerKey: LayerKey,
      data: DetailMarkerEntry['data'],
      building: Building | null,
    ) => {
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return
      const dragKey =
        building != null
          ? detailDragKey(layerKey, data.name ?? '', building.address)
          : 'utility_type' in data
            ? utilityDragKey(data)
            : detailDragKey(layerKey, data.name ?? '', '')
      const marker = createAppMarker({
        map,
        position: { lat, lng },
        title: data.name ?? '',
        zIndex: 20,
        draggable: false,
      })
      setAppMarkerVisible(marker, false)

      const entry: DetailMarkerEntry = { type: layerKey, building, data, marker, dragKey }
      syncDetailMarkerAppearance(entry, false, false)

      if (layerKey === 'rtu' && building && data.name) {
        registerRtuDropTarget(rtuDropTargetKey(building.address, data.name), marker, 20)
      }

      addAppMarkerListener(marker, 'click', (e: google.maps.MapMouseEvent) => {
        suppressMapClickClearOnce()
        if (shouldSuppressMarkerClick()) return
        if (useUiStore.getState().addMarkerPickMode || useUiStore.getState().polygonDrawMode) return
        if (useSelectionStore.getState().dragMode) {
          const additive = isSelectionAdditiveClick(e)
          useSelectionStore.getState().toggleDragSelect(dragKey, additive)
          refreshDragSelectionStyles()
          return
        }
        openDetailInfo(entry)
      })

      addAppMarkerListener(marker, 'dragstart', () => {
        isDraggingMarkerRef.current = true
        if (soloMoveRef.current?.marker === marker) {
          soloMoveRef.current.didDrag = true
          return
        }
        const startPos = getAppMarkerPosition(marker)
        if (!startPos) return
        const startLat = startPos.lat()
        const startLng = startPos.lng()
        beginDragSession(dragKey, startLat, startLng)
        if (isGroupDragActive()) {
          setNativeDragKey(dragKey)
        }
        if (!isGroupDragActive()) {
          setLastDragUndo(() => {
            syncDetailMarkerPositions(entry, startLat, startLng)
            callbacksRef.current.onDetailMoved?.(layerKey, entry.data, startLat, startLng, building)
          })
        }
      })

      addAppMarkerListener(marker, 'drag', () => {
        if (soloMoveRef.current?.marker === marker) return
        if (!isGroupDragActive()) return
        const pos = getAppMarkerPosition(marker)
        if (!pos) return
        applyGroupDragDelta({ lat: pos.lat(), lng: pos.lng() })
      })

      addAppMarkerListener(marker, 'dragend', () => {
        setNativeDragKey(null)
        const isSolo = soloMoveRef.current?.marker === marker

        // Popup Move: commit through the shared solo-move helper (same path as
        // its own dragend / pointerup fallback). Multi-select drag is unchanged.
        if (isSolo) {
          commitSoloMove()
          isDraggingMarkerRef.current = false
          return
        }

        if (isGroupDragActive()) {
          // Lock in the definitive final position before committing.
          const pos = getAppMarkerPosition(marker)
          if (pos) applyGroupDragDelta({ lat: pos.lat(), lng: pos.lng() })
          commitGroupDrag()
          isDraggingMarkerRef.current = false
          markMarkerDragJustEnded()
          return
        }
        const pos = getAppMarkerPosition(marker)
        if (!pos) {
          isDraggingMarkerRef.current = false
          return
        }
        const lat = pos.lat()
        const lng = pos.lng()
        syncDetailMarkerPositions(entry, lat, lng)
        callbacksRef.current.onDetailMoved?.(layerKey, entry.data, lat, lng, building)
        isDraggingMarkerRef.current = false
        markMarkerDragJustEnded()
      })

      detailMarkersRef.current.push(entry)
      registerMarqueeTarget(dragKey, {
        kind: 'point',
        resolve: () => {
          const pos = getAppMarkerPosition(marker)
          return pos ? { lat: pos.lat(), lng: pos.lng() } : null
        },
      })
    }

    for (const b of buildings) {
      for (const r of b.rtus ?? []) {
        if (isLegacySuiteMarkerName(r.name)) continue
        makeDetailMarker(r.lat, r.lng, 'rtu', r, b)
      }
    }

    for (const u of utilities) {
      const layerKey = UTILITY_LAYER_MAP[u.utility_type] ?? 'sprinkler'
      makeDetailMarker(u.lat, u.lng, layerKey, u, null)
    }

    for (const entrance of suiteEntrances) {
      const building = buildingForSuiteEntrance(buildings, polygons, entrance) ?? null
      makeDetailMarker(entrance.lat, entrance.lng, 'inspection360', entrance, building)
    }

    map.addListener('zoom_changed', refreshDetailVisibility)
    map.addListener('idle', refreshDetailVisibility)

    if (!hasInitialBuildingFitRef.current && buildingMarkersRef.current.length > 0) {
      hasInitialBuildingFitRef.current = true
      const entries = buildingMarkersRef.current
      google.maps.event.addListenerOnce(map, 'idle', () => {
        if (hasPendingHardRefreshView() || wasHardRefreshViewApplied()) return
        fitMapToBuildingMarkers(map, entries)
      })
    }

    void refreshRtuPictureBadges()

    return () => {
      clearAllRtuDropTargets()
      for (const entry of buildingMarkersRef.current) {
        unregisterMarqueeTarget(buildingDragKey(entry.building.address))
        setAppMarkerMap(entry.marker, null)
      }
      for (const entry of detailMarkersRef.current) {
        if (entry.type === 'rtu' && entry.building && entry.data.name) {
          unregisterRtuDropTarget(rtuDropTargetKey(entry.building.address, entry.data.name))
        }
        unregisterMarqueeTarget(entry.dragKey)
        setAppMarkerMap(entry.marker, null)
      }
      buildingMarkersRef.current = []
      detailMarkersRef.current = []
      infoWindowRef.current?.close()
      infoWindowRef.current = null
      stopSoloMove()
    }
    // markerStructureKey already tracks buildings/utilities changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    map,
    markerStructureKey,
    openBuildingInfo,
    openDetailInfo,
    attachInfoWindowActions,
    refreshDetailVisibility,
    refreshRtuPictureBadges,
    stopSoloMove,
    commitSoloMove,
    beginDragSession,
    commitGroupDrag,
    refreshDragSelectionStyles,
    clearActiveRtuPictures,
    setLastDragUndo,
  ])

  useEffect(() => {
    const wasDragMode = prevDragModeRef.current
    prevDragModeRef.current = dragMode
    if (wasDragMode && !dragMode) {
      const patched = applyPendingMarkerPositions(
        portfolioRef.current,
        buildingMarkersRef.current,
        detailMarkersRef.current,
      )
      if (patched) {
        onGroupMoved?.({ ...portfolioRef.current, ...patched })
      }
    }
  }, [dragMode, onGroupMoved])

  useEffect(() => {
    if (!map || buildingMarkersRef.current.length === 0) return
    if (isDraggingMarkerRef.current || soloMoveRef.current || isGroupDragActive()) return
    syncMarkersFromPortfolio(
      buildings,
      utilities,
      suiteEntrances,
      buildingMarkersRef.current,
      detailMarkersRef.current,
    )
  }, [map, buildings, utilities, suiteEntrances])

  useEffect(() => {
    if (!map || detailMarkersRef.current.length === 0) return
    refreshDragSelectionStyles()
  }, [map, buildings, polygons, utilities, suiteEntrances, refreshDragSelectionStyles])

  // ------------------------------------------------------------

  useEffect(() => {
    refreshDetailVisibility()
  }, [layers, refreshDetailVisibility])

  useEffect(() => {
    return onRtuPicturesChanged(() => {
      void refreshRtuPictureBadges()
    })
  }, [refreshRtuPictureBadges])

  useEffect(() => {
    const closePopups = () => {
      infoWindowRef.current?.close()
      activeInfoMarkerRef.current = null
      activeDetailInfoRef.current = null
      clearActiveRtuPictures()
      // Do not call stopSoloMove here. Map click after a sphere Move dragend
      // also fires closePopups and was clearing solo state before the move
      // could be committed — so the Save bar never appeared.
    }
    window.addEventListener(MAP_CLOSE_POPUPS_EVENT, closePopups)
    return () => window.removeEventListener(MAP_CLOSE_POPUPS_EVENT, closePopups)
  }, [clearActiveRtuPictures])

  useEffect(() => {
    if (!map) return
    const listener = map.addListener('click', (e: google.maps.MapMouseEvent) => {
      if (tryConsumeMapAddMarkerPick(e.latLng)) return
      if (consumeMapClickClearSuppression()) return
      // Ignore the synthetic map click that follows marker dragend.
      if (shouldSuppressMarkerClick()) return
      // Cancel an unfinished Move (clicked away before dragging).
      if (soloMoveRef.current) {
        if (isDraggingMarkerRef.current) return
        stopSoloMove()
        return
      }
      if (useSelectionStore.getState().dragMode) {
        useSelectionStore.getState().clearDragSelect()
        refreshDragSelectionStyles()
      }
      closeAllMapPopups()
    })
    return () => google.maps.event.removeListener(listener)
  }, [map, refreshDragSelectionStyles, stopSoloMove])

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (
        e as CustomEvent<{ layerKey: LayerKey; name: string; buildingAddress?: string }>
      ).detail
      const entry = detailMarkersRef.current.find((dm) => {
        if (detail.layerKey === 'inspection360') {
          return (
            dm.type === 'inspection360' &&
            dm.data.name === detail.name &&
            (detail.buildingAddress
              ? dm.building?.address === detail.buildingAddress
              : true)
          )
        }
        return (
          dm.type === detail.layerKey &&
          dm.data.name === detail.name &&
          (detail.buildingAddress
            ? dm.building?.address === detail.buildingAddress
            : !dm.building)
        )
      })
      if (!entry || !map) return
      panToPreserveRotation(map, { lat: entry.data.lat, lng: entry.data.lng }, MAP_DETAIL_ZOOM, {
        onlyZoomIn: true,
      })
      openDetailInfo(entry)
    }
    window.addEventListener('map:openDetail', handler)
    return () => window.removeEventListener('map:openDetail', handler)
  }, [map, openDetailInfo])

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ address: string }>).detail
      if (!map) return
      const entry = buildingMarkersRef.current.find((m) => m.building.address === detail.address)
      if (!entry) return
      closeAllMapPopups()
      callbacksRef.current.onSelectBuilding(entry.building)
      highlightBuilding(entry.building)
      const savedView = getBuildingSavedView(entry.building)
      if (savedView) {
        applySavedMapView(map, savedView)
        if (savedView.imageryMode) {
          const applied = applyMode(imageryModeIndexFromId(savedView.imageryMode))
          if (applied) onImageryModeChange?.(applied)
        }
      } else {
        const currentZoom = map.getZoom() ?? 0
        panToPreserveRotation(
          map,
          { lat: entry.building.lat, lng: entry.building.lng },
          resolveBuildingClickZoom(currentZoom, MAP_DETAIL_ZOOM),
          { onlyZoomIn: true },
        )
      }
      refreshDetailVisibility()
      setTimeout(() => {
        document
          .querySelector('.building-item.active')
          ?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
      }, 60)
    }
    window.addEventListener('map:openBuilding', handler)
    return () => window.removeEventListener('map:openBuilding', handler)
  }, [map, highlightBuilding, refreshDetailVisibility, applyMode, onImageryModeChange])

  const visibleAddressesRef = useRef('')

  useEffect(() => {
    if (!map) return
    if (hasPendingHardRefreshView()) return

    const q = search.trim()
    const hasDropdownFilter = Boolean(park || cluster || manager)
    if (
      q &&
      !hasDropdownFilter &&
      collectSearchHits(buildings, polygons, q).length > 0
    ) {
      return
    }

    const addressKey = mapBuildings
      .map((b) => b.address)
      .sort()
      .join('\n')
    const fitKey = `${park}|${cluster}|${manager}|${addressKey}`
    if (fitKey === visibleAddressesRef.current) {
      return
    }
    visibleAddressesRef.current = fitKey

    const savedPortfolioView = !currentBuilding
      ? getPortfolioSavedView(portfolioMapViews ?? {}, { park, cluster, manager })
      : null
    if (savedPortfolioView) {
      applySavedMapView(map, savedPortfolioView)
      if (savedPortfolioView.imageryMode) {
        const applied = applyMode(imageryModeIndexFromId(savedPortfolioView.imageryMode))
        if (applied) onImageryModeChange?.(applied)
      }
      return
    }

    fitAllMarkers()
  }, [
    map,
    mapBuildings,
    fitAllMarkers,
    buildings,
    polygons,
    search,
    park,
    cluster,
    manager,
    portfolioMapViews,
    currentBuilding,
    applyMode,
    onImageryModeChange,
  ])

  const showAllBuildingsView = useCallback(() => {
    if (!map) return
    const filter = { park: '', cluster: '', manager: '' }
    const addressKey = mapBuildings
      .map((b) => b.address)
      .sort()
      .join('\n')
    visibleAddressesRef.current = `|||${addressKey}`

    const saved = getPortfolioSavedView(portfolioMapViews ?? {}, filter)
    if (saved) {
      applySavedMapView(map, saved)
      if (saved.imageryMode) {
        const applied = applyMode(imageryModeIndexFromId(saved.imageryMode))
        if (applied) onImageryModeChange?.(applied)
      }
      refreshDetailVisibility()
      return
    }
    showAllMarkers()
  }, [
    map,
    mapBuildings,
    portfolioMapViews,
    applyMode,
    onImageryModeChange,
    refreshDetailVisibility,
    showAllMarkers,
  ])

  useEffect(() => {
    if (
      useUiStore.getState().addMarkerPickMode ||
      useUiStore.getState().polygonDrawMode ||
      useUiStore.getState().isModalOpen('addMarker')
    ) {
      return
    }
    if (!currentBuilding) return

    if (consumeSuppressBuildingMapFocus()) return
    highlightBuilding(currentBuilding)
  }, [currentBuilding, highlightBuilding])

  useEffect(() => {
    refreshDetailVisibility()
  }, [layers, dragMode, dragSelectedKeys, refreshDetailVisibility])

  const addMarkerPickMode = useUiStore((s) => s.addMarkerPickMode)
  const polygonDrawMode = useUiStore((s) => s.polygonDrawMode)
  const blockMarkerClicks = addMarkerPickMode || polygonDrawMode

  const syncMarkerDragState = useCallback(() => {
    const selected = new Set(useSelectionStore.getState().dragSelectedKeys)
    for (const entry of buildingMarkersRef.current) {
      const isSolo = soloMoveRef.current?.marker === entry.marker
      setAppMarkerDraggable(entry.marker, isSolo || dragMode)
      setAppMarkerClickable(entry.marker, !blockMarkerClicks)
      if (!isSolo) setAppMarkerCursor(entry.marker, dragMode ? 'grab' : null)
    }
    for (const entry of detailMarkersRef.current) {
      const isSolo = soloMoveRef.current?.marker === entry.marker
      const isSelected = selected.has(entry.dragKey)
      setAppMarkerDraggable(entry.marker, isSolo || (dragMode && isSelected))
      setAppMarkerClickable(entry.marker, !blockMarkerClicks)
      if (!isSolo) setAppMarkerCursor(entry.marker, dragMode && isSelected ? 'grab' : null)
    }
  }, [dragMode, blockMarkerClicks, soloMoveRef, buildingMarkersRef, detailMarkersRef])

  useEffect(() => {
    syncMarkerDragState()
  }, [syncMarkerDragState, markerStructureKey, dragSelectedKeys])

  // ------------------------------------------------------------
  return {
    fitAllMarkers,
    showAllMarkers,
    showAllBuildingsView,
    cycleImagery,
    refreshDetailVisibility,
    buildingMarkersRef,
    detailMarkersRef,
  }
}
