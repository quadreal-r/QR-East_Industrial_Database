/** Localhost session role override (`?as=` on `/api/session`). */
export type LocalDevAs = 'admin' | 'viewer'

/**
 * Pick which email to mint for localhost `/api/session`.
 * `as=admin|viewer` prefers LOCAL_DEV_EMAIL when that email already has that role,
 * otherwise the first matching row from Manage users.
 */
export function pickLocalDevEmail(options: {
  as: LocalDevAs | null
  configuredEmail: string
  adminEmails: string[]
  viewerEmails: string[]
}): string {
  const configured = options.configuredEmail.trim().toLowerCase()
  const admins = options.adminEmails.map((e) => e.trim().toLowerCase()).filter(Boolean)
  const viewers = options.viewerEmails.map((e) => e.trim().toLowerCase()).filter(Boolean)

  if (options.as === 'admin') {
    if (configured && admins.includes(configured)) return configured
    if (admins[0]) return admins[0]
    throw new Error(
      'No Admin user for local sign-in. Promote an email in Manage users, or set LOCAL_DEV_EMAIL to an Admin.',
    )
  }

  if (options.as === 'viewer') {
    if (configured && viewers.includes(configured)) return configured
    if (viewers[0]) return viewers[0]
    throw new Error(
      'No Viewer user for local sign-in. Set LOCAL_DEV_EMAIL to a Viewer email in .env.local.',
    )
  }

  if (configured) return configured
  if (admins[0]) return admins[0]
  throw new Error('Set LOCAL_DEV_EMAIL in .env.local')
}
