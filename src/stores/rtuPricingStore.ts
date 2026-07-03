import { create } from 'zustand'
import {
  buildPricingTable,
  fetchPricing,
  savePricing,
  updatePricingRowField,
} from '@/data/pricingApi'
import {
  DEFAULT_RTU_PRICING_ROWS,
  DEFAULT_RTU_PRICING_VERSION,
} from '@/lib/rtuPricing.defaults'
import {
  DEFAULT_RCB_PRICING,
  type RcbPricingTable,
} from '@/lib/costEstimator.pricing'
import {
  parseRtuPricingWorkbook,
  type RtuPricingRow,
  type RtuPricingComponentField,
} from '@/lib/rtuPricingSheet'

function cloneRows(rows: RtuPricingRow[]): RtuPricingRow[] {
  return rows.map((row) => ({ ...row }))
}

interface RtuPricingState {
  rows: RtuPricingRow[]
  version: string | null
  sourceFile: string | null
  revision: number
  pricingTable: RcbPricingTable
  loaded: boolean
  load: () => Promise<void>
  resetToDefaults: () => Promise<void>
  applyPricingImport: (
    rows: RtuPricingRow[],
    version: string | null,
    sourceFile: string,
  ) => Promise<void>
  importWorkbook: (file: File) => Promise<{ rowCount: number }>
  updateRowField: (
    tonnageKey: number,
    field: RtuPricingComponentField,
    value: number,
  ) => Promise<void>
}

export const useRtuPricingStore = create<RtuPricingState>((set, get) => ({
  rows: cloneRows(DEFAULT_RTU_PRICING_ROWS),
  version: DEFAULT_RTU_PRICING_VERSION,
  sourceFile: null,
  revision: 0,
  pricingTable: DEFAULT_RCB_PRICING,
  loaded: false,

  load: async () => {
    const data = await fetchPricing()
    const rows = cloneRows(data.rows)
    set({
      rows,
      version: data.version,
      sourceFile: data.sourceFile,
      pricingTable: buildPricingTable(rows),
      revision: get().revision + 1,
      loaded: true,
    })
  },

  resetToDefaults: async () => {
    const rows = cloneRows(DEFAULT_RTU_PRICING_ROWS)
    set({
      rows,
      version: DEFAULT_RTU_PRICING_VERSION,
      sourceFile: null,
      pricingTable: buildPricingTable(rows),
      revision: get().revision + 1,
    })
    await savePricing(rows, DEFAULT_RTU_PRICING_VERSION, null)
  },

  applyPricingImport: async (rows, version, sourceFile) => {
    const cloned = cloneRows(rows)
    set({
      rows: cloned,
      version,
      sourceFile,
      pricingTable: buildPricingTable(cloned),
      revision: get().revision + 1,
    })
    await savePricing(cloned, version, sourceFile)
  },

  importWorkbook: async (file: File) => {
    const buffer = await file.arrayBuffer()
    const { version, rows } = parseRtuPricingWorkbook(buffer)
    if (!rows.length) {
      throw new Error('No tonnage rows found on the “RTU Pricing” sheet.')
    }
    const cloned = cloneRows(rows)
    set({
      rows: cloned,
      version: version ?? null,
      sourceFile: file.name,
      pricingTable: buildPricingTable(cloned),
      revision: get().revision + 1,
    })
    await savePricing(cloned, version ?? null, file.name)
    return { rowCount: rows.length }
  },

  updateRowField: async (tonnageKey, field, value) => {
    const safe = Number.isFinite(value) ? value : 0
    const current = get().rows.find((row) => row.tonnageKey === tonnageKey)
    if (!current || current[field] === safe) return
    const rows = get().rows.map((row) =>
      row.tonnageKey === tonnageKey ? { ...row, [field]: safe } : row,
    )
    set({
      rows,
      pricingTable: buildPricingTable(rows),
      revision: get().revision + 1,
    })
    await updatePricingRowField(tonnageKey, field, safe)
  },
}))

export function getActiveRcbPricing(): RcbPricingTable {
  return useRtuPricingStore.getState().pricingTable
}
