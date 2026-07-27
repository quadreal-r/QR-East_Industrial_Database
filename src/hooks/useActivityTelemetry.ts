import { useEffect, useRef } from 'react'
import { recordActivityEvent } from '@/data/activityApi'
import { useAuth } from '@/hooks/useAuth'

const HEARTBEAT_MS = 60_000

/**
 * Silent session telemetry while signed in (heartbeat + session_end).
 * Login is recorded once when authentication becomes available.
 */
export function useActivityTelemetry() {
  const { isAuthenticated, email, session } = useAuth()
  const loginRecordedFor = useRef<string | null>(null)
  const sessionStartedAt = useRef<number | null>(null)

  useEffect(() => {
    // Need a Supabase JWT before inserts can pass RLS.
    if (!isAuthenticated || !email || !session) {
      if (!isAuthenticated) {
        loginRecordedFor.current = null
        sessionStartedAt.current = null
      }
      return
    }

    const normalized = email.trim().toLowerCase()
    if (loginRecordedFor.current !== normalized) {
      loginRecordedFor.current = normalized
      sessionStartedAt.current = Date.now()
      void recordActivityEvent({ eventType: 'login', email: normalized })
    } else if (sessionStartedAt.current == null) {
      sessionStartedAt.current = Date.now()
    }

    const sendHeartbeat = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
      void recordActivityEvent({ eventType: 'heartbeat', email: normalized })
    }

    const endSession = (reason: string) => {
      const started = sessionStartedAt.current
      const durationMs = started != null ? Date.now() - started : null
      sessionStartedAt.current = null
      void recordActivityEvent({
        eventType: 'session_end',
        email: normalized,
        durationMs,
        meta: { reason },
      })
    }

    sendHeartbeat()
    const timer = window.setInterval(sendHeartbeat, HEARTBEAT_MS)

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') endSession('hidden')
      else if (document.visibilityState === 'visible') {
        sessionStartedAt.current = Date.now()
        sendHeartbeat()
      }
    }
    const onPageHide = () => endSession('pagehide')

    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pagehide', onPageHide)

    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pagehide', onPageHide)
      endSession('unmount')
    }
  }, [isAuthenticated, email, session])
}
