/** Activity log event types + digest builder (admin Settings). */

export const ACTIVITY_REPORT_TO = 'quadreal.rpiwin@gmail.com'

export const ACTIVITY_EVENT_TYPES = [
  'login',
  'logout',
  'heartbeat',
  'session_end',
  'tour_open_ok',
  'tour_open_fail',
  'tour_publish',
  'tour_link',
  'tour_unlink',
  'portfolio_save',
  'excel_import',
  'excel_export',
  'role_save',
  'role_delete',
  'budget_save',
  'schedule_save',
] as const

export type ActivityEventType = (typeof ACTIVITY_EVENT_TYPES)[number]

export const ACTIVITY_EVENT_TYPE_SET = new Set<string>(ACTIVITY_EVENT_TYPES)

export interface ActivityEventRow {
  email: string
  event_type: string
  resource_key: string | null
  duration_ms: number | null
  meta: Record<string, unknown> | null
  created_at: string
}

export interface ActivityReport {
  periodStart: string
  periodEnd: string
  hours: number
  text: string
  eventCount: number
  uniqueUsers: number
}

const HEARTBEAT_GAP_CAP_MS = 90_000
const MAX_RESOURCE_KEY_LEN = 512
const MAX_META_JSON_LEN = 1500

export function clampActivityHours(raw: unknown): number {
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) return 24
  return Math.min(168, Math.max(1, Math.floor(n)))
}

export function normalizeActivityEmail(email: string | null | undefined): string {
  return String(email || '')
    .trim()
    .toLowerCase()
}

export function sanitizeResourceKey(key: string | null | undefined): string | null {
  if (key == null || key === '') return null
  const k = String(key).slice(0, MAX_RESOURCE_KEY_LEN)
  if (k.includes('..')) return null
  return k
}

export function clampDurationMs(ms: number | null | undefined): number | null {
  if (ms == null) return null
  const n = Number(ms)
  if (!Number.isFinite(n) || n < 0) return null
  return Math.min(Math.floor(n), 24 * 60 * 60 * 1000)
}

export function sanitizeActivityMeta(
  meta: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (meta == null || typeof meta !== 'object' || Array.isArray(meta)) return null
  try {
    const s = JSON.stringify(meta)
    if (s.length > MAX_META_JSON_LEN) {
      return { truncated: true, preview: s.slice(0, MAX_META_JSON_LEN) }
    }
    return meta
  } catch {
    return null
  }
}

function formatMinutes(ms: number): string {
  const m = Math.round(ms / 60000)
  if (m < 1) return '<1 min'
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  const rem = m % 60
  return rem ? `${h}h ${rem}m` : `${h}h`
}

function formatMs(ms: number | null): string {
  if (ms == null || !Number.isFinite(ms)) return '—'
  if (ms < 1000) return `${Math.round(ms)} ms`
  return `${(ms / 1000).toFixed(1)} s`
}

function percentile(sorted: number[], p: number): number | null {
  if (!sorted.length) return null
  const first = sorted[0]
  if (sorted.length === 1) return first ?? null
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))
  return sorted[idx] ?? null
}

/** Estimate active time from heartbeat / session_end events for one user. */
export function estimateActiveMs(events: ActivityEventRow[]): number {
  const timed = events
    .filter((e) => e.event_type === 'heartbeat' || e.event_type === 'session_end')
    .slice()
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))

  let total = 0
  for (let i = 0; i < timed.length; i++) {
    const ev = timed[i]
    if (!ev) continue
    if (
      ev.event_type === 'session_end' &&
      ev.duration_ms != null &&
      Number.isFinite(Number(ev.duration_ms))
    ) {
      total += Math.min(Number(ev.duration_ms), 8 * 60 * 60 * 1000)
      continue
    }
    if (ev.event_type === 'heartbeat' && i > 0) {
      const prev = timed[i - 1]
      if (!prev) continue
      if (prev.event_type === 'heartbeat' || prev.event_type === 'session_end') {
        const gap = new Date(ev.created_at).getTime() - new Date(prev.created_at).getTime()
        if (Number.isFinite(gap) && gap > 0 && gap <= HEARTBEAT_GAP_CAP_MS) {
          total += gap
        }
      }
    }
  }
  return total
}

