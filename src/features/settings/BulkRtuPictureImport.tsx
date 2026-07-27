import { useRef, useState, useEffect } from 'react'
import {
  bulkImportRtuPictures,
  formatBulkRtuPictureImportReport,
  type BulkRtuPictureImportProgress,
  type BulkRtuPictureImportResult,
} from '@/lib/rtuBulkPictureImport'
import { showToastError, showToastSuccess } from '@/lib/toast'
import type { PortfolioData } from '@/types/domain'
import { SettingsToolButton } from '@/features/settings/SettingsToolButton'
import styles from './SettingsModal.module.css'

export interface BulkRtuPictureImportProps {
  portfolio: PortfolioData
  onBusyChange?: (busy: boolean) => void
}

function downloadImportReport(result: BulkRtuPictureImportResult): void {
  const text = formatBulkRtuPictureImportReport(result)
  const stamp = result.completedAt.slice(0, 19).replace(/[:T]/g, '-')
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `rtu-picture-import-${stamp}.txt`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

function ImportReportList({ items }: { items: { file: string; detail: string }[] }) {
  return (
    <ul>
      {items.map((item) => (
        <li key={`${item.file}-${item.detail}`}>
          <span className={styles.importFile}>{item.file}</span> — {item.detail}
        </li>
      ))}
    </ul>
  )
}

export function BulkRtuPictureImport({ portfolio, onBusyChange }: BulkRtuPictureImportProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<BulkRtuPictureImportProgress | null>(null)
  const [report, setReport] = useState<BulkRtuPictureImportResult | null>(null)

  useEffect(() => {
    onBusyChange?.(busy)
  }, [busy, onBusyChange])

  useEffect(
    () => () => {
      onBusyChange?.(false)
    },
    [onBusyChange],
  )

  const handleCancel = () => {
    abortRef.current?.abort()
  }

  const handleFolderChange = () => {
    void (async () => {
      const input = inputRef.current
      if (!input?.files?.length) return

      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller

      setBusy(true)
      setReport(null)
      setProgress({ processed: 0, total: input.files.length, currentFile: '' })

      try {
        const files = [...input.files]
        const result = await bulkImportRtuPictures(portfolio.buildings, files, {
          signal: controller.signal,
          onProgress: setProgress,
        })
        setReport(result)

        if (result.cancelled) {
          showToastError(
            result.imported > 0
              ? `Import cancelled — ${result.imported} picture${result.imported === 1 ? '' : 's'} imported before stop`
              : 'Import cancelled',
          )
        } else if (result.imported > 0) {
          showToastSuccess(
            `✓ Imported ${result.imported} picture${result.imported === 1 ? '' : 's'} — see report below`,
          )
        } else {
          showToastError('No pictures were imported — see report below')
        }
      } catch (e) {
        showToastError(e instanceof Error ? e.message : 'Bulk import failed')
      } finally {
        setBusy(false)
        setProgress(null)
        abortRef.current = null
        input.value = ''
      }
    })()
  }

  const progressPct =
    progress && progress.total > 0
      ? Math.round((progress.processed / progress.total) * 100)
      : 0

  return (
    <div className={styles.bulkImport}>
      <div className={styles.bulkImportRow}>
        <SettingsToolButton
          tooltip={
            <>
              Select a folder of RTU photos. Filenames like 2320-RTU-04-1.jpg, 2320-RTU-04 (2).jpg,
              2320-RTU-04 Hybrid.jpg, 6150E-RTU-01-1.jpg (East), or 6150W-RTU-10-1.jpg (West) match by
              building street number (plus East/West letter when needed) and RTU unit id only (GPS is
              ignored). RTU-04 does not match RTU-04B. Files or folders with &quot;old&quot; in the name
              are skipped.
            </>
          }
          onClick={() => inputRef.current?.click()}
          disabled={busy}
        >
          <span className={styles.bulkImportBtnInner}>
            {busy ? (
              <span
                className={styles.bulkImportBtnFill}
                style={{ width: `${progressPct}%` }}
                aria-hidden="true"
              />
            ) : null}
            <span className={styles.bulkImportBtnText}>
              {busy
                ? progress
                  ? `Importing ${progress.processed} / ${progress.total} (${progressPct}%)`
                  : 'Importing pictures…'
                : 'Upload RTU Pictures in Bulk'}
            </span>
          </span>
        </SettingsToolButton>
        {busy ? (
          <button type="button" className={styles.bulkImportCancel} onClick={handleCancel}>
            Cancel
          </button>
        ) : null}
      </div>
      {busy && progress?.currentFile ? (
        <p className={styles.bulkImportFile} title={progress.currentFile}>
          {progress.currentFile.replace(/^.*[/\\]/, '')}
        </p>
      ) : null}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        className={styles.hiddenFile}
        // @ts-expect-error webkitdirectory is supported in Chromium browsers
        webkitdirectory=""
        onChange={handleFolderChange}
      />
      {report ? (
        <div className={styles.importReport}>
          <div className={styles.importReportHeader}>
            <div>
              <div className={styles.importReportTitle}>Upload report</div>
              <div className={styles.importSummary}>
                {report.cancelled ? 'Cancelled — ' : null}
                {report.totalFiles} file{report.totalFiles === 1 ? '' : 's'} in folder · Imported{' '}
                <strong>{report.imported}</strong>
                {report.skipped ? (
                  <>
                    {' '}
                    · Skipped <strong>{report.skipped}</strong>
                  </>
                ) : null}
                {report.excluded.length ? (
                  <>
                    {' '}
                    · Excluded <strong>{report.excluded.length}</strong>
                  </>
                ) : null}
                {report.warnings.length ? (
                  <>
                    {' '}
                    ·{' '}
                    <span className={styles.importSummaryWarning}>
                      Warnings <strong>{report.warnings.length}</strong>
                    </span>
                  </>
                ) : null}
              </div>
            </div>
            <button
              type="button"
              className={styles.importDownloadBtn}
              onClick={() => downloadImportReport(report)}
            >
              Download report
            </button>
          </div>

          {report.successes.length ? (
            <details className={styles.importDetails} open>
              <summary>
                {report.successes.length} imported picture{report.successes.length === 1 ? '' : 's'}
              </summary>
              <ImportReportList
                items={report.successes.map((s) => ({
                  file: s.file,
                  detail: `${s.rtuName} @ ${s.buildingAddress} (#${s.pictureIndex}) → ${s.storedFileName}`,
                }))}
              />
            </details>
          ) : null}

          {report.warnings.length ? (
            <details className={`${styles.importDetails} ${styles.importDetailsWarning}`} open>
              <summary>
                {report.warnings.length} warning{report.warnings.length === 1 ? '' : 's'}
              </summary>
              <ImportReportList
                items={report.warnings.map((w) => ({ file: w.file, detail: w.message }))}
              />
            </details>
          ) : null}

          {report.failures.length ? (
            <details className={styles.importDetails} open={!report.successes.length}>
              <summary>
                {report.failures.length} skipped file{report.failures.length === 1 ? '' : 's'}
              </summary>
              <ImportReportList
                items={report.failures.map((f) => ({ file: f.file, detail: f.reason }))}
              />
            </details>
          ) : null}

          {report.excluded.length ? (
            <details className={styles.importDetails}>
              <summary>
                {report.excluded.length} excluded file{report.excluded.length === 1 ? '' : 's'}
              </summary>
              <ImportReportList
                items={report.excluded.map((e) => ({ file: e.file, detail: e.reason }))}
              />
            </details>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
