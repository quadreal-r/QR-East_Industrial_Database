import type { Json, Tables } from '@/types/database.types'
import type {
  Building,
  ImageryModeId,
  LatLng,
  Polygon,
  PortfolioData,
  PortfolioMapViewFields,
  Rtu,
  Utility,
  UtilityType,
} from '@/types/domain'
import { normalizePortfolioData } from '@/types/domain'
import { computePortfolioChanges } from '@/features/edit-mode/diffPortfolio'
import { supabase } from '@/lib/supabaseClient'

type BuildingRow = Tables<'buildings'>
type RtuRow = Tables<'rtus'>
type UtilityRow = Tables<'utilities'>
type PolygonRow = Tables<'polygons'>
type PortfolioMapViewRow = Tables<'portfolio_map_views'>

function rowToRtu(row: RtuRow): Rtu {
  return {
    id: row.id,
    building_id: row.building_id,
    name: row.name,
    description: row.description ?? '',
    lat: row.lat,
    lng: row.lng,
    model: row.model,
    serial: row.serial,
    make: row.make,
    install_date: row.install_date,
    install_year: row.install_year,
    heating_btu: row.heating_btu,
    cooling_tons: row.cooling_tons,
    suite: row.suite,
  }
}

function rowToBuilding(row: BuildingRow, rtus: RtuRow[]): Building {
  return {
    id: row.id,
    park: row.park,
    address: row.address,
    bu: row.bu ?? '',
    lat: row.lat,
    lng: row.lng,
    sqft: row.sqft ?? '',
    cluster: row.cluster ?? '',
    manager: row.manager ?? '',
    notes: row.notes,
    sold: row.sold,
    mapLat: row.map_lat,
    mapLng: row.map_lng,
    mapZoom: row.map_zoom,
    mapHeading: row.map_heading,
    mapTilt: row.map_tilt,
    mapImageryMode: parseMapImageryMode(row.map_imagery_mode),
    rtus: rtus.map(rowToRtu),
  }
}

/**
 * Saved map-view columns for a building, only including keys that are explicitly set
 * so bulk imports (which omit them) never wipe an existing saved view.
 */
function parseMapImageryMode(value: string | null | undefined): ImageryModeId | null {
  if (value === 'google' || value === 'esri') return value
  return null
}

function buildingMapViewPayload(building: Building): Record<string, number | string | null> {
  const payload: Record<string, number | string | null> = {}
  if (building.mapLat !== undefined) payload.map_lat = building.mapLat
  if (building.mapLng !== undefined) payload.map_lng = building.mapLng
  if (building.mapZoom !== undefined) payload.map_zoom = building.mapZoom
  if (building.mapHeading !== undefined) payload.map_heading = building.mapHeading
  if (building.mapTilt !== undefined) payload.map_tilt = building.mapTilt
  if (building.mapImageryMode !== undefined) payload.map_imagery_mode = building.mapImageryMode
  return payload
}

function rowToUtility(row: UtilityRow): Utility {
  return {
    id: row.id,
    utility_type: row.utility_type as UtilityType,
    name: row.name,
    description: row.description ?? '',
    lat: row.lat,
    lng: row.lng,
  }
}

function rowToPolygon(row: PolygonRow): Polygon {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? '',
    color: row.color,
    paths: row.paths as unknown as LatLng[],
  }
}

function rowToPortfolioMapView(row: PortfolioMapViewRow): [string, PortfolioMapViewFields] {
  return [
    row.filter_key,
    {
      mapLat: row.map_lat,
      mapLng: row.map_lng,
      mapZoom: row.map_zoom,
      mapHeading: row.map_heading,
      mapTilt: row.map_tilt,
      mapImageryMode: parseMapImageryMode(row.map_imagery_mode),
    },
  ]
}

export async function fetchPortfolio(): Promise<PortfolioData> {
  const [buildingsRes, rtusRes, utilitiesRes, polygonsRes, mapViewsRes] = await Promise.all([
    supabase.from('buildings').select('*').order('address'),
    supabase.from('rtus').select('*'),
    supabase.from('utilities').select('*').order('name'),
    supabase.from('polygons').select('*').order('name'),
    supabase.from('portfolio_map_views').select('*'),
  ])

  if (buildingsRes.error) throw buildingsRes.error
  if (rtusRes.error) throw rtusRes.error
  if (utilitiesRes.error) throw utilitiesRes.error
  if (polygonsRes.error) throw polygonsRes.error
  if (mapViewsRes.error) throw mapViewsRes.error

  const rtusByBuilding = new Map<number, RtuRow[]>()
  for (const rtu of rtusRes.data ?? []) {
    const list = rtusByBuilding.get(rtu.building_id) ?? []
    list.push(rtu)
    rtusByBuilding.set(rtu.building_id, list)
  }

  const buildings = (buildingsRes.data ?? []).map((row) =>
    rowToBuilding(row, rtusByBuilding.get(row.id) ?? []),
  )

  const portfolioMapViews = Object.fromEntries(
    (mapViewsRes.data ?? []).map(rowToPortfolioMapView),
  )

  return normalizePortfolioData({
    buildings,
    utilities: (utilitiesRes.data ?? []).map(rowToUtility),
    polygons: (polygonsRes.data ?? []).map(rowToPolygon),
    portfolioMapViews,
  })
}

