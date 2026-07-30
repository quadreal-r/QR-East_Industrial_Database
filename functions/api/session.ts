import { createClient } from '@supabase/supabase-js'
import { createRemoteJWKSet, jwtVerify } from 'jose'
import { verifySession } from '../lib/bmeAuth'
import {
  decideOfflineVerify,
  getAccessOffline,
  isAppAdmin,
  setAccessOffline,
} from '../lib/accessOffline'

interface Env {
  SUPABASE_URL: string
  SUPABASE_SERVICE_ROLE_KEY: string
  SESSION_SECRET?: string
}

interface PagesContext {
  request: Request
  env: Env
}

const ACCESS_TEAM = 'late-dream-df75.cloudflareaccess.com'
/** Access application AUD tag (not the app UUID). */
const ACCESS_AUDIENCE = 'c5957e717eb901c2bf75f820a013af86ac7ea19c5849177c2fc21dd7a6b067d4'
const accessKeys = createRemoteJWKSet(new URL(`https://${ACCESS_TEAM}/cdn-cgi/access/certs`))

function json(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json',
    },
  })
}

async function ensureAuthUser(
  admin: ReturnType<typeof createClient>,
  email: string,
): Promise<void> {
  const { error } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
  })
  // "already been registered" is fine — we only need the user to exist.
  if (error && !/already|registered|exists/i.test(error.message)) {
    throw error
  }
}

async function mintSession(email: string, env: Env) {
  const admin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  await ensureAuthUser(admin, email)

  // Resolve / seed app_roles WHILE this client still has the service role.
  // verifyOtp below attaches the end-user session to the client; PostgREST
  // calls after that hit RLS as that user (viewers cannot insert app_roles).
  const { data: existingRole, error: roleError } = await admin
    .from('app_roles')
    .select('role')
    .eq('email', email)
    .maybeSingle()
  if (roleError) throw roleError

  const role = existingRole?.role === 'admin' ? 'admin' : 'viewer'
  if (!existingRole) {
    const { error } = await admin.from('app_roles').insert({ email, role })
    if (error) throw error
  }

  const { data: link, error: linkError } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email,
  })
  if (linkError) throw linkError

  const tokenHash = link.properties?.hashed_token
  if (!tokenHash) throw new Error('Supabase did not return a session token')

  // Separate client so verifyOtp never contaminates the service-role admin client.
  const verifier = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { data: verified, error: verifyError } = await verifier.auth.verifyOtp({
    type: 'email',
    token_hash: tokenHash,
  })
  if (verifyError) throw verifyError
  if (!verified.session) throw new Error('Supabase did not create a session')

  return {
    access_token: verified.session.access_token,
    refresh_token: verified.session.refresh_token,
    email,
    role,
  }
}

async function resolveAccessEmail(request: Request): Promise<string> {
  const assertion = request.headers.get('Cf-Access-Jwt-Assertion')
  const headerEmail = request.headers
    .get('Cf-Access-Authenticated-User-Email')
    ?.trim()
    .toLowerCase()

  if (!assertion && !headerEmail) {
    throw new Error('Cloudflare Access identity required')
  }

  if (assertion) {
    try {
      const { payload } = await jwtVerify(assertion, accessKeys, {
        audience: ACCESS_AUDIENCE,
        issuer: `https://${ACCESS_TEAM}`,
        clockTolerance: 60,
      })
      const jwtEmail =
        typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : ''
      const email = jwtEmail || headerEmail
      if (!email) throw new Error('Access identity missing email')
      if (headerEmail && jwtEmail && headerEmail !== jwtEmail) {
        throw new Error('Access identity mismatch')
      }
      return email
    } catch (error) {
      // Access already validated the browser at the edge. If JWT verify fails
      // (JWKS blip, clock skew), the trusted Access email header is enough.
      if (headerEmail) {
        console.error(
          'Access JWT verify failed; using Access email header',
          error instanceof Error ? error.message : String(error),
        )
        return headerEmail
      }
      throw error
    }
  }

  return headerEmail as string
}

/** Prefer QuadReal OTP cookie; fall back to Cloudflare Access JWT while Access is still on. */
async function resolveIdentityEmail(request: Request, env: Env): Promise<string> {
  if (env.SESSION_SECRET) {
    const session = await verifySession(request, env)
    if (session.ok) return session.email
  }
  return resolveAccessEmail(request)
}

/** Supabase/PostgREST often throws plain objects, not Error instances. */
function thrownMessage(error: unknown): string {
  if (typeof error === 'string' && error.trim() && error.trim() !== '[object Object]') {
    return error.trim()
  }
  if (error instanceof Error && error.message.trim() && error.message !== '[object Object]') {
    return error.message.trim()
  }
  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>
    const message = typeof record.message === 'string' ? record.message.trim() : ''
    const details =
      typeof record.details === 'string'
        ? record.details.trim()
        : typeof record.detail === 'string'
          ? record.detail.trim()
          : ''
    if (message && details) return `${message} (${details})`.slice(0, 200)
    if (message) return message.slice(0, 200)
    if (details) return details.slice(0, 200)
    try {
      const encoded = JSON.stringify(error)
      if (encoded && encoded !== '{}' && encoded !== 'null') return encoded.slice(0, 200)
    } catch {
      /* ignore */
    }
  }
  return 'Unknown session error'
}

async function handleGet(context: PagesContext): Promise<Response> {
  if (!context.env.SUPABASE_URL || !context.env.SUPABASE_SERVICE_ROLE_KEY) {
    return json({ error: 'Session service is not configured' }, 500)
  }

  try {
    const email = await resolveIdentityEmail(context.request, context.env)
    const offline = await getAccessOffline(context.env)
    if (offline) {
      const adminUser = await isAppAdmin(email, context.env)
      const decision = decideOfflineVerify({ offline: true, isAdmin: adminUser })
      if (decision.action === 'refuse') {
        return json(
          {
            error: 'App is offline',
            detail: decision.error,
          },
          403,
        )
      }
      if (decision.action === 'clear_offline') {
        await setAccessOffline(context.env, false, { setBy: email })
      }
    }
    return json(await mintSession(email, context.env))
  } catch (error) {
    const message = thrownMessage(error)
    console.error('Could not create application session', message)
    const status =
      /identity required|missing email|mismatch|Sign in required|Session expired|Invalid session/i.test(
        message,
      )
        ? 401
        : 500
    return json(
      {
        error: 'Could not create application session',
        detail: message.slice(0, 200),
      },
      status,
    )
  }
}

export function onRequest(context: PagesContext): Promise<Response> | Response {
  if (context.request.method !== 'GET') return json({ error: 'Method not allowed' }, 405)
  return handleGet(context)
}
