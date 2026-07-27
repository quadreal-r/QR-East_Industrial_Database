import { supabase } from '@/lib/supabaseClient'
import {
  ACTIVITY_EVENT_TYPE_SET,
  buildActivityReport,
  clampActivityHours,
  clampDurationMs,
  normalizeActivityEmail,
  sanitizeActivityMeta,
  sanitizeResourceKey,
  type ActivityEventRow,
  type ActivityEventType,
  type ActivityReport,
} from '@/lib/activityLog'
import type { Json } from '@/types/database.types'

export interface RecordActivityInput {
  eventType: ActivityEventType
  /** Prefer JWT email; pass only when session email is already known (e.g. login). */
  email?: string | null
  resourceKey?: string | null
  durationMs?: number | null
  meta?: Record<string, unknown> | null
}

/**
 * Fire-and-forget activity write. Never throws — failures stay silent.
 */
export async function recordActivityEvent(input: RecordActivityInput): Promise<void> {
  try {
    if (!ACTIVITY_EVENT_TYPE_SET.has(input.eventType)) return

    let email = normalizeActivityEmail(input.email)
    if (!email) {
      const { data } = await supabase.auth.getSession()
      email = normalizeActivityEmail(data.session?.user?.email)
    }
    if (!email || !email.includes('@')) return

    const { error } = await supabase.from('activity_events').insert({
      email,
      event_type: input.eventType,
      resource_key: sanitizeResourceKey(input.resourceKey),
      duration_ms: clampDurationMs(input.durationMs),
      meta: sanitizeActivityMeta(input.meta) as Json | null,
    })
    if (error) {
      console.warn('activity_events insert failed', error.message)
    }
  } catch (err) {
    console.warn('activity_events insert failed', err)
  }
}

function mapRow(row: {
  email: string
  event_type: string
  resource_key: string | null
  duration_ms: number | null
  meta: Json | null
  created_at: string
}): ActivityEventRow {
  return {
    email: row.email,
    event_type: row.event_type,
    resource_key: row.resource_key,
    duration_ms: row.duration_ms,
    meta:
      row.meta && typeof row.meta === 'object' && !Array.isArray(row.meta)
        ? (row.meta as Record<string, unknown>)
        : null,
    created_at: row.created_at,
  }
}

/** Admin-only: load events for the last `hours` and build a digest. */
export async function fetchActivityReport(hours: number): Promise<ActivityReport> {
  const h = clampActivityHours(hours)
  const until = new Date()
  const since = new Date(until.getTime() - h * 60 * 60 * 1000)

  const { data, error } = await supabase
    .from('activity_events')
    .select('email, event_type, resource_key, duration_ms, meta, created_at')
    .gte('created_at', since.toISOString())
    .lt('created_at', until.toISOString())
    .order('created_at', { ascending: true })
    .limit(5000)

  if (error) throw error

  const events = (data ?? []).map(mapRow)
  return buildActivityReport(events, h, until)
}
