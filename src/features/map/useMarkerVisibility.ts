import { useCallback } from 'react'
import type { MutableRefObject } from 'react'
import {
  getAppMarkerPosition,
  setAppMarkerVisible,
  setAppMarkerZIndex,
  setAppMarkerCursor,
} from '@/lib/appMapMarker'
import { isGroupDragActive } from '@/lib/mapGroupDragSession'
import { fitBoundsPreserveRotation } from '@/lib/mapRotation'
import { useSelectionStore } from '@/stores/selectionStore'
import { areAllLayersHidden, useLayerStore } from '@/stores/layerStore'
import { buildingDragKey } from '@/lib/dragSelection'
import {
  syncBuildingMarkerAppearance,
  syncDetailMarkerAppearance,
  fitMapToBuildingMarkers,
  MAP_BUILDING_FIT_PADDING,
} from '@/features/map/mapMarkersState'
import type { BuildingMarkerEntry, DetailMarkerEntry } from '@/features/map/mapMarkersState'
import type { Building } from '@/types/domain'

export function useMarkerVisibility(
  map: google.maps.Map | null,
  mapBuildings: Building[],
  buildingMarkersRef: MutableRefObject<BuildingMarkerEntry[]>,
  detailMarkersRef: MutableRefObject<DetailMarkerEntry[]>,
) {
  const refreshBuildingMarkerVisibility = useCallback(() => {
    const { layers } = useLayerStore.getState()
    const anyLayerOn = !areAllLayersHidden(layers)
    const showBuildings = anyLayerOn

    for (const entry of buildingMarkersRef.current) {
      setAppMarkerVisible(entry.marker, showBuildings)
    }
  }, [buildingMarkersRef])

  const refreshDetailVisibility = useCallback(() => {
    if (!map) return
    if (isGroupDragActive()) return

    const { layers } = useLayerStore.getState()
    const zoom = map.getZoom() ?? 0
    const bounds = map.getBounds()
    const editMode = useSelectionStore.getState().dragMode
    const selected = new Set(useSelectionStore.getState().dragSelectedKeys)

    refreshBuildingMarkerVisibility()

    for (const dm of detailMarkersRef.current) {
      const pos = getAppMarkerPosition(dm.marker)
      const layerOn = layers[dm.type]
      const zoomOk = zoom >= 16
      const inBounds = Boolean(bounds && pos && bounds.contains(pos))
      const show =
        layerOn &&
        zoomOk &&
        (editMode && selected.has(dm.dragKey) ? true : inBounds)
      setAppMarkerVisible(dm.marker, show)
    }
  }, [map, detailMarkersRef, refreshBuildingMarkerVisibility])

  const refreshDragSelectionStyles = useCallback(() => {
    const selected = new Set(useSelectionStore.getState().dragSelectedKeys)
    for (const entry of buildingMarkersRef.current) {
      const isSelected = selected.has(buildingDragKey(entry.building.address))
      syncBuildingMarkerAppearance(entry, isSelected)
      setAppMarkerZIndex(entry.marker, isSelected ? 999 : 10)
      if (useSelectionStore.getState().dragMode) {
        setAppMarkerCursor(entry.marker, 'grab')
      }
    }
    for (const entry of detailMarkersRef.current) {
      const isSelected = selected.has(entry.dragKey)
      syncDetailMarkerAppearance(
        entry,
        isSelected,
        useLayerStore.getState().showRtuPictureCount,
      )
    }
  }, [buildingMarkersRef, detailMarkersRef])

  const resetBuildingIcons = useCallback(() => {
    for (const entry of buildingMarkersRef.current) {
      syncBuildingMarkerAppearance(entry, false)
      setAppMarkerZIndex(entry.marker, 10)
    }
  }, [buildingMarkersRef])

  const highlightBuilding = useCallback(
    (building: Building) => {
      resetBuildingIcons()
      const entry = buildingMarkersRef.current.find((m) => m.building.address === building.address)
      if (!entry) return
      syncBuildingMarkerAppearance(entry, true)
      setAppMarkerZIndex(entry.marker, 999)
    },
    [buildingMarkersRef, resetBuildingIcons],
  )

  const fitAllMarkers = useCallback(() => {
    if (!map) return
    if (areAllLayersHidden(useLayerStore.getState().layers)) {
      refreshDetailVisibility()
      return
    }
    const editMode = useSelectionStore.getState().dragMode
    const bounds = new google.maps.LatLngBounds()
    const visibleSet = new Set(mapBuildings.map((b) => b.address))
    for (const entry of buildingMarkersRef.current) {
      if (!editMode && !visibleSet.has(entry.building.address)) continue
      const pos = getAppMarkerPosition(entry.marker)
      if (pos) bounds.extend(pos)
    }
    if (!bounds.isEmpty()) {
      fitBoundsPreserveRotation(map, bounds, MAP_BUILDING_FIT_PADDING)
    }
    refreshDetailVisibility()
  }, [map, mapBuildings, buildingMarkersRef, refreshDetailVisibility])

  const showAllMarkers = useCallback(() => {
    if (!map) return
    for (const entry of buildingMarkersRef.current) {
      setAppMarkerVisible(entry.marker, true)
    }
    fitMapToBuildingMarkers(map, buildingMarkersRef.current)
    refreshDetailVisibility()
  }, [map, buildingMarkersRef, refreshDetailVisibility])

  return {
    refreshDetailVisibility,
    refreshDragSelectionStyles,
    resetBuildingIcons,
    highlightBuilding,
    fitAllMarkers,
    showAllMarkers,
  }
}
