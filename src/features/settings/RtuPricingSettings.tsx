import { useRef, useState, type FocusEvent } from 'react'
import { Modal } from '@/components/Modal/Modal'
import { computeRtuAllInFromComponents } from '@/lib/rtuPricingSheet'
import {
  RTU_PRICING_COLUMN_LABELS,
  RTU_PRICING_COMPONENT_FIELDS,
  RTU_PRICING_MONEY_FIELDS,
} from '@/lib/rtuPricingSheet'
import { showToastSuccess } from '@/lib/toast'
import { useRtuPricingStore } from '@/stores/rtuPricingStore'
import styles from './RtuPricingSettings.module.css'

export interface RtuPricingSettingsProps {
  open: boolean
  onClose: () => void
}

function formatMoney(value: number): string {
  return `$${Math.round(value).toLocaleString('en-CA')}`
}

function formatAmount(value: number): string {
  return Math.round(value).toLocaleString('en-CA')
}

function parseAmount(raw: string): number | null {
  const cleaned = raw.replace(/,/g, '').trim()
  if (!cleaned) return 0
  const n = Number(cleaned)
  return Number.isFinite(n) ? Math.round(n) : null
}

interface MoneyInputProps {
  value: number
  onChange: (value: number) => void
}

function MoneyInput({ value, onChange }: MoneyInputProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const display = formatAmount(value)

  const commit = (raw: string) => {
    const parsed = parseAmount(raw)
    if (parsed != null) onChange(parsed)
  }

  const handleFocus = (event: FocusEvent<HTMLInputElement>) => {
    setEditing(true)
    setDraft(String(value))
    event.target.select()
  }

  const handleBlur = () => {
    setEditing(false)
    commit(draft)
  }

  return (
    <div className={styles.moneyInput}>
      <span className={styles.moneyPrefix}>$</span>
      <input
        ref={inputRef}
        className={`${styles.cellInput} ${styles.moneyCellInput}`}
        type="text"
        inputMode="numeric"
        value={editing ? draft : display}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onChange={(e) => {
          setEditing(true)
          setDraft(e.target.value)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') inputRef.current?.blur()
        }}
      />
    </div>
  )
}

interface MultInputProps {
  value: number
  onChange: (value: number) => void
}

function MultInput({ value, onChange }: MultInputProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const commit = (raw: string) => {
    const n = Number.parseFloat(raw)
    if (Number.isFinite(n)) onChange(n)
  }

  return (
    <input
      ref={inputRef}
      className={styles.cellInput}
      type="text"
      inputMode="decimal"
      value={editing ? draft : value.toFixed(2)}
      onFocus={(e) => {
        setEditing(true)
        setDraft(String(value))
        e.target.select()
      }}
      onBlur={() => {
        setEditing(false)
        commit(draft)
      }}
      onChange={(e) => {
        setEditing(true)
        setDraft(e.target.value)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') inputRef.current?.blur()
      }}
    />
  )
}

export function RtuPricingSettings({ open, onClose }: RtuPricingSettingsProps) {
  const rows = useRtuPricingStore((s) => s.rows)
  const version = useRtuPricingStore((s) => s.version)
  const sourceFile = useRtuPricingStore((s) => s.sourceFile)
  const resetToDefaults = useRtuPricingStore((s) => s.resetToDefaults)
  const updateRowField = useRtuPricingStore((s) => s.updateRowField)

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="RTU pricing (columns D–L)"
      width="min(1540px, calc(100vw - 32px))"
      align="center"
    >
      <div className={styles.body}>
        <p className={styles.intro}>
          Matches the Capital workbook <strong>RTU Pricing</strong> sheet: component costs in columns
          D–L roll up to all-in installed pricing (std 2025, hybrid 2026+ with 5% annual escalation).
          Import Excel from the bottom cost bar (<strong>Import</strong> between Excel and PDF).
        </p>

        <div className={styles.toolbar}>
          <button
            type="button"
            className="btn-action"
            onClick={() => {
              resetToDefaults()
              showToastSuccess('RTU pricing reset to defaults')
            }}
          >
            Reset to defaults
          </button>
        </div>

        <p className={styles.meta}>
          {version ? `Version ${version}` : 'Custom pricing'}
          {sourceFile ? ` · from ${sourceFile}` : ''}
          {' · '}
          {rows.length} tonnage tiers
        </p>

        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Tonnage</th>
                <th>Model</th>
                {RTU_PRICING_COMPONENT_FIELDS.map((field) => (
                  <th key={field}>{RTU_PRICING_COLUMN_LABELS[field]}</th>
                ))}
                <th>Std 2025 $</th>
                <th>Hyb 2026 $</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.tonnageKey}>
                  <td className={styles.tonnage}>{row.label}</td>
                  <td className={styles.model} title={row.notes || row.model}>
                    {row.model}
                  </td>
                  {RTU_PRICING_COMPONENT_FIELDS.map((field) => (
                    <td key={field} className={styles.valueCell}>
                      {RTU_PRICING_MONEY_FIELDS.has(field) ? (
                        <MoneyInput
                          value={row[field]}
                          onChange={(value) => updateRowField(row.tonnageKey, field, value)}
                        />
                      ) : (
                        <MultInput
                          value={row[field]}
                          onChange={(value) => updateRowField(row.tonnageKey, field, value)}
                        />
                      )}
                    </td>
                  ))}
                  <td className={styles.computed}>
                    {formatMoney(computeRtuAllInFromComponents(row, 'std'))}
                  </td>
                  <td className={styles.computed}>
                    {formatMoney(computeRtuAllInFromComponents(row, 'hyb'))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className={styles.hint}>
          Edits save automatically. Cost estimator and Excel export use these values immediately.
        </p>
      </div>
    </Modal>
  )
}
