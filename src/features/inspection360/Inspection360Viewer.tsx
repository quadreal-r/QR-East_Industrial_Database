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
  gateKey: string | null
  onClose: () => void
}

export function Inspection360Viewer({
  open,
  title,
  buildingAddress,
  suiteName,
  projectUrl,
  scene,
  gateKey,
  onClose,
}: Inspection360ViewerProps) {
  const iframeSrc = useMemo(() => {
    if (!open) return null
    return buildInspection360ViewerPageUrl({
      projectUrl,
      scene,
      title: title || suiteName,
      gateKey,
    })
  }, [open, projectUrl, scene, title, suiteName, gateKey])

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
    <div className={styles.inspection360Overlay} role="dialog" aria-label="QR-360 degree tour viewer">
      <header className={styles.header}>
        <div className={styles.headerText}>
          <div className={styles.title}>{title || suiteName || '360° tour'}</div>
          <div className={styles.subtitle}>
            {buildingAddress}
            {!projectUrl
              ? ' · Open the .insp360 project for this gate (it will reopen next time)'
              : ''}
          </div>
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
            title={`QR-360° tour — ${suiteName}`}
            allow="fullscreen"
          />
        </div>
      ) : null}
    </div>
  )
}