function hoursLabel(sinceIso: string, untilIso: string): string {
  const ms = new Date(untilIso).getTime() - new Date(sinceIso).getTime()
  if (!Number.isFinite(ms) || ms <= 0) return '24h'
  const h = Math.round(ms / (60 * 60 * 1000))
  return `${Math.max(1, h)}h`
}

const MOD_TYPES: Array<[ActivityEventType, string]> = [
  ['portfolio_save', 'Portfolio saves'],
  ['excel_import', 'Excel imports'],
  ['excel_export', 'Excel exports'],
  ['tour_publish', 'Tour publishes'],
  ['tour_link', 'Tour links'],
  ['tour_unlink', 'Tour unlinks'],
  ['budget_save', 'Budget saves'],
  ['schedule_save', 'Schedule saves'],
  ['role_save', 'Role saves'],
  ['role_delete', 'Role removals'],
]

const MOD_TYPE_SET = new Set(MOD_TYPES.map(([t]) => t))

/**
 * Build plain-text activity digest for [sinceIso, untilIso).
 */
export function buildActivityReportText(
  events: ActivityEventRow[],
  sinceIso: string,
  untilIso: string,
): Omit<ActivityReport, 'periodStart' | 'periodEnd' | 'hours'> {
  const periodLabel = sinceIso.slice(0, 10)
  const label = hoursLabel(sinceIso, untilIso)

  if (!events.length) {
    return {
      text:
        `QR East map activity log — ${periodLabel} (${label})\n\n` +
        `No activity in this period.\n` +
        `(Window ${sinceIso} → ${untilIso})`,
      eventCount: 0,
      uniqueUsers: 0,
    }
  }

  const byUser = new Map<string, ActivityEventRow[]>()
  for (const ev of events) {
    const em = normalizeActivityEmail(ev.email)
    if (!byUser.has(em)) byUser.set(em, [])
    byUser.get(em)!.push(ev)
  }

  const signInLines: Array<{ email: string; count: number; first: string; last: string }> = []
  for (const [em, list] of [...byUser.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const logins = list.filter((e) => e.event_type === 'login')
    if (!logins.length) continue
    const times = logins.map((e) => e.created_at)
    const first = times[0]
    const last = times[times.length - 1]
    if (!first || !last) continue
    signInLines.push({
      email: em,
      count: logins.length,
      first,
      last,
    })
  }

  const timeLines: Array<{ email: string; ms: number }> = []
  for (const [em, list] of [...byUser.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const ms = estimateActiveMs(list)
    if (ms > 0 || list.some((e) => e.event_type === 'heartbeat' || e.event_type === 'session_end')) {
      timeLines.push({ email: em, ms })
    }
  }

  const opensOk = events.filter((e) => e.event_type === 'tour_open_ok')
  const opensFail = events.filter((e) => e.event_type === 'tour_open_fail')
  const loadMs = opensOk
    .map((e) => Number(e.duration_ms))
    .filter((n) => Number.isFinite(n) && n >= 0)
    .sort((a, b) => a - b)
  const avg = loadMs.length > 0 ? loadMs.reduce((a, b) => a + b, 0) / loadMs.length : null
  const med = percentile(loadMs, 50)
  const p95 = percentile(loadMs, 95)

  const byTour = new Map<string, number[]>()
  for (const e of opensOk) {
    const k = e.resource_key || '(unknown)'
    if (!byTour.has(k)) byTour.set(k, [])
    if (e.duration_ms != null && Number.isFinite(Number(e.duration_ms))) {
      byTour.get(k)!.push(Number(e.duration_ms))
    }
  }
  const slowest = [...byTour.entries()]
    .map(([key, times]) => ({
      key,
      avg: times.length ? times.reduce((a, b) => a + b, 0) / times.length : 0,
      count: times.length,
      max: times.length ? Math.max(...times) : 0,
    }))
    .sort((a, b) => b.max - a.max)
    .slice(0, 5)

  const mods = events.filter((e) => MOD_TYPE_SET.has(e.event_type as ActivityEventType))
  const modCounts = Object.fromEntries(
    MOD_TYPES.map(([type]) => [type, mods.filter((e) => e.event_type === type).length]),
  ) as Record<string, number>
  const modLabel: Record<string, string> = {
    portfolio_save: 'portfolio save',
    excel_import: 'excel import',
    excel_export: 'excel export',
    tour_publish: 'tour publish',
    tour_link: 'tour link',
    tour_unlink: 'tour unlink',
    budget_save: 'budget',
    schedule_save: 'schedule',
    role_save: 'role save',
    role_delete: 'role remove',
  }
  const modDetailLines = mods.slice(0, 50).map((e) => ({
    email: e.email,
    action: modLabel[e.event_type] || e.event_type,
    resource_key: e.resource_key || '?',
    created_at: e.created_at,
  }))

  const logouts = events.filter((e) => e.event_type === 'logout')

  const lines: string[] = []
  lines.push(`QR East map activity log — ${periodLabel} (${label})`)
  lines.push(`Window: ${sinceIso} → ${untilIso}`)
  lines.push(`Events: ${events.length} · Unique users: ${byUser.size}`)
  lines.push('')

  lines.push('1. Sign-ins')
  if (!signInLines.length) {
    lines.push('  (none)')
  } else {
    for (const s of signInLines) {
      lines.push(`  ${s.email} — ${s.count} login(s); first ${s.first}; last ${s.last}`)
    }
  }
  lines.push('')

  lines.push('2. Time in app (estimated)')
  if (!timeLines.length) {
    lines.push('  (none)')
  } else {
    for (const t of timeLines) {
      lines.push(`  ${t.email} — ${formatMinutes(t.ms)}`)
    }
  }
  lines.push('')

  lines.push('3. 360° tour opens')
  lines.push(
    `  Opens ok: ${opensOk.length} · Failures: ${opensFail.length}` +
      (loadMs.length
        ? ` · median ${formatMs(med)} · p95 ${formatMs(p95)} · avg ${formatMs(avg)}`
        : ''),
  )
  if (slowest.length) {
    lines.push('  Slowest tours:')
    for (const s of slowest) {
      lines.push(`    ${s.key} — max ${formatMs(s.max)} (avg ${formatMs(s.avg)}, n=${s.count})`)
    }
  }
  lines.push('')

  lines.push('4. Map edits & admin actions')
  lines.push(
    `  Portfolio saves: ${modCounts.portfolio_save} · Excel import: ${modCounts.excel_import}` +
      ` · Excel export: ${modCounts.excel_export}` +
      ` · Tour publish: ${modCounts.tour_publish} · Tour link: ${modCounts.tour_link}` +
      ` · Tour unlink: ${modCounts.tour_unlink}` +
      ` · Budget: ${modCounts.budget_save} · Schedule: ${modCounts.schedule_save}` +
      ` · Role save: ${modCounts.role_save} · Role remove: ${modCounts.role_delete}`,
  )
  if (modDetailLines.length) {
    for (const m of modDetailLines) {
      lines.push(`    ${m.email} — ${m.action} → ${m.resource_key} @ ${m.created_at}`)
    }
  } else {
    lines.push('  (none)')
  }
  lines.push('')

  lines.push('5. Other')
  lines.push(`  Logouts: ${logouts.length}`)

  return {
    text: lines.join('\n'),
    eventCount: events.length,
    uniqueUsers: byUser.size,
  }
}

export function buildActivityReport(
  events: ActivityEventRow[],
  hours: number,
  now = new Date(),
): ActivityReport {
  const h = clampActivityHours(hours)
  const until = now
  const since = new Date(until.getTime() - h * 60 * 60 * 1000)
  const periodStart = since.toISOString()
  const periodEnd = until.toISOString()
  const built = buildActivityReportText(events, periodStart, periodEnd)
  return {
    periodStart,
    periodEnd,
    hours: h,
    ...built,
  }
}

export function activityReportFilename(report: ActivityReport): string {
  const day = (report.periodStart || '').slice(0, 10) || 'log'
  return `qr-east-activity-${day}-${report.hours}h.txt`
}

export function activityReportMailto(report: ActivityReport): string {
  const subject = `QR East map activity log — ${report.periodStart.slice(0, 10)} (${report.hours}h)`
  // Keep body short enough for mailto; full digest is copied to clipboard separately.
  const body =
    `Digest ready (also copied to clipboard).\n\n` +
    `Events: ${report.eventCount} · Users: ${report.uniqueUsers}\n` +
    `Window: ${report.periodStart} → ${report.periodEnd}\n`
  return `mailto:${encodeURIComponent(ACTIVITY_REPORT_TO)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
}
