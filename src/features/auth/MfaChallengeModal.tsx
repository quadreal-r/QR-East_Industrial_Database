import { useState } from 'react'
import { Modal } from '@/components/Modal/Modal'
import { Button } from '@/components/Button/Button'
import { useAuth } from '@/hooks/useAuth'
import styles from './LoginModal.module.css'

export function MfaChallengeModal() {
  const { needsMfaChallenge, completeMfaChallenge, signOut } = useAuth()
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)
    setLoading(true)
    try {
      await completeMfaChallenge(code)
      setCode('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Verification failed')
    } finally {
      setLoading(false)
    }
  }

  const handleCancel = () => {
    setCode('')
    setError(null)
    void signOut()
  }

  return (
    <Modal open={needsMfaChallenge} onClose={handleCancel} title="Authenticator code" width="sm">
      <form className={styles.form} onSubmit={(e) => void handleSubmit(e)}>
        <p className={styles.hint}>
          Enter the 6-digit code from your authenticator app to finish signing in.
        </p>
        <label className={styles.label}>
          Code
          <input
            className={styles.input}
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={code}
            onChange={(e) => setCode(e.target.value.trim())}
            required
          />
        </label>
        {error ? <p className={styles.error}>{error}</p> : null}
        <div className={styles.actions}>
          <Button type="button" variant="ghost" onClick={handleCancel}>
            Sign out
          </Button>
          <Button type="submit" disabled={loading}>
            {loading ? 'Verifying…' : 'Verify'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
