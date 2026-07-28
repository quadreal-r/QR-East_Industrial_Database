import { clearCookieHeader, OTP_COOKIE, SESSION_COOKIE, type AuthEnv } from '../../lib/bmeAuth'

interface PagesContext {
  request: Request
  env: AuthEnv
}

function json(body: unknown, status = 200): Response {
  const headers = new Headers({
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json',
  })
  headers.append('Set-Cookie', clearCookieHeader(SESSION_COOKIE))
  headers.append('Set-Cookie', clearCookieHeader(OTP_COOKIE))
  return new Response(JSON.stringify(body), { status, headers })
}

export async function onRequest(context: PagesContext): Promise<Response> {
  if (context.request.method !== 'POST' && context.request.method !== 'GET') {
    return json({ error: 'Method not allowed' }, 405)
  }
  void context.env
  return json({ ok: true })
}
