import { useState } from 'react'
import { Button } from '@/components/Button/Button'
import { useAuth } from '@/hooks/useAuth'
import { ActivityLogSettings } from '@/features/settings/ActivityLogSettings'
import { SettingsToolButton } from '@/features/settings/SettingsToolButton'
import { UserAdminSettings } from '@/features/settings/UserAdminSettings'
import styles from './SettingsModal.module.css'

export function SettingsAccountPage() {
  const {
    user,
    email,
    role,
    canEdit,
    isLoading,
    error,
    isAuthenticated,
    isLocalDev,
    signOut,
    signInAtAccessWall,
    signInAsLocal,
  } = useAuth()
  const [userAdminOpen, setUserAdminOpen] = useState(false)
  const [activityLogOpen, setActivityLogOpen] = useState(false)

  return (
    <>
      <div className={styles.body}>
        {isLoading ? (
          <p className={styles.authStatus}>Connecting…</p>
        ) : (
          <p className={styles.authStatus}>
            {email ?? user?.email ?? 'No Access identity'} ·{' '}
            {role === 'admin' ? 'Admin' : role === 'viewer' ? 'Viewer' : 'Connecting…'}
          </p>
        )}
        {error ? <p className={styles.pwMismatch}>{error}</p> : null}

        <p className={styles.hint}>
          {isLocalDev
            ? 'Localhost has no Access wall. After Logout, choose Sign in as Admin or Sign in as Viewer.'
            : 'Cloudflare Access controls who can open the cloud app. Your application role controls whether you can edit.'}
        </p>

        {isAuthenticated ? (
          <Button type="button" variant="ghost" onClick={() => void signOut()}>
            Logout
          </Button>
        ) : isLocalDev ? (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Button type="button" variant="ghost" onClick={() => signInAsLocal('admin')}>
              Sign in as Admin
            </Button>
            <Button type="button" variant="ghost" onClick={() => signInAsLocal('viewer')}>
              Sign in as Viewer
            </Button>
          </div>
        ) : (
          <Button type="button" variant="ghost" onClick={() => signInAtAccessWall()}>
            Sign in
          </Button>
        )}

        {canEdit ? (
          <section style={{ marginTop: 20 }}>
            <p className={styles.sectionLabel} style={{ marginBottom: 8 }}>
              Admin
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <SettingsToolButton
                tooltip="Assign Admin or Viewer access by email."
                onClick={() => setUserAdminOpen(true)}
              >
                Manage users
              </SettingsToolButton>
              <SettingsToolButton
                tooltip="Fetch, download, or email a digest of sign-ins, time in app, 360° tour opens, and map edits."
                onClick={() => setActivityLogOpen(true)}
              >
                Activity log
              </SettingsToolButton>
            </div>
          </section>
        ) : null}
      </div>
      <UserAdminSettings open={userAdminOpen} onClose={() => setUserAdminOpen(false)} />
      <ActivityLogSettings open={activityLogOpen} onClose={() => setActivityLogOpen(false)} />
    </>
  )
}
