import { create } from 'zustand'
import {
  fetchBuildingYearBudgets,
  upsertBuildingYearBudget,
  upsertBuildingYearBudgetNote,
} from '@/data/buildingBudgetApi'
import { buildingYearBudgetKey } from '@/lib/buildingYearBudget'
import { STORAGE_KEYS } from '@/lib/storageKeys'

interface BuildingYearBudgetState {
  pots: Record<string, number>
  notes: Record<string, string>
  statuses: Record<string, string>
  jobTypes: Record<string, string>
  loaded: boolean
  load: () => Promise<void>
  getBuildingYearBudget: (address: string, year: string) => number
  getBuildingYearNote: (address: string, year: string) => string
  getBuildingYearStatus: (address: string, year: string) => string
  getBuildingYearJobType: (address: string, year: string) => string
  setBuildingYearBudget: (address: string, year: string, amount: number | null) => void
  setBuildingYearNote: (address: string, year: string, note: string | null) => void
  /** Replace all pots and notes (e.g. after Capex import). */
  replaceAll: (
    pots: Record<string, number>,
    notes?: Record<string, string>,
    statuses?: Record<string, string>,
    jobTypes?: Record<string, string>,
  ) => void
  /** Merge Capex pot notes/statuses/job types without changing budgets. */
  applyNotesMerge: (
    notes: Record<string, string>,
    statuses?: Record<string, string>,
    jobTypes?: Record<string, string>,
  ) => void
}

function readPersistedPots(): Record<string, number> {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.buildingYearBudgets)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') return {}
    const out: Record<string, number> = {}
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
        out[key] = Math.round(value)
      }
    }
    return out
  } catch {
    return {}
  }
}

function readPersistedStringMap(storageKey: string): Record<string, string> {
  try {
    const raw = localStorage.getItem(storageKey)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') return {}
    const out: Record<string, string> = {}
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === 'string' && value.trim()) out[key] = value.trim()
    }
    return out
  } catch {
    return {}
  }
}

function persistPots(pots: Record<string, number>): void {
  try {
    localStorage.setItem(STORAGE_KEYS.buildingYearBudgets, JSON.stringify(pots))
  } catch {
    /* ignore */
  }
}

function persistNotes(notes: Record<string, string>): void {
  try {
    localStorage.setItem(STORAGE_KEYS.buildingYearBudgetNotes, JSON.stringify(notes))
  } catch {
    /* ignore */
  }
}

function persistStatuses(statuses: Record<string, string>): void {
  try {
    localStorage.setItem(STORAGE_KEYS.buildingYearBudgetStatuses, JSON.stringify(statuses))
  } catch {
    /* ignore */
  }
}

function persistJobTypes(jobTypes: Record<string, string>): void {
  try {
    localStorage.setItem(STORAGE_KEYS.buildingYearBudgetJobTypes, JSON.stringify(jobTypes))
  } catch {
    /* ignore */
  }
}

function syncOne(address: string, year: string, amount: number | null): void {
  void upsertBuildingYearBudget(address, year, amount).catch((error) => {
    console.warn('Building-year budget sync failed (kept locally):', error)
  })
}

function syncNote(
  address: string,
  year: string,
  note: string | null,
  status?: string | null,
  jobType?: string | null,
): void {
  void upsertBuildingYearBudgetNote(address, year, note, status, jobType).catch((error) => {
    console.warn('Building-year budget note sync failed (kept locally):', error)
  })
}

