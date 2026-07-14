import { supabase } from '@/lib/supabaseClient'
import type { SavedMapView } from '@/lib/buildingMapView'
import { parsePortfolioMapView } from '@/lib/portfolioMapView'

export interface PortfolioSettings {
  themeIndex: number
  managerRenames: Record<string, string>
}

const PORTFOLIO_MAP_VIEW_KEY = 'portfolio_map_view'

export async function fetchSettings(): Promise<PortfolioSettings> {
  const { data, error } = await supabase.from('app_settings').select('key, value')
  if (error) throw error

  let themeIndex = 0
  const managerRenames: Record<string, string> = {}

  for (const row of data ?? []) {
    if (row.key === 'theme') {
      const value = row.value as { index?: number; name?: string }
      if (typeof value.index === 'number') themeIndex = value.index
      else if (value.name != null) {
        const parsed = Number.parseInt(String(value.name), 10)
        if (!Number.isNaN(parsed)) themeIndex = parsed
      }
    }
    if (row.key === 'managers') {
      const value = row.value as { renames?: Record<string, string> }
      if (value.renames && typeof value.renames === 'object') {
        Object.assign(managerRenames, value.renames)
      }
    }
  }

  return { themeIndex, managerRenames }
}

export async function saveThemeIndex(themeIndex: number): Promise<void> {
  const { error } = await supabase.from('app_settings').upsert(
    {
      key: 'theme',
      value: { index: themeIndex, name: String(themeIndex) },
    },
    { onConflict: 'key' },
  )
  if (error) throw error
}

export async function saveManagerRenames(managerRenames: Record<string, string>): Promise<void> {
  const { error } = await supabase.from('app_settings').upsert(
    {
      key: 'managers',
      value: { renames: managerRenames },
    },
    { onConflict: 'key' },
  )
  if (error) throw error
}

export async function saveSettings(settings: PortfolioSettings): Promise<void> {
  await Promise.all([
    saveThemeIndex(settings.themeIndex),
    saveManagerRenames(settings.managerRenames),
  ])
}

/** Load the saved All Buildings overview camera from app_settings. */
export async function fetchPortfolioMapView(): Promise<SavedMapView | null> {
  const { data, error } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', PORTFOLIO_MAP_VIEW_KEY)
    .maybeSingle()
  if (error) throw error
  return parsePortfolioMapView(data?.value)
}

/** Save or clear the All Buildings overview camera. */
export async function savePortfolioMapView(view: SavedMapView | null): Promise<void> {
  if (view == null) {
    const { error } = await supabase.from('app_settings').delete().eq('key', PORTFOLIO_MAP_VIEW_KEY)
    if (error) throw error
    return
  }
  const { error } = await supabase.from('app_settings').upsert(
    {
      key: PORTFOLIO_MAP_VIEW_KEY,
      value: {
        lat: view.lat,
        lng: view.lng,
        zoom: view.zoom,
        heading: view.heading,
        tilt: view.tilt,
        imageryMode: view.imageryMode,
      },
    },
    { onConflict: 'key' },
  )
  if (error) throw error
}
