/** OAuth / password-recovery redirect target for the current deployment. */
export function getAuthRedirectUrl(): string {
  if (typeof window === 'undefined') return ''
  const base = import.meta.env.BASE_URL ?? '/'
  const path = base.endsWith('/') ? base : `${base}/`
  return `${window.location.origin}${path}`
}
