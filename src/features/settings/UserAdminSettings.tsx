import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import type { AppRole } from '@/app/authContext'
import { Modal } from '@/components/Modal/Modal'
import {
  deleteAppUserRole,
  listAppUserRoles,
  saveAppUserRole,
} from '@/data/adminUsersApi'
import { recordActivityEvent } from '@/data/activityApi'
import { useAuth } from '@/hooks/useAuth'
import { confirm } from '@/stores/confirmStore'
import { showToastError, showToastSuccess } from '@/lib/toast'
import selectStyles from '@/components/Select/Select.module.css'
import styles from './SettingsModal.module.css'

export interface UserAdminSettingsProps {
  open: boolean
  onClose: () => void
}

export function UserAdminSettings({ open, onClose }: UserAdminSettingsProps) {
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<AppRole>('viewer')
  const [search, setSearch] = useState('')

  const rolesQuery = useQuery({
    queryKey: ['appUserRoles'],
    queryFn: listAppUserRoles,
    enabled: open,
  })

  const filteredRoles = useMemo(() => {
    const rows = rolesQuery.data ?? []
    const q = search.trim().toLowerCase()
    if (!q) return rows
    return rows.filter(
      (entry) =>
        entry.email.includes(q) ||
        entry.role.includes(q) ||
        (entry.role === 'admin' ? 'admin' : 'viewer').includes(q),
    )
  }, [rolesQuery.data, search])

  const saveMutation = useMutation({
    mutationFn: saveAppUserRole,
    onSuccess: async (saved) => {
      void recordActivityEvent({
        eventType: 'role_save',
        resourceKey: saved.email,
        meta: { role: saved.role },
      })
      showToastSuccess(`✓ ${saved.email} is now ${saved.role === 'admin' ? 'an Admin' : 'a Viewer'}`)
      setEmail('')
      setRole('viewer')
      await queryClient.invalidateQueries({ queryKey: ['appUserRoles'] })
    },
    onError: (error) =>
      showToastError(error instanceof Error ? error.message : 'Could not save role'),
  })

  const deleteMutation = useMutation({
    mutationFn: deleteAppUserRole,
    onSuccess: async (_void, targetEmail) => {
      void recordActivityEvent({
        eventType: 'role_delete',
        resourceKey: targetEmail,
      })
      showToastSuccess('✓ User role removed; they will default to Viewer next time')
      await queryClient.invalidateQueries({ queryKey: ['appUserRoles'] })
    },
    onError: (error) =>
      showToastError(error instanceof Error ? error.message : 'Could not remove role'),
  })

  const busy = saveMutation.isPending || deleteMutation.isPending
  const total = rolesQuery.data?.length ?? 0

  const handleSave = (event: React.FormEvent) => {
    event.preventDefault()
    const normalizedEmail = email.trim().toLowerCase()
    if (!normalizedEmail) {
      showToastError('Enter an email address.')
      return
    }
    if (normalizedEmail === user?.email?.toLowerCase() && role !== 'admin') {
      showToastError('You cannot change your own Admin role to Viewer.')
      return
    }
    saveMutation.mutate({ email: normalizedEmail, role })
  }

  const handleDelete = async (targetEmail: string) => {
    if (targetEmail === user?.email?.toLowerCase()) {
      showToastError('You cannot remove your own Admin role.')
      return
    }
    if (await confirm(`Remove the saved role for "${targetEmail}"?`)) {
      deleteMutation.mutate(targetEmail)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Manage users" width={520} align="center">
      <div className={styles.body}>
        <p className={styles.hint}>
          Assign Admin (can edit) or Viewer (view only). New people also need to be on the
          Cloudflare Access allowlist to receive a login code — ask your Cloudflare admin to add
          their email there, or use an address ending in <code>@quadreal.com</code> (those are
          already allowed).
        </p>
        <form onSubmit={handleSave}>
          <label className={styles.mgrFieldLabel} htmlFor="role-email">Email</label>
          <input
            id="role-email"
            type="email"
            className={styles.mgrInput}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            disabled={busy}
            required
          />
          <label className={styles.mgrFieldLabel} htmlFor="role-value" style={{ marginTop: 8 }}>
            Role
          </label>
          <select
            id="role-value"
            className={selectStyles.select}
            value={role}
            onChange={(event) => setRole(event.target.value === 'admin' ? 'admin' : 'viewer')}
            disabled={busy}
          >
            <option value="viewer">Viewer</option>
            <option value="admin">Admin</option>
          </select>
          <button type="submit" className={styles.mgrApplyBtn} disabled={busy}>
            Save role
          </button>
        </form>

        <div className={styles.userListSection}>
          <p className={styles.sectionLabel} style={{ marginBottom: 0 }}>Assigned roles</p>
          <div className={styles.userListSearchRow}>
            <input
              type="search"
              className={styles.mgrInput}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search by email or role…"
              aria-label="Search users"
              disabled={rolesQuery.isLoading}
            />
            {search.trim() ? (
              <button
                type="button"
                className={styles.linkBtn}
                onClick={() => setSearch('')}
                disabled={busy}
              >
                Clear
              </button>
            ) : null}
          </div>
          {!rolesQuery.isLoading && !rolesQuery.isError ? (
            <p className={styles.userListMeta}>
              {search.trim()
                ? `Showing ${filteredRoles.length} of ${total}`
                : `${total} user${total === 1 ? '' : 's'}`}
            </p>
          ) : null}
          {rolesQuery.isLoading ? <p className={styles.hint}>Loading…</p> : null}
          {rolesQuery.isError ? (
            <p className={styles.pwMismatch}>
              {rolesQuery.error instanceof Error
                ? rolesQuery.error.message
                : 'Could not load roles'}
            </p>
          ) : null}
          {!rolesQuery.isLoading && !rolesQuery.isError ? (
            <div className={styles.userListScroll} role="list">
              {filteredRoles.length === 0 ? (
                <p className={styles.userListEmpty}>
                  {total === 0
                    ? 'No assigned roles yet.'
                    : 'No users match that search.'}
                </p>
              ) : (
                filteredRoles.map((entry) => {
                  const isAdmin = entry.role === 'admin'
                  return (
                    <div
                      key={entry.email}
                      className={`${styles.passkeyRow}${isAdmin ? ` ${styles.userRowAdmin}` : ''}`}
                      role="listitem"
                    >
                      <span className={styles.userRowIdentity}>
                        <span className={styles.userRowEmail}>{entry.email}</span>
                        <span
                          className={`${styles.userRoleChip}${
                            isAdmin ? ` ${styles.userRoleChipAdmin}` : ''
                          }`}
                        >
                          {isAdmin ? 'Admin' : 'Viewer'}
                        </span>
                      </span>
                      <button
                        type="button"
                        className={styles.linkBtn}
                        disabled={busy || entry.email === user?.email?.toLowerCase()}
                        onClick={() => void handleDelete(entry.email)}
                      >
                        Remove
                      </button>
                    </div>
                  )
                })
              )}
            </div>
          ) : null}
        </div>
      </div>
    </Modal>
  )
}
