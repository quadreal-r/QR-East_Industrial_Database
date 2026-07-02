/**
 * Shared types and pure utility functions for useMapMarkers sub-hooks.
 */
import {
  getAppMarkerPosition,
  setBuildingMarkerContent,
  setDetailMarkerContent,
  setAppMarkerPosition,
  type AppMapMarker,
} from '@/lib/appMapMarker'
import { matchesUtility } from '@/lib/dragSelection'
import { isLegacySuiteMarkerName } from '@/lib/legacySuiteMarkers'
import { LAYER_COLORS } from '@/lib/constants'
import { getColor } from '@/lib/colors'
import { getDetailMarkerIcon, getMarkerIcon } from '@/lib/markerStyles'
import { registerRtuDropTarget, rtuDropTargetKey } from '@/features/map/rtuDropTargetHighlight'
import { fitBoundsPreserveRotation } from '@/lib/mapRotation'
import type { buildPolygonBuildingIndex } from '@/lib/polygonBuildings'
import type { Building, LayerKey, Rtu, Utility } from '@/types/domain'

// --- Types --------------------------------------------------------------------

/** Return type of buildPolygonBuildingIndex - shared across sub-hooks. */
export type PolygonBuildingIndex = ReturnType<typeof buildPolygonBuildingIndex>

/** Stable callbacks bag stored in a ref and kept up-to-date every render. */
export interface MapMarkersCallbacks {
  onSelectBuilding: (building: Building) => void
  onBuildingMoved?: (building: Building, lat: number, lng: number) => void
  onDetailMoved?: (
    layerKey: LayerKey,
    data: Rtu | Utility,
    lat: number,
    lng: number,
    building: Building | null,
  ) => void
  onDeleteDetail?: (layerKey: LayerKey, data: Rtu | Utility, building: Building | null) => void
  onEditDetail?: (
    layerKey: LayerKey,
    building: Building,
    oldName: string,
    updates: { name: string; description: string },
  ) => void | Promise<void>
}


export interface BuildingMarkerEntry {
  building: Building
  marker: AppMapMarker
}

export interface DetailMarkerEntry {
  type: LayerKey
  building: Building | null
  data: Rtu | Utility
  marker: AppMapMarker
  pictureCount?: number
  dragKey: string
}

export type ActiveDetailView = 'info' | 'pictures' | 'documents' | 'edit'

export interface ActiveDetailInfo {
  entry: DetailMarkerEntry
  view: ActiveDetailView
  pictureIndex: number
}

// --- Constants ----------------------------------------------------------------

export const MAP_BUILDING_FIT_PADDING = { top: 40, right: 40, bottom: 40, left: 40 } as const

// --- Pure helpers -------------------------------------------------------------

export function fitMapToBuildingMarkers(
  map: google.maps.Map,
  entries: BuildingMarkerEntry[],
): void {
  const bounds = new google.maps.LatLngBounds()
  for (const entry of entries) {
    bounds.extend({ lat: entry.building.lat, lng: entry.building.lng })
  }
  if (!bounds.isEmpty()) {
    fitBoundsPreserveRotation(map, bounds, MAP_BUILDING_FIT_PADDING)
  }
}

export function buildingLabelText(address: string): string {
  return address.length > 24 ? `${address.slice(0, 22)}...` : address
}

export function syncBuildingMarkerAppearance(
  entry: BuildingMarkerEntry,
  isSelected = false,
): void {
  const color = getColor(entry.building.park)
  const icon = getMarkerIcon(color, isSelected)
  setBuildingMarkerContent(entry.marker, icon, {
    text: buildingLabelText(entry.building.address),
    className: 'bldg-marker-label',
  })
}

export function detailLabelFor(entry: DetailMarkerEntry): google.maps.MarkerLabel | undefined {
  const { type: layerKey, data } = entry
  if (!data.name) return undefined
  const cfg = LAYER_COLORS[layerKey]
  const text =
    layerKey === 'hydrant' ? 'Hydrant' : layerKey === 'gas' ? 'Gas Meter' : data.name
  return {
    text,
    color: cfg.fill,
    fontSize: layerKey === 'rtu' ? '11px' : '9px',
    fontWeight: layerKey === 'rtu' ? '500' : '700',
    fontFamily: 'Inter,sans-serif',
    className: layerKey === 'rtu' ? 'rtu-marker-label' : 'rtu-label',
  }
}

export function detailIconFor(
  entry: DetailMarkerEntry,
  isSelected: boolean,
): google.maps.Symbol {
  const cfg = LAYER_COLORS[entry.type]
  if (isSelected) {
    return {
      path: google.maps.SymbolPath.CIRCLE,
      fillColor: cfg.fill,
      fillOpacity: 0.9,
      strokeColor: '#ffffff',
      strokeWeight: 3,
      scale: cfg.scale + 2,
    }
  }
  return getDetailMarkerIcon(cfg.fill, cfg.stroke, {
    shapeIndex: entry.data.marker_shape,
    scale: entry.data.marker_scale,
    defaultScale: cfg.scale,
  })
}

export function detailMarkerPictureCount(
  entry: DetailMarkerEntry,
  showPictureCount: boolean,
): number {
  return showPictureCount && entry.type === 'rtu' ? (entry.pictureCount ?? 0) : 0
}

