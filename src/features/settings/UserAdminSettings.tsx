import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Modal } from '@/components/Modal/Modal'
import { confirm } from '@/stores/confirmStore'
import {
  createAppUser,
  deleteAppUser,
  listAppUsers,
  type AppUser,
} from '@/data/adminUsersApi'
import { showToastError, showToastSuccess } from '@/lib/toast'
import { useAuth } from '@/hooks/useAuth'
import selectStyles from '@/components/Select/Select.module.css'
import styles from './SettingsModal.module.css'

export interface UserAdminSettingsProps {
  open: boolean
  onClose: () => void
}

function userLabel(user: AppUser): string {
  if (user.name && user.email) return `${user.name} (${user.email})`
  return user.email || user.name || 'User'
}

export function UserAdminSettings({ open, onClose }: UserAdminSettingsProps) {
  const queryClient = useQueryClient()
  const { user: currentUser } = useAuth()
  const [selectedUserId, setSelectedUserId] = useState('')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)

  const usersQuery = useQuery({
    queryKey: ['appUsers'],
    queryFn: listAppUsers,
    enabled: open,
  })

  const users = usersQuery.data ?? []
  const resolvedSelectedId =
    selectedUserId && users.some((user) => user.id === selectedUserId)
      ? selectedUserId
      : (users[0]?.id ?? '')
  const selectedUser = users.find((user) => user.id === resolvedSelectedId)

  const createMutation = useMutation({
    mutationFn: createAppUser,
    onSuccess: async (created) => {
      showToastSuccess(`✓ Created user ${userLabel(created)}`)
      setName('')
      setEmail('')
      setPassword('')
      setConfirmPassword('')
      setShowPassword(false)
      setSelectedUserId(created.id)
      await queryClient.invalidateQueries({ queryKey: ['appUsers'] })
    },
    onError: (error) => {
      showToastError(error instanceof Error ? error.message : 'Could not create user')
    },
  })

  const deleteMutation = useMutation({
    mutationFn: deleteAppUser,
    onSuccess: async () => {
      if (selectedUser) {
        showToastSuccess(`✓ Deleted user ${userLabel(selectedUser)}`)
      }
      setSelectedUserId('')
      await queryClient.invalidateQueries({ queryKey: ['appUsers'] })
    },
    onError: (error) => {
      showToastError(error instanceof Error ? error.message : 'Could not delete user')
    },
  })

  const busy = createMutation.isPending || deleteMutation.isPending
  const loading = usersQuery.isLoading

  const handleCreate = (event: React.FormEvent) => {
    event.preventDefault()
    if (!name.trim() || !email.trim() || !password) {
      showToastError('Name, email, and password are required.')
      return
    }
    if (password.length < 6) {
      showToastError('Password must be at least 6 characters.')
      return
    }
    if (password !== confirmPassword) {
      showToastError('Passwords do not match.')
      return
    }
    createMutation.mutate({ name, email, password })
  }

  const handleDelete = () => {
    if (!selectedUser) {
      showToastError('Select a user first.')
      return
    }
    if (selectedUser.id === currentUser?.id) {
      showToastError('You cannot delete your own account here.')
      return
    }
    void confirm(`Delete user "${userLabel(selectedUser)}"? They will no longer be able to sign in.`).then(
      (ok) => {
        if (!ok || !selectedUser) return
        deleteMutation.mutate(selectedUser.id)
      },
    )
  }

  return (
    <Modal open={open} onClose={onClose} title="Manage users" width={420} align="center">
      <div className={styles.body}>
        <p className={styles.mgrFieldLabel} style={{ textTransform: 'none', letterSpacing: 0, fontSize: 12 }}>
          Create Supabase sign-in accounts for editors. Users sign in with their email and password.
        </p>

        <form onSubmit={handleCreate}>
          <label className={styles.mgrFieldLabel} htmlFor="user-admin-name">
            Name
          </label>
          <input
            id="user-admin-name"
            type="text"
            className={styles.mgrInput}
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="name"
            disabled={busy}
          />

          <label className={styles.mgrFieldLabel} htmlFor="user-admin-email" style={{ marginTop: 8 }}>
            Email
          </label>
          <input
            id="user-admin-email"
            type="email"
            className={styles.mgrInput}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="off"
            disabled={busy}
          />

          <div className={styles.pwLabelRow}>
            <label className={styles.mgrFieldLabel} htmlFor="user-admin-password">
              Password
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
          <input
            id="user-admin-password"
            type={showPassword ? 'text' : 'password'}
            className={styles.mgrInput}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            disabled={busy}
          />

          <label className={styles.mgrFieldLabel} htmlFor="user-admin-confirm-password" style={{ marginTop: 8 }}>
            Confirm password
          </label>
          <input
            id="user-admin-confirm-password"
            type={showPassword ? 'text' : 'password'}
            className={styles.mgrInput}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            autoComplete="new-password"
            disabled={busy}
          />
          {confirmPassword && confirmPassword !== password ? (
            <p className={styles.pwMismatch}>Passwords do not match.</p>
          ) : null}

          <button type="submit" className={styles.mgrApplyBtn} disabled={busy}>
            Add user
          </button>
        </form>

        <label className={styles.mgrFieldLabel} htmlFor="user-admin-select" style={{ marginTop: 16 }}>
          Existing users
        </label>
        <select
          id="user-admin-select"
          className={selectStyles.select}
          value={resolvedSelectedId}
          disabled={loading || busy || users.length === 0}
          onChange={(e) => setSelectedUserId(e.target.value)}
        >
          {loading ? (
            <option value="">Loading users…</option>
          ) : users.length ? (
            users.map((user) => (
              <option key={user.id} value={user.id}>
                {userLabel(user)}
              </option>
            ))
          ) : (
            <option value="">No users yet</option>
          )}
        </select>

        {usersQuery.isError ? (
          <p className={styles.mgrFieldLabel} style={{ textTransform: 'none', letterSpacing: 0, fontSize: 11, color: '#f87171' }}>
            {usersQuery.error instanceof Error ? usersQuery.error.message : 'Could not load users'}
          </p>
        ) : null}

        <div className={styles.tools} style={{ marginTop: 12 }}>
          <button
            type="button"
            className="btn-action"
            style={{ width: '100%', justifyContent: 'flex-start', color: '#f87171' }}
            disabled={!selectedUser || busy || selectedUser.id === currentUser?.id}
            onClick={handleDelete}
          >
            🗑 Delete selected user
          </button>
        </div>
      </div>
    </Modal>
  )
}
