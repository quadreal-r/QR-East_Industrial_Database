import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useRef, useState } from 'react'
import type { AppRole } from '@/app/authContext'
import { Modal } from '@/components/Modal/Modal'
import {
  deleteAppUserRole,
  listAppUserRoles,
  saveAppUserRole,
} from '@/data/adminUsersApi'
import { recordActivityEvent } from '@/data/activityApi'
import { useAuth } from '@/hooks/useAuth'
import {
  appRolesExportFilename,
  buildAppRolesCsv,
  parseAppRolesCsv,
  planAppRoleImport,
  roleLabel,
} from '@/lib/appUserRolesCsv'
import { confirm } from '@/stores/confirmStore'
import { showToastError, showToastSuccess } from '@/lib/toast'
import selectStyles from '@/components/Select/Select.module.css'
import styles from './SettingsModal.module.css'

export interface UserAdminSettingsProps {
  open: boolean
  onClose: () => void
}

function downloadText(filename: string, text: string) {
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export function UserAdminSettings({ open, onClose }: UserAdminSettingsProps) {
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<AppRole>('viewer')
  const [search, setSearch] = useState('')
  /** Email sort: A→Z by default. */
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [importBusy, setImportBusy] = useState(false)
  const importInputRef = useRef<HTMLInputElement>(null)

  const rolesQuery = useQuery({
    queryKey: ['appUserRoles'],
    queryFn: listAppUserRoles,
    enabled: open,
  })

  const filteredRoles = useMemo(() => {
    const rows = rolesQuery.data ?? []
    const q = search.trim().toLowerCase()
    const filtered = !q
      ? [...rows]
      : rows.filter(
          (entry) =>
            entry.email.includes(q) ||
            entry.role.includes(q) ||
            (entry.role === 'admin' ? 'admin' : 'viewer').includes(q),
        )
    filtered.sort((a, b) => {
      const cmp = a.email.localeCompare(b.email, undefined, { sensitivity: 'base' })
      return sortDir === 'asc' ? cmp : -cmp
    })
    return filtered
  }, [rolesQuery.data, search, sortDir])

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

  const busy = saveMutation.isPending || deleteMutation.isPending || importBusy
  const total = rolesQuery.data?.length ?? 0
  const selfEmail = user?.email?.toLowerCase() ?? ''

  const handleSave = async (event: React.FormEvent) => {
    event.preventDefault()
    const normalizedEmail = email.trim().toLowerCase()
    if (!normalizedEmail) {
      showToastError('Enter an email address.')
      return
    }
    if (normalizedEmail === selfEmail && role !== 'admin') {
      showToastError('You cannot change your own Admin role to Viewer.')
      return
    }

    const existing = (rolesQuery.data ?? []).find((entry) => entry.email === normalizedEmail)
    if (existing) {
      if (existing.role === role) {
        showToastError(
          `${normalizedEmail} is already in the list as ${roleLabel(existing.role)}.`,
        )
        return
      }
      const ok = await confirm(
        `${normalizedEmail} is already a ${roleLabel(existing.role)}. Change them to ${roleLabel(role)}?`,
        { confirmLabel: 'Change role', cancelLabel: 'Cancel' },
      )
      if (!ok) return
    }

    saveMutation.mutate({ email: normalizedEmail, role })
  }

  const handleDelete = async (targetEmail: string) => {
    if (targetEmail === selfEmail) {
      showToastError('You cannot remove your own Admin role.')
      return
    }
    if (await confirm(`Remove the saved role for "${targetEmail}"?`)) {
      deleteMutation.mutate(targetEmail)
    }
  }

  const handleExport = () => {
    const rows = rolesQuery.data ?? []
    if (rows.length === 0) {
      showToastError('No users to export yet.')
      return
    }
    downloadText(
      appRolesExportFilename(),
      buildAppRolesCsv(rows.map((row) => ({ email: row.email, role: row.role }))),
    )
    showToastSuccess(`✓ Exported ${rows.length} user${rows.length === 1 ? '' : 's'}`)
  }

  const handleImportFile = async (file: File | null) => {
    if (!file) return
    setImportBusy(true)
    try {
      const text = await file.text()
      const parsed = parseAppRolesCsv(text)
      if (parsed.rows.length === 0) {
        showToastError(
          parsed.errors[0] ?? 'No valid users found in that file. Use columns email,role.',
        )
        return
      }

      const existing = (rolesQuery.data ?? []).map((row) => ({
        email: row.email,
        role: row.role,
      }))
      const plan = planAppRoleImport(existing, parsed.rows)

      // Never demote the signed-in admin via import.
      const safeToSave = plan.toSave.filter((row) => {
        if (row.email === selfEmail && row.role !== 'admin') {
          return false
        }
        return true
      })
      const blockedSelf = plan.toSave.length - safeToSave.length

      if (safeToSave.length === 0) {
        const parts = [
          plan.alreadyMatch
            ? `${plan.alreadyMatch} already match`
            : null,
          blockedSelf ? 'skipped changing your own Admin role' : null,
          parsed.errors.length ? `${parsed.errors.length} row error(s)` : null,
        ].filter(Boolean)
        showToastError(
          parts.length
            ? `Nothing to import (${parts.join('; ')}).`
            : 'Nothing new to import.',
        )
        return
      }

      const summary = [
        plan.additions ? `${plan.additions} new` : null,
        plan.roleChanges ? `${plan.roleChanges} role change${plan.roleChanges === 1 ? '' : 's'}` : null,
        plan.alreadyMatch ? `${plan.alreadyMatch} unchanged` : null,
        parsed.errors.length ? `${parsed.errors.length} skipped (errors)` : null,
        blockedSelf ? 'your Admin role left alone' : null,
      ]
        .filter(Boolean)
        .join(', ')

      const ok = await confirm(
        `Import ${safeToSave.length} user${safeToSave.length === 1 ? '' : 's'} from "${file.name}"?\n\n${summary}`,
        { confirmLabel: 'Import', cancelLabel: 'Cancel' },
      )
      if (!ok) return

      let saved = 0
      for (const row of safeToSave) {
        await saveAppUserRole(row)
        void recordActivityEvent({
          eventType: 'role_save',
          resourceKey: row.email,
          meta: { role: row.role, source: 'csv_import' },
        })
        saved += 1
      }

      await queryClient.invalidateQueries({ queryKey: ['appUserRoles'] })
      showToastSuccess(
        `✓ Imported ${saved} user${saved === 1 ? '' : 's'}${
          parsed.errors.length ? ` (${parsed.errors.length} row${parsed.errors.length === 1 ? '' : 's'} skipped)` : ''
        }`,
      )
    } catch (error) {
      showToastError(error instanceof Error ? error.message : 'Could not import users')
    } finally {
      setImportBusy(false)
      if (importInputRef.current) importInputRef.current.value = ''
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Manage users" width={520} align="center">
      <div className={styles.body}>
        <p className={styles.hint}>
          Assign Admin (can edit) or Viewer (view only). Anyone listed here can sign in on the live
          site. Addresses ending in <code>@quadreal.com</code> can also sign in even if they are not
          listed yet.
        </p>
        <form onSubmit={(event) => void handleSave(event)}>
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
          <div className={styles.userListHeader}>
            <p className={styles.sectionLabel} style={{ marginBottom: 0 }}>Assigned roles</p>
            <div className={styles.userListActions}>
              <button
                type="button"
                className={styles.linkBtn}
                onClick={handleExport}
                disabled={busy || rolesQuery.isLoading || total === 0}
              >
                Export
              </button>
              <button
                type="button"
                className={styles.linkBtn}
                onClick={() => importInputRef.current?.click()}
                disabled={busy || rolesQuery.isLoading}
              >
                Import
              </button>
              <input
                ref={importInputRef}
                type="file"
                accept=".csv,text/csv"
                className={styles.hiddenFileInput}
                aria-label="Import users from CSV"
                onChange={(event) => {
                  const file = event.target.files?.[0] ?? null
                  void handleImportFile(file)
                }}
              />
            </div>
          </div>
          <p className={styles.hint} style={{ marginTop: 0 }}>
            Export downloads a spreadsheet-friendly list (email, role). Import the same format to
            add or update several people at once.
          </p>
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
            <button
              type="button"
              className={styles.sortBtn}
              onClick={() => setSortDir((dir) => (dir === 'asc' ? 'desc' : 'asc'))}
              disabled={busy || rolesQuery.isLoading || total === 0}
              aria-label={
                sortDir === 'asc'
                  ? 'Sorted A to Z. Click for Z to A.'
                  : 'Sorted Z to A. Click for A to Z.'
              }
              title={sortDir === 'asc' ? 'A → Z (click for Z → A)' : 'Z → A (click for A → Z)'}
            >
              {sortDir === 'asc' ? 'A → Z' : 'Z → A'}
            </button>
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
              {' · '}
              sorted {sortDir === 'asc' ? 'A → Z' : 'Z → A'}
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
                        disabled={busy || entry.email === selfEmail}
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
