import { create } from 'zustand'
import type { Building } from '@/types/domain'

interface SelectionState {
  currentBuilding: Building | null
  viewedPolygon: { name: string; description: string } | null
  dragMode: boolean
  dragSelectedKeys: string[]
  sidebarCollapsed: boolean
  lastDragUndo: (() => void) | null
  setCurrentBuilding: (building: Building | null) => void
  selectBuilding: (building: Building) => void
  clearSelection: () => void
  setViewedPolygon: (polygon: { name: string; description: string } | null) => void
  setDragMode: (active: boolean) => void
  toggleDragMode: () => void
  toggleDragSelect: (key: string, additive: boolean) => void
  setDragSelect: (keys: string[], additive?: boolean) => void
  clearDragSelect: () => void
  isDragSelected: (key: string) => boolean
  setSidebarCollapsed: (collapsed: boolean) => void
  toggleSidebar: () => void
  setLastDragUndo: (fn: (() => void) | null) => void
  runDragUndo: () => boolean
}

export const useSelectionStore = create<SelectionState>((set, get) => ({
  currentBuilding: null,
  viewedPolygon: null,
  dragMode: false,
  dragSelectedKeys: [],
  sidebarCollapsed: false,
  lastDragUndo: null,

  setCurrentBuilding: (building) => set({ currentBuilding: building }),
  selectBuilding: (building) => set({ currentBuilding: building }),
  clearSelection: () => set({ currentBuilding: null, viewedPolygon: null }),

  setViewedPolygon: (polygon) => set({ viewedPolygon: polygon }),

  setDragMode: (active) =>
    set({
      dragMode: active,
      dragSelectedKeys: active ? get().dragSelectedKeys : [],
    }),

  toggleDragMode: () => {
    const next = !get().dragMode
    set({ dragMode: next, dragSelectedKeys: next ? get().dragSelectedKeys : [] })
  },

  toggleDragSelect: (key, additive) => {
    const current = get().dragSelectedKeys
    if (!additive) {
      if (current.length === 1 && current[0] === key) {
        set({ dragSelectedKeys: [] })
        return
      }
      set({ dragSelectedKeys: [key] })
      return
    }
    if (current.includes(key)) {
      set({ dragSelectedKeys: current.filter((k) => k !== key) })
      return
    }
    set({ dragSelectedKeys: [...current, key] })
  },

  setDragSelect: (keys, additive = false) => {
    if (additive) {
      const merged = new Set(get().dragSelectedKeys)
      for (const key of keys) merged.add(key)
      set({ dragSelectedKeys: [...merged] })
      return
    }
    set({ dragSelectedKeys: keys })
  },

  clearDragSelect: () => set({ dragSelectedKeys: [] }),

  isDragSelected: (key) => get().dragSelectedKeys.includes(key),

  setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
  toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),

  setLastDragUndo: (fn) => set({ lastDragUndo: fn }),

  runDragUndo: () => {
    const fn = get().lastDragUndo
    if (!fn) return false
    fn()
    set({ lastDragUndo: null })
    return true
  },
}))
