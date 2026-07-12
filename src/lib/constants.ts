import type { CostBasis, ImageryMode, LayerKey, LayerStyle, UtilityType } from '@/types/domain'

export const PARK_COLORS: Record<string, string> = {
  'Dixie Business Park (x 34)': '#6b8fff',
  'East Business Park (x 22)': '#60c4f5',
  'Western Business Park (x 22)': '#a78bfa',
  'Meadowvale North Business Park (x 24)': '#34d399',
}

export const DEFAULT_PARK_COLOR = '#3d7fff'

export const DEFAULT_POLYGON_COLOR = '#60a5fa'

/** Preset polygon colours used across the portfolio (matches existing tenant polygons). */
export const POLYGON_DRAW_COLORS: ReadonlyArray<{ color: string; label: string }> = [
  { color: '#60a5fa', label: 'Blue' },
  { color: '#34d399', label: 'Green' },
  { color: '#38bdf8', label: 'Sky' },
  { color: '#a78bfa', label: 'Purple' },
  { color: '#fb923c', label: 'Orange' },
  { color: '#f97316', label: 'Deep orange' },
  { color: '#facc15', label: 'Yellow' },
  { color: '#f472b6', label: 'Pink' },
  { color: '#fb608e', label: 'Rose' },
]

export function polygonColorOptions(existing: Array<{ color: string }> = []): string[] {
  const seen = new Set<string>()
  const options: string[] = []
  for (const color of [
    ...POLYGON_DRAW_COLORS.map((entry) => entry.color),
    ...existing.map((polygon) => polygon.color),
  ]) {
    const normalized = color.trim().toLowerCase()
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    options.push(color)
  }
  return options
}

export function polygonColorLabel(color: string): string {
  const match = POLYGON_DRAW_COLORS.find(
    (entry) => entry.color.toLowerCase() === color.trim().toLowerCase(),
  )
  return match?.label ?? color
}

export const LAYER_COLORS: Record<LayerKey, LayerStyle> = {
  rtu: { fill: '#fbbf24', stroke: '#92400e', scale: 9 },
  polygons: { fill: '#34d399', stroke: '#065f46', scale: 6 },
  /** Tenant suite entrance gates — sky blue spheres. */
  inspection360: { fill: '#38bdf8', stroke: '#0c4a6e', scale: 10 },
  /** Sprinkler room 360° gates — yellow spheres. */
  sprinkler: { fill: '#eab308', stroke: '#854d0e', scale: 10 },
  /** Electrical room 360° gates — green spheres. */
  electrical: { fill: '#22c55e', stroke: '#14532d', scale: 10 },
  hydrant: { fill: '#f87171', stroke: '#7f1d1d', scale: 5 },
  gas: { fill: '#fb923c', stroke: '#7c2d12', scale: 5 },
}

export const UTILITY_LAYER_MAP: Record<UtilityType, LayerKey> = {
  'Sprinkler Rooms': 'sprinkler',
  'Electrical Rooms': 'electrical',
  'Fire Hydrants': 'hydrant',
  'Natural Gas Shut-Off': 'gas',
}

export const PLACEHOLDER_LAT = 43.5852972
export const PLACEHOLDER_LNG = -79.6449838

/** Hard cap for map zoom (includes digital zoom past native satellite tiles). */
export const MAP_MAX_ZOOM = 24
/** Extra integer zoom levels beyond Google's native satellite max at the current location. */
export const MAP_EXTRA_ZOOM_LEVELS = 3
/** Max visual scale when scroll-zooming past native satellite resolution. */
export const MAP_MAX_DIGITAL_SCALE = 2.5
/** Zoom used when panning to a building, RTU, polygon, or search hit. */
export const MAP_DETAIL_ZOOM = 21

/** Pixel size for 360° gate sphere markers on the map. */
export const INSPECTION360_MARKER_PX = 24
export const INSPECTION360_MARKER_PX_SELECTED = 30
/** Sprinkler / electrical spheres — 15% smaller than suite gates. */
export const UTILITY_360_MARKER_PX = Math.round(INSPECTION360_MARKER_PX * 0.85)
export const UTILITY_360_MARKER_PX_SELECTED = Math.round(INSPECTION360_MARKER_PX_SELECTED * 0.85)

export const RTU_AGE_WARN = 19
export const RTU_AGE_CRITICAL = 20

export const RCB_DEFAULT_THRESHOLD = 20
export const RCB_DEFAULT_BASIS: CostBasis = 'hyb'
export const RCB_DEFAULT_YEAR = '2026'

export const RCB_YEARS: Record<CostBasis, string[]> = {
  hyb: ['2026', '2027', '2028', '2029', '2030', '2031', '2032'],
  std: ['2025'],
}

export const IMAGERY_MODES: ImageryMode[] = [
  {
    id: 'google',
    label: '🛰 Google',
    color: 'rgb(167, 139, 250)',
    borderColor: 'rgb(167, 139, 250)',
  },
  {
    id: 'esri',
    label: '🛰 Esri',
    color: 'rgb(245, 158, 11)',
    borderColor: 'rgb(245, 158, 11)',
  },
]

export const ESRI_TILE_URL =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
