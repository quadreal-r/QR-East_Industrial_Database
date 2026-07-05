import { useCallback, useState } from 'react'
import type { Factor, PasskeyListItem } from '@supabase/supabase-js'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/Button/Button'
import { confirm } from '@/stores/confirmStore'
import { useAuth } from '@/hooks/useAuth'
import { useIsAppAdmin } from '@/hooks/useIsAppAdmin'
import { isPasskeySupported, totpQrDataUrl, verifyCurrentPassword } from '@/lib/accountAuth'
import { supabase, supabaseDashboardUrl } from '@/lib/supabaseClient'
import { showToastSuccess } from '@/lib/toast'
import { SettingsToolButton } from '@/features/settings/SettingsToolButton'
import { UserAdminSettings } from '@/features/settings/UserAdminSettings'
import styles from './SettingsModal.module.css'

type MfaSetup = {
  factorId: string
  qrCode: string
  secret: string
}

type SignInView = 'sign-in' | 'forgot'

function PasswordField({
  id,
  label,
  value,
  onChange,
  showPassword,
  disabled,
  autoComplete,
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  showPassword: boolean
  disabled?: boolean
  autoComplete?: string
}) {
  return (
    <>
      {label ? (
        <label className={styles.mgrFieldLabel} htmlFor={id}>
          {label}
        </label>
      ) : null}
      <input
        id={id}
        type={showPassword ? 'text' : 'password'}
        className={styles.mgrInput}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        disabled={disabled}
      />
    </>
  )
}

