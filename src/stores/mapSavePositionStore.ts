import { create } from 'zustand'
import type { PortfolioFilterKey } from '@/lib/portfolioMapView'

interface MapSavePositionState {
  /** Address of the building the "Save map position" prompt is offered for, or null. */
  promptAddress: string | null
  /** Park/cluster/manager filter the save prompt is offered for, or null. */
  promptPortfolioFilter: PortfolioFilterKey | null
  /** Offer to save the current map view for this building (after the user rotates). */
  requestBuildingPrompt: (address: string) => void
  /** Offer to save the current map view for the active portfolio filter. */
  requestPortfolioPrompt: (filter: PortfolioFilterKey) => void
  dismiss: () => void
}

/** Drives the "Save map position" prompt shown after rotating while a building or filter is focused. */
export const useMapSavePositionStore = create<MapSavePositionState>((set) => ({
  promptAddress: null,
  promptPortfolioFilter: null,
  requestBuildingPrompt: (address) => set({ promptAddress: address, promptPortfolioFilter: null }),
  requestPortfolioPrompt: (filter) =>
    set({ promptPortfolioFilter: filter, promptAddress: null }),
  dismiss: () => set({ promptAddress: null, promptPortfolioFilter: null }),
}))
