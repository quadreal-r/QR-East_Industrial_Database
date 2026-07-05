import { useState } from 'react'
import { Modal } from '@/components/Modal/Modal'
import { Button } from '@/components/Button/Button'
import { useAuth } from '@/hooks/useAuth'
import styles from './LoginModal.module.css'

export interface ResetPasswordModalProps {
  open: boolean
  onClose: () => void
}

export function ResetPasswordModal({ open, onClose }: ResetPasswordModalProps) {
  const { updatePassword, dismissPasswordRecovery } = useAuth()
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const handleCancel = () => {
    setPassword('')
    setConfirmPassword('')
    setError(null)
    dismissPasswordRecovery()
    onClose()
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)
    if (password.length < 6) {
      setError('Password must be at least 6 characters')
      return
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match')
      return
    }
    setLoading(true)
    try {
      await updatePassword(password)
      setPassword('')
      setConfirmPassword('')
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update password')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal open={open} onClose={handleCancel} title="Set new password" width="sm">
      <form className={styles.form} onSubmit={(e) => void handleSubmit(e)}>
        <p className={styles.hint}>Choose a new password for your account.</p>
        <label className={styles.label}>
          New password
          <input
            className={styles.input}
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={6}
          />
        </label>
        <label className={styles.label}>
          Confirm password
          <input
            className={styles.input}
            type="password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
            minLength={6}
          />
        </label>
        {error ? <p className={styles.error}>{error}</p> : null}
        <div className={styles.actions}>
          <Button type="button" variant="ghost" onClick={handleCancel}>
            Cancel
          </Button>
          <Button type="submit" disabled={loading}>
            {loading ? 'Saving…' : 'Save password'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
