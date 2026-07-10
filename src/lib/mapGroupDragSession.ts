import {
  applyDeltaToSnapshot,
  buildingDragKey,
  cloneSnapshot,
  type GroupDragSnapshot,
} from '@/lib/dragSelection'

export interface GroupDragVisuals {
  setBuildingPosition: (address: string, lat: number, lng: number) => void
  setDetailPosition: (key: string, lat: number, lng: number) => void
  setPolygonPaths: (key: string, paths: Array<{ lat: number; lng: number }>) => void
}

interface ActiveGroupDrag {
  anchorStart: { lat: number; lng: number }
  baseSnapshot: GroupDragSnapshot
  currentSnapshot: GroupDragSnapshot
}

let activeDrag: ActiveGroupDrag | null = null
/** Item being dragged natively by Maps — skip programmatic position updates for it during group drag. */
let nativeDragKey: string | null = null
const visualsStore: Partial<GroupDragVisuals> = {}

function getVisuals(): GroupDragVisuals | null {
  if (
    !visualsStore.setBuildingPosition &&
    !visualsStore.setDetailPosition &&
    !visualsStore.setPolygonPaths
  ) {
    return null
  }
  return {
    setBuildingPosition: visualsStore.setBuildingPosition ?? (() => {}),
    setDetailPosition: visualsStore.setDetailPosition ?? (() => {}),
    setPolygonPaths: visualsStore.setPolygonPaths ?? (() => {}),
  }
}

export function registerGroupDragVisuals(partial: Partial<GroupDragVisuals> | null): void {
  if (!partial) {
    visualsStore.setBuildingPosition = undefined
    visualsStore.setDetailPosition = undefined
    visualsStore.setPolygonPaths = undefined
    return
  }
  Object.assign(visualsStore, partial)
}

export function beginGroupDrag(anchorStart: { lat: number; lng: number }, snapshot: GroupDragSnapshot): void {
  const baseSnapshot = cloneSnapshot(snapshot)
  activeDrag = {
    anchorStart,
    baseSnapshot,
    currentSnapshot: baseSnapshot,
  }
}

export function isGroupDragActive(): boolean {
  return activeDrag != null
}

export function setNativeDragKey(key: string | null): void {
  nativeDragKey = key
}

/** @deprecated Use setNativeDragKey */
export function setNativeDragPolygonKey(key: string | null): void {
  setNativeDragKey(key)
}

export function applyGroupDragDelta(currentAnchor: { lat: number; lng: number }): GroupDragSnapshot | null {
  if (!activeDrag) return null
  const dLat = currentAnchor.lat - activeDrag.anchorStart.lat
  const dLng = currentAnchor.lng - activeDrag.anchorStart.lng
  const nextSnapshot = applyDeltaToSnapshot(activeDrag.baseSnapshot, dLat, dLng)

  // Always update the snapshot (used by endGroupDrag) even if visuals aren't ready.
  activeDrag.currentSnapshot = nextSnapshot

  const visuals = getVisuals()
  if (visuals) {
    for (const [address, pos] of Object.entries(nextSnapshot.buildings)) {
      if (nativeDragKey != null && nativeDragKey === buildingDragKey(address)) continue
      visuals.setBuildingPosition(address, pos.lat, pos.lng)
    }
    for (const item of nextSnapshot.details) {
      if (item.key === nativeDragKey) continue
      visuals.setDetailPosition(item.key, item.lat, item.lng)
    }
    for (const [key, poly] of Object.entries(nextSnapshot.polygons)) {
      if (key === nativeDragKey) continue
      visuals.setPolygonPaths(key, poly.paths)
    }
  }

  return nextSnapshot
}

export function endGroupDrag(): GroupDragSnapshot | null {
  if (!activeDrag) return null
  const finalSnapshot = cloneSnapshot(activeDrag.currentSnapshot)
  activeDrag = null
  nativeDragKey = null
  return finalSnapshot
}

export function cancelGroupDrag(): void {
  const visuals = getVisuals()
  if (!activeDrag || !visuals) {
    activeDrag = null
    nativeDragKey = null
    return
  }
  const snapshot = activeDrag.baseSnapshot
  for (const [address, pos] of Object.entries(snapshot.buildings)) {
    if (nativeDragKey != null && nativeDragKey === `building:${address}`) continue
    visuals.setBuildingPosition(address, pos.lat, pos.lng)
  }
  for (const item of snapshot.details) {
    if (item.key === nativeDragKey) continue
    visuals.setDetailPosition(item.key, item.lat, item.lng)
  }
  for (const [key, poly] of Object.entries(snapshot.polygons)) {
    if (key === nativeDragKey) continue
    visuals.setPolygonPaths(key, poly.paths)
  }
  activeDrag = null
  nativeDragKey = null
}

export function getGroupDragSnapshot(): GroupDragSnapshot | null {
  return activeDrag ? cloneSnapshot(activeDrag.baseSnapshot) : null
}
