import { create } from 'zustand'
import type { PortfolioData } from '@/types/domain'

interface PortfolioStoreState {
  portfolio: PortfolioData | null
  unsaved: boolean
  setPortfolio: (data: PortfolioData, options?: { markSaved?: boolean }) => void
  patchPortfolio: (data: PortfolioData) => void
  markSaved: () => void
  markUnsaved: () => void
}

export const usePortfolioStore = create<PortfolioStoreState>((set) => ({
  portfolio: null,
  unsaved: false,

  setPortfolio: (data, options) => {
    set({ portfolio: data, unsaved: options?.markSaved === false })
  },

  patchPortfolio: (data) => {
    set({ portfolio: data, unsaved: true })
  },

  markSaved: () => set({ unsaved: false }),
  markUnsaved: () => set({ unsaved: true }),
}))
