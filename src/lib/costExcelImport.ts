import * as XLSX from 'xlsx'
import { importCapitalRtuWorkbook } from '@/lib/capitalRtuWorkbook'
import { detectExcelWorkbookKind } from '@/lib/excelWorkbookType'
import {
  importEquipmentSchedule,
  type EquipmentImportResult,
} from '@/lib/equipmentSheet'
import {
  importRcbReportWorkbook,
  type RcbAllUnitsImportResult,
} from '@/lib/rcbReportImport'
import type { Building } from '@/types/domain'
import type { RtuPricingRow } from '@/lib/rtuPricingSheet'

export interface CostExcelImportDeps {
  buildings: Building[]
  pricingRows: RtuPricingRow[]
  applyRcbReportMerge: (result: RcbAllUnitsImportResult, sourceFile: string) => Promise<void>
  applyBudgetMerge: (budgets: Record<string, number | null>) => void
  applyRcbReportPricingMerge: (rows: RtuPricingRow[], sourceFile: string) => Promise<void>
  applyEquipmentImport: (result: EquipmentImportResult, sourceFile: string) => Promise<void>
  applyPricingImport: (
    rows: RtuPricingRow[],
    version: string | null,
    sourceFile: string,
  ) => Promise<void>
  /** Pricing-only Capital / Cost DB workbook (former Pricing Center import). */
  importPricingWorkbook: (fileName: string, buffer: ArrayBuffer) => Promise<{ rowCount: number }>
}

export interface CostExcelImportResult {
  message: string
}

/**
 * Import an Excel file next to RTU Replacement Cost Center export:
 * RCB cost report → years / notes / budgets / pricing;
 * Capital workbook → schedule + pricing;
 * otherwise → Pricing Center-style RTU Pricing sheet import.
 */
export async function importCostExcelFile(
  buffer: ArrayBuffer,
  fileName: string,
  deps: CostExcelImportDeps,
): Promise<CostExcelImportResult> {
  const sheetNames = XLSX.read(buffer, { type: 'array', bookSheets: true }).SheetNames

  let kind: ReturnType<typeof detectExcelWorkbookKind>
  try {
    kind = detectExcelWorkbookKind(sheetNames)
  } catch {
    const { rowCount } = await deps.importPricingWorkbook(fileName, buffer)
    return { message: `Imported ${rowCount} tonnage rows from workbook` }
  }

  if (kind === 'portfolio') {
    throw new Error(
      'This looks like a portfolio database export. Use Settings → Import Database from Excel for that file.',
    )
  }

  if (kind === 'rcbReport') {
    const result = importRcbReportWorkbook(buffer, deps.buildings, deps.pricingRows)
    const { stats } = result.allUnits

    if (
      stats.matchedYears === 0 &&
      stats.matchedNotes === 0 &&
      stats.matchedBudgets === 0 &&
      !(result.pricing?.stats.matchedTiers)
    ) {
      throw new Error(
        'No matching buildings, RTUs, or pricing tiers found in this cost report.',
      )
    }

    await deps.applyRcbReportMerge(result.allUnits, fileName)
    if (Object.keys(result.allUnits.budgets).length) {
      deps.applyBudgetMerge(result.allUnits.budgets)
    }
    if (result.pricing) {
      await deps.applyRcbReportPricingMerge(result.pricing.rows, fileName)
    }

    const parts = [
      stats.matchedYears ? `${stats.matchedYears} replacement years` : '',
      stats.matchedNotes ? `${stats.matchedNotes} notes` : '',
      stats.matchedBudgets ? `${stats.matchedBudgets} budgets` : '',
      result.pricing?.stats.updatedTiers
        ? `${result.pricing.stats.updatedTiers} pricing tiers`
        : result.pricing?.stats.matchedTiers
          ? `${result.pricing.stats.matchedTiers} pricing tiers checked`
          : '',
    ].filter(Boolean)
    const skipped =
      stats.unmatchedBuilding + stats.unmatchedRtu > 0
        ? ` (${stats.unmatchedBuilding + stats.unmatchedRtu} rows skipped — building/unit not found)`
        : ''
    return {
      message: `Updated ${parts.join(', ')} from cost report. Other data left alone.${skipped}`,
    }
  }

  // Capital workbook (Equipment +/or RTU Pricing)
  const hasPricing = sheetNames.some((name) => /^rtu pricing$/i.test(name.trim()))
  const hasEquipment = sheetNames.some((name) => /^equipment$/i.test(name.trim()))

  if (hasPricing && hasEquipment) {
    const result = importCapitalRtuWorkbook(buffer, deps.buildings)
    await deps.applyEquipmentImport(result.equipment, fileName)
    await deps.applyPricingImport(result.pricing.rows, result.pricing.version, fileName)
    const { stats } = result.equipment
    return {
      message: `Imported ${stats.matchedYears} replacement years, ${stats.matchedNotes} notes, and ${result.pricing.rowCount} pricing tiers.`,
    }
  }

  if (hasEquipment) {
    const equipment = importEquipmentSchedule(buffer, deps.buildings)
    await deps.applyEquipmentImport(equipment, fileName)
    const { stats } = equipment
    return {
      message: `Imported ${stats.matchedYears} replacement years and ${stats.matchedNotes} notes.`,
    }
  }

  const { rowCount } = await deps.importPricingWorkbook(fileName, buffer)
  return { message: `Imported ${rowCount} tonnage rows from workbook` }
}