export function SettingsAccountPage() {
  const queryClient = useQueryClient()
  const {
    user,
    isAuthenticated,
    signIn,
    signOut,
    signInWithPasskey,
    requestPasswordReset,
    updatePassword,
  } = useAuth()
  const { data: isAppAdmin = false } = useIsAppAdmin()

  const [busy, setBusy] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [signInView, setSignInView] = useState<SignInView>('sign-in')
  const [signInEmail, setSignInEmail] = useState('')
  const [signInPassword, setSignInPassword] = useState('')
  const [signInError, setSignInError] = useState<string | null>(null)
  const [signInInfo, setSignInInfo] = useState<string | null>(null)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [mfaSetup, setMfaSetup] = useState<MfaSetup | null>(null)
  const [mfaCode, setMfaCode] = useState('')
  const [removeMfaCode, setRemoveMfaCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [userAdminOpen, setUserAdminOpen] = useState(false)

  const passkeyAvailable = isPasskeySupported()

  const factorsQuery = useQuery({
    queryKey: ['accountMfaFactors'],
    queryFn: async () => {
      const { data, error: factorsError } = await supabase.auth.mfa.listFactors()
      if (factorsError) throw factorsError
      return [...data.totp, ...data.phone] as Factor[]
    },
    enabled: isAuthenticated,
  })

  const passkeysQuery = useQuery({
    queryKey: ['accountPasskeys'],
    queryFn: async () => {
      const { data, error: listError } = await supabase.auth.passkey.list()
      if (listError) throw listError
      return data as PasskeyListItem[]
    },
    enabled: isAuthenticated,
  })

  const mfaFactors = factorsQuery.data ?? []
  const passkeys = passkeysQuery.data ?? []
  const verifiedTotp = mfaFactors.find((factor) => factor.factor_type === 'totp' && factor.status === 'verified')

  const refreshPasskeys = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ['accountPasskeys'] })
  }, [queryClient])

  const loadFactors = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ['accountMfaFactors'] })
  }, [queryClient])

  const requireCurrentPassword = async () => {
    if (!user?.email) throw new Error('No signed-in user')
    if (!currentPassword) throw new Error('Enter your current password')
    await verifyCurrentPassword(user.email, currentPassword)
  }

  const handleEmailSignIn = async (event: React.FormEvent) => {
    event.preventDefault()
    setSignInError(null)
    setSignInInfo(null)
    setBusy(true)
    try {
      await signIn(signInEmail.trim(), signInPassword)
      setSignInEmail('')
      setSignInPassword('')
    } catch (err) {
      setSignInError(err instanceof Error ? err.message : 'Sign in failed')
    } finally {
      setBusy(false)
    }
  }

  const handleForgotPassword = async (event: React.FormEvent) => {
    event.preventDefault()
    setSignInError(null)
    setSignInInfo(null)
    setBusy(true)
    try {
      await requestPasswordReset(signInEmail.trim())
      setSignInInfo('Check your email for a password reset link.')
    } catch (err) {
      setSignInError(err instanceof Error ? err.message : 'Could not send reset email')
    } finally {
      setBusy(false)
    }
  }

  const handlePasskeySignIn = async () => {
    setSignInError(null)
    setBusy(true)
    try {
      await signInWithPasskey()
    } catch (err) {
      setSignInError(err instanceof Error ? err.message : 'Passkey sign-in failed')
    } finally {
      setBusy(false)
    }
  }

  const handleChangePassword = async (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)
    if (newPassword.length < 6) {
      setError('New password must be at least 6 characters')
      return
    }
    if (newPassword !== confirmPassword) {
      setError('New passwords do not match')
      return
    }
    setBusy(true)
    try {
      await requireCurrentPassword()
      await updatePassword(newPassword)
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      showToastSuccess('✓ Password updated')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update password')
    } finally {
      setBusy(false)
    }
  }

  const handleStartMfaEnroll = async () => {
    setError(null)
    setBusy(true)
    try {
      await requireCurrentPassword()
      const { data, error: enrollError } = await supabase.auth.mfa.enroll({
        factorType: 'totp',
        friendlyName: 'Authenticator app',
      })
      if (enrollError) throw enrollError
      setMfaSetup({
        factorId: data.id,
        qrCode: data.totp.qr_code,
        secret: data.totp.secret,
      })
      setMfaCode('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start MFA setup')
    } finally {
      setBusy(false)
    }
  }

  const handleCompleteMfaEnroll = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!mfaSetup) return
    setError(null)
    setBusy(true)
    try {
      const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({
        factorId: mfaSetup.factorId,
      })
      if (challengeError) throw challengeError

      const { error: verifyError } = await supabase.auth.mfa.verify({
        factorId: mfaSetup.factorId,
        challengeId: challenge.id,
        code: mfaCode.trim(),
      })
      if (verifyError) throw verifyError

      await supabase.auth.refreshSession()
      await loadFactors()
      setMfaSetup(null)
      setMfaCode('')
      setCurrentPassword('')
      showToastSuccess('✓ Authenticator app enabled')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not verify authenticator code')
    } finally {
      setBusy(false)
    }
  }

  const handleRemoveMfa = async () => {
    if (!verifiedTotp) return
    setError(null)
    const ok = await confirm('Remove authenticator app from this account?')
    if (!ok) return

    setBusy(true)
    try {
      await requireCurrentPassword()
      if (!removeMfaCode.trim()) {
        throw new Error('Enter the current authenticator code to remove MFA')
      }

      const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({
        factorId: verifiedTotp.id,
      })
      if (challengeError) throw challengeError

      const { error: verifyError } = await supabase.auth.mfa.verify({
        factorId: verifiedTotp.id,
        challengeId: challenge.id,
        code: removeMfaCode.trim(),
      })
      if (verifyError) throw verifyError

      const { error: unenrollError } = await supabase.auth.mfa.unenroll({ factorId: verifiedTotp.id })
      if (unenrollError) throw unenrollError

      await supabase.auth.refreshSession()
      await loadFactors()
      setRemoveMfaCode('')
      setCurrentPassword('')
      showToastSuccess('✓ Authenticator app removed')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove MFA')
    } finally {
      setBusy(false)
    }
  }

  const handleAddPasskey = async () => {
    setError(null)
    setBusy(true)
    try {
      await requireCurrentPassword()
      const { error: registerError } = await supabase.auth.registerPasskey()
      if (registerError) throw registerError
      await refreshPasskeys()
      setCurrentPassword('')
      showToastSuccess('✓ Passkey added')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add passkey')
    } finally {
      setBusy(false)
    }
  }

  const handleRemovePasskey = async (passkey: PasskeyListItem) => {
    setError(null)
    const label = passkey.friendly_name ?? 'Passkey'
    const ok = await confirm(`Remove ${label} from this account?`)
    if (!ok) return

    setBusy(true)
    try {
      await requireCurrentPassword()
      const { error: deleteError } = await supabase.auth.passkey.delete({ passkeyId: passkey.id })
      if (deleteError) throw deleteError
      await refreshPasskeys()
      setCurrentPassword('')
      showToastSuccess('✓ Passkey removed')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove passkey')
    } finally {
      setBusy(false)
    }
  }

  if (!isAuthenticated) {
    return (
      <div className={styles.body}>
        <p className={styles.authStatus}>
          Sign in to edit map data, schedule, pricing, and account settings.
        </p>

        {passkeyAvailable ? (
          <button
            type="button"
            className={styles.mgrApplyBtn}
            disabled={busy}
            onClick={() => void handlePasskeySignIn()}
          >
            Sign in with passkey
          </button>
        ) : null}

        {signInView === 'forgot' ? (
          <form onSubmit={(e) => void handleForgotPassword(e)} className={styles.mgrEditor}>
            <p className={styles.sectionLabel} style={{ marginBottom: 8 }}>
              Reset password
            </p>
            <label className={styles.mgrFieldLabel} htmlFor="account-sign-in-email">
              Email
            </label>
            <input
              id="account-sign-in-email"
              type="email"
              className={styles.mgrInput}
              value={signInEmail}
              onChange={(e) => setSignInEmail(e.target.value)}
              autoComplete="email"
              disabled={busy}
              required
            />
            {signInError ? (
              <p className={styles.pwMismatch}>{signInError}</p>
            ) : null}
            {signInInfo ? (
              <p className={styles.hint} style={{ marginTop: 8 }}>
                {signInInfo}
              </p>
            ) : null}
            <div className={styles.tools} style={{ marginTop: 8 }}>
              <button
                type="button"
                className={styles.mgrApplyBtn}
                disabled={busy}
                onClick={() => {
                  setSignInView('sign-in')
                  setSignInError(null)
                  setSignInInfo(null)
                }}
              >
                Back to sign in
              </button>
              <button type="submit" className={styles.mgrApplyBtn} disabled={busy}>
                {busy ? 'Sending…' : 'Send reset link'}
              </button>
            </div>
          </form>
        ) : (
          <form onSubmit={(e) => void handleEmailSignIn(e)} className={styles.mgrEditor}>
            <p className={styles.sectionLabel} style={{ marginBottom: 8 }}>
              Sign in
            </p>
            <label className={styles.mgrFieldLabel} htmlFor="account-sign-in-email">
              Email
            </label>
            <input
              id="account-sign-in-email"
              type="email"
              className={styles.mgrInput}
              value={signInEmail}
              onChange={(e) => setSignInEmail(e.target.value)}
              autoComplete="email"
              disabled={busy}
              required
            />
            <label className={styles.mgrFieldLabel} htmlFor="account-sign-in-password" style={{ marginTop: 8 }}>
              Password
            </label>
            <input
              id="account-sign-in-password"
              type="password"
              className={styles.mgrInput}
              value={signInPassword}
              onChange={(e) => setSignInPassword(e.target.value)}
              autoComplete="current-password"
              disabled={busy}
              required
            />
            <button
              type="button"
              className={styles.linkBtn}
              style={{ marginTop: 8, textAlign: 'left' }}
              onClick={() => {
                setSignInView('forgot')
                setSignInError(null)
                setSignInInfo(null)
              }}
            >
              Forgot password?
            </button>
            {signInError ? (
              <p className={styles.pwMismatch}>{signInError}</p>
            ) : null}
            <button type="submit" className={styles.mgrApplyBtn} disabled={busy}>
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        )}
      </div>
    )
  }

  return (
    <>
      <div className={styles.body}>
        <Button type="button" variant="ghost" onClick={() => void signOut()}>
          Sign out
        </Button>

        <div style={{ marginTop: 16 }}>
          <div className={styles.pwLabelRow}>
            <label className={styles.mgrFieldLabel} htmlFor="account-current-password">
              Current password
            </label>
            <button
              type="button"
              className={styles.pwToggle}
              onClick={() => setShowPassword((prev) => !prev)}
              aria-pressed={showPassword}
              disabled={busy}
            >
              {showPassword ? 'Hide' : 'Show'}
            </button>
          </div>
          <PasswordField
            id="account-current-password"
            label=""
            value={currentPassword}
            onChange={setCurrentPassword}
            showPassword={showPassword}
            disabled={busy}
            autoComplete="current-password"
          />
          <p className={styles.hint}>Required to change password, MFA, or passkeys.</p>
          {error ? (
            <p className={styles.pwMismatch} role="alert">
              {error}
            </p>
          ) : null}
        </div>

        <form onSubmit={(e) => void handleChangePassword(e)} style={{ marginTop: 16 }}>
          <p className={styles.sectionLabel} style={{ marginBottom: 8 }}>
            Password
          </p>
          <PasswordField
            id="account-new-password"
            label="New password"
            value={newPassword}
            onChange={setNewPassword}
            showPassword={showPassword}
            disabled={busy}
            autoComplete="new-password"
          />
          <div style={{ marginTop: 8 }}>
            <PasswordField
              id="account-confirm-password"
              label="Confirm new password"
              value={confirmPassword}
              onChange={setConfirmPassword}
              showPassword={showPassword}
              disabled={busy}
              autoComplete="new-password"
            />
          </div>
          {confirmPassword && confirmPassword !== newPassword ? (
            <p className={styles.pwMismatch}>Passwords do not match.</p>
          ) : null}
          <button type="submit" className={styles.mgrApplyBtn} disabled={busy}>
            Update password
          </button>
        </form>

        <section style={{ marginTop: 20 }}>
          <p className={styles.sectionLabel} style={{ marginBottom: 8 }}>
            Passkeys
          </p>
          {!passkeyAvailable ? (
            <p className={styles.hint}>Passkeys need HTTPS or localhost in a supported browser.</p>
          ) : null}
          {passkeys.length > 0 ? (
            <ul className={styles.passkeyList}>
              {passkeys.map((passkey) => (
                <li key={passkey.id} className={styles.passkeyRow}>
                  <span>{passkey.friendly_name ?? 'Passkey'}</span>
                  <button
                    type="button"
                    className={styles.linkBtn}
                    style={{ color: '#f87171' }}
                    disabled={busy}
                    onClick={() => void handleRemovePasskey(passkey)}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className={styles.hint}>No passkeys on this account yet.</p>
          )}
          {passkeysQuery.isError ? (
            <p className={styles.pwMismatch}>
              {passkeysQuery.error instanceof Error
                ? passkeysQuery.error.message
                : 'Could not load passkeys'}
            </p>
          ) : null}
          <button
            type="button"
            className={styles.mgrApplyBtn}
            disabled={busy || !passkeyAvailable}
            onClick={() => void handleAddPasskey()}
          >
            Add passkey
          </button>
        </section>

        <section style={{ marginTop: 20 }}>
          <p className={styles.sectionLabel} style={{ marginBottom: 8 }}>
            Two-factor authentication
          </p>
          {verifiedTotp ? (
            <p className={styles.hint}>
              Authenticator app is enabled
              {verifiedTotp.friendly_name ? ` (${verifiedTotp.friendly_name})` : ''}.
            </p>
          ) : (
            <p className={styles.hint}>Add an authenticator app for a second sign-in step.</p>
          )}

          {mfaSetup ? (
            <form onSubmit={(e) => void handleCompleteMfaEnroll(e)} className={styles.mgrEditor}>
              <img
                src={totpQrDataUrl(mfaSetup.qrCode)}
                alt="Scan this QR code with your authenticator app"
                width={180}
                height={180}
                style={{ alignSelf: 'center', background: '#fff', padding: 8, borderRadius: 8 }}
              />
              <p className={styles.hint}>
                Manual key: <code className={styles.inlineCode}>{mfaSetup.secret}</code>
              </p>
              <label className={styles.mgrFieldLabel} htmlFor="account-mfa-code">
                Verification code
              </label>
              <input
                id="account-mfa-code"
                type="text"
                inputMode="numeric"
                className={styles.mgrInput}
                value={mfaCode}
                onChange={(e) => setMfaCode(e.target.value.trim())}
                autoComplete="one-time-code"
                disabled={busy}
              />
              <div className={styles.tools}>
                <button
                  type="button"
                  className={styles.mgrApplyBtn}
                  disabled={busy}
                  onClick={() => {
                    setMfaSetup(null)
                    setMfaCode('')
                  }}
                >
                  Cancel setup
                </button>
                <button type="submit" className={styles.mgrApplyBtn} disabled={busy}>
                  Enable authenticator
                </button>
              </div>
            </form>
          ) : verifiedTotp ? (
            <div className={styles.mgrEditor}>
              <label className={styles.mgrFieldLabel} htmlFor="account-remove-mfa-code">
                Authenticator code
              </label>
              <input
                id="account-remove-mfa-code"
                type="text"
                inputMode="numeric"
                className={styles.mgrInput}
                value={removeMfaCode}
                onChange={(e) => setRemoveMfaCode(e.target.value.trim())}
                autoComplete="one-time-code"
                disabled={busy}
              />
              <button
                type="button"
                className="btn-action"
                style={{ width: '100%', justifyContent: 'flex-start', color: '#f87171' }}
                disabled={busy}
                onClick={() => void handleRemoveMfa()}
              >
                Remove authenticator app
              </button>
            </div>
          ) : (
            <button
              type="button"
              className={styles.mgrApplyBtn}
              disabled={busy}
              onClick={() => void handleStartMfaEnroll()}
            >
              Set up authenticator app
            </button>
          )}
          {factorsQuery.isError ? (
            <p className={styles.pwMismatch}>
              {factorsQuery.error instanceof Error
                ? factorsQuery.error.message
                : 'Could not load MFA settings'}
            </p>
          ) : null}
        </section>

        {isAppAdmin ? (
          <section style={{ marginTop: 20 }}>
            <p className={styles.sectionLabel} style={{ marginBottom: 8 }}>
              Admin
            </p>
            <div className={styles.tools}>
              <SettingsToolButton
                tooltip="Add or remove Supabase sign-in accounts for map editors."
                onClick={() => setUserAdminOpen(true)}
              >
                Manage users
              </SettingsToolButton>
              <SettingsToolButton
                tooltip="Open the Supabase dashboard in a new tab."
                onClick={() =>
                  window.open(supabaseDashboardUrl, '_blank', 'noopener,noreferrer')
                }
              >
                Open Supabase dashboard ↗
              </SettingsToolButton>
            </div>
          </section>
        ) : null}
      </div>
      <UserAdminSettings open={userAdminOpen} onClose={() => setUserAdminOpen(false)} />
    </>
  )
}
