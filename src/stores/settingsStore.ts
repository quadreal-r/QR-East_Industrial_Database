import { create } from 'zustand'
import { applyThemeVars } from '@/lib/themes'
import { fetchSettings, saveSettings as saveSettingsApi } from '@/data/settingsApi'
import { STORAGE_KEYS } from '@/lib/storageKeys'

interface SettingsState {
  themeIndex: number
  managerRenames: Record<string, string>
  loaded: boolean
  setThemeIndex: (index: number) => void
  setManagerRename: (original: string, name: string) => void
  applyTheme: (index: number) => void
  loadSettings: () => Promise<void>
  saveSettings: () => Promise<void>
}

interface CachedUiSettings {
  themeIndex?: number
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  themeIndex: 0,
  managerRenames: {},
  loaded: false,

  setThemeIndex: (index) => set({ themeIndex: index }),

  setManagerRename: (original, name) =>
    set((state) => ({
      managerRenames: { ...state.managerRenames, [original]: name },
    })),

  applyTheme: (index) => {
    applyThemeVars(index)
    set({ themeIndex: index })
  },

  loadSettings: async () => {
    try {
      const settings = await fetchSettings()
      get().applyTheme(settings.themeIndex)
      set({
        themeIndex: settings.themeIndex,
        managerRenames: settings.managerRenames,
        loaded: true,
      })
      localStorage.setItem(
        STORAGE_KEYS.settings,
        JSON.stringify({ themeIndex: settings.themeIndex } satisfies CachedUiSettings),
      )
    } catch {
      const cached = localStorage.getItem(STORAGE_KEYS.settings)
      if (cached) {
        try {
          const parsed = JSON.parse(cached) as CachedUiSettings
          const themeIndex = parsed.themeIndex ?? 0
          get().applyTheme(themeIndex)
          set({ themeIndex, loaded: true })
          return
        } catch {
          /* fall through */
        }
      }
      get().applyTheme(0)
      set({ loaded: true })
    }
  },

  saveSettings: async () => {
    const { themeIndex, managerRenames } = get()
    localStorage.setItem(
      STORAGE_KEYS.settings,
      JSON.stringify({ themeIndex } satisfies CachedUiSettings),
    )
    await saveSettingsApi({ themeIndex, managerRenames })
  },
}))
