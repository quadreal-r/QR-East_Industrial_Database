import { create } from 'zustand'
import { rcbReplacementYearKey } from '@/lib/costEstimator'
import {
  fetchSchedule,
  saveScheduleBatch,
  saveScheduleMerge,
  updateScheduleEntry,
} from '@/data/scheduleApi'
import { importEquipmentSchedule, type EquipmentImportResult } from '@/lib/equipmentSheet'
import type { RcbAllUnitsImportResult } from '@/lib/rcbReportImport'
import type { Building } from '@/types/domain'

interface RtuScheduleState {
  replacementYears: Record<string, string>
  notes: Record<string, string>
  sourceFile: string | null
  loaded: boolean
  load: () => Promise<void>
  applyEquipmentImport: (result: EquipmentImportResult, sourceFile: string) => Promise<void>
  applyRcbReportMerge: (result: RcbAllUnitsImportResult, sourceFile: string) => Promise<void>
  importWorkbook: (
    file: File,
    buildings: Building[],
  ) => Promise<{ stats: ReturnType<typeof importEquipmentSchedule>['stats'] }>
  setReplacementYear: (address: string, rtu: string, year: string, defaultYear: string) => Promise<void>
  setNotes: (address: string, rtu: string, notes: string) => Promise<void>
  getNotes: (address: string, rtu: string) => string
}

function applyScheduleData(
  data: { replacementYears: Record<string, string>; notes: Record<string, string>; sourceFile: string | null },
  set: (partial: Partial<RtuScheduleState>) => void,
): void {
  set({
    replacementYears: data.replacementYears,
    notes: data.notes,
    sourceFile: data.sourceFile,
    loaded: true,
  })
}

export const useRtuScheduleStore = create<RtuScheduleState>((set, get) => ({
  replacementYears: {},
  notes: {},
  sourceFile: null,
  loaded: false,

  load: async () => {
    const data = await fetchSchedule()
    applyScheduleData(data, set)
  },

  applyEquipmentImport: async (result, sourceFile) => {
    set({
      replacementYears: result.replacementYears,
      notes: result.notes,
      sourceFile,
    })
    await saveScheduleBatch(result.replacementYears, result.notes, sourceFile)
  },

  applyRcbReportMerge: async (result, sourceFile) => {
    set((state) => {
      const nextYears = { ...state.replacementYears, ...result.replacementYears }
      const nextNotes = { ...state.notes }
      for (const [key, value] of Object.entries(result.notes)) {
        if (value == null || !value.trim()) delete nextNotes[key]
        else nextNotes[key] = value
      }
      return { replacementYears: nextYears, notes: nextNotes, sourceFile }
    })
    await saveScheduleMerge(result.replacementYears, result.notes, sourceFile)
  },

  importWorkbook: async (file, buildings) => {
    const buffer = await file.arrayBuffer()
    const result = importEquipmentSchedule(buffer, buildings)
    set({
      replacementYears: result.replacementYears,
      notes: result.notes,
      sourceFile: file.name,
    })
    await saveScheduleBatch(result.replacementYears, result.notes, file.name)
    return { stats: result.stats }
  },

  setReplacementYear: async (address, rtu, year, _defaultYear) => {
    const key = rcbReplacementYearKey(address, rtu)
    const raw = year.trim()
    // Empty / None / legacy 0 placeholders clear the assignment.
    const nextYear = raw && /^\d{4}$/.test(raw) && Number(raw) >= 2000 ? raw : ''
    const current = get().replacementYears[key]
    if (!nextYear) {
      if (current == null) return
      set((state) => {
        const next = { ...state.replacementYears }
        delete next[key]
        return { replacementYears: next }
      })
      await updateScheduleEntry(address, rtu, { replacementYear: null })
      return
    }
    // Assignment tool: always persist the chosen year (independent of top filter / default).
    if (current === nextYear) return
    set((state) => ({
      replacementYears: { ...state.replacementYears, [key]: nextYear },
    }))
    await updateScheduleEntry(address, rtu, { replacementYear: nextYear })
  },

  setNotes: async (address, rtu, notes) => {
    const key = rcbReplacementYearKey(address, rtu)
    const trimmed = notes.trim()
    const current = get().notes[key] ?? ''
    if (current === trimmed) return
    set((state) => {
      const next = { ...state.notes }
      if (trimmed) next[key] = trimmed
      else delete next[key]
      return { notes: next }
    })
    await updateScheduleEntry(address, rtu, { note: trimmed || null })
  },

  getNotes: (address, rtu) => {
    return get().notes[rcbReplacementYearKey(address, rtu)] ?? ''
  },
}))

export function getRtuReplacementYearAssignments(): Record<string, string> {
  return useRtuScheduleStore.getState().replacementYears
}
