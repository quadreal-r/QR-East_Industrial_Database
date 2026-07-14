import { create } from 'zustand'
import type { SavedMapView } from '@/lib/buildingMapView'
import { fetchPortfolioMapView, savePortfolioMapView } from '@/data/settingsApi'

interface PortfolioMapViewState {
  view: SavedMapView | null
  loaded: boolean
  load: () => Promise<void>
  setView: (view: SavedMapView | null) => void
  persist: (view: SavedMapView | null) => Promise<void>
}

/** Saved camera for the green All Buildings overview (center, zoom, heading, tilt). */
export const usePortfolioMapViewStore = create<PortfolioMapViewState>((set) => ({
  view: null,
  loaded: false,

  load: async () => {
    try {
      const view = await fetchPortfolioMapView()
      set({ view, loaded: true })
    } catch {
      set({ loaded: true })
    }
  },

  setView: (view) => set({ view }),

  persist: async (view) => {
    await savePortfolioMapView(view)
    set({ view })
  },
}))
