import { useRef, useState } from 'react'
import * as XLSX from 'xlsx'
import { importCapitalRtuWorkbook } from '@/lib/capitalRtuWorkbook'
import { detectExcelWorkbookKind } from '@/lib/excelWorkbookType'
import { exportPortfolioExcel, importPortfolioExcel } from '@/lib/excel'
import {
  loadLastExcelImportFileName,
  resolveLastExcelImportFileName,
  saveLastExcelImportFileName,
} from '@/lib/lastExcelImportFile'
import { mergePortfolioExcelImport } from '@/lib/portfolioExcelMerge'
import { importEquipmentSchedule } from '@/lib/equipmentSheet'
import { importRcbReportWorkbook } from '@/lib/rcbReportImport'
import { recordActivityEvent } from '@/data/activityApi'
import { showToastError, showToastSuccess } from '@/lib/toast'
import { normalizePortfolioData } from '@/types/domain'
import { useRtuBudgetStore } from '@/stores/rtuBudgetStore'
import { useRtuPricingStore } from '@/stores/rtuPricingStore'
import { useRtuScheduleStore } from '@/stores/rtuScheduleStore'
import { useSettingsStore } from '@/stores/settingsStore'
import type { Building, PortfolioData } from '@/types/domain'
import { SettingsToolButton } from '@/features/settings/SettingsToolButton'
import styles from '@/features/settings/SettingsModal.module.css'

export interface ImportExportButtonsProps {
  portfolio: PortfolioData
  buildings: Building[]
  onImport: (data: PortfolioData) => void
  onExportComplete?: () => void
  mode?: 'both' | 'export' | 'import'
  canEdit?: boolean
}

