import { useEffect, useMemo } from 'react'
import { buildInspection360ViewerPageUrl } from '@/lib/insp360Viewer'
import styles from './Inspection360Viewer.module.css'

export interface Inspection360ViewerProps {
  open: boolean
  title: string
  buildingAddress: string
  suiteName: string
  projectUrl: string | null
  scene: string | null
  onClose: () => void
}

export function Inspection360Viewer({
  open,
  title,
  buildingAddress,
  suiteName,
  projectUrl,
  scene,
  onClose,
}: Inspection360ViewerProps) {
  const iframeSrc = useMemo(() => {
    if (!open || !projectUrl) return null
    return buildInspection360ViewerPageUrl({
      projectUrl,
      scene,
      title: title || suiteName,
    })
  }, [open, projectUrl, scene, title, suiteName])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className={styles.inspection360Overlay} role="dialog" aria-label="360 degree tour viewer">
      <header className={styles.header}>
        <div className={styles.headerText}>
          <div className={styles.title}>{title || suiteName || '360° tour'}</div>
          <div className={styles.subtitle}>{buildingAddress}</div>
        </div>
        <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="Close 360 tour">
          ✕
        </button>
      </header>

      {iframeSrc ? (
        <div className={styles.frameWrap}>
          <iframe
            className={styles.frame}
            src={iframeSrc}
            title={`360 degree tour — ${suiteName}`}
            allow="fullscreen"
          />
        </div>
      ) : (
        <div className={styles.noTour}>
          <p>
            <strong>No tour file linked yet.</strong>
          </p>
          <p>
            Open Settings → Edit 360° Gates, select this suite, and paste the path or URL to your
            `.insp360` project file in the Tour URL field. Then save your map changes.
          </p>
        </div>
      )}
    </div>
  )
}
