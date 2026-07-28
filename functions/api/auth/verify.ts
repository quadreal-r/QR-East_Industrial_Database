import { verifyLoginCode, type AuthEnv } from '../../lib/bmeAuth'

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

  let body: { email?: string; code?: string }
  try {
    body = (await context.request.json()) as { email?: string; code?: string }
  } catch {
    return json({ error: 'Invalid JSON body' }, 400)
  }

  const result = await verifyLoginCode(body.email || '', body.code || '', context.request, context.env)
  if (!result.ok) return json({ error: result.error }, 400)
  return json({ ok: true, email: result.email }, 200, result.setCookies)
}
