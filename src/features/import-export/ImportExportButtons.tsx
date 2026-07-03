import { useRef, useState } from 'react'
import * as XLSX from 'xlsx'
import { importCapitalRtuWorkbook } from '@/lib/capitalRtuWorkbook'
import { detectExcelWorkbookKind } from '@/lib/excelWorkbookType'
import { exportPortfolioExcel, importPortfolioExcel } from '@/lib/excel'
import { importEquipmentSchedule } from '@/lib/equipmentSheet'
import { showToastError, showToastSuccess } from '@/lib/toast'
import { normalizePortfolioData } from '@/types/domain'
import { useRtuPricingStore } from '@/stores/rtuPricingStore'
import { useRtuScheduleStore } from '@/stores/rtuScheduleStore'
import type { Building, PortfolioData } from '@/types/domain'
import { SettingsToolButton } from '@/features/settings/SettingsToolButton'
import styles from '@/features/settings/SettingsModal.module.css'

export interface ImportExportButtonsProps {
  portfolio: PortfolioData
  buildings: Building[]
  onImport: (data: PortfolioData) => void
  onExportComplete?: () => void
  mode?: 'both' | 'export' | 'import'
  isAuthenticated?: boolean
}

export function ImportExportButtons({
  portfolio,
  buildings,
  onImport,
  onExportComplete,
  mode = 'both',
  isAuthenticated = false,
}: ImportExportButtonsProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const sourceFile = useRtuScheduleStore((s) => s.sourceFile)
  const pricingTiers = useRtuPricingStore((s) => s.rows.length)
  const applyEquipmentImport = useRtuScheduleStore((s) => s.applyEquipmentImport)
  const applyPricingImport = useRtuPricingStore((s) => s.applyPricingImport)

  const requireAuth = () => {
    if (!isAuthenticated) {
      showToastError('Sign in to import data to Supabase.')
      return false
    }
    return true
  }

  const handleExport = async () => {
    setBusy(true)
    try {
      await exportPortfolioExcel(portfolio)
      showToastSuccess('✓ Excel exported')
      onExportComplete?.()
    } catch (e) {
      showToastError(e instanceof Error ? e.message : 'Export failed')
    } finally {
      setBusy(false)
    }
  }

  const handleCapitalImport = async (buffer: ArrayBuffer, file: File) => {
    if (!requireAuth()) return
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
    if (!requireAuth()) return
    setBusy(true)
    try {
      const buffer = await file.arrayBuffer()
      const kind = detectExcelWorkbookKind(
        XLSX.read(buffer, { type: 'array', bookSheets: true }).SheetNames,
      )

      if (kind === 'portfolio') {
        const data = normalizePortfolioData(importPortfolioExcel(buffer))
        onImport(data)
        showToastSuccess('✓ Portfolio imported to Supabase')
        return
      }

      await handleCapitalImport(buffer, file)
    } catch (e) {
      showToastError(e instanceof Error ? e.message : 'Import failed')
    } finally {
      setBusy(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  const showExport = mode === 'both' || mode === 'export'
  const showImport = mode === 'both' || mode === 'import'

  return (
    <>
      {showExport ? (
        <SettingsToolButton
          variant="export"
          tooltip="Export buildings, RTUs, tenant polygons, utilities, and RTU picture references to Excel."
          onClick={() => void handleExport()}
          disabled={busy}
        >
          {busy ? 'Exporting…' : 'Export Database to Excel'}
        </SettingsToolButton>
      ) : null}
      {showImport ? (
        <SettingsToolButton
          tooltip={
            <>
              Import Database from Excel: portfolio export updates map data in Supabase, or Capital RTU
              Replacement workbook updates schedule and pricing.
              {sourceFile ? (
                <>
                  {' '}
                  Last workbook: {sourceFile}
                  {pricingTiers ? ` · ${pricingTiers} tonnage tiers` : ''}
                </>
              ) : null}
            </>
          }
          onClick={() => inputRef.current?.click()}
          disabled={busy}
        >
          {busy ? 'Importing…' : 'Import Database from Excel'}
        </SettingsToolButton>
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
