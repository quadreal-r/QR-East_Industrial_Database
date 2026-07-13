import { create } from 'zustand'
import {
  loadSearchHistory,
  pushSearchHistory,
  saveSearchHistory,
} from '@/lib/searchHistory'
import {
  DEFAULT_ADV_FILTERS,
  type AdvFilterState,
  type AdvFilterValue,
} from '@/types/domain'

interface FilterStoreState {
  searchInput: string
  search: string
  recentSearches: string[]
  park: string
  cluster: string
  manager: string
  buildingOperator: string
  adv: AdvFilterState
  advPanelOpen: boolean
  setSearchInput: (value: string) => void
  applySearch: () => void
  applyRecentSearch: (query: string) => void
  clearSearch: () => void
  setPark: (park: string) => void
  setCluster: (cluster: string) => void
  setManager: (manager: string) => void
  setBuildingOperator: (buildingOperator: string) => void
  setAdvFilter: (key: keyof AdvFilterState, value: AdvFilterValue) => void
  clearAdvFilters: () => void
  toggleAdvPanel: () => void
  setAdvPanelOpen: (open: boolean) => void
  resetFilters: () => void
}

export const useFilterStore = create<FilterStoreState>((set, get) => ({
  searchInput: '',
  search: '',
  recentSearches: loadSearchHistory(),
  park: '',
  cluster: '',
  manager: '',
  buildingOperator: '',
  adv: { ...DEFAULT_ADV_FILTERS },
  advPanelOpen: false,

  setSearchInput: (searchInput) => {
    set({ searchInput })
    if (searchInput === '') get().applySearch()
  },

  applySearch: () => {
    const query = get().searchInput.trim()
    let recentSearches = get().recentSearches
    if (query) {
      recentSearches = pushSearchHistory(query, recentSearches)
      saveSearchHistory(recentSearches)
    }
    set({ search: query, recentSearches })
  },

  applyRecentSearch: (query) => {
    const trimmed = query.trim()
    if (!trimmed) return
    const recentSearches = pushSearchHistory(trimmed, get().recentSearches)
    saveSearchHistory(recentSearches)
    set({ searchInput: trimmed, search: trimmed, recentSearches })
  },

  clearSearch: () => set({ searchInput: '', search: '' }),

  setPark: (park) => set({ park }),
  setCluster: (cluster) => set({ cluster }),
  setManager: (manager) => set({ manager }),
  setBuildingOperator: (buildingOperator) => set({ buildingOperator }),

  setAdvFilter: (key, value) =>
    set((state) => ({
      adv: { ...state.adv, [key]: value },
    })),

  clearAdvFilters: () => set({ adv: { ...DEFAULT_ADV_FILTERS } }),

  toggleAdvPanel: () => set((state) => ({ advPanelOpen: !state.advPanelOpen })),
  setAdvPanelOpen: (open) => set({ advPanelOpen: open }),

  resetFilters: () =>
    set({
      searchInput: '',
      search: '',
      park: '',
      cluster: '',
      manager: '',
      buildingOperator: '',
      adv: { ...DEFAULT_ADV_FILTERS },
    }),
}))
