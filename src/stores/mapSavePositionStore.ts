import { create } from 'zustand'

interface MapSavePositionState {
  /** Address of the building the "Save map position" prompt is offered for, or null. */
  promptAddress: string | null
  /** Offer to save the current map view for this building (after the user rotates). */
  requestPrompt: (address: string) => void
  dismiss: () => void
}

/** Drives the "Save map position" prompt shown after rotating while a building is focused. */
export const useMapSavePositionStore = create<MapSavePositionState>((set) => ({
  promptAddress: null,
  requestPrompt: (address) => set({ promptAddress: address }),
  dismiss: () => set({ promptAddress: null }),
}))
