import { create } from 'zustand'
import { rcbReplacementYearKey } from '@/lib/costEstimator'
import {
  fetchSchedule,
  saveScheduleBatch,
  updateScheduleEntry,
} from '@/data/scheduleApi'
import { importEquipmentSchedule, type EquipmentImportResult } from '@/lib/equipmentSheet'
import type { Building } from '@/types/domain'

interface RtuScheduleState {
  replacementYears: Record<string, string>
  notes: Record<string, string>
  sourceFile: string | null
  loaded: boolean
  load: () => Promise<void>
  applyEquipmentImport: (result: EquipmentImportResult, sourceFile: string) => Promise<void>
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

  setReplacementYear: async (address, rtu, year, defaultYear) => {
    const key = rcbReplacementYearKey(address, rtu)
    const current = get().replacementYears[key]
    if (year === defaultYear) {
      if (current === undefined) return
    } else if (current === year) {
      return
    }
    set((state) => {
      const next = { ...state.replacementYears }
      if (year === defaultYear) delete next[key]
      else next[key] = year
      return { replacementYears: next }
    })
    await updateScheduleEntry(address, rtu, {
      replacementYear: year === defaultYear ? null : year,
    })
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
