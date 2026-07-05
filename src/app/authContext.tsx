import {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import type { AuthChangeEvent, Session } from '@supabase/supabase-js'
import { getAuthRedirectUrl } from '@/lib/authRedirect'
import { supabase } from '@/lib/supabaseClient'

interface AuthContextValue {
  session: Session | null
  user: Session['user'] | null
  isLoading: boolean
  isAuthenticated: boolean
  needsPasswordRecovery: boolean
  needsMfaChallenge: boolean
  signIn: (email: string, password: string) => Promise<void>
  signOut: () => Promise<void>
  requestPasswordReset: (email: string) => Promise<void>
  updatePassword: (password: string) => Promise<void>
  dismissPasswordRecovery: () => void
  completeMfaChallenge: (code: string) => Promise<void>
  signInWithPasskey: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export { AuthContext, type AuthContextValue }

function hashIndicatesRecovery(): boolean {
  if (typeof window === 'undefined') return false
  const hash = window.location.hash.replace(/^#/, '')
  if (!hash) return false
  return new URLSearchParams(hash).get('type') === 'recovery'
}

function clearAuthHashFromUrl(): void {
  if (typeof window === 'undefined') return
  const { pathname, search } = window.location
  window.history.replaceState(null, '', `${pathname}${search}`)
}

async function readMfaChallengeRequired(): Promise<boolean> {
  const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
  if (error || !data) return false
  return data.nextLevel === 'aal2' && data.currentLevel !== data.nextLevel
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [needsPasswordRecovery, setNeedsPasswordRecovery] = useState(() => hashIndicatesRecovery())
  const [needsMfaChallenge, setNeedsMfaChallenge] = useState(false)

  const syncMfaChallenge = useCallback(async (nextSession: Session | null) => {
    if (!nextSession) {
      setNeedsMfaChallenge(false)
      return
    }
    setNeedsMfaChallenge(await readMfaChallengeRequired())
  }, [])

  const handleAuthEvent = useCallback(
    async (event: AuthChangeEvent, nextSession: Session | null) => {
      setSession(nextSession)
      setIsLoading(false)
      if (event === 'PASSWORD_RECOVERY' || hashIndicatesRecovery()) {
        setNeedsPasswordRecovery(true)
      }
      await syncMfaChallenge(nextSession)
    },
    [syncMfaChallenge],
  )

  useEffect(() => {
    let mounted = true

    void supabase.auth.getSession().then(async ({ data }) => {
      if (!mounted) return
      setSession(data.session)
      if (hashIndicatesRecovery()) {
        setNeedsPasswordRecovery(true)
      }
      await syncMfaChallenge(data.session)
      setIsLoading(false)
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (!mounted) return
      void handleAuthEvent(event, nextSession)
    })

    return () => {
      mounted = false
      subscription.unsubscribe()
    }
  }, [handleAuthEvent, syncMfaChallenge])

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
    const { data } = await supabase.auth.getSession()
    await syncMfaChallenge(data.session)
  }, [syncMfaChallenge])

  const signOut = useCallback(async () => {
    const { error } = await supabase.auth.signOut()
    if (error) throw error
    setNeedsMfaChallenge(false)
  }, [])

  const requestPasswordReset = useCallback(async (email: string) => {
    const redirectTo = getAuthRedirectUrl()
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo })
    if (error) throw error
  }, [])

  const updatePassword = useCallback(async (password: string) => {
    const { error } = await supabase.auth.updateUser({ password })
    if (error) throw error
    setNeedsPasswordRecovery(false)
    clearAuthHashFromUrl()
  }, [])

  const dismissPasswordRecovery = useCallback(() => {
    setNeedsPasswordRecovery(false)
    clearAuthHashFromUrl()
    void supabase.auth.signOut()
  }, [])

  const completeMfaChallenge = useCallback(async (code: string) => {
    const { data: factors, error: factorsError } = await supabase.auth.mfa.listFactors()
    if (factorsError) throw factorsError

    const totpFactor = factors.totp.find((factor) => factor.status === 'verified')
    if (!totpFactor) {
      throw new Error('No authenticator app is set up on this account.')
    }

    const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({
      factorId: totpFactor.id,
    })
    if (challengeError) throw challengeError

    const { error: verifyError } = await supabase.auth.mfa.verify({
      factorId: totpFactor.id,
      challengeId: challenge.id,
      code: code.trim(),
    })
    if (verifyError) throw verifyError

    await supabase.auth.refreshSession()
    setNeedsMfaChallenge(false)
  }, [])

  const signInWithPasskey = useCallback(async () => {
    const { error } = await supabase.auth.signInWithPasskey()
    if (error) throw error
    const { data } = await supabase.auth.getSession()
    await syncMfaChallenge(data.session)
  }, [syncMfaChallenge])

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      user: session?.user ?? null,
      isLoading,
      isAuthenticated: Boolean(session?.user),
      needsPasswordRecovery,
      needsMfaChallenge,
      signIn,
      signOut,
      requestPasswordReset,
      updatePassword,
      dismissPasswordRecovery,
      completeMfaChallenge,
      signInWithPasskey,
    }),
    [
      session,
      isLoading,
      needsPasswordRecovery,
      needsMfaChallenge,
      signIn,
      signOut,
      requestPasswordReset,
      updatePassword,
      dismissPasswordRecovery,
      completeMfaChallenge,
      signInWithPasskey,
    ],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
