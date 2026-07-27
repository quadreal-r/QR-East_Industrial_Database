import { rcbReplacementYearKey } from '@/lib/costEstimator'
import { fetchAllPages } from '@/lib/supabasePager'
import { supabase } from '@/lib/supabaseClient'
import type { Tables } from '@/types/database.types'

type RtuRow = Tables<'rtus'>

export interface RtuScheduleData {
  replacementYears: Record<string, string>
  notes: Record<string, string>
  sourceFile: string | null
}

export async function fetchSchedule(): Promise<RtuScheduleData> {
  const { data: buildings, error: buildingsError } = await supabase
    .from('buildings')
    .select('id, address')
  if (buildingsError) throw buildingsError

  const addressById = new Map((buildings ?? []).map((b) => [b.id, b.address]))

  // Paginate — PostgREST caps a single response at 1000 rows.
  const rtus = await fetchAllPages<{
    building_id: number
    name: string
    replacement_year: number | null
    replacement_note: string | null
  }>((from, to) =>
    supabase
      .from('rtus')
      .select('building_id, name, replacement_year, replacement_note')
      .order('id')
      .range(from, to),
  )

  const replacementYears: Record<string, string> = {}
  const notes: Record<string, string> = {}

  for (const rtu of rtus) {
    const address = addressById.get(rtu.building_id)
    if (!address) continue
    const key = rcbReplacementYearKey(address, rtu.name)
    // 0 / invalid placeholders from older imports mean None — not an assigned year.
    if (rtu.replacement_year != null && rtu.replacement_year >= 2000 && rtu.replacement_year <= 2100) {
      replacementYears[key] = String(rtu.replacement_year)
    }
    if (rtu.replacement_note?.trim()) {
      notes[key] = rtu.replacement_note.trim()
    }
  }

  const { data: settings } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', 'rtu_schedule_source')
    .maybeSingle()

  const sourceFile =
    settings?.value && typeof settings.value === 'object' && settings.value !== null
      ? String((settings.value as { sourceFile?: string }).sourceFile ?? '') || null
      : null

  return { replacementYears, notes, sourceFile }
}

export async function updateScheduleEntry(
  address: string,
  rtuName: string,
  fields: { replacementYear?: string | null; note?: string | null },
): Promise<void> {
  const { data: building, error: buildingError } = await supabase
    .from('buildings')
    .select('id')
    .eq('address', address)
    .maybeSingle()
  if (buildingError) throw buildingError
  if (!building) throw new Error(`Building not found: ${address}`)

  const { data: rtu, error: rtuError } = await supabase
    .from('rtus')
    .select('id')
    .eq('building_id', building.id)
    .eq('name', rtuName)
    .maybeSingle()
  if (rtuError) throw rtuError
  if (!rtu) throw new Error(`RTU not found: ${address} / ${rtuName}`)

  const update: Partial<RtuRow> = {}
  if ('replacementYear' in fields) {
    const year = fields.replacementYear?.trim()
    update.replacement_year = year ? Number.parseInt(year, 10) : null
  }
  if ('note' in fields) {
    const note = fields.note?.trim()
    update.replacement_note = note || null
  }

  const { error } = await supabase.from('rtus').update(update).eq('id', rtu.id)
  if (error) throw error
}

export async function saveScheduleBatch(
  replacementYears: Record<string, string>,
  notes: Record<string, string>,
  sourceFile: string | null,
): Promise<void> {
  const keys = new Set([...Object.keys(replacementYears), ...Object.keys(notes)])
  for (const key of keys) {
    const sep = key.indexOf('::')
    if (sep < 0) continue
    const address = key.slice(0, sep)
    const rtuName = key.slice(sep + 2)
    await updateScheduleEntry(address, rtuName, {
      replacementYear: replacementYears[key] ?? null,
      note: notes[key] ?? null,
    })
  }

  const { error } = await supabase.from('app_settings').upsert(
    {
      key: 'rtu_schedule_source',
      value: { sourceFile },
    },
    { onConflict: 'key' },
  )
  if (error) throw error
}

/**
 * Merge schedule patches: only keys present are written; fields omitted on a key are left alone.
 * `notes[key] === null` clears that RTU’s note.
 */
export async function saveScheduleMerge(
  replacementYears: Record<string, string>,
  notes: Record<string, string | null>,
  sourceFile: string | null,
): Promise<void> {
  const keys = new Set([...Object.keys(replacementYears), ...Object.keys(notes)])
  for (const key of keys) {
    const sep = key.indexOf('::')
    if (sep < 0) continue
    const address = key.slice(0, sep)
    const rtuName = key.slice(sep + 2)
    const fields: { replacementYear?: string | null; note?: string | null } = {}
    if (Object.prototype.hasOwnProperty.call(replacementYears, key)) {
      fields.replacementYear = replacementYears[key] ?? null
    }
    if (Object.prototype.hasOwnProperty.call(notes, key)) {
      fields.note = notes[key]
    }
    await updateScheduleEntry(address, rtuName, fields)
  }

  const { error } = await supabase.from('app_settings').upsert(
    {
      key: 'rtu_schedule_source',
      value: { sourceFile },
    },
    { onConflict: 'key' },
  )
  if (error) throw error
}
