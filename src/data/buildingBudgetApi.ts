import { buildingYearBudgetKey } from '@/lib/buildingYearBudget'
import { supabase } from '@/lib/supabaseClient'

export interface BuildingYearBudgetData {
  pots: Record<string, number>
  notes: Record<string, string>
  statuses: Record<string, string>
  jobTypes: Record<string, string>
}

/** Fetch all building-year Capex pots, notes, statuses, and job types keyed by `address::year`. */
export async function fetchBuildingYearBudgets(): Promise<BuildingYearBudgetData> {
  const { data: buildings, error: buildingsError } = await supabase
    .from('buildings')
    .select('id, address')
  if (buildingsError) throw buildingsError

  const addressById = new Map((buildings ?? []).map((b) => [b.id, b.address]))

  const { data: rows, error } = await supabase
    .from('building_year_budgets')
    .select('building_id, year, budget, note, capex_status, capex_job_project_type')
  if (error) throw error

  const pots: Record<string, number> = {}
  const notes: Record<string, string> = {}
  const statuses: Record<string, string> = {}
  const jobTypes: Record<string, string> = {}
  for (const row of rows ?? []) {
    const address = addressById.get(row.building_id)
    if (!address) continue
    const amount = Number(row.budget)
    if (!Number.isFinite(amount) || amount <= 0) continue
    const key = buildingYearBudgetKey(address, row.year)
    pots[key] = Math.round(amount)
    const note = row.note?.trim()
    if (note) notes[key] = note
    const status = row.capex_status?.trim()
    if (status) statuses[key] = status
    const jobType = row.capex_job_project_type?.trim()
    if (jobType) jobTypes[key] = jobType
  }
  return { pots, notes, statuses, jobTypes }
}

export async function upsertBuildingYearBudget(
  address: string,
  year: string,
  budget: number | null,
  note?: string | null,
): Promise<void> {
  const { data: building, error: buildingError } = await supabase
    .from('buildings')
    .select('id')
    .eq('address', address)
    .maybeSingle()
  if (buildingError) throw buildingError
  if (!building) throw new Error(`Building not found: ${address}`)

  const yearNum = Number.parseInt(year, 10)
  if (!Number.isFinite(yearNum)) throw new Error(`Invalid year: ${year}`)

  if (budget == null || budget <= 0) {
    const { error } = await supabase
      .from('building_year_budgets')
      .delete()
      .eq('building_id', building.id)
      .eq('year', yearNum)
    if (error) throw error
    return
  }

  const row: {
    building_id: number
    year: number
    budget: number
    note?: string | null
  } = {
    building_id: building.id,
    year: yearNum,
    budget: Math.round(budget),
  }
  if (note !== undefined) {
    row.note = note?.trim() || null
  }

  const { error } = await supabase.from('building_year_budgets').upsert(row, {
    onConflict: 'building_id,year',
  })
  if (error) throw error
}

/** Update Capex pot note / status / job type for a building-year (leaves budget alone). */
export async function upsertBuildingYearBudgetNote(
  address: string,
  year: string,
  note: string | null,
  status?: string | null,
  jobType?: string | null,
): Promise<void> {
  const { data: building, error: buildingError } = await supabase
    .from('buildings')
    .select('id')
    .eq('address', address)
    .maybeSingle()
  if (buildingError) throw buildingError
  if (!building) throw new Error(`Building not found: ${address}`)

  const yearNum = Number.parseInt(year, 10)
  if (!Number.isFinite(yearNum)) throw new Error(`Invalid year: ${year}`)

  const trimmed = note?.trim() || null
  const { data: existing, error: findError } = await supabase
    .from('building_year_budgets')
    .select('id, budget')
    .eq('building_id', building.id)
    .eq('year', yearNum)
    .maybeSingle()
  if (findError) throw findError

  if (!existing) {
    if (!trimmed) return
    throw new Error(`No Capex pot for ${address} ${year} to attach note`)
  }

  const update: {
    note: string | null
    capex_status?: string | null
    capex_job_project_type?: string | null
  } = { note: trimmed }
  if (status !== undefined) {
    update.capex_status = status?.trim() || null
  }
  if (jobType !== undefined) {
    update.capex_job_project_type = jobType?.trim() || null
  }

  const { error } = await supabase
    .from('building_year_budgets')
    .update(update)
    .eq('id', existing.id)
  if (error) throw error
}

/** Replace all building-year pots (used by Capex import). */
export async function replaceAllBuildingYearBudgets(
  pots: Record<string, number>,
  notes: Record<string, string> = {},
  statuses: Record<string, string> = {},
  jobTypes: Record<string, string> = {},
): Promise<number> {
  const { data: buildings, error: buildingsError } = await supabase
    .from('buildings')
    .select('id, address')
  if (buildingsError) throw buildingsError

  const idByAddress = new Map((buildings ?? []).map((b) => [b.address, b.id]))

  const { error: clearError } = await supabase
    .from('building_year_budgets')
    .delete()
    .neq('id', 0)
  if (clearError) throw clearError

  const rows: {
    building_id: number
    year: number
    budget: number
    note: string | null
    capex_status: string | null
    capex_job_project_type: string | null
  }[] = []
  for (const [key, amount] of Object.entries(pots)) {
    if (!(amount > 0)) continue
    const sep = key.lastIndexOf('::')
    if (sep <= 0) continue
    const address = key.slice(0, sep)
    const year = Number.parseInt(key.slice(sep + 2), 10)
    const buildingId = idByAddress.get(address)
    if (buildingId == null || !Number.isFinite(year)) continue
    rows.push({
      building_id: buildingId,
      year,
      budget: Math.round(amount),
      note: notes[key]?.trim() || null,
      capex_status: statuses[key]?.trim() || null,
      capex_job_project_type: jobTypes[key]?.trim() || null,
    })
  }

  if (!rows.length) return 0

  const { error } = await supabase.from('building_year_budgets').insert(rows)
  if (error) throw error
  return rows.length
}
