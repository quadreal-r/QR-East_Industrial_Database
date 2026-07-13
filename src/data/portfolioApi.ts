import type { Json, Tables } from '@/types/database.types'
import type {
  Building,
  ImageryModeId,
  LatLng,
  Polygon,
  PortfolioData,
  Rtu,
  SuiteEntrance,
  Utility,
  UtilityType,
} from '@/types/domain'
import { normalizePortfolioData } from '@/types/domain'
import { computePortfolioChanges } from '@/features/edit-mode/diffPortfolio'
import { supabase } from '@/lib/supabaseClient'
import { fetchAllPages } from '@/lib/supabasePager'

type BuildingRow = Tables<'buildings'>
type RtuRow = Tables<'rtus'>
type UtilityRow = Tables<'utilities'>
type PolygonRow = Tables<'polygons'>
type TenantRow = Tables<'tenants'>

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
    buildingOperator: row.building_operator,
    operatorPhone: row.operator_phone,
    opsManager: row.ops_manager,
    gmOps: row.gm_ops,
    vp: row.vp,
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
    inspection_url: row.inspection_url,
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

function rowToSuiteEntrance(row: TenantRow): SuiteEntrance {
  return {
    id: row.id,
    building_id: row.building_id,
    polygon_id: row.polygon_id,
    name: row.name,
    description: row.description ?? '',
    lat: row.lat,
    lng: row.lng,
    inspection_url: row.inspection_url,
    auto_placed: row.auto_placed,
  }
}

export async function fetchPortfolio(): Promise<PortfolioData> {
  const [buildingsRows, rtusRows, utilitiesRows, polygonsRows, tenantsRows] = await Promise.all([
    fetchAllPages<BuildingRow>(async (from, to) =>
      supabase.from('buildings').select('*').order('address').range(from, to),
    ),
    fetchAllPages<RtuRow>(async (from, to) => supabase.from('rtus').select('*').range(from, to)),
    fetchAllPages<UtilityRow>(async (from, to) =>
      supabase.from('utilities').select('*').order('name').range(from, to),
    ),
    fetchAllPages<PolygonRow>(async (from, to) =>
      supabase.from('polygons').select('*').order('name').range(from, to),
    ),
    fetchAllPages<TenantRow>(async (from, to) => supabase.from('tenants').select('*').range(from, to)),
  ])

  const rtusByBuilding = new Map<number, RtuRow[]>()
  for (const rtu of rtusRows) {
    const list = rtusByBuilding.get(rtu.building_id) ?? []
    list.push(rtu)
    rtusByBuilding.set(rtu.building_id, list)
  }

  const buildings = buildingsRows.map((row) => rowToBuilding(row, rtusByBuilding.get(row.id) ?? []))

  return normalizePortfolioData({
    buildings,
    utilities: utilitiesRows.map(rowToUtility),
    polygons: polygonsRows.map(rowToPolygon),
    suiteEntrances: tenantsRows.map(rowToSuiteEntrance),
  })
}

function buildingCorePayload(building: Building) {
  return {
    park: building.park,
    address: building.address,
    bu: building.bu || null,
    lat: building.lat,
    lng: building.lng,
    sqft: building.sqft || null,
    cluster: building.cluster || null,
    manager: building.manager || null,
    building_operator: building.buildingOperator || null,
    operator_phone: building.operatorPhone || null,
    ops_manager: building.opsManager || null,
    gm_ops: building.gmOps || null,
    vp: building.vp || null,
    notes: building.notes ?? null,
    sold: building.sold ?? false,
    ...buildingMapViewPayload(building),
  }
}

export async function upsertBuilding(building: Building): Promise<Building> {
  const payload = buildingCorePayload(building)

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

  const payload = buildingCorePayload(building)

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
    inspection_url: utility.inspection_url?.trim() || null,
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

  if (polygon.id != null) {
    const { data, error } = await supabase
      .from('polygons')
      .update(payload)
      .eq('id', polygon.id)
      .select('*')
      .maybeSingle()
    if (error) throw error
    if (data) return rowToPolygon(data)
    throw new Error(`Polygon #${polygon.id} was not found — cannot update a missing row.`)
  }

  const { data, error } = await supabase.from('polygons').insert(payload).select('*').single()
  if (error) throw error
  return rowToPolygon(data)
}

