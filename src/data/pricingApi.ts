import {
  DEFAULT_RTU_PRICING_ROWS,
  DEFAULT_RTU_PRICING_VERSION,
} from '@/lib/rtuPricing.defaults'
import {
  getRcbTiersFromPricing,
  rowsToRtuPricing,
  type RtuPricingRow,
} from '@/lib/rtuPricingSheet'
import type { RcbPricingTable } from '@/lib/costEstimator.pricing'
import { supabase } from '@/lib/supabaseClient'
import type { Json, Tables, TablesInsert } from '@/types/database.types'

type PricingRow = Tables<'rtu_pricing'>

export interface RtuPricingData {
  rows: RtuPricingRow[]
  version: string | null
  sourceFile: string | null
}

function rowToPricing(row: PricingRow): RtuPricingRow {
  return {
    tonnageKey: row.tonnage_key,
    label: row.label,
    notes: row.notes,
    model: row.model,
    supplyStd: Number(row.supply_std),
    supplyHyb: Number(row.supply_hyb),
    install: Number(row.install),
    consulting: Number(row.consulting),
    structural: Number(row.structural),
    serviceBalancing: Number(row.service_balancing),
    electrical: Number(row.electrical),
    miscellaneous: Number(row.miscellaneous),
    supervisoryMult: Number(row.supervisory_mult),
  }
}

function pricingToRow(row: RtuPricingRow, position: number): TablesInsert<'rtu_pricing'> {
  return {
    tonnage_key: row.tonnageKey,
    label: row.label,
    notes: row.notes ?? '',
    model: row.model ?? '',
    supply_std: row.supplyStd,
    supply_hyb: row.supplyHyb,
    install: row.install,
    consulting: row.consulting,
    structural: row.structural,
    service_balancing: row.serviceBalancing,
    electrical: row.electrical,
    miscellaneous: row.miscellaneous,
    supervisory_mult: row.supervisoryMult,
    position,
  }
}

export function buildPricingTable(rows: RtuPricingRow[]): RcbPricingTable {
  const pricing = rowsToRtuPricing(rows)
  return { pricing, tiers: getRcbTiersFromPricing(pricing) }
}

export async function fetchPricing(): Promise<RtuPricingData> {
  const { data, error } = await supabase
    .from('rtu_pricing')
    .select('*')
    .order('position', { ascending: true })
  if (error) throw error

  const rows = (data ?? []).map(rowToPricing)
  if (!rows.length) {
    return {
      rows: DEFAULT_RTU_PRICING_ROWS,
      version: DEFAULT_RTU_PRICING_VERSION,
      sourceFile: null,
    }
  }

  const { data: versionSetting } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', 'rtu_pricing_version')
    .maybeSingle()

  const version =
    versionSetting?.value && typeof versionSetting.value === 'object' && versionSetting.value !== null
      ? String((versionSetting.value as { version?: string }).version ?? '') || null
      : null

  const { data: sourceSetting } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', 'rtu_pricing_source')
    .maybeSingle()

  const sourceFile =
    sourceSetting?.value && typeof sourceSetting.value === 'object' && sourceSetting.value !== null
      ? String((sourceSetting.value as { sourceFile?: string }).sourceFile ?? '') || null
      : null

  return { rows, version, sourceFile }
}

export async function savePricing(
  rows: RtuPricingRow[],
  version: string | null,
  sourceFile: string | null,
): Promise<void> {
  const { error: deleteError } = await supabase
    .from('rtu_pricing')
    .delete()
    .neq('id', 0)
  if (deleteError) throw deleteError

  const inserts = rows.map((row, index) => pricingToRow(row, index))
  if (inserts.length) {
    const { error } = await supabase.from('rtu_pricing').insert(inserts)
    if (error) throw error
  }

  const settingsUpserts = [
    { key: 'rtu_pricing_version', value: { version } },
    { key: 'rtu_pricing_source', value: { sourceFile } },
  ]
  for (const setting of settingsUpserts) {
    const { error } = await supabase.from('app_settings').upsert(
      { key: setting.key, value: setting.value as Json },
      { onConflict: 'key' },
    )
    if (error) throw error
  }
}

export async function updatePricingRowField(
  tonnageKey: number,
  field: keyof Pick<
    RtuPricingRow,
    | 'supplyStd'
    | 'supplyHyb'
    | 'install'
    | 'consulting'
    | 'structural'
    | 'serviceBalancing'
    | 'electrical'
    | 'miscellaneous'
    | 'supervisoryMult'
  >,
  value: number,
): Promise<void> {
  const columnMap = {
    supplyStd: 'supply_std',
    supplyHyb: 'supply_hyb',
    install: 'install',
    consulting: 'consulting',
    structural: 'structural',
    serviceBalancing: 'service_balancing',
    electrical: 'electrical',
    miscellaneous: 'miscellaneous',
    supervisoryMult: 'supervisory_mult',
  } as const

  const column = columnMap[field]

  const { error } = await supabase
    .from('rtu_pricing')
    .update({ [column]: value } as never)
    .eq('tonnage_key', tonnageKey)
  if (error) throw error
}
