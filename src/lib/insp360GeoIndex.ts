import {
  buildingForPolygon,
  findNearestBuildingByDistance,
  polygonCentroid,
} from '@/lib/polygonBuildings'
import type { PortfolioData, Utility } from '@/types/domain'

/** QR-360 viewer address DB shape (`geoIndex` / `#geoDbEmbedded`). */
export interface Insp360GeoBuilding {
  a: string
  p: string
  lat: number
  lng: number
  sf?: number
  /** Live RTU count from the main portfolio (preferred over embedded snapshots). */
  rtuCount?: number
  rtus?: Insp360GeoRtu[]
}

export interface Insp360GeoPolygon {
  a: string
  s: string
  t: string
  c: string
  clat: number
  clng: number
  path: Array<[number, number]>
}

export type Insp360GeoRoomType = 'electrical' | 'sprinkler' | 'hydrant' | 'gas'

export interface Insp360GeoRoom {
  a: string
  type: Insp360GeoRoomType
  name: string
  lat: number
  lng: number
}

export interface Insp360GeoRtu {
  a: string
  name: string
  lat: number
  lng: number
  description?: string
  model?: string | null
  make?: string | null
  serial?: string | null
}

export interface Insp360GeoIndex {
  source: string
  fileName?: string
  buildings: Insp360GeoBuilding[]
  polys: Insp360GeoPolygon[]
  rooms: Insp360GeoRoom[]
  /** Flat RTU list from the live main-program portfolio. */
  rtus: Insp360GeoRtu[]
  rtuTotal?: number
}

function parseSqft(sqft: string | null | undefined): number | undefined {
  if (!sqft?.trim()) return undefined
  const n = Number(String(sqft).replace(/[^0-9.]/g, ''))
  return Number.isFinite(n) && n > 0 ? n : undefined
}

function roomTypeForUtility(utility: Utility): Insp360GeoRoomType | null {
  if (utility.utility_type === 'Electrical Rooms') return 'electrical'
  if (utility.utility_type === 'Sprinkler Rooms') return 'sprinkler'
  if (utility.utility_type === 'Fire Hydrants') return 'hydrant'
  if (utility.utility_type === 'Natural Gas Shut-Off') return 'gas'
  return null
}

/** Convert live Building Map Explorer portfolio into the QR-360 viewer address DB. */
export function buildInsp360GeoIndex(portfolio: PortfolioData): Insp360GeoIndex {
  const rtus: Insp360GeoRtu[] = []
  const buildings: Insp360GeoBuilding[] = portfolio.buildings.map((building) => {
    const sf = parseSqft(building.sqft)
    const buildingRtus = (building.rtus || []).map((rtu) => ({
      a: building.address,
      name: rtu.name,
      lat: rtu.lat,
      lng: rtu.lng,
      description: rtu.description || '',
      model: rtu.model ?? null,
      make: rtu.make ?? null,
      serial: rtu.serial ?? null,
    }))
    for (const rtu of buildingRtus) rtus.push(rtu)
    return {
      a: building.address,
      p: building.park,
      lat: building.lat,
      lng: building.lng,
      ...(sf != null ? { sf } : {}),
      rtuCount: buildingRtus.length,
      ...(buildingRtus.length ? { rtus: buildingRtus } : {}),
    }
  })

  const polys: Insp360GeoPolygon[] = []
  for (const polygon of portfolio.polygons) {
    if (polygon.paths.length < 3) continue
    const building = buildingForPolygon(portfolio.buildings, polygon)
    if (!building) continue
    const center = polygonCentroid(polygon.paths)
    polys.push({
      a: building.address,
      s: polygon.name,
      t: polygon.description || '',
      c: polygon.color || '#60a5fa',
      clat: center.lat,
      clng: center.lng,
      path: polygon.paths.map((pt) => [pt.lat, pt.lng]),
    })
  }

  const rooms: Insp360GeoRoom[] = []
  for (const utility of portfolio.utilities) {
    const type = roomTypeForUtility(utility)
    if (!type) continue
    const nearest = findNearestBuildingByDistance(portfolio.buildings, utility.lat, utility.lng)
    const address = nearest?.building.address ?? utility.description?.trim() ?? ''
    if (!address) continue
    rooms.push({
      a: address,
      type,
      name: utility.name,
      lat: utility.lat,
      lng: utility.lng,
    })
  }

  return {
    source: 'Building Map Explorer (live Supabase portfolio)',
    fileName: 'QR-East_Industrial_Database-portfolio',
    buildings,
    polys,
    rooms,
    rtus,
    rtuTotal: rtus.length,
  }
}

export const INSP360_GEO_REQUEST = 'insp360:requestGeoIndex'
export const INSP360_GEO_RESPONSE = 'insp360:setGeoIndex'
