import { completeMagicLinkSession, type AuthEnv } from '../../lib/bmeAuth'

interface PagesContext {
  request: Request
  env: AuthEnv
}

function json(body: unknown, status = 200, setCookies?: string[]): Response {
  const headers = new Headers({
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json',
  })
  for (const cookie of setCookies ?? []) headers.append('Set-Cookie', cookie)
  return new Response(JSON.stringify(body), { status, headers })
}

export async function onRequest(context: PagesContext): Promise<Response> {
  if (context.request.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  let body: { access_token?: string }
  try {
    body = (await context.request.json()) as { access_token?: string }
  } catch {
    return json({ error: 'Invalid JSON body' }, 400)
  }

  const result = await completeMagicLinkSession(body.access_token || '', context.env)
  if (!result.ok) return json({ error: result.error }, 400)
  return json({ ok: true, email: result.email }, 200, result.setCookies)
}
