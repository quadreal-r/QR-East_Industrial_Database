import { create } from 'zustand'
import type { LayerKey } from '@/types/domain'

export type LayerVisibility = Record<LayerKey, boolean>

const DEFAULT_LAYERS: LayerVisibility = {
  rtu: true,
  polygons: true,
  inspection360: true,
  sprinkler: true,
  electrical: true,
  hydrant: true,
  gas: true,
}

const ALL_LAYERS_OFF: LayerVisibility = {
  rtu: false,
  polygons: false,
  inspection360: false,
  sprinkler: false,
  electrical: false,
  hydrant: false,
  gas: false,
}

export function areAllLayersHidden(layers: LayerVisibility): boolean {
  return !Object.values(layers).some(Boolean)
}

interface LayerState {
  layers: LayerVisibility
  /** When false, RTU markers hide the numeric picture-count badge. */
  showRtuPictureCount: boolean
  toggleLayer: (key: LayerKey) => void
  setLayer: (key: LayerKey, visible: boolean) => void
  setLayers: (layers: LayerVisibility) => void
  resetLayers: () => void
  hideAllLayers: () => void
  showAllLayers: () => void
  toggleShowRtuPictureCount: () => void
  setShowRtuPictureCount: (visible: boolean) => void
}

export const useLayerStore = create<LayerState>((set) => ({
  layers: { ...DEFAULT_LAYERS },
  showRtuPictureCount: true,

  toggleLayer: (key) =>
    set((state) => ({
      layers: { ...state.layers, [key]: !state.layers[key] },
    })),

  setLayer: (key, visible) =>
    set((state) => ({
      layers: { ...state.layers, [key]: visible },
    })),

  setLayers: (layers) => set({ layers: { ...layers } }),

  resetLayers: () => set({ layers: { ...DEFAULT_LAYERS } }),

  hideAllLayers: () => set({ layers: { ...ALL_LAYERS_OFF } }),

  showAllLayers: () => set({ layers: { ...DEFAULT_LAYERS } }),

  toggleShowRtuPictureCount: () =>
    set((state) => ({ showRtuPictureCount: !state.showRtuPictureCount })),

  setShowRtuPictureCount: (visible) => set({ showRtuPictureCount: visible }),
}))
