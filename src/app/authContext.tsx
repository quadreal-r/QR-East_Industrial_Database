import {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type { Session } from '@supabase/supabase-js'
import {
  clearAuthLoggedOutLatch,
  clearBrowserAuthStorage,
  isAuthLoggedOutLatchSet,
  isCloudflareAccessHost,
  markAuthLoggedOutLatch,
  redirectToCloudflareAccessApp,
  redirectToCloudflareAccessWall,
} from '@/lib/cloudflareAccess'
import {
  normalizeAppRole,
  shouldBootstrapSilentSession,
  type AppRole,
} from '@/lib/appRoles'
import {
  getLocalDevAs,
  isLocalDevHost,
  setLocalDevAs,
  type LocalDevAs,
} from '@/lib/localDevAuth'
import { recordActivityEvent } from '@/data/activityApi'
import { supabase } from '@/lib/supabaseClient'
import { errorMessage } from '@/lib/errorMessage'

export type { AppRole } from '@/lib/appRoles'

interface SilentSessionResponse {
  access_token: string
  refresh_token: string
  email: string
  role: AppRole
}

interface AuthContextValue {
  session: Session | null
  user: Session['user'] | null
  /** Access / app identity email (preferred for UI). */
  email: string | null
  role: AppRole | null
  canEdit: boolean
  isLoading: boolean
  isAuthenticated: boolean
  error: string | null
  /** True on 127.0.0.1 / localhost (no Cloudflare Access wall). */
  isLocalDev: boolean
  signOut: () => Promise<void>
  signInAtAccessWall: () => void
  /** Localhost only: sign in as an Admin or Viewer from Manage users. */
  signInAsLocal: (role: LocalDevAs) => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

export { AuthContext, type AuthContextValue }

/** Share one in-flight mint across React Strict Mode remounts. */
let silentSessionInFlight: Promise<SilentSessionResponse> | null = null

function resetSilentSessionInFlight(): void {
  silentSessionInFlight = null
}

/** Localhost logout latch — Access hosts ignore it (wall already gated the page). */
function shouldBlockSessionReplay(): boolean {
  return isAuthLoggedOutLatchSet() && !isCloudflareAccessHost()
}

async function fetchSilentSession(): Promise<SilentSessionResponse> {
  if (!silentSessionInFlight) {
    silentSessionInFlight = (async () => {
      const loadOnce = async (): Promise<SilentSessionResponse> => {
        const as = isLocalDevHost() ? getLocalDevAs() : null
        const sessionPath = as ? `/api/session?as=${encodeURIComponent(as)}` : '/api/session'
        const response = await fetch(sessionPath, {
          method: 'GET',
          credentials: 'same-origin',
          headers: { Accept: 'application/json' },
        })
        const text = await response.text()
        let body: Partial<SilentSessionResponse> & {
          error?: unknown
          detail?: unknown
        }
        try {
          body = JSON.parse(text) as typeof body
        } catch {
          throw new Error(
            response.redirected || text.trimStart().startsWith('<')
              ? 'Cloudflare Access blocked the session service'
              : 'Session service returned an invalid response',
          )
        }
        if (!response.ok) {
          throw new Error(
            errorMessage(
              body.detail,
              errorMessage(body.error, 'Could not connect your application session'),
            ) ||
              errorMessage(body.error, 'Could not connect your application session'),
          )
        }
        if (!body.access_token || !body.refresh_token || !body.email) {
          throw new Error('The session service returned an incomplete response')
        }
        return {
          access_token: body.access_token,
          refresh_token: body.refresh_token,
          email: body.email,
          role: normalizeAppRole(body.role),
        }
      }

      try {
        return await loadOnce()
      } catch (firstError) {
        // One retry covers Access cookie settle / JWKS cold-start blips.
        await new Promise((resolve) => globalThis.setTimeout(resolve, 400))
        try {
          return await loadOnce()
        } catch {
          throw firstError
        }
      }
    })().finally(() => {
      // Allow a later manual retry (Sign in) to mint again.
      globalThis.setTimeout(() => {
        silentSessionInFlight = null
      }, 0)
    })
  }
  return silentSessionInFlight
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [email, setEmail] = useState<string | null>(null)
  const [role, setRole] = useState<AppRole | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [sessionBlocked, setSessionBlocked] = useState(shouldBlockSessionReplay)
  const sessionBlockedRef = useRef(sessionBlocked)

  useEffect(() => {
    sessionBlockedRef.current = sessionBlocked
  }, [sessionBlocked])

  useEffect(() => {
    let mounted = true
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (!mounted) return
      // After local Logout, never re-apply a recovered Supabase session.
      if (sessionBlockedRef.current) {
        if (nextSession) void supabase.auth.signOut({ scope: 'local' })
        setSession(null)
        setEmail(null)
        setRole(null)
        return
      }
      // Do not let INITIAL_SESSION null wipe a silent session we are about to apply.
      if (event === 'INITIAL_SESSION' && !nextSession) return
      if (event === 'SIGNED_OUT') {
        setSession(null)
        return
      }
      if (nextSession) {
        setSession(nextSession)
        if (nextSession.user?.email) setEmail(nextSession.user.email)
      }
    })

    void (async () => {
      try {
        if (shouldBootstrapSilentSession()) {
          setSessionBlocked(false)
          // Passing the Access wall (or localhost without a logout latch) means we should
          // mint an app session. Clear the latch so retries can bootstrap again.
          clearAuthLoggedOutLatch()
          const silent = await fetchSilentSession()
          if (!mounted) return
          if (sessionBlockedRef.current) return
          // Show identity immediately — do not wait on Supabase client persistence.
          setEmail(silent.email)
          setRole(silent.role)
          setError(null)

          const { data, error: sessionError } = await supabase.auth.setSession({
            access_token: silent.access_token,
            refresh_token: silent.refresh_token,
          })
          if (sessionError) throw sessionError
          if (!mounted || sessionBlockedRef.current) return
          setSession(data.session)
          if (data.session?.user?.email) {
            setEmail(data.session.user.email)
          }
        } else if (isAuthLoggedOutLatchSet()) {
          // Logged out on purpose — do not revive any stored Supabase session.
          setSessionBlocked(!isCloudflareAccessHost())
          markAuthLoggedOutLatch()
          resetSilentSessionInFlight()
          await supabase.auth.signOut({ scope: 'local' })
          clearBrowserAuthStorage()
          markAuthLoggedOutLatch()
          if (!mounted) return
          setSession(null)
          setEmail(null)
          setRole(null)
        } else {
          const { data } = await supabase.auth.getSession()
          if (!mounted) return
          setSession(data.session)
          setEmail(data.session?.user?.email ?? null)
          if (data.session) {
            const { data: currentRole } = await supabase.rpc('get_my_app_role')
            if (mounted) setRole(normalizeAppRole(currentRole))
          }
        }
      } catch (caught) {
        if (mounted) {
          setSession(null)
          // Keep email/role if we already received them from /api/session before setSession failed.
          setError(errorMessage(caught, 'Could not connect your session'))
        }
      } finally {
        if (mounted) setIsLoading(false)
      }
    })()

    return () => {
      mounted = false
      subscription.unsubscribe()
    }
  }, [])

  const signOut = useCallback(async () => {
    const logoutEmail = email ?? session?.user?.email ?? null
    if (logoutEmail) {
      await recordActivityEvent({ eventType: 'logout', email: logoutEmail })
    }
    // Localhost: block silent replay across refresh until Sign in.
    setSessionBlocked(!isCloudflareAccessHost())
    resetSilentSessionInFlight()
    clearBrowserAuthStorage()
    markAuthLoggedOutLatch()
    setSession(null)
    setEmail(null)
    setRole(null)
    setError(null)
    try {
      await supabase.auth.signOut({ scope: 'local' })
    } catch {
      /* still leave for Access wall */
    }
    // Re-assert after signOut in case the client touched storage.
    markAuthLoggedOutLatch()
    await redirectToCloudflareAccessWall()
  }, [email, session?.user?.email])

  const signInAtAccessWall = useCallback(() => {
    setSessionBlocked(false)
    resetSilentSessionInFlight()
    redirectToCloudflareAccessApp()
  }, [])

  const signInAsLocal = useCallback((nextRole: LocalDevAs) => {
    setLocalDevAs(nextRole)
    setSessionBlocked(false)
    resetSilentSessionInFlight()
    clearAuthLoggedOutLatch()
    if (typeof window !== 'undefined') window.location.reload()
  }, [])

  const displayEmail = email ?? session?.user?.email ?? null
  const isAuthenticated = !sessionBlocked && Boolean(displayEmail || session?.user)
  const isLocalDev = isLocalDevHost()

  const value = useMemo<AuthContextValue>(
    () => ({
      session: isAuthenticated ? session : null,
      user: isAuthenticated ? (session?.user ?? null) : null,
      email: isAuthenticated ? displayEmail : null,
      role: isAuthenticated ? role : null,
      canEdit: isAuthenticated && role === 'admin',
      isLoading,
      isAuthenticated,
      error,
      isLocalDev,
      signOut,
      signInAtAccessWall,
      signInAsLocal,
    }),
    [
      session,
      displayEmail,
      role,
      isLoading,
      isAuthenticated,
      error,
      isLocalDev,
      signOut,
      signInAtAccessWall,
      signInAsLocal,
    ],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
