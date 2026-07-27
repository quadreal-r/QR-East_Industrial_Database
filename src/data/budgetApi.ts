import { rcbReplacementYearKey } from '@/lib/costEstimator'
import { fetchAllPages } from '@/lib/supabasePager'
import { supabase } from '@/lib/supabaseClient'

/** Fetch all stored RTU budgets keyed by `address::rtuName`. */
export async function fetchBudgets(): Promise<Record<string, number>> {
  const { data: buildings, error: buildingsError } = await supabase
    .from('buildings')
    .select('id, address')
  if (buildingsError) throw buildingsError

  const addressById = new Map((buildings ?? []).map((b) => [b.id, b.address]))

  // Paginate — PostgREST caps a single response at 1000 rows.
  const rtus = await fetchAllPages<{
    building_id: number
    name: string
    budget: number | null
  }>((from, to) =>
    supabase
      .from('rtus')
      .select('building_id, name, budget')
      .order('id')
      .range(from, to),
  )

  const budgets: Record<string, number> = {}
  for (const rtu of rtus) {
    const address = addressById.get(rtu.building_id)
    if (!address) continue
    const amount = rtu.budget
    if (typeof amount === 'number' && Number.isFinite(amount) && amount > 0) {
      budgets[rcbReplacementYearKey(address, rtu.name)] = Math.round(amount)
    }
  }
  return budgets
}

export async function updateBudgetEntry(
  address: string,
  rtuName: string,
  budget: number | null,
): Promise<void> {
  const { data: building, error: buildingError } = await supabase
    .from('buildings')
    .select('id')
    .eq('address', address)
    .maybeSingle()
  if (buildingError) throw buildingError
  if (!building) throw new Error(`Building not found: ${address}`)

  const { error } = await supabase
    .from('rtus')
    .update({ budget: budget != null && budget > 0 ? Math.round(budget) : null })
    .eq('building_id', building.id)
    .eq('name', rtuName)
  if (error) throw error
}

/** Merge budget patches keyed by `address::rtuName`; `null` clears that RTU. */
export async function saveBudgetMerge(
  budgets: Record<string, number | null>,
): Promise<void> {
  for (const [key, amount] of Object.entries(budgets)) {
    const sep = key.indexOf('::')
    if (sep < 0) continue
    const address = key.slice(0, sep)
    const rtuName = key.slice(sep + 2)
    await updateBudgetEntry(address, rtuName, amount)
  }
}
