import {
  isAuthLoggedOutLatchSet,
  isCloudflareAccessHost,
} from '@/lib/cloudflareAccess'

export type AppRole = 'admin' | 'viewer'

export function shouldBootstrapSilentSession(
  hostname = typeof window !== 'undefined' ? window.location.hostname : '',
): boolean {
  // Access hosts: if this page loaded, Cloudflare Access already authenticated the
  // user (the wall sits in front of the app). Ignore the logout latch — it survives
  // in localStorage after Access login and would otherwise leave a useless "Sign in".
  if (isCloudflareAccessHost(hostname)) return true

  // Localhost has no Access wall — honor the latch so Logout stays logged out
  // until the user clicks Sign in.
  if (isAuthLoggedOutLatchSet()) return false
  return hostname === '127.0.0.1' || hostname === 'localhost'
}

/** Unknown or missing role values always fail closed to Viewer. */
export function normalizeAppRole(value: unknown): AppRole {
  return value === 'admin' ? 'admin' : 'viewer'
}
