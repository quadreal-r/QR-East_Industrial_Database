/** Cloudflare Zero Trust team host for this map app (quadreal Access). */
export const CLOUDFLARE_ACCESS_TEAM_HOST = 'late-dream-df75.cloudflareaccess.com'

/** Production Pages origin protected by Cloudflare Access. */
export const CLOUDFLARE_ACCESS_APP_ORIGIN = 'https://qr-east-industrial-database.pages.dev'

/** localStorage flag: block silent re-login until Access sign-in succeeds. */
export const AUTH_LOGGED_OUT_KEY = 'bme-auth-logged-out'

/** Hostnames protected by Cloudflare Access for this map app. */
export function isCloudflareAccessHost(
  hostname = typeof window !== 'undefined' ? window.location.hostname : '',
): boolean {
  return (
    hostname === 'qr-east-industrial-database.pages.dev' ||
    hostname.endsWith('.qr-east-industrial-database.pages.dev')
  )
}

export function isAuthLoggedOutLatchSet(): boolean {
  if (typeof localStorage === 'undefined') return false
  return localStorage.getItem(AUTH_LOGGED_OUT_KEY) === '1'
}

export function markAuthLoggedOutLatch(): void {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(AUTH_LOGGED_OUT_KEY, '1')
}

export function clearAuthLoggedOutLatch(): void {
  if (typeof localStorage === 'undefined') return
  localStorage.removeItem(AUTH_LOGGED_OUT_KEY)
}

function appRootFromOrigin(origin: string): string {
  return `${origin.replace(/\/$/, '')}/`
}

/**
 * Same-origin Access logout that clears the per-app `CF_Authorization` cookie
 * and would redirect to the app root if followed in the browser.
 *
 * Important: never put another `/cdn-cgi/access/logout` URL in `returnTo` —
 * that nesting is what shows Cloudflare’s “Failed to log out” page.
 */
export function cloudflareAccessAppLogoutUrl(
  origin = typeof window !== 'undefined' ? window.location.origin : CLOUDFLARE_ACCESS_APP_ORIGIN,
): string {
  const appRoot = appRootFromOrigin(origin)
  return `${origin.replace(/\/$/, '')}/cdn-cgi/access/logout?returnTo=${encodeURIComponent(appRoot)}`
}

/**
 * Team-domain Access logout that clears the Zero Trust SSO session, then
 * returns to `returnTo` (must be the app itself — never another logout URL).
 */
export function cloudflareAccessTeamLogoutUrl(returnTo: string): string {
  return `https://${CLOUDFLARE_ACCESS_TEAM_HOST}/cdn-cgi/access/logout?returnTo=${encodeURIComponent(returnTo)}`
}

/** @deprecated Prefer {@link cloudflareAccessAppLogoutUrl} / team logout helpers. */
export function cloudflareAccessLogoutUrl(
  origin = typeof window !== 'undefined' ? window.location.origin : CLOUDFLARE_ACCESS_APP_ORIGIN,
): string {
  return cloudflareAccessAppLogoutUrl(origin)
}

/**
 * Remove Supabase auth tokens and session scratch data from the browser.
 * Keeps normal app preferences (filters, Capex excludes, etc.).
 */
export function clearBrowserAuthStorage(): void {
  if (typeof window === 'undefined') return

  const removeMatching = (store: Storage) => {
    const keys: string[] = []
    for (let i = 0; i < store.length; i++) {
      const key = store.key(i)
      if (!key || key === AUTH_LOGGED_OUT_KEY) continue
      if (
        key.startsWith('sb-') ||
        key.includes('supabase.auth') ||
        key.includes('-auth-token') ||
        key.toLowerCase().includes('supabase')
      ) {
        keys.push(key)
      }
    }
    for (const key of keys) store.removeItem(key)
  }

  try {
    removeMatching(window.localStorage)
  } catch {
    /* ignore quota / private mode */
  }
  try {
    // Session scratch only — full clear so a refresh cannot revive an in-tab session.
    window.sessionStorage.clear()
  } catch {
    /* ignore */
  }
  markAuthLoggedOutLatch()
}

/**
 * After app sign-out, clear the QuadReal OTP session cookie and show the login wall.
 * Falls back to Cloudflare Access logout only when the OTP wall is not configured.
 *
 * On localhost there is no OTP/Access wall — stay on the local app logged out.
 */
export async function redirectToCloudflareAccessWall(): Promise<void> {
  if (typeof window === 'undefined') return
  if (!isCloudflareAccessHost()) {
    window.location.replace(`${window.location.origin}/`)
    return
  }

  try {
    await fetch('/api/auth/logout', {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
    })
  } catch {
    /* still leave for the wall */
  }

  // Reload app root — middleware serves the QuadReal OTP wall when logged out.
  window.location.replace(`${window.location.origin}/`)
}

/**
 * Resume sign-in after Logout.
 * - On Access hosts: open the app (Access wall if cookies were cleared).
 * - On localhost: clear the logout latch and reload so local silent login can run again.
 */
export function redirectToCloudflareAccessApp(): void {
  if (typeof window === 'undefined') return
  clearAuthLoggedOutLatch()
  if (!isCloudflareAccessHost()) {
    window.location.reload()
    return
  }
  window.location.replace(`${window.location.origin}/`)
}
