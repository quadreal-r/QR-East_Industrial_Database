import { readGoogleMapsEnv } from '@/lib/googleMaps'
import type { LatLng } from '@/types/domain'

export interface LatLngBounds {
  north: number
  south: number
  east: number
  west: number
}

interface GeoJsonPolygonCoordinates {
  type?: string
  coordinates: number[][][] | number[][][][]
}

interface GeocodeBuildingOutline {
  display_polygon?: GeoJsonPolygonCoordinates
}

interface GeocodeBuilding {
  building_outlines?: GeocodeBuildingOutline[]
}

interface GeocodeResult {
  buildings?: GeocodeBuilding[]
}

interface GeocodeJsonResponse {
  status: string
  results?: GeocodeResult[]
  error_message?: string
}

interface OsmNode {
  lat: number
  lon: number
}

interface OsmWay {
  geometry?: OsmNode[]
}

interface OsmResponse {
  elements?: OsmWay[]
}

declare global {
  interface Window {
    [key: string]: unknown
  }
}

/** GeoJSON ring [lng, lat] pairs → app LatLng (drops duplicate closing vertex). */
export function ringToLatLng(ring: number[][]): LatLng[] {
  if (ring.length < 3) return []
  const points: LatLng[] = []
  for (const pair of ring) {
    const lng = pair[0]
    const lat = pair[1]
    if (typeof lat !== 'number' || typeof lng !== 'number') continue
    points.push({ lat, lng })
  }
  if (points.length < 3) return []
  const first = points[0]!
  const last = points[points.length - 1]!
  if (first.lat === last.lat && first.lng === last.lng) {
    return points.slice(0, -1)
  }
  return points
}

export function parseOutlineCoordinates(displayPolygon: GeoJsonPolygonCoordinates): LatLng[] {
  const { coordinates, type } = displayPolygon
  if (!coordinates?.length) return []

  if (type === 'MultiPolygon' || Array.isArray(coordinates[0]?.[0]?.[0])) {
    const multi = coordinates as number[][][][]
    const firstPoly = multi[0]
    const outerRing = firstPoly?.[0]
    return outerRing ? ringToLatLng(outerRing) : []
  }

  const outerRing = (coordinates as number[][][])[0]
  return outerRing ? ringToLatLng(outerRing) : []
}

export function extractBuildingOutlines(result: GeocodeResult | undefined): LatLng[][] {
  if (!result?.buildings?.length) return []
  const outlines: LatLng[][] = []
  for (const building of result.buildings) {
    for (const outline of building.building_outlines ?? []) {
      if (!outline.display_polygon) continue
      const paths = parseOutlineCoordinates(outline.display_polygon)
      if (paths.length >= 3) outlines.push(paths)
    }
  }
  return outlines
}

export function polygonCentroid(paths: LatLng[]): LatLng {
  const lat = paths.reduce((sum, pt) => sum + pt.lat, 0) / paths.length
  const lng = paths.reduce((sum, pt) => sum + pt.lng, 0) / paths.length
  return { lat, lng }
}

export function polygonAreaSqDegrees(paths: LatLng[]): number {
  if (paths.length < 3) return 0
  let area = 0
  for (let i = 0; i < paths.length; i++) {
    const a = paths[i]!
    const b = paths[(i + 1) % paths.length]!
    area += a.lng * b.lat - b.lng * a.lat
  }
  return Math.abs(area / 2)
}

export function pointInBounds(point: LatLng, bounds: LatLngBounds, padding = 0): boolean {
  return (
    point.lat >= bounds.south - padding &&
    point.lat <= bounds.north + padding &&
    point.lng >= bounds.west - padding &&
    point.lng <= bounds.east + padding
  )
}

export function normalizeBounds(a: LatLng, b: LatLng): LatLngBounds {
  return {
    north: Math.max(a.lat, b.lat),
    south: Math.min(a.lat, b.lat),
    east: Math.max(a.lng, b.lng),
    west: Math.min(a.lng, b.lng),
  }
}

