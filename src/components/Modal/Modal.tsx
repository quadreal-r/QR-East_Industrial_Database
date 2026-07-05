import { useEffect, type ReactNode } from 'react'
import styles from './Modal.module.css'

export interface ModalProps {
  open: boolean
  onClose: () => void
  title?: string
  children: ReactNode
  align?: 'center' | 'right'
  width?: number | string
  /** When set, shows a back control in the header (e.g. settings sub-pages). */
  onBack?: () => void
  backLabel?: string
  /** When true, overlay click, Escape, and the close button do nothing. */
  preventClose?: boolean
}

export function Modal({
  open,
  onClose,
  title,
  children,
  align = 'center',
  width = 400,
  onBack,
  backLabel = 'Back',
  preventClose = false,
}: ModalProps) {
  useEffect(() => {
    if (!open || preventClose) return

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, onClose, preventClose])

  if (!open) return null

  const panelStyle = { width: typeof width === 'number' ? `${width}px` : width }

  const tryClose = () => {
    if (!preventClose) onClose()
  }

  return (
    <div
      className={styles.overlay}
      data-align={align}
      onClick={(event) => {
        if (event.target === event.currentTarget) tryClose()
      }}
    >
      <div className={styles.panel} style={panelStyle} role="dialog" aria-modal="true">
        {title ? (
          <header className={styles.header}>
            <div className={styles.headerStart}>
              {onBack ? (
                <button type="button" className={styles.back} onClick={onBack} aria-label={backLabel}>
                  ←
                </button>
              ) : null}
              <h2 className={styles.title}>{title}</h2>
            </div>
            <button
              type="button"
              className={styles.close}
              onClick={tryClose}
              disabled={preventClose}
              aria-label={preventClose ? 'Close disabled during upload' : 'Close'}
              title={preventClose ? 'Finish or cancel the picture upload first' : 'Close'}
            >
              ×
            </button>
          </header>
        ) : null}
        <div className={styles.body}>{children}</div>
      </div>
    </div>
  )
}