export async function upsertBuilding(building: Building): Promise<Building> {
  const payload = {
    park: building.park,
    address: building.address,
    bu: building.bu || null,
    lat: building.lat,
    lng: building.lng,
    sqft: building.sqft || null,
    cluster: building.cluster || null,
    manager: building.manager || null,
    notes: building.notes ?? null,
    sold: building.sold ?? false,
    ...buildingMapViewPayload(building),
  }

  let buildingId = building.id
  if (buildingId) {
    const { error } = await supabase.from('buildings').update(payload).eq('id', buildingId)
    if (error) throw error
  } else {
    const { data, error } = await supabase.from('buildings').insert(payload).select('*').single()
    if (error) throw error
    buildingId = data.id
  }

  const rtus = building.rtus ?? []
  for (const rtu of rtus) {
    await upsertRtu({ ...rtu, building_id: buildingId })
  }

  return { ...building, id: buildingId }
}

async function updateBuildingOnly(building: Building): Promise<void> {
  if (building.id == null) {
    throw new Error('Cannot update building without id')
  }

  const payload = {
    park: building.park,
    address: building.address,
    bu: building.bu || null,
    lat: building.lat,
    lng: building.lng,
    sqft: building.sqft || null,
    cluster: building.cluster || null,
    manager: building.manager || null,
    notes: building.notes ?? null,
    sold: building.sold ?? false,
    ...buildingMapViewPayload(building),
  }

  const { error } = await supabase.from('buildings').update(payload).eq('id', building.id)
  if (error) throw error
}

export interface BuildingMapView {
  lat: number
  lng: number
  zoom: number
  heading: number
  tilt: number
  imageryMode: ImageryModeId | null
}

/** Save (or clear when `view` is null) a building's map camera directly. */
export async function saveBuildingMapView(
  buildingId: number,
  view: BuildingMapView | null,
): Promise<void> {
  const payload = view
    ? {
        map_lat: view.lat,
        map_lng: view.lng,
        map_zoom: view.zoom,
        map_heading: view.heading,
        map_tilt: view.tilt,
        map_imagery_mode: view.imageryMode,
      }
    : {
        map_lat: null,
        map_lng: null,
        map_zoom: null,
        map_heading: null,
        map_tilt: null,
        map_imagery_mode: null,
      }

  const { error } = await supabase.from('buildings').update(payload).eq('id', buildingId)
  if (error) throw error
}

/** Save (or clear when `view` is null) a portfolio filter's map camera. */
export async function savePortfolioMapView(
  filterKey: string,
  view: BuildingMapView | null,
): Promise<void> {
  if (view) {
    const payload = {
      filter_key: filterKey,
      map_lat: view.lat,
      map_lng: view.lng,
      map_zoom: view.zoom,
      map_heading: view.heading,
      map_tilt: view.tilt,
      map_imagery_mode: view.imageryMode,
      updated_at: new Date().toISOString(),
    }
    const { error } = await supabase.from('portfolio_map_views').upsert(payload, {
      onConflict: 'filter_key',
    })
    if (error) throw error
    return
  }

  const { error } = await supabase.from('portfolio_map_views').delete().eq('filter_key', filterKey)
  if (error) throw error
}

export async function upsertRtu(rtu: Rtu & { building_id: number }): Promise<Rtu> {
  const payload = {
    building_id: rtu.building_id,
    name: rtu.name,
    description: rtu.description || null,
    lat: rtu.lat,
    lng: rtu.lng,
    model: rtu.model ?? null,
    serial: rtu.serial ?? null,
    make: rtu.make ?? null,
    install_date: rtu.install_date ?? null,
    install_year: rtu.install_year ?? null,
    heating_btu: rtu.heating_btu ?? null,
    cooling_tons: rtu.cooling_tons ?? null,
    suite: rtu.suite ?? null,
  }

  if (rtu.id) {
    const { data, error } = await supabase
      .from('rtus')
      .update(payload)
      .eq('id', rtu.id)
      .select('*')
      .single()
    if (error) throw error
    return rowToRtu(data)
  }

  const { data, error } = await supabase.from('rtus').insert(payload).select('*').single()
  if (error) throw error
  return rowToRtu(data)
}

