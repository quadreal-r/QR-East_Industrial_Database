import { useCallback, useEffect, useRef } from 'react'
import { polygonDragKey, buildGroupDragSnapshot, applySnapshotToPortfolio } from '@/lib/dragSelection'
import {
  applyGroupDragDelta,
  beginGroupDrag,
  endGroupDrag,
  isGroupDragActive,
  registerGroupDragVisuals,
  setNativeDragPolygonKey,
} from '@/lib/mapGroupDragSession'
import { MAP_DETAIL_ZOOM } from '@/lib/constants'
import { afterMapViewChange, panToPreserveRotation } from '@/lib/mapRotation'
import { consumeMapClickClearSuppression, isSelectionAdditiveClick, registerMarqueeTarget, suppressMapClickClearOnce, unregisterMarqueeTarget } from '@/lib/mapMarqueeSelect'
import { shouldSuppressMarkerClick } from '@/features/map/mapMarkersState'
import { tryConsumeMapAddMarkerPick } from '@/lib/mapAddMarkerPick'
import { closeAllMapPopups, ensureInfoWindowVisible, bindMapPopupWheelScrollFromInfoWindow, MAP_CLOSE_POPUPS_EVENT } from '@/lib/mapPopups'
import { buildPolygonInfoHtml } from '@/lib/mapInfoWindow'
import { buildingForPolygon } from '@/lib/polygonBuildings'
import { bindPolygonVertexDelete } from '@/lib/polygonVertexEdit'
import { showToastError, showToastSuccess } from '@/lib/toast'
import { useLayerStore } from '@/stores/layerStore'
import { useSelectionStore } from '@/stores/selectionStore'
import type { Building, Polygon, SuiteEntrance, Utility } from '@/types/domain'

export interface UsePolygonsOptions {
  map: google.maps.Map | null
  buildings: Building[]
  utilities: Utility[]
  suiteEntrances: SuiteEntrance[]
  polygons: Polygon[]
  onPolygonUpdated?: (polygon: Polygon) => void
  onPolygonDeleted?: (polygon: Polygon) => void
  onGroupMoved?: (data: {
    buildings: Building[]
    utilities: Utility[]
    suiteEntrances: SuiteEntrance[]
    polygons: Polygon[]
  }) => void
}

interface RenderedPolygon {
  data: Polygon
  gmPoly: google.maps.Polygon
}

function panToPolygon(map: google.maps.Map, data: Polygon) {
  const lats = data.paths.reduce((s, pt) => s + pt.lat, 0)
  const lngs = data.paths.reduce((s, pt) => s + pt.lng, 0)
  panToPreserveRotation(
    map,
    { lat: lats / data.paths.length, lng: lngs / data.paths.length },
    MAP_DETAIL_ZOOM,
    { onlyZoomIn: true },
  )
}

function polygonKey(data: Polygon): string {
  return polygonDragKey(data.name, data.description)
}

function polygonCentroid(data: Polygon): { lat: number; lng: number } {
  const lats = data.paths.reduce((s, pt) => s + pt.lat, 0)
  const lngs = data.paths.reduce((s, pt) => s + pt.lng, 0)
  return { lat: lats / data.paths.length, lng: lngs / data.paths.length }
}

