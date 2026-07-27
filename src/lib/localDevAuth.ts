import type { LocalDevAs } from '@/lib/localDevEmail'

export type { LocalDevAs } from '@/lib/localDevEmail'
export { pickLocalDevEmail } from '@/lib/localDevEmail'

/** localStorage: last localhost Sign in choice (`admin` | `viewer`). */
export const LOCAL_DEV_AS_KEY = 'bme-local-dev-as'

export function isLocalDevHost(
  hostname = typeof window !== 'undefined' ? window.location.hostname : '',
): boolean {
  return hostname === '127.0.0.1' || hostname === 'localhost'
}

export function getLocalDevAs(): LocalDevAs | null {
  if (typeof localStorage === 'undefined') return null
  const value = localStorage.getItem(LOCAL_DEV_AS_KEY)
  return value === 'admin' || value === 'viewer' ? value : null
}

export function setLocalDevAs(role: LocalDevAs): void {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(LOCAL_DEV_AS_KEY, role)
}

export function clearLocalDevAs(): void {
  if (typeof localStorage === 'undefined') return
  localStorage.removeItem(LOCAL_DEV_AS_KEY)
}
