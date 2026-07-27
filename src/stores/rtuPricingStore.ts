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
  isRcbReportPricingSheet,
  mergeRcbReportPricingIntoRows,
  parseRcbReportPricingSheet,
} from '@/lib/rcbReportImport'
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
  applyRcbReportPricingMerge: (rows: RtuPricingRow[], sourceFile: string) => Promise<void>
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

  applyRcbReportPricingMerge: async (rows, sourceFile) => {
    const cloned = cloneRows(rows)
    set({
      rows: cloned,
      sourceFile,
      pricingTable: buildPricingTable(cloned),
      revision: get().revision + 1,
    })
    await savePricing(cloned, get().version, sourceFile)
  },

  importWorkbook: async (file: File) => {
    const buffer = await file.arrayBuffer()

    // RCB cost report: merge base-year all-in into existing Cost DB tiers only.
    if (isRcbReportPricingSheet(buffer)) {
      const { basis, rows: reportRows } = parseRcbReportPricingSheet(buffer)
      const merged = mergeRcbReportPricingIntoRows(get().rows, reportRows, basis)
      if (!merged.stats.matchedTiers) {
        throw new Error('No matching tonnage tiers found on the “RTU Pricing” sheet.')
      }
      const cloned = cloneRows(merged.rows)
      set({
        rows: cloned,
        sourceFile: file.name,
        pricingTable: buildPricingTable(cloned),
        revision: get().revision + 1,
      })
      await savePricing(cloned, get().version, file.name)
      return { rowCount: merged.stats.matchedTiers }
    }

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
