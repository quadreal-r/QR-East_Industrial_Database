import {
  authWallResponse,
  verifySession,
  wantsHtml,
  type AuthEnv,
} from './lib/bmeAuth'
import { getAccessOffline } from './lib/accessOffline'

interface PagesContext {
  request: Request
  env: AuthEnv
  next: (input?: Request | string, init?: RequestInit) => Promise<Response>
}

/**
 * Serve the QuadReal OTP wall for document navigations without a bme_session.
 * While Offline, always serve the Off Line wall (even with a valid session cookie).
 * Cloudflare Access must be disabled on this Pages hostname so this wall is visible.
 */
export async function onRequest(context: PagesContext): Promise<Response> {
  const url = new URL(context.request.url)
  const path = url.pathname

  if (
    path.startsWith('/api/') ||
    path.startsWith('/auth/') ||
    path.startsWith('/assets/') ||
    path.startsWith('/brand/') ||
    path.startsWith('/insp360/') ||
    path.startsWith('/database/') ||
    /\.(js|css|map|png|jpe?g|webp|svg|ico|woff2?|ttf|json)$/i.test(path)
  ) {
    return context.next()
  }

  // Only gate HTML document requests (SPA entry).
  if (!wantsHtml(context.request) || context.request.method !== 'GET') {
    return context.next()
  }

  // Panic kill-switch: cut all HTML access while Offline (admins reactivate via wall OTP).
  if (await getAccessOffline(context.env)) {
    return authWallResponse('', { offline: true })
  }

  const session = await verifySession(context.request, context.env)
  if (session.ok) return context.next()

  // Transition: if Cloudflare Access is still enabled, trust its identity
  // so users are not asked for a second OTP on our wall.
  if (
    context.request.headers.get('Cf-Access-Jwt-Assertion') ||
    context.request.headers.get('Cf-Access-Authenticated-User-Email')
  ) {
    return context.next()
  }

  // If SESSION_SECRET is missing, do not lock everyone out during rollout.
  if (!context.env.SESSION_SECRET) {
    console.warn('[auth] SESSION_SECRET missing — skipping OTP wall')
    return context.next()
  }

  return authWallResponse(session.error)
}