export async function deleteRtu(id: number): Promise<void> {
  const { error } = await supabase.from('rtus').delete().eq('id', id)
  if (error) throw error
}

export async function upsertUtility(utility: Utility): Promise<Utility> {
  const payload = {
    utility_type: utility.utility_type,
    name: utility.name,
    description: utility.description || null,
    lat: utility.lat,
    lng: utility.lng,
  }

  if (utility.id) {
    const { data, error } = await supabase
      .from('utilities')
      .update(payload)
      .eq('id', utility.id)
      .select('*')
      .single()
    if (error) throw error
    return rowToUtility(data)
  }

  const { data, error } = await supabase.from('utilities').insert(payload).select('*').single()
  if (error) throw error
  return rowToUtility(data)
}

export async function deleteUtility(id: number): Promise<void> {
  const { error } = await supabase.from('utilities').delete().eq('id', id)
  if (error) throw error
}

export async function upsertPolygon(polygon: Polygon): Promise<Polygon> {
  const payload = {
    name: polygon.name,
    description: polygon.description || null,
    color: polygon.color,
    paths: polygon.paths as unknown as Json,
  }

  if (polygon.id) {
    const { data, error } = await supabase
      .from('polygons')
      .update(payload)
      .eq('id', polygon.id)
      .select('*')
      .single()
    if (error) throw error
    return rowToPolygon(data)
  }

  const { data, error } = await supabase.from('polygons').insert(payload).select('*').single()
  if (error) throw error
  return rowToPolygon(data)
}

export async function deletePolygon(id: number): Promise<void> {
  const { error } = await supabase.from('polygons').delete().eq('id', id)
  if (error) throw error
}

/** Replace the full portfolio in Supabase (used by Excel import and bulk edits). */
export async function savePortfolio(portfolio: PortfolioData): Promise<PortfolioData> {
  const normalized = normalizePortfolioData(portfolio)

  const existingBuildings = await supabase.from('buildings').select('id, address')
  if (existingBuildings.error) throw existingBuildings.error

  const existingByAddress = new Map(
    (existingBuildings.data ?? []).map((row) => [row.address, row.id]),
  )
  const nextAddresses = new Set(normalized.buildings.map((b) => b.address))

  for (const building of normalized.buildings) {
    const id = building.id ?? existingByAddress.get(building.address)
    await upsertBuilding({ ...building, id })
  }

  for (const [address, id] of existingByAddress) {
    if (!nextAddresses.has(address)) {
      await supabase.from('buildings').delete().eq('id', id)
    }
  }

  const existingUtilities = await supabase.from('utilities').select('id')
  if (existingUtilities.error) throw existingUtilities.error
  const nextUtilityIds = new Set(
    normalized.utilities.map((u) => u.id).filter((id): id is number => id != null),
  )
  for (const row of existingUtilities.data ?? []) {
    if (!nextUtilityIds.has(row.id)) {
      await deleteUtility(row.id)
    }
  }
  for (const utility of normalized.utilities) {
    await upsertUtility(utility)
  }

  const existingPolygons = await supabase.from('polygons').select('id')
  if (existingPolygons.error) throw existingPolygons.error
  const nextPolygonIds = new Set(
    normalized.polygons.map((p) => p.id).filter((id): id is number => id != null),
  )
  for (const row of existingPolygons.data ?? []) {
    if (!nextPolygonIds.has(row.id)) {
      await deletePolygon(row.id)
    }
  }
  for (const polygon of normalized.polygons) {
    await upsertPolygon(polygon)
  }

  return fetchPortfolio()
}

/** Apply only pending portfolio edits (staged map/notes changes). */
export async function savePortfolioChanges(
  baseline: PortfolioData,
  pending: PortfolioData,
): Promise<PortfolioData> {
  const normalizedPending = normalizePortfolioData(pending)
  const changes = computePortfolioChanges(baseline, normalizedPending)

  for (const id of changes.buildingIdsToDelete) {
    await supabase.from('buildings').delete().eq('id', id)
  }

  for (const building of changes.buildingsToInsert) {
    await upsertBuilding(building)
  }

  for (const building of changes.buildingsToUpdate) {
    await updateBuildingOnly(building)
  }

  for (const id of changes.rtuIdsToDelete) {
    await deleteRtu(id)
  }

  for (const rtu of changes.rtusToUpsert) {
    await upsertRtu(rtu)
  }

  for (const id of changes.utilityIdsToDelete) {
    await deleteUtility(id)
  }

  for (const utility of changes.utilitiesToUpsert) {
    await upsertUtility(utility)
  }

  for (const id of changes.polygonIdsToDelete) {
    await deletePolygon(id)
  }

  for (const polygon of changes.polygonsToUpsert) {
    await upsertPolygon(polygon)
  }

  return fetchPortfolio()
}
