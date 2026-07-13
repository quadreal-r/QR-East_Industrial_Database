import { Modal } from '@/components/Modal/Modal'
import { suppressMapClickClearOnce } from '@/lib/mapMarqueeSelect'
import { useConfirmStore } from '@/stores/confirmStore'
import styles from './ConfirmDialog.module.css'

/**
 * App-level confirm dialog that replaces `window.confirm`.
 * Mount once in AppShell; trigger via `confirm()` from `@/stores/confirmStore`.
 */
export function ConfirmDialog() {
  const request = useConfirmStore((s) => s.request)
  const resolve = useConfirmStore((s) => s._resolve)

  if (!request) return null

  return (
    <Modal
      open
      onClose={() => resolve(false)}
      title="Confirm"
      width={380}
    >
      <p className={styles.message}>{request.message}</p>
      <div className={styles.actions}>
        <button
          type="button"
          className={styles.cancel}
          onClick={() => {
            suppressMapClickClearOnce()
            resolve(false)
          }}
          autoFocus
        >
          {request.cancelLabel}
        </button>
        <button
          type="button"
          className={styles.confirm}
          onClick={() => {
            suppressMapClickClearOnce()
            resolve(true)
          }}
        >
          {request.confirmLabel}
        </button>
      </div>
    </Modal>
  )
}