export function syncDetailMarkerAppearance(
  entry: DetailMarkerEntry,
  isSelected = false,
  showPictureCount = true,
): void {
  setDetailMarkerContent(entry.marker, {
    icon: detailIconFor(entry, isSelected),
    label: detailLabelFor(entry),
    labelOffsetY: entry.type === 'rtu' ? -7 : -4,
    pictureCount: detailMarkerPictureCount(entry, showPictureCount),
  })
  if (entry.type === 'rtu' && entry.building && entry.data.name) {
    registerRtuDropTarget(
      rtuDropTargetKey(entry.building.address, entry.data.name),
      entry.marker,
      20,
    )
  }
}

export function syncDetailMarkerPositions(
  entry: DetailMarkerEntry,
  lat: number,
  lng: number,
): void {
  setAppMarkerPosition(entry.marker, lat, lng)
}

/** Apply map marker positions that differ from portfolio (e.g. before leaving edit mode). */
export function applyPendingMarkerPositions(
  portfolio: { buildings: Building[]; utilities: Utility[] },
  buildingMarkers: BuildingMarkerEntry[],
  detailMarkers: DetailMarkerEntry[],
): { buildings: Building[]; utilities: Utility[] } | null {
  let buildings = portfolio.buildings
  let utilities = portfolio.utilities
  let changed = false

  for (const entry of buildingMarkers) {
    const pos = getAppMarkerPosition(entry.marker)
    if (!pos) continue
    const lat = pos.lat()
    const lng = pos.lng()
    const stored = buildings.find((b) => b.address === entry.building.address)
    if (stored && stored.lat === lat && stored.lng === lng) continue
    buildings = buildings.map((b) =>
      b.address === entry.building.address ? { ...b, lat, lng } : b,
    )
    changed = true
  }

  for (const entry of detailMarkers) {
    const pos = getAppMarkerPosition(entry.marker)
    if (!pos) continue
    const lat = pos.lat()
    const lng = pos.lng()
    if (entry.type === 'rtu' && entry.building) {
      const stored = buildings
        .find((b) => b.address === entry.building!.address)
        ?.rtus?.find((r) => r.name === entry.data.name)
      if (stored && stored.lat === lat && stored.lng === lng) continue
      buildings = buildings.map((b) =>
        b.address === entry.building!.address
          ? {
              ...b,
              rtus: b.rtus?.map((r) => (r.name === entry.data.name ? { ...r, lat, lng } : r)),
            }
          : b,
      )
      changed = true
      continue
    }
    if ('utility_type' in entry.data) {
      const stored = utilities.find((u) => matchesUtility(u, entry.data as Utility))
      if (stored && stored.lat === lat && stored.lng === lng) continue
      utilities = utilities.map((u) =>
        matchesUtility(u, entry.data as Utility) ? { ...u, lat, lng } : u,
      )
      changed = true
    }
  }

  return changed ? { buildings, utilities } : null
}

/** Rebuild markers only when portfolio structure changes, not on coordinate edits. */
export function buildMarkerStructureKey(
  buildings: Building[],
  utilities: Utility[],
): string {
  const buildingPart = buildings
    .map((b) => {
      const rtuNames = (b.rtus ?? [])
        .filter((r) => !isLegacySuiteMarkerName(r.name))
        .map((r) => r.name)
        .sort()
        .join(',')
      return `${b.address}\0${rtuNames}`
    })
    .sort()
    .join('\n')
  const utilityPart = utilities
    .map((u) => `${u.utility_type}\0${u.name ?? ''}\0${u.description ?? ''}`)
    .sort()
    .join('\n')
  return `${buildingPart}||${utilityPart}`
}

/** Keep live markers aligned with portfolio after moves without tearing down the map layer. */
export function syncMarkersFromPortfolio(
  buildings: Building[],
  utilities: Utility[],
  buildingMarkers: BuildingMarkerEntry[],
  detailMarkers: DetailMarkerEntry[],
): void {
  for (const entry of buildingMarkers) {
    const b = buildings.find((x) => x.address === entry.building.address)
    if (!b) continue
    entry.building = b
    const pos = getAppMarkerPosition(entry.marker)
    if (!pos || pos.lat() !== b.lat || pos.lng() !== b.lng) {
      setAppMarkerPosition(entry.marker, b.lat, b.lng)
    }
  }

  for (const entry of detailMarkers) {
    if (entry.type === 'rtu' && entry.building) {
      const b = buildings.find((x) => x.address === entry.building!.address)
      const rtus = b?.rtus ?? []
      const rtu =
        rtus.find((r) => r.name === entry.data.name) ??
        rtus.find(
          (r) =>
            r.lat === entry.data.lat &&
            r.lng === entry.data.lng &&
            !isLegacySuiteMarkerName(r.name),
        )
      if (!b || !rtu) continue
      entry.building = b
      entry.data = rtu
      const pos = getAppMarkerPosition(entry.marker)
      if (!pos || pos.lat() !== rtu.lat || pos.lng() !== rtu.lng) {
        syncDetailMarkerPositions(entry, rtu.lat, rtu.lng)
      }
      continue
    }
    if ('utility_type' in entry.data) {
      const u = utilities.find((item) => matchesUtility(item, entry.data as Utility))
      if (!u) continue
      entry.data = u
      const pos = getAppMarkerPosition(entry.marker)
      if (!pos || pos.lat() !== u.lat || pos.lng() !== u.lng) {
        syncDetailMarkerPositions(entry, u.lat, u.lng)
      }
    }
  }
}

let suppressMarkerClickUntil = 0

/** Maps often emits a click right after dragend; ignore it so popups stay closed. */
export function markMarkerDragJustEnded(durationMs = 350): void {
  suppressMarkerClickUntil = Date.now() + durationMs
}

export function shouldSuppressMarkerClick(): boolean {
  return Date.now() < suppressMarkerClickUntil
}
