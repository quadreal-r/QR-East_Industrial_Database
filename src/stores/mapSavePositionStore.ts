import { create } from 'zustand'

export type MapSavePromptKind = 'building' | 'portfolio'

interface MapSavePositionState {
  /** What the save prompt is for, or null when hidden. */
  promptKind: MapSavePromptKind | null
  /** Address when promptKind is 'building'; otherwise null. */
  promptAddress: string | null
  /** Offer to save the current map view for this building (after the user rotates). */
  requestBuildingPrompt: (address: string) => void
  /** Offer to save the All Buildings overview camera (after rotate with nothing focused). */
  requestPortfolioPrompt: () => void
  dismiss: () => void
}

/** Drives the "Save map position" prompt shown after rotating the map. */
export const useMapSavePositionStore = create<MapSavePositionState>((set) => ({
  promptKind: null,
  promptAddress: null,
  requestBuildingPrompt: (address) => set({ promptKind: 'building', promptAddress: address }),
  requestPortfolioPrompt: () => set({ promptKind: 'portfolio', promptAddress: null }),
  dismiss: () => set({ promptKind: null, promptAddress: null }),
}))
