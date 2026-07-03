import type { EditSummary } from '@/features/edit-mode/diffPortfolio'
import styles from './EditModeBar.module.css'

export type SaveState = 'idle' | 'saving' | 'success'

export interface EditModeBarProps {
  summary: EditSummary
  onSave: () => void
  onDiscard: () => void
  saveState?: SaveState
}

export function EditModeBar({
  summary,
  onSave,
  onDiscard,
  saveState = 'idle',
}: EditModeBarProps) {
  const changeLabel = summary.total === 1 ? 'change' : 'changes'
  const isSaving = saveState === 'saving'
  const isSuccess = saveState === 'success'

  return (
    <div className={styles.bar} role="status" aria-live="polite">
      <div className={styles.content}>
        {isSuccess ? (
          <>
            <p className={styles.heading}>Saved</p>
            <p className={styles.summary}>Changes pushed to the database.</p>
          </>
        ) : isSaving ? (
          <>
            <p className={styles.heading}>Saving…</p>
            <p className={styles.summary}>
              Pushing {summary.total} pending {changeLabel} to the database.
            </p>
          </>
        ) : (
          <>
            <p className={styles.heading}>
              {summary.total} pending {changeLabel}
            </p>
            <p className={styles.summary}>Review your edits, then save to push them to the database.</p>
            {summary.groups.length ? (
              <ul className={styles.groupList}>
                {summary.groups.map((group) => (
                  <li key={group.label}>
                    {group.count} {group.label.toLowerCase()}
                    {group.items.length ? ` — ${group.items.join(', ')}` : ''}
                    {group.count > group.items.length
                      ? ` (+${group.count - group.items.length} more)`
                      : ''}
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        )}

        {isSaving || isSuccess ? (
          <div className={styles.progressTrack} aria-hidden="true">
            <div
              className={`${styles.progressFill}${isSuccess ? ` ${styles.progressFillSuccess}` : ` ${styles.progressFillSaving}`}`}
            />
          </div>
        ) : null}
      </div>

      {!isSaving && !isSuccess ? (
        <div className={styles.actions}>
        <button
          type="button"
          className={styles.save}
          onClick={onSave}
          disabled={isSaving}
          title="Save pending changes to Supabase"
        >
            Save
          </button>
          <button
            type="button"
            className={styles.discard}
            onClick={onDiscard}
            title="Discard all pending changes"
          >
            Discard
          </button>
        </div>
      ) : null}
    </div>
  )
}
