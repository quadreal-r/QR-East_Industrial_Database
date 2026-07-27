import { describe, expect, it } from 'vitest'
import {
  buildActivityReport,
  buildActivityReportText,
  clampActivityHours,
  estimateActiveMs,
  type ActivityEventRow,
} from '@/lib/activityLog'

function ev(
  partial: Partial<ActivityEventRow> & Pick<ActivityEventRow, 'email' | 'event_type' | 'created_at'>,
): ActivityEventRow {
  return {
    resource_key: null,
    duration_ms: null,
    meta: null,
    ...partial,
  }
}

describe('clampActivityHours', () => {
  it('defaults and clamps', () => {
    expect(clampActivityHours(undefined)).toBe(24)
    expect(clampActivityHours(0)).toBe(24)
    expect(clampActivityHours(48)).toBe(48)
    expect(clampActivityHours(999)).toBe(168)
  })
})

describe('estimateActiveMs', () => {
  it('sums heartbeat gaps within the cap', () => {
    const ms = estimateActiveMs([
      ev({
        email: 'a@x.com',
        event_type: 'heartbeat',
        created_at: '2026-07-23T12:00:00.000Z',
      }),
      ev({
        email: 'a@x.com',
        event_type: 'heartbeat',
        created_at: '2026-07-23T12:01:00.000Z',
      }),
    ])
    expect(ms).toBe(60_000)
  })

  it('uses session_end duration_ms', () => {
    const ms = estimateActiveMs([
      ev({
        email: 'a@x.com',
        event_type: 'session_end',
        created_at: '2026-07-23T12:00:00.000Z',
        duration_ms: 120_000,
      }),
    ])
    expect(ms).toBe(120_000)
  })
})

describe('buildActivityReportText', () => {
  it('reports empty period', () => {
    const report = buildActivityReportText(
      [],
      '2026-07-22T12:00:00.000Z',
      '2026-07-23T12:00:00.000Z',
    )
    expect(report.eventCount).toBe(0)
    expect(report.text).toContain('No activity')
  })

  it('summarizes sign-ins, tours, and map edits', () => {
    const events: ActivityEventRow[] = [
      ev({
        email: 'admin@quadreal.com',
        event_type: 'login',
        created_at: '2026-07-23T10:00:00.000Z',
      }),
      ev({
        email: 'admin@quadreal.com',
        event_type: 'tour_open_ok',
        created_at: '2026-07-23T10:05:00.000Z',
        resource_key: 'gate:suite:1',
        duration_ms: 2500,
      }),
      ev({
        email: 'admin@quadreal.com',
        event_type: 'portfolio_save',
        created_at: '2026-07-23T10:10:00.000Z',
        resource_key: 'portfolio',
      }),
      ev({
        email: 'viewer@quadreal.com',
        event_type: 'login',
        created_at: '2026-07-23T11:00:00.000Z',
      }),
    ]
    const report = buildActivityReport(events, 24, new Date('2026-07-23T12:00:00.000Z'))
    expect(report.eventCount).toBe(4)
    expect(report.uniqueUsers).toBe(2)
    expect(report.text).toContain('admin@quadreal.com')
    expect(report.text).toContain('Opens ok: 1')
    expect(report.text).toContain('Portfolio saves: 1')
    expect(report.text).toContain('QR East map activity log')
  })
})