/** Prefer the largest outline whose centroid lies inside the drag selection. */
export function pickBestBuildingOutline(
  outlines: LatLng[][],
  selection: LatLngBounds,
): LatLng[] | null {
  let best: LatLng[] | null = null
  let bestArea = 0
  const pad = 0.00005

  for (const outline of outlines) {
    const centroid = polygonCentroid(outline)
    if (!pointInBounds(centroid, selection, pad)) continue
    const area = polygonAreaSqDegrees(outline)
    if (area > bestArea) {
      bestArea = area
      best = outline
    }
  }

  if (best) return best

  if (outlines.length === 1) return outlines[0] ?? null

  for (const outline of outlines) {
    const area = polygonAreaSqDegrees(outline)
    if (area > bestArea) {
      bestArea = area
      best = outline
    }
  }

  return best
}

function geocodeJsonp(lat: number, lng: number, apiKey: string): Promise<GeocodeJsonResponse> {
  return new Promise((resolve, reject) => {
    const callbackName = `bmeGeocode_${Date.now()}_${Math.random().toString(36).slice(2)}`
    let script: HTMLScriptElement | null = document.createElement('script')

    const cleanup = () => {
      delete window[callbackName]
      script?.remove()
      script = null
    }

    window[callbackName] = (data: GeocodeJsonResponse) => {
      cleanup()
      resolve(data)
    }

    script.onerror = () => {
      cleanup()
      reject(new Error('Building lookup request failed'))
    }

    const params = new URLSearchParams({
      latlng: `${lat},${lng}`,
      extra_computations: 'BUILDING_AND_ENTRANCES',
      key: apiKey,
      callback: callbackName,
    })
    script.src = `https://maps.googleapis.com/maps/api/geocode/json?${params.toString()}`
    document.head.appendChild(script)
  })
}

export async function fetchGoogleBuildingFootprint(
  lat: number,
  lng: number,
  selection: LatLngBounds,
): Promise<LatLng[] | null> {
  const { apiKey } = readGoogleMapsEnv()
  if (!apiKey) return null

  const data = await geocodeJsonp(lat, lng, apiKey)
  if (data.status !== 'OK' || !data.results?.length) return null

  for (const result of data.results) {
    const outlines = extractBuildingOutlines(result)
    const picked = pickBestBuildingOutline(outlines, selection)
    if (picked) return picked
  }

  return null
}

export async function fetchOsmBuildingFootprint(selection: LatLngBounds): Promise<LatLng[] | null> {
  const query = `[out:json][timeout:25];way["building"](${selection.south},${selection.west},${selection.north},${selection.east});out geom;`
  const response = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
    body: `data=${encodeURIComponent(query)}`,
  })
  if (!response.ok) return null

  const data = (await response.json()) as OsmResponse
  const ways = data.elements ?? []
  let best: LatLng[] | null = null
  let bestArea = 0

  for (const way of ways) {
    const geom = way.geometry
    if (!geom || geom.length < 3) continue
    const paths = geom.map((node) => ({ lat: node.lat, lng: node.lon }))
    const centroid = polygonCentroid(paths)
    if (!pointInBounds(centroid, selection)) continue
    const area = polygonAreaSqDegrees(paths)
    if (area > bestArea) {
      bestArea = area
      best = paths
    }
  }

  return best
}

export async function fetchBuildingFootprintInSelection(
  selection: LatLngBounds,
): Promise<LatLng[] | null> {
  const center = {
    lat: (selection.north + selection.south) / 2,
    lng: (selection.east + selection.west) / 2,
  }

  try {
    const googleOutline = await fetchGoogleBuildingFootprint(center.lat, center.lng, selection)
    if (googleOutline) return googleOutline
  } catch {
    // Fall through to OSM.
  }

  try {
    return await fetchOsmBuildingFootprint(selection)
  } catch {
    return null
  }
}
