import { supabase } from '@/lib/supabaseClient'
import type { Tables } from '@/types/database.types'

export interface RtuPictureManifest {
  entries: Record<string, string[]>
}

export interface RtuDocumentManifest {
  entries: Record<string, string[]>
}

type PictureRow = Tables<'rtu_pictures'>
type DocumentRow = Tables<'rtu_documents'>

function pictureKey(buildingAddress: string, rtuName: string): string {
  return `${buildingAddress}|${rtuName}`
}

/** PostgREST caps each response at 1000 rows; paginate for full manifests. */
const SUPABASE_PAGE_SIZE = 1000

async function fetchAllPages<T>(
  fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: Error | null }>,
): Promise<T[]> {
  const rows: T[] = []
  let from = 0
  while (true) {
    const { data, error } = await fetchPage(from, from + SUPABASE_PAGE_SIZE - 1)
    if (error) throw error
    if (!data?.length) break
    rows.push(...data)
    if (data.length < SUPABASE_PAGE_SIZE) break
    from += SUPABASE_PAGE_SIZE
  }
  return rows
}

export async function fetchPictureManifest(): Promise<RtuPictureManifest> {
  type Row = Pick<PictureRow, 'building_address' | 'rtu_name' | 'file_name'>
  const data = await fetchAllPages<Row>(async (from, to) =>
    supabase
      .from('rtu_pictures')
      .select('building_address, rtu_name, file_name')
      .eq('hidden', false)
      .order('position', { ascending: true })
      .range(from, to),
  )

  const entries: Record<string, string[]> = {}
  for (const row of data) {
    const key = pictureKey(row.building_address, row.rtu_name)
    if (!entries[key]) entries[key] = []
    entries[key]!.push(row.file_name)
  }
  return { entries }
}

export async function fetchHiddenPictureKeys(): Promise<Set<string>> {
  type Row = Pick<PictureRow, 'building_address' | 'rtu_name' | 'file_name'>
  const data = await fetchAllPages<Row>(async (from, to) =>
    supabase
      .from('rtu_pictures')
      .select('building_address, rtu_name, file_name')
      .eq('hidden', true)
      .order('id', { ascending: true })
      .range(from, to),
  )

  const hidden = new Set<string>()
  for (const row of data) {
    hidden.add(`${pictureKey(row.building_address, row.rtu_name)}|${row.file_name}`)
  }
  return hidden
}

export async function upsertPictureRow(
  row: Omit<PictureRow, 'id' | 'created_at' | 'updated_at'> & { id?: number },
): Promise<void> {
  const payload = {
    rtu_id: row.rtu_id,
    building_address: row.building_address,
    rtu_name: row.rtu_name,
    file_name: row.file_name,
    position: row.position,
    hidden: row.hidden,
  }

  if (row.id) {
    const { error } = await supabase.from('rtu_pictures').update(payload).eq('id', row.id)
    if (error) throw error
    return
  }

  const { error } = await supabase.from('rtu_pictures').upsert(payload, {
    onConflict: 'building_address,rtu_name,file_name',
  })
  if (error) throw error
}

export async function setPictureHidden(
  buildingAddress: string,
  rtuName: string,
  fileName: string,
  hidden: boolean,
): Promise<void> {
  const { error } = await supabase
    .from('rtu_pictures')
    .update({ hidden })
    .eq('building_address', buildingAddress)
    .eq('rtu_name', rtuName)
    .eq('file_name', fileName)
  if (error) throw error
}

export async function deletePictureRow(
  buildingAddress: string,
  rtuName: string,
  fileName: string,
): Promise<void> {
  const { error } = await supabase
    .from('rtu_pictures')
    .delete()
    .eq('building_address', buildingAddress)
    .eq('rtu_name', rtuName)
    .eq('file_name', fileName)
  if (error) throw error
}

export async function fetchDocumentManifest(): Promise<RtuDocumentManifest> {
  type Row = Pick<DocumentRow, 'building_address' | 'rtu_name' | 'file_name'>
  const data = await fetchAllPages<Row>(async (from, to) =>
    supabase
      .from('rtu_documents')
      .select('building_address, rtu_name, file_name')
      .order('position', { ascending: true })
      .range(from, to),
  )

  const entries: Record<string, string[]> = {}
  for (const row of data) {
    const key = pictureKey(row.building_address, row.rtu_name)
    if (!entries[key]) entries[key] = []
    entries[key]!.push(row.file_name)
  }
  return { entries }
}

export async function upsertDocumentRow(
  row: Omit<DocumentRow, 'id' | 'created_at' | 'updated_at'> & { id?: number },
): Promise<void> {
  const payload = {
    rtu_id: row.rtu_id,
    building_address: row.building_address,
    rtu_name: row.rtu_name,
    file_name: row.file_name,
    title: row.title,
    doc_type: row.doc_type,
    position: row.position,
  }

  if (row.id) {
    const { error } = await supabase.from('rtu_documents').update(payload).eq('id', row.id)
    if (error) throw error
    return
  }

  const { error } = await supabase.from('rtu_documents').upsert(payload, {
    onConflict: 'building_address,rtu_name,file_name',
  })
  if (error) throw error
}

export async function deleteDocumentRow(
  buildingAddress: string,
  rtuName: string,
  fileName: string,
): Promise<void> {
  const { error } = await supabase
    .from('rtu_documents')
    .delete()
    .eq('building_address', buildingAddress)
    .eq('rtu_name', rtuName)
    .eq('file_name', fileName)
  if (error) throw error
}