export async function deletePolygon(id: number): Promise<void> {
  const { error } = await supabase.from('polygons').delete().eq('id', id)
  if (error) throw error
}

export async function upsertSuiteEntrance(
  entrance: SuiteEntrance & { building_id: number },
): Promise<SuiteEntrance> {
  const payload = {
    building_id: entrance.building_id,
    polygon_id: entrance.polygon_id ?? null,
    name: entrance.name,
    description: entrance.description || null,
    lat: entrance.lat,
    lng: entrance.lng,
    inspection_url: entrance.inspection_url ?? null,
    auto_placed: entrance.auto_placed !== false,
  }

  if (entrance.id) {
    const { data, error } = await supabase
      .from('tenants')
      .update(payload)
      .eq('id', entrance.id)
      .select('*')
      .single()
    if (error) throw error
    return rowToSuiteEntrance(data)
  }

  const { data, error } = await supabase.from('tenants').insert(payload).select('*').single()
  if (error) throw error
  return rowToSuiteEntrance(data)
}

export async function deleteSuiteEntrance(id: number): Promise<void> {
  const { error } = await supabase.from('tenants').delete().eq('id', id)
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
  // Upsert first so suite gates can keep valid polygon_id links.
  for (const polygon of normalized.polygons) {
    await upsertPolygon(polygon)
  }

  const existingEntrances = await supabase.from('tenants').select('id')
  if (existingEntrances.error) throw existingEntrances.error
  const nextEntranceIds = new Set(
    normalized.suiteEntrances.map((e) => e.id).filter((id): id is number => id != null),
  )
  for (const row of existingEntrances.data ?? []) {
    if (!nextEntranceIds.has(row.id)) {
      await deleteSuiteEntrance(row.id)
    }
  }
  for (const entrance of normalized.suiteEntrances) {
    if (entrance.building_id == null) continue
    await upsertSuiteEntrance({ ...entrance, building_id: entrance.building_id })
  }

  for (const row of existingPolygons.data ?? []) {
    if (!nextPolygonIds.has(row.id)) {
      await deletePolygon(row.id)
    }
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

  // Upsert polygons BEFORE deletes so suite gates can keep a valid polygon_id.
  const deletedPolygonIds = new Set(changes.polygonIdsToDelete)
  const baselinePolygonById = new Map(
    baseline.polygons.filter((p) => p.id != null).map((p) => [p.id!, p]),
  )
  const savedPolygonIdByKey = new Map<string, number>()

  for (const polygon of changes.polygonsToUpsert) {
    const saved = await upsertPolygon(polygon)
    if (saved.id != null) {
      savedPolygonIdByKey.set(polygonKey(saved.name, saved.description), saved.id)
    }
  }

  for (const id of changes.suiteEntranceIdsToDelete) {
    await deleteSuiteEntrance(id)
  }

  for (const entrance of changes.suiteEntrancesToUpsert) {
    await upsertSuiteEntrance(
      remapSuiteEntrancePolygonId(entrance, {
        deletedPolygonIds,
        baselinePolygonById,
        savedPolygonIdByKey,
      }),
    )
  }

  for (const id of changes.polygonIdsToDelete) {
    await deletePolygon(id)
  }

  return fetchPortfolio()
}

function polygonKey(name: string, description: string | null | undefined): string {
  return `${name}\0${description ?? ''}`
}

/**
 * If a gate still points at a polygon row that is about to be deleted, point it
 * at the replacement polygon (same name) or clear the link.
 */
export function remapSuiteEntrancePolygonId<T extends SuiteEntrance>(
  entrance: T,
  options: {
    deletedPolygonIds: Set<number>
    baselinePolygonById: Map<number, Polygon>
    savedPolygonIdByKey: Map<string, number>
  },
): T {
  const polygonId = entrance.polygon_id ?? null
  if (polygonId == null || !options.deletedPolygonIds.has(polygonId)) {
    return entrance
  }

  const oldPolygon = options.baselinePolygonById.get(polygonId)
  const key = oldPolygon
    ? polygonKey(oldPolygon.name, oldPolygon.description)
    : polygonKey(entrance.name, entrance.description)
  const remapped =
    options.savedPolygonIdByKey.get(key) ??
    options.savedPolygonIdByKey.get(polygonKey(entrance.name, entrance.description)) ??
    null

  return { ...entrance, polygon_id: remapped }
}
