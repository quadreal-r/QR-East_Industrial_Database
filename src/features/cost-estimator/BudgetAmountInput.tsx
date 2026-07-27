import { useState } from 'react'
import { formatBudgetInputValue, parseBudgetInput } from '@/lib/rtuBudget'
import styles from './CostBanner.module.css'

export interface BudgetAmountInputProps {
  value: number | null
  onCommit: (amount: number | null) => void
  title?: string
  ariaLabel?: string
  className?: string
}

/** Local draft currency input — commits on blur or Enter. */
export function BudgetAmountInput({
  value,
  onCommit,
  title,
  ariaLabel,
  className,
}: BudgetAmountInputProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  const display = editing ? draft : formatBudgetInputValue(value)

  const commit = () => {
    const parsed = parseBudgetInput(draft)
    onCommit(parsed)
    setEditing(false)
    setDraft('')
  }

  return (
    <input
      type="text"
      inputMode="decimal"
      className={`${styles.budgetInput}${className ? ` ${className}` : ''}`}
      value={display}
      title={title}
      aria-label={ariaLabel}
      placeholder="—"
      onFocus={() => {
        setEditing(true)
        setDraft(formatBudgetInputValue(value))
      }}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          ;(e.target as HTMLInputElement).blur()
        }
      }}
      onClick={(e) => e.stopPropagation()}
    />
  )
}
