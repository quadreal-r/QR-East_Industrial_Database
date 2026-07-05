import { useState } from 'react'
import { Modal } from '@/components/Modal/Modal'
import { Button } from '@/components/Button/Button'
import { useAuth } from '@/hooks/useAuth'
import styles from './LoginModal.module.css'

export interface LoginModalProps {
  open: boolean
  onClose: () => void
}

type LoginView = 'sign-in' | 'forgot'

export function LoginModal({ open, onClose }: LoginModalProps) {
  const { signIn, requestPasswordReset } = useAuth()
  const [view, setView] = useState<LoginView>('sign-in')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const resetForm = () => {
    setView('sign-in')
    setError(null)
    setInfo(null)
    setLoading(false)
  }

  const handleClose = () => {
    resetForm()
    onClose()
  }

  const handleSignIn = async (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)
    setInfo(null)
    setLoading(true)
    try {
      await signIn(email.trim(), password)
      handleClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign in failed')
    } finally {
      setLoading(false)
    }
  }

  const handleForgot = async (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)
    setInfo(null)
    setLoading(true)
    try {
      await requestPasswordReset(email.trim())
      setInfo('Check your email for a password reset link.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send reset email')
    } finally {
      setLoading(false)
    }
  }

  if (view === 'forgot') {
    return (
      <Modal open={open} onClose={handleClose} title="Reset password" width="sm">
        <form className={styles.form} onSubmit={(e) => void handleForgot(e)}>
          <p className={styles.hint}>
            Enter your email and we will send a link to set a new password.
          </p>
          <label className={styles.label}>
            Email
            <input
              className={styles.input}
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </label>
          {error ? <p className={styles.error}>{error}</p> : null}
          {info ? <p className={styles.info}>{info}</p> : null}
          <div className={styles.actions}>
            <Button type="button" variant="ghost" onClick={() => setView('sign-in')}>
              Back
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? 'Sending…' : 'Send reset link'}
            </Button>
          </div>
        </form>
      </Modal>
    )
  }

  return (
    <Modal open={open} onClose={handleClose} title="Sign in" width="sm">
      <form className={styles.form} onSubmit={(e) => void handleSignIn(e)}>
        <p className={styles.hint}>Sign in to edit map data, schedule, pricing, and settings.</p>
        <label className={styles.label}>
          Email
          <input
            className={styles.input}
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>
        <label className={styles.label}>
          Password
          <input
            className={styles.input}
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        <button
          type="button"
          className={styles.linkButton}
          onClick={() => {
            setError(null)
            setInfo(null)
            setView('forgot')
          }}
        >
          Forgot password?
        </button>
        {error ? <p className={styles.error}>{error}</p> : null}
        <div className={styles.actions}>
          <Button type="button" variant="ghost" onClick={handleClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={loading}>
            {loading ? 'Signing in…' : 'Sign in'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