export const useBuildingYearBudgetStore = create<BuildingYearBudgetState>((set, get) => ({
  pots: {},
  notes: {},
  statuses: {},
  jobTypes: {},
  loaded: false,

  load: async () => {
    const localPots = readPersistedPots()
    const localNotes = readPersistedStringMap(STORAGE_KEYS.buildingYearBudgetNotes)
    const localStatuses = readPersistedStringMap(STORAGE_KEYS.buildingYearBudgetStatuses)
    const localJobTypes = readPersistedStringMap(STORAGE_KEYS.buildingYearBudgetJobTypes)
    set({
      pots: localPots,
      notes: localNotes,
      statuses: localStatuses,
      jobTypes: localJobTypes,
      loaded: true,
    })
    try {
      const remote = await fetchBuildingYearBudgets()
      if (Object.keys(remote.pots).length) {
        set({
          pots: remote.pots,
          notes: remote.notes,
          statuses: remote.statuses,
          jobTypes: remote.jobTypes,
        })
        persistPots(remote.pots)
        persistNotes(remote.notes)
        persistStatuses(remote.statuses)
        persistJobTypes(remote.jobTypes)
      } else if (Object.keys(localPots).length) {
        for (const [key, amount] of Object.entries(localPots)) {
          const sep = key.lastIndexOf('::')
          if (sep <= 0) continue
          syncOne(key.slice(0, sep), key.slice(sep + 2), amount)
        }
      }
    } catch (error) {
      console.warn('Building-year budget load failed (using local):', error)
    }
  },

  getBuildingYearBudget: (address, year) => {
    const amount = get().pots[buildingYearBudgetKey(address, year)]
    return typeof amount === 'number' && amount > 0 ? amount : 0
  },

  getBuildingYearNote: (address, year) =>
    get().notes[buildingYearBudgetKey(address, year)]?.trim() ?? '',

  getBuildingYearStatus: (address, year) =>
    get().statuses[buildingYearBudgetKey(address, year)]?.trim() ?? '',

  getBuildingYearJobType: (address, year) =>
    get().jobTypes[buildingYearBudgetKey(address, year)]?.trim() ?? '',

  setBuildingYearBudget: (address, year, amount) => {
    const key = buildingYearBudgetKey(address, year)
    const value = amount == null || amount <= 0 ? null : Math.round(amount)
    set((state) => {
      const next = { ...state.pots }
      const nextNotes = { ...state.notes }
      const nextStatuses = { ...state.statuses }
      const nextJobTypes = { ...state.jobTypes }
      if (value == null) {
        delete next[key]
        delete nextNotes[key]
        delete nextStatuses[key]
        delete nextJobTypes[key]
      } else {
        next[key] = value
      }
      persistPots(next)
      persistNotes(nextNotes)
      persistStatuses(nextStatuses)
      persistJobTypes(nextJobTypes)
      return {
        pots: next,
        notes: nextNotes,
        statuses: nextStatuses,
        jobTypes: nextJobTypes,
      }
    })
    syncOne(address, year, value)
  },

  setBuildingYearNote: (address, year, note) => {
    const key = buildingYearBudgetKey(address, year)
    const trimmed = note?.trim() || null
    set((state) => {
      const next = { ...state.notes }
      if (trimmed) next[key] = trimmed
      else delete next[key]
      persistNotes(next)
      return { notes: next }
    })
    syncNote(address, year, trimmed)
  },

  replaceAll: (pots, notes = {}, statuses = {}, jobTypes = {}) => {
    const clean: Record<string, number> = {}
    for (const [key, amount] of Object.entries(pots)) {
      if (typeof amount === 'number' && amount > 0) clean[key] = Math.round(amount)
    }
    const cleanNotes: Record<string, string> = {}
    for (const [key, note] of Object.entries(notes)) {
      if (clean[key] && note.trim()) cleanNotes[key] = note.trim()
    }
    const cleanStatuses: Record<string, string> = {}
    for (const [key, status] of Object.entries(statuses)) {
      if (clean[key] && status.trim()) cleanStatuses[key] = status.trim()
    }
    const cleanJobTypes: Record<string, string> = {}
    for (const [key, jobType] of Object.entries(jobTypes)) {
      if (clean[key] && jobType.trim()) cleanJobTypes[key] = jobType.trim()
    }
    persistPots(clean)
    persistNotes(cleanNotes)
    persistStatuses(cleanStatuses)
    persistJobTypes(cleanJobTypes)
    set({
      pots: clean,
      notes: cleanNotes,
      statuses: cleanStatuses,
      jobTypes: cleanJobTypes,
      loaded: true,
    })
  },

  applyNotesMerge: (notes, statuses = {}, jobTypes = {}) => {
    set((state) => {
      const nextNotes = { ...state.notes }
      const nextStatuses = { ...state.statuses }
      const nextJobTypes = { ...state.jobTypes }
      for (const [key, note] of Object.entries(notes)) {
        const trimmed = note.trim()
        if (trimmed && state.pots[key]) nextNotes[key] = trimmed
      }
      for (const [key, status] of Object.entries(statuses)) {
        const trimmed = status.trim()
        if (trimmed && state.pots[key]) nextStatuses[key] = trimmed
      }
      for (const [key, jobType] of Object.entries(jobTypes)) {
        const trimmed = jobType.trim()
        if (trimmed && state.pots[key]) nextJobTypes[key] = trimmed
      }
      persistNotes(nextNotes)
      persistStatuses(nextStatuses)
      persistJobTypes(nextJobTypes)
      return { notes: nextNotes, statuses: nextStatuses, jobTypes: nextJobTypes }
    })
    for (const [key, note] of Object.entries(notes)) {
      if (!get().pots[key]) continue
      const sep = key.lastIndexOf('::')
      if (sep <= 0) continue
      syncNote(
        key.slice(0, sep),
        key.slice(sep + 2),
        note.trim() || null,
        statuses[key]?.trim() || null,
        jobTypes[key]?.trim() || null,
      )
    }
  },
}))
