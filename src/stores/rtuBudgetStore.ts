import { create } from 'zustand'
import { rcbReplacementYearKey } from '@/lib/costEstimator'
import { fetchBudgets, saveBudgetMerge } from '@/data/budgetApi'
import {
  splitBuildingBudget,
  type RtuBudgetSplitItem,
} from '@/lib/rtuBudget'
import { STORAGE_KEYS } from '@/lib/storageKeys'

interface RtuBudgetState {
  budgets: Record<string, number>
  loaded: boolean
  load: () => Promise<void>
  getRtuBudget: (address: string, rtu: string) => number | null
  setRtuBudget: (address: string, rtu: string, amount: number | null) => void
  setBuildingBudget: (address: string, total: number | null, items: RtuBudgetSplitItem[]) => void
  clearBuildingBudgets: (address: string, rtuNames: string[]) => void
  /** Merge budget patches; `null` clears that RTU. Unmentioned keys stay as-is. */
  applyBudgetMerge: (budgets: Record<string, number | null>) => void
}

function readPersistedBudgets(): Record<string, number> {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.rtuBudgets)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') return {}
    const out: Record<string, number> = {}
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
        out[key] = Math.round(value)
      }
    }
    return out
  } catch {
    return {}
  }
}

function persistBudgets(budgets: Record<string, number>): void {
  try {
    localStorage.setItem(STORAGE_KEYS.rtuBudgets, JSON.stringify(budgets))
  } catch {
    /* ignore quota / private mode */
  }
}

/** Best-effort remote sync; local state is already updated (offline / signed-out safe). */
function syncBudgets(patch: Record<string, number | null>): void {
  void saveBudgetMerge(patch).catch((error) => {
    console.warn('Budget sync to Supabase failed (kept locally):', error)
  })
}

export const useRtuBudgetStore = create<RtuBudgetState>((set, get) => ({
  budgets: {},
  loaded: false,

  load: async () => {
    const local = readPersistedBudgets()
    set({ budgets: local, loaded: true })

    try {
      // Trust Supabase when reachable — empty means Capex/app cleared RTU fields
      // (do not re-upload stale local splits).
      const remote = await fetchBudgets()
      set({ budgets: remote })
      persistBudgets(remote)
    } catch (error) {
      console.warn('Budget load from Supabase failed (using local copy):', error)
    }
  },

  getRtuBudget: (address, rtu) => {
    const amount = get().budgets[rcbReplacementYearKey(address, rtu)]
    return typeof amount === 'number' ? amount : null
  },

  setRtuBudget: (address, rtu, amount) => {
    const key = rcbReplacementYearKey(address, rtu)
    const value = amount == null ? null : Math.round(amount)
    set((state) => {
      const next = { ...state.budgets }
      if (value == null) {
        delete next[key]
      } else {
        next[key] = value
      }
      persistBudgets(next)
      return { budgets: next }
    })
    syncBudgets({ [key]: value })
  },

  setBuildingBudget: (address, total, items) => {
    if (total == null || total <= 0 || !items.length) {
      get().clearBuildingBudgets(
        address,
        items.map((item) => item.rtu),
      )
      return
    }
    const split = splitBuildingBudget(total, items)
    const patch: Record<string, number | null> = {}
    set((state) => {
      const next = { ...state.budgets }
      for (const item of items) {
        const key = rcbReplacementYearKey(address, item.rtu)
        const amount = split[item.rtu]
        if (amount == null || amount <= 0) {
          delete next[key]
          patch[key] = null
        } else {
          next[key] = amount
          patch[key] = amount
        }
      }
      persistBudgets(next)
      return { budgets: next }
    })
    syncBudgets(patch)
  },

  clearBuildingBudgets: (address, rtuNames) => {
    const patch: Record<string, number | null> = {}
    set((state) => {
      const next = { ...state.budgets }
      for (const rtu of rtuNames) {
        const key = rcbReplacementYearKey(address, rtu)
        delete next[key]
        patch[key] = null
      }
      persistBudgets(next)
      return { budgets: next }
    })
    syncBudgets(patch)
  },

  applyBudgetMerge: (budgets) => {
    set((state) => {
      const next = { ...state.budgets }
      for (const [key, amount] of Object.entries(budgets)) {
        if (amount == null || amount <= 0) delete next[key]
        else next[key] = Math.round(amount)
      }
      persistBudgets(next)
      return { budgets: next }
    })
    syncBudgets(budgets)
  },
}))
