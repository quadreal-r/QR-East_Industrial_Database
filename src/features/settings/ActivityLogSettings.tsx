import { useState } from 'react'
import { Button } from '@/components/Button/Button'
import { Modal } from '@/components/Modal/Modal'
import { fetchActivityReport } from '@/data/activityApi'
import {
  ACTIVITY_REPORT_TO,
  activityReportFilename,
  activityReportMailto,
  clampActivityHours,
  type ActivityReport,
} from '@/lib/activityLog'
import { showToastError, showToastSuccess } from '@/lib/toast'
import selectStyles from '@/components/Select/Select.module.css'
import styles from './SettingsModal.module.css'

export interface ActivityLogSettingsProps {
  open: boolean
  onClose: () => void
}

function downloadText(filename: string, text: string) {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export function ActivityLogSettings({ open, onClose }: ActivityLogSettingsProps) {
  const [hours, setHours] = useState(24)
  const [report, setReport] = useState<ActivityReport | null>(null)
  const [busy, setBusy] = useState(false)

  const handleFetch = async () => {
    setBusy(true)
    try {
      const data = await fetchActivityReport(clampActivityHours(hours))
      setReport(data)
      showToastSuccess(
        `✓ Activity log ready to download (${data.eventCount} event${data.eventCount === 1 ? '' : 's'})`,
      )
    } catch (error) {
      showToastError(error instanceof Error ? error.message : 'Could not fetch activity log')
    } finally {
      setBusy(false)
    }
  }

  const handleDownload = () => {
    if (!report?.text) {
      showToastError('Fetch the activity log first.')
      return
    }
    downloadText(activityReportFilename(report), report.text)
    showToastSuccess('✓ Activity log downloaded')
  }

  const handleEmail = async () => {
    setBusy(true)
    try {
      const data = report ?? (await fetchActivityReport(clampActivityHours(hours)))
      setReport(data)
      try {
        await navigator.clipboard.writeText(data.text)
      } catch {
        /* mailto still opens */
      }
      window.location.href = activityReportMailto(data)
      showToastSuccess(`✓ Digest copied — paste into email to ${ACTIVITY_REPORT_TO}`)
    } catch (error) {
      showToastError(error instanceof Error ? error.message : 'Could not prepare email digest')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Activity log" width={520} align="center">
      <div className={styles.body}>
        <p className={styles.hint}>
          Silent usage log for who signed in, time in the app, 360° tour opens, and map edits
          (saves, imports, tour links, roles). Same idea as QR-360° Inspections.
        </p>

        <div className={styles.activityToolbar}>
          <label className={styles.mgrFieldLabel} htmlFor="activity-hours">
            Lookback window
          </label>
          <select
            id="activity-hours"
            className={selectStyles.select}
            value={hours}
            onChange={(event) => {
              setHours(clampActivityHours(event.target.value))
              setReport(null)
            }}
            disabled={busy}
          >
            <option value={24}>Last 24 hours</option>
            <option value={48}>Last 48 hours</option>
            <option value={168}>Last 7 days</option>
          </select>

          <div className={styles.activityActions}>
            <Button type="button" variant="ghost" onClick={() => void handleFetch()} disabled={busy}>
              Fetch
            </Button>
            <Button type="button" variant="ghost" onClick={handleDownload} disabled={busy || !report}>
              Download
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => void handleEmail()}
              disabled={busy}
              title={`Email digest to ${ACTIVITY_REPORT_TO}`}
            >
              Email digest
            </Button>
          </div>
        </div>

        {report ? (
          <div className={styles.activityPreviewWrap}>
            <p className={styles.userListMeta}>
              {report.eventCount} event{report.eventCount === 1 ? '' : 's'} ·{' '}
              {report.uniqueUsers} user{report.uniqueUsers === 1 ? '' : 's'} · {report.hours}h window
            </p>
            <pre className={styles.activityPreview} tabIndex={0}>
              {report.text}
            </pre>
          </div>
        ) : (
          <p className={styles.hint}>Fetch to load a digest for Download or Email.</p>
        )}
      </div>
    </Modal>
  )
}
