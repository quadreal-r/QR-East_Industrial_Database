/** Application domain types (normalized from DB rows or legacy JSON). */

import { isLegacySuiteMarkerName } from '@/lib/legacySuiteMarkers'
import { mergePortfolioSuiteEntrances } from '@/lib/suiteEntrances'

export type LayerKey =
  | 'rtu'
  | 'polygons'
  | 'inspection360'
  | 'sprinkler'
  | 'electrical'
  | 'hydrant'
  | 'gas'

export type UtilityType =
  | 'Sprinkler Rooms'
  | 'Electrical Rooms'
  | 'Fire Hydrants'
  | 'Natural Gas Shut-Off'

export type AdvFilterValue = 'any' | 'yes' | 'no'

export type CostBasis = 'hyb' | 'std'

export type ImageryModeId = 'google' | 'esri'

export interface LatLng {
  lat: number
  lng: number
}

export interface Rtu {
  id?: number
  building_id?: number
  name: string
  description: string
  lat: number
  lng: number
  model?: string | null
  serial?: string | null
  make?: string | null
  install_date?: string | null
  install_year?: number | null
  heating_btu?: string | null
  cooling_tons?: number | null
  suite?: string | null
  marker_shape?: number
  marker_scale?: number
}

export interface Building {
  id?: number
  park: string
  address: string
  bu: string
  lat: number
  lng: number
  sqft: string
  cluster: string
  manager: string
  notes?: string | null
  sold?: boolean
  /** Saved map camera for this building (center/zoom/rotation); null = no saved view. */
  mapLat?: number | null
  mapLng?: number | null
  mapZoom?: number | null
  mapHeading?: number | null
  mapTilt?: number | null
  /** Saved imagery provider: google or esri. */
  mapImageryMode?: ImageryModeId | null
  rtus?: Rtu[]
}

export interface Utility {
  id?: number
  utility_type: UtilityType
  name: string
  description: string
  lat: number
  lng: number
  /** QR-360° tour URL for electrical / sprinkler room gates. */
  inspection_url?: string | null
  marker_shape?: number
  marker_scale?: number
}

export interface Polygon {
  id?: number
  name: string
  description: string
  color: string
  paths: LatLng[]
}

/** Suite entrance gate for QR-360°-Inspections virtual tours (stored in `tenants` table). */
export interface SuiteEntrance {
  id?: number
  building_id?: number
  polygon_id?: number | null
  name: string
  description: string
  lat: number
  lng: number
  /** QR-360°-Inspections tour URL — connected in a future session. */
  inspection_url?: string | null
  /**
   * True only while this gate still sits at its auto-computed facade
   * position and has never been manually dragged or placed. Cleared to
   * false the moment a user moves it, so later portfolio updates never
   * snap a manual placement back to the default spot.
   */
  auto_placed?: boolean
}

export interface LayerStyle {
  fill: string
  stroke: string
  scale: number
}

export interface AppSettings {
  theme: { name: string }
  managers: string[]
}

export interface AdvFilterState {
  vacant: AdvFilterValue
  rtu: AdvFilterValue
  hasrtu: AdvFilterValue
  ml: AdvFilterValue
}

export interface DqFilterState {
  gps: boolean
  rtu: boolean
  vacant: boolean
  ml: boolean
}

export interface FilterState {
  search: string
  park: string
  cluster: string
  manager: string
  adv: AdvFilterState
  dq: DqFilterState
}

export interface PortfolioMapViewFields {
  mapLat: number | null
  mapLng: number | null
  mapZoom: number | null
  mapHeading: number | null
  mapTilt: number | null
  mapImageryMode: ImageryModeId | null
}

export interface PortfolioData {
  buildings: Building[]
  utilities: Utility[]
  polygons: Polygon[]
  suiteEntrances: SuiteEntrance[]
  /** Saved map cameras keyed by `${park}|${cluster}|${manager}`. */
  portfolioMapViews?: Record<string, PortfolioMapViewFields>
}

export interface ImageryMode {
  id: ImageryModeId
  label: string
  color: string
  borderColor: string
}

/** Legacy JSON snapshot shape (nested rtus use `desc`). */
export interface LegacyRtuJson {
  name: string
  desc: string
  lat: number
  lng: number
}

export interface LegacyBuildingJson {
  park: string
  address: string
  bu: string
  lat: number
  lng: number
  sqft: string
  cluster: string
  manager: string
  notes?: string
  sold?: boolean
  rtus?: LegacyRtuJson[]
}

export interface LegacyUtilityJson {
  type: UtilityType
  name: string
  desc: string
  lat: number
  lng: number
}

export interface LegacyPolygonJson {
  name: string
  desc: string
  color: string
  paths: LatLng[]
}

export function normalizeBuilding(building: Building): Building {
  if (!building.rtus?.length) return building
  const rtus = building.rtus.filter((r) => !isLegacySuiteMarkerName(r.name))
  return { ...building, rtus }
}

export function normalizePortfolioData(portfolio: PortfolioData): PortfolioData {
  return mergePortfolioSuiteEntrances({
    ...portfolio,
    portfolioMapViews: portfolio.portfolioMapViews ?? {},
    suiteEntrances: portfolio.suiteEntrances ?? [],
    buildings: portfolio.buildings.map(normalizeBuilding),
  })
}

export function normalizeLegacyBuilding(raw: LegacyBuildingJson): Building {
  return normalizeBuilding({
    park: raw.park,
    address: raw.address,
    bu: raw.bu,
    lat: raw.lat,
    lng: raw.lng,
    sqft: raw.sqft,
    cluster: raw.cluster,
    manager: raw.manager,
    notes: raw.notes ?? null,
    sold: raw.sold,
    rtus: (raw.rtus ?? [])
      .filter((r) => !isLegacySuiteMarkerName(r.name))
      .map((r) => ({
        name: r.name,
        description: r.desc,
        lat: r.lat,
        lng: r.lng,
      })),
  })
}

export function normalizeLegacyUtility(raw: LegacyUtilityJson): Utility {
  return {
    utility_type: raw.type,
    name: raw.name,
    description: raw.desc,
    lat: raw.lat,
    lng: raw.lng,
  }
}

export function normalizeLegacyPolygon(raw: LegacyPolygonJson): Polygon {
  return {
    name: raw.name,
    description: raw.desc,
    color: raw.color,
    paths: raw.paths,
  }
}

export const DEFAULT_ADV_FILTERS: AdvFilterState = {
  vacant: 'any',
  rtu: 'any',
  hasrtu: 'any',
  ml: 'any',
}

export const DEFAULT_DQ_FILTERS: DqFilterState = {
  gps: false,
  rtu: false,
  vacant: false,
  ml: false,
}

export const DEFAULT_FILTER_STATE: FilterState = {
  search: '',
  park: '',
  cluster: '',
  manager: '',
  adv: DEFAULT_ADV_FILTERS,
  dq: DEFAULT_DQ_FILTERS,
}