export function ImportExportButtons({
  portfolio,
  buildings,
  onImport,
  onExportComplete,
  mode = 'both',
  canEdit = false,
}: ImportExportButtonsProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [sessionFileName, setSessionFileName] = useState<string | null>(null)
  const scheduleSourceFile = useRtuScheduleStore((s) => s.sourceFile)
  const pricingSourceFile = useRtuPricingStore((s) => s.sourceFile)
  const pricingTiers = useRtuPricingStore((s) => s.rows.length)
  const applyEquipmentImport = useRtuScheduleStore((s) => s.applyEquipmentImport)
  const applyRcbReportMerge = useRtuScheduleStore((s) => s.applyRcbReportMerge)
  const applyPricingImport = useRtuPricingStore((s) => s.applyPricingImport)
  const applyRcbReportPricingMerge = useRtuPricingStore((s) => s.applyRcbReportPricingMerge)
  const pricingRows = useRtuPricingStore((s) => s.rows)
  const applyBudgetMerge = useRtuBudgetStore((s) => s.applyBudgetMerge)
  const managerRenames = useSettingsStore((s) => s.managerRenames)
  const lastFileName = resolveLastExcelImportFileName({
    persisted: sessionFileName ?? loadLastExcelImportFileName(),
    scheduleSourceFile,
    pricingSourceFile,
  })

  const rememberImportFile = (fileName: string) => {
    saveLastExcelImportFileName(fileName)
    setSessionFileName(fileName.trim())
  }

  const requireEdit = () => {
    if (!canEdit) {
      showToastError('Admin access is required to import data to Supabase.')
      return false
    }
    return true
  }

  const handleExport = async () => {
    setBusy(true)
    try {
      await exportPortfolioExcel(portfolio, undefined, { managerRenames })
      void recordActivityEvent({
        eventType: 'excel_export',
        resourceKey: 'portfolio.xlsx',
        meta: { buildings: buildings.length },
      })
      showToastSuccess('✓ Excel exported')
      onExportComplete?.()
    } catch (e) {
      showToastError(e instanceof Error ? e.message : 'Export failed')
    } finally {
      setBusy(false)
    }
  }

  const handleRcbReportImport = async (buffer: ArrayBuffer, file: File) => {
    if (!requireEdit()) return
    const result = importRcbReportWorkbook(buffer, buildings, pricingRows)
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

    await applyRcbReportMerge(result.allUnits, file.name)
    if (Object.keys(result.allUnits.budgets).length) {
      applyBudgetMerge(result.allUnits.budgets)
    }
    if (result.pricing) {
      await applyRcbReportPricingMerge(result.pricing.rows, file.name)
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
    showToastSuccess(
      `Updated ${parts.join(', ')} from cost report. Other data left alone.${skipped}`,
    )
  }

  const handleCapitalImport = async (buffer: ArrayBuffer, file: File) => {
    if (!requireEdit()) return
    const sheetNames = XLSX.read(buffer, { type: 'array', bookSheets: true }).SheetNames
    const hasPricing = sheetNames.some((name) => /^rtu pricing$/i.test(name.trim()))

    if (hasPricing) {
      const result = importCapitalRtuWorkbook(buffer, buildings)
      await applyEquipmentImport(result.equipment, file.name)
      await applyPricingImport(result.pricing.rows, result.pricing.version, file.name)
      const { stats } = result.equipment
      showToastSuccess(
        `Imported ${stats.matchedYears} replacement years, ${stats.matchedNotes} notes, and ${result.pricing.rowCount} pricing tiers to Supabase.`,
      )
      return
    }

    const equipment = importEquipmentSchedule(buffer, buildings)
    await applyEquipmentImport(equipment, file.name)
    const { stats } = equipment
    showToastSuccess(
      `Imported ${stats.matchedYears} replacement years and ${stats.matchedNotes} notes to Supabase.`,
    )
  }

  const handleFile = async (file: File) => {
    if (!requireEdit()) return
    setBusy(true)
    try {
      const buffer = await file.arrayBuffer()
      const kind = detectExcelWorkbookKind(
        XLSX.read(buffer, { type: 'array', bookSheets: true }).SheetNames,
      )

      if (kind === 'portfolio') {
        const imported = normalizePortfolioData(importPortfolioExcel(buffer))
        const data = mergePortfolioExcelImport(portfolio, imported)
        rememberImportFile(file.name)
        onImport(data)
        void recordActivityEvent({
          eventType: 'excel_import',
          resourceKey: file.name,
          meta: { kind: 'portfolio' },
        })
        showToastSuccess('✓ Portfolio staged from Excel — click Save to write to Supabase')
        return
      }

      if (kind === 'rcbReport') {
        await handleRcbReportImport(buffer, file)
        rememberImportFile(file.name)
        void recordActivityEvent({
          eventType: 'excel_import',
          resourceKey: file.name,
          meta: { kind: 'rcbReport' },
        })
        return
      }

      await handleCapitalImport(buffer, file)
      rememberImportFile(file.name)
      void recordActivityEvent({
        eventType: 'excel_import',
        resourceKey: file.name,
        meta: { kind: 'capital' },
      })
    } catch (e) {
      showToastError(e instanceof Error ? e.message : 'Import failed')
    } finally {
      setBusy(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  const showExport = mode === 'both' || mode === 'export'
  const showImport = canEdit && (mode === 'both' || mode === 'import')

  if (!showExport && !showImport) return null

  return (
    <>
      {showExport ? (
        <SettingsToolButton
          variant="export"
          tooltip="Export buildings, RTUs, tenant polygons, utilities, 360 gateways, building operators, user emails with access levels, and RTU picture references to Excel."
          onClick={() => void handleExport()}
          disabled={busy}
        >
          {busy ? 'Exporting…' : 'Export Database to Excel'}
        </SettingsToolButton>
      ) : null}
      {showImport ? (
        <div>
          <SettingsToolButton
            tooltip={
              <>
                Import Database from Excel: sheet headers must match the app export. Portfolio
                export updates map data; RTU Replacement Cost Center Excel updates matched years, notes,
                budgets, and Cost DB pricing (other data left alone); or Capital RTU Replacement
                workbook updates schedule and pricing.
                {pricingTiers ? ` · ${pricingTiers} tonnage tiers` : ''}
              </>
            }
            onClick={() => inputRef.current?.click()}
            disabled={busy}
          >
            {busy ? 'Importing…' : 'Import Database from Excel'}
          </SettingsToolButton>
          {lastFileName ? (
            <p className={styles.hint} title={lastFileName}>
              Last file: {lastFileName}
            </p>
          ) : null}
        </div>
      ) : null}
      {showImport ? (
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.xls"
          className={styles.hiddenFile}
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) void handleFile(file)
          }}
        />
      ) : null}
    </>
  )
}