export function usePolygons({
  map,
  buildings,
  utilities,
  suiteEntrances,
  polygons,
  onPolygonUpdated,
  onPolygonDeleted,
  onGroupMoved,
}: UsePolygonsOptions) {
  const dragMode = useSelectionStore((s) => s.dragMode)
  const dragSelectedKeys = useSelectionStore((s) => s.dragSelectedKeys)
  const polygonsLayerVisible = useLayerStore((s) => s.layers.polygons)
  const setLastDragUndo = useSelectionStore((s) => s.setLastDragUndo)

  const portfolioRef = useRef({ buildings, utilities, suiteEntrances, polygons })

  useEffect(() => {
    portfolioRef.current = { buildings, utilities, suiteEntrances, polygons }
  }, [buildings, utilities, suiteEntrances, polygons])
  const renderedRef = useRef<RenderedPolygon[]>([])
  const infoWindowRef = useRef<google.maps.InfoWindow | null>(null)
  const infoPolyRef = useRef<google.maps.Polygon | null>(null)
  const editingRef = useRef<{ poly: google.maps.Polygon; data: Polygon } | null>(null)
  const editDblListenerRef = useRef<google.maps.MapsEventListener | null>(null)
  const editVertexDeleteRef = useRef<(() => void) | null>(null)
  const resolveGroupKeys = useCallback((anchorKey: string) => {
    const selected = useSelectionStore.getState().dragSelectedKeys
    if (selected.length > 0 && selected.includes(anchorKey)) return selected
    return [anchorKey]
  }, [])

  const commitGroupDrag = useCallback(() => {
    const finalSnapshot = endGroupDrag()
    if (!finalSnapshot || !onGroupMoved) return
    onGroupMoved(applySnapshotToPortfolio(portfolioRef.current, finalSnapshot))
    showToastSuccess('✓ Positions updated — save to HTML to keep changes.')
  }, [onGroupMoved])

  const beginDragSession = useCallback(
    (anchorKey: string, startLat: number, startLng: number) => {
      const keys = resolveGroupKeys(anchorKey)
      const portfolio = portfolioRef.current
      const beforeSnapshot = buildGroupDragSnapshot(portfolio, keys)
      if (keys.length > 1) {
        beginGroupDrag({ lat: startLat, lng: startLng }, beforeSnapshot)
        setLastDragUndo(() => {
          onGroupMoved?.(applySnapshotToPortfolio(portfolio, beforeSnapshot))
        })
      }
    },
    [onGroupMoved, resolveGroupKeys, setLastDragUndo],
  )

  useEffect(() => {
    registerGroupDragVisuals({
      setPolygonPaths: (key, paths) => {
        const entry = renderedRef.current.find((r) => polygonKey(r.data) === key)
        if (!entry) return
        entry.gmPoly.setPath(paths)
      },
    })
    return () => {
      registerGroupDragVisuals({ setPolygonPaths: undefined })
    }
  }, [])

  const refreshPolygonSelectionStyles = useCallback(() => {
    const selected = new Set(useSelectionStore.getState().dragSelectedKeys)
    for (const entry of renderedRef.current) {
      const key = polygonKey(entry.data)
      const isSelected = selected.has(key)
      entry.gmPoly.setOptions({
        strokeWeight: isSelected ? 4 : 2,
        fillOpacity: isSelected ? 0.15 : 0.02,
        strokeColor: isSelected ? '#ffffff' : entry.data.color,
      })
    }
  }, [])

  useEffect(() => {
    refreshPolygonSelectionStyles()
  }, [dragMode, dragSelectedKeys, refreshPolygonSelectionStyles])

  const callbacksRef = useRef({ onPolygonUpdated, onPolygonDeleted })

  const syncPaths = useCallback((poly: google.maps.Polygon, data: Polygon) => {
    const path = poly.getPath()
    const paths: Polygon['paths'] = []
    for (let i = 0; i < path.getLength(); i++) {
      const pt = path.getAt(i)
      paths.push({ lat: pt.lat(), lng: pt.lng() })
    }
    const updated = { ...data, paths }
    callbacksRef.current.onPolygonUpdated?.(updated)
    return updated
  }, [])

  const clearEditListeners = useCallback(() => {
    if (editDblListenerRef.current) {
      google.maps.event.removeListener(editDblListenerRef.current)
      editDblListenerRef.current = null
    }
    editVertexDeleteRef.current?.()
    editVertexDeleteRef.current = null
  }, [])

  const stopEdit = useCallback(
    (options?: { silent?: boolean }) => {
      const entry = editingRef.current
      if (!entry) return
      entry.poly.setEditable(false)
      syncPaths(entry.poly, entry.data)
      clearEditListeners()
      editingRef.current = null
      if (!options?.silent) {
        showToastSuccess('✓ Edit saved — save to HTML to keep changes.')
      }
    },
    [clearEditListeners, syncPaths],
  )

  const startEdit = useCallback(
    (poly: google.maps.Polygon, data: Polygon) => {
      if (editingRef.current?.poly === poly) return
      if (editingRef.current) stopEdit({ silent: true })
      editingRef.current = { poly, data }
      poly.setEditable(true)
      showToastSuccess(
        'Edit mode — drag vertices. Click a point, then press Delete to remove it. Double-click when done.',
      )

      editVertexDeleteRef.current = bindPolygonVertexDelete(poly, {
        onVerticesChanged: () => {
          const entry = editingRef.current
          if (!entry) return
          entry.data = syncPaths(entry.poly, entry.data)
        },
        onMinVerticesBlocked: () => {
          showToastError('Polygon needs at least 3 points.')
        },
      })

      editDblListenerRef.current = poly.addListener('dblclick', (e: google.maps.MapMouseEvent) => {
        e.stop()
        stopEdit()
      })
    },
    [stopEdit, syncPaths],
  )

  const openPopup = useCallback(
    (poly: google.maps.Polygon, data: Polygon, latLng?: google.maps.LatLng) => {
      if (!map) return
      if (editingRef.current && editingRef.current.poly !== poly) {
        stopEdit({ silent: true })
      }
      if (infoWindowRef.current && infoPolyRef.current === poly) {
        closeAllMapPopups()
        return
      }

      closeAllMapPopups()

      let position = latLng
      if (!position) {
        const lats = data.paths.reduce((s, pt) => s + pt.lat, 0)
        const lngs = data.paths.reduce((s, pt) => s + pt.lng, 0)
        position = new google.maps.LatLng(lats / data.paths.length, lngs / data.paths.length)
      }

      const assigned = buildingForPolygon(buildings, data)
      const content = buildPolygonInfoHtml(data, {
        assignedBuildingAddress: assigned?.address ?? null,
      })

      infoWindowRef.current = new google.maps.InfoWindow({
        content,
        position,
        disableAutoPan: true,
      })
      infoPolyRef.current = poly
      useSelectionStore.getState().setViewedPolygon({
        name: data.name,
        description: data.description ?? '',
      })
      infoWindowRef.current.open({ map, shouldFocus: false })
      bindMapPopupWheelScrollFromInfoWindow(infoWindowRef.current, map)
      ensureInfoWindowVisible(map, infoWindowRef.current)
      afterMapViewChange(map)
    },
    [map, stopEdit, buildings],
  )

  const openPopupRef = useRef(openPopup)

  useEffect(() => {
    callbacksRef.current = { onPolygonUpdated, onPolygonDeleted }
  }, [onPolygonUpdated, onPolygonDeleted])

  useEffect(() => {
    openPopupRef.current = openPopup
  }, [openPopup])

  const syncPolygonLayerVisibility = useCallback(() => {
    const { layers } = useLayerStore.getState()
    const polygonsOn = layers.polygons
    for (const entry of renderedRef.current) {
      entry.gmPoly.setVisible(polygonsOn)
    }
    if (!polygonsOn) {
      infoWindowRef.current?.close()
      infoWindowRef.current = null
      infoPolyRef.current = null
    }
  }, [])

  useEffect(() => {
    return useLayerStore.subscribe((state, prevState) => {
      if (state.layers === prevState.layers) {
        return
      }
      syncPolygonLayerVisibility()
    })
  }, [syncPolygonLayerVisibility])

  useEffect(() => {
    if (!map) return

    const onOpenPolygon = (e: Event) => {
      const detail = (e as CustomEvent<{ name: string; description: string }>).detail
      useSelectionStore.getState().setViewedPolygon({
        name: detail.name,
        description: detail.description ?? '',
      })
      const key = polygonKey({ name: detail.name, description: detail.description, color: '', paths: [] })
      const entry = renderedRef.current.find((r) => polygonKey(r.data) === key)
      if (!entry) return
      panToPolygon(map, entry.data)
      openPopupRef.current(entry.gmPoly, entry.data)
    }

    const onEditPolygon = (e: Event) => {
      const detail = (e as CustomEvent<{ name: string; description: string }>).detail
      useSelectionStore.getState().setViewedPolygon({
        name: detail.name,
        description: detail.description ?? '',
      })
      const key = polygonKey({ name: detail.name, description: detail.description, color: '', paths: [] })
      const entry = renderedRef.current.find((r) => polygonKey(r.data) === key)
      if (!entry) return
      closeAllMapPopups()
      panToPolygon(map, entry.data)
      startEdit(entry.gmPoly, entry.data)
    }

    window.addEventListener('map:openPolygon', onOpenPolygon)
    window.addEventListener('map:editPolygon', onEditPolygon)
    return () => {
      window.removeEventListener('map:openPolygon', onOpenPolygon)
      window.removeEventListener('map:editPolygon', onEditPolygon)
    }
  }, [map, startEdit])

  useEffect(() => {
    if (!map) return

    for (const entry of renderedRef.current) {
      entry.gmPoly.setMap(null)
    }
    renderedRef.current = []
    infoWindowRef.current?.close()
    infoWindowRef.current = null
    infoPolyRef.current = null

    for (const p of polygons) {
      if (p.paths.length < 3) continue
      const key = polygonKey(p)
      const gmPoly = new google.maps.Polygon({
        paths: p.paths,
        strokeColor: p.color,
        strokeOpacity: 1,
        strokeWeight: 2,
        fillColor: p.color,
        fillOpacity: 0.02,
        map,
        visible: polygonsLayerVisible,
        zIndex: 40,
        draggable: false,
      })

      gmPoly.addListener('click', (e: google.maps.MapMouseEvent) => {
        if (tryConsumeMapAddMarkerPick(e.latLng)) return
        if (useSelectionStore.getState().dragMode) {
          e.stop()
          suppressMapClickClearOnce()
          const additive = isSelectionAdditiveClick(e)
          useSelectionStore.getState().toggleDragSelect(key, additive)
          refreshPolygonSelectionStyles()
          return
        }
        closeAllMapPopups()
      })

      gmPoly.addListener('dblclick', (e: google.maps.MapMouseEvent) => {
        if (useSelectionStore.getState().dragMode) return
        e.stop()
        if (editingRef.current?.poly === gmPoly) {
          stopEdit()
          return
        }
        openPopupRef.current(gmPoly, p, e.latLng ?? undefined)
      })

      gmPoly.addListener('dragstart', () => {
        if (!useSelectionStore.getState().dragMode) return
        const start = polygonCentroid(p)
        beginDragSession(key, start.lat, start.lng)
        if (isGroupDragActive()) {
          setNativeDragPolygonKey(key)
        }
      })

      gmPoly.addListener('drag', () => {
        if (!isGroupDragActive()) return
        const path = gmPoly.getPath()
        let latSum = 0
        let lngSum = 0
        const count = path.getLength()
        for (let i = 0; i < count; i++) {
          const pt = path.getAt(i)
          latSum += pt.lat()
          lngSum += pt.lng()
        }
        if (!count) return
        applyGroupDragDelta({ lat: latSum / count, lng: lngSum / count })
      })

      gmPoly.addListener('dragend', () => {
        setNativeDragPolygonKey(null)
        if (isGroupDragActive()) {
          commitGroupDrag()
          return
        }
        if (useSelectionStore.getState().dragMode) {
          syncPaths(gmPoly, p)
        }
      })

      renderedRef.current.push({ data: p, gmPoly })
      registerMarqueeTarget(key, {
        kind: 'polygon',
        resolve: () => {
          const path = gmPoly.getPath()
          const paths: Array<{ lat: number; lng: number }> = []
          for (let i = 0; i < path.getLength(); i++) {
            const pt = path.getAt(i)
            paths.push({ lat: pt.lat(), lng: pt.lng() })
          }
          return paths
        },
      })
    }

    refreshPolygonSelectionStyles()

    return () => {
      for (const entry of renderedRef.current) {
        unregisterMarqueeTarget(polygonKey(entry.data))
        entry.gmPoly.setMap(null)
      }
      renderedRef.current = []
      infoWindowRef.current?.close()
      editingRef.current = null
      clearEditListeners()
    }
  }, [map, polygons, polygonsLayerVisible, refreshPolygonSelectionStyles, beginDragSession, commitGroupDrag, stopEdit, syncPaths, clearEditListeners])

  useEffect(() => {
    for (const entry of renderedRef.current) {
      const key = polygonKey(entry.data)
      const selected = useSelectionStore.getState().isDragSelected(key)
      entry.gmPoly.setDraggable(dragMode && selected)
    }
  }, [dragMode, dragSelectedKeys])

  useEffect(() => {
    syncPolygonLayerVisibility()
  }, [polygonsLayerVisible, syncPolygonLayerVisibility])

  useEffect(() => {
    const closePopups = () => {
      infoWindowRef.current?.close()
      infoWindowRef.current = null
      infoPolyRef.current = null
    }
    window.addEventListener(MAP_CLOSE_POPUPS_EVENT, closePopups)
    return () => window.removeEventListener(MAP_CLOSE_POPUPS_EVENT, closePopups)
  }, [])

  useEffect(() => {
    if (!map) return
    const listener = map.addListener('click', (e: google.maps.MapMouseEvent) => {
      if (tryConsumeMapAddMarkerPick(e.latLng)) return
      if (consumeMapClickClearSuppression()) return
      if (shouldSuppressMarkerClick()) return
      if (useSelectionStore.getState().dragMode) {
        useSelectionStore.getState().clearDragSelect()
        refreshPolygonSelectionStyles()
      }
      closeAllMapPopups()
    })
    return () => google.maps.event.removeListener(listener)
  }, [map, refreshPolygonSelectionStyles])
}