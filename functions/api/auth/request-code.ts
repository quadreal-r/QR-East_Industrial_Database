import { requestLoginCode, type AuthEnv } from '../../lib/bmeAuth'

interface PagesContext {
  request: Request
  env: AuthEnv
}

function json(body: unknown, status = 200, headers?: HeadersInit): Response {
  return Response.json(body, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      ...(headers || {}),
    },
  })
}

export async function onRequest(context: PagesContext): Promise<Response> {
  if (context.request.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  let body: { email?: string }
  try {
    body = (await context.request.json()) as { email?: string }
  } catch {
    return json({ error: 'Invalid JSON body' }, 400)
  }

  const result = await requestLoginCode(body.email || '', context.env, {
    redirectOrigin: new URL(context.request.url).origin,
  })
  if (!result.ok) return json({ error: result.error }, 400)

  const headers: Record<string, string> = {}
  if (result.setCookie) headers['Set-Cookie'] = result.setCookie
  return json({ ok: true, email: result.email, mode: result.mode }, 200, headers)
}
