/**
 * Presign a PUT to the insp360 R2 bucket (no npm/esm AWS SDK imports —
 * those crash Supabase Edge isolates and surface as FunctionsFetchError).
 *
 * Secrets:
 *   INSP360_R2_ACCOUNT_ID
 *   INSP360_R2_ACCESS_KEY_ID
 *   INSP360_R2_SECRET_ACCESS_KEY
 *   INSP360_R2_BUCKET_NAME          (default: insp360)
 *   INSP360_R2_KEY_PREFIX           (optional)
 *   INSP360_R2_PUBLIC_URL or VITE_INSP360_BASE_URL
 */

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-supabase-api-version, prefer',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const PRESIGN_EXPIRES_SEC = 30 * 60

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function readEnv(...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = Deno.env.get(key)?.trim()
    if (value) return value
  }
  return undefined
}

function getBucket(): string {
  return readEnv('INSP360_R2_BUCKET_NAME') ?? 'insp360'
}

function getKeyPrefix(): string {
  const prefix = readEnv('INSP360_R2_KEY_PREFIX') ?? ''
  if (!prefix) return ''
  return prefix.endsWith('/') ? prefix : `${prefix}/`
}

function getPublicBaseUrl(): string | undefined {
  const value = readEnv('INSP360_R2_PUBLIC_URL', 'VITE_INSP360_BASE_URL')
  if (!value) return undefined
  return value.endsWith('/') ? value : `${value}/`
}

function sanitizeInsp360ObjectKey(raw: string): string | null {
  let key = String(raw || '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
  if (!key || key.includes('..') || key.includes('://')) return null
  key = key
    .split('/')
    .map((part) =>
      part
        .normalize('NFKD')
        .replace(/[^\w.-]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .toLowerCase(),
    )
    .filter(Boolean)
    .join('/')
  if (!key || key.length > 240) return null
  // Tours (.insp360/.zip), dashboard thumbnail (.cover.jpg), or pin/map sidecar (.tour.json)
  if (/\.cover\.jpe?g$/i.test(key)) {
    return `${getKeyPrefix()}${key}`
  }
  if (/\.tour\.json$/i.test(key)) {
    return `${getKeyPrefix()}${key}`
  }
  if (!/\.(insp360|zip)$/i.test(key)) key = `${key}.insp360`
  return `${getKeyPrefix()}${key}`
}

function publicUrlForKey(objectKey: string): string | null {
  const base = getPublicBaseUrl()
  if (!base) return null
  return `${base}${objectKey.split('/').map(encodeURIComponent).join('/')}`
}

function encodeRfc3986(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
}

function toAmzDate(d: Date): { amzDate: string; dateStamp: string } {
  const iso = d.toISOString().replace(/[:-]|\.\d{3}/g, '')
  return { amzDate: iso, dateStamp: iso.slice(0, 8) }
}

async function hmac(key: ArrayBuffer | Uint8Array, data: string): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    key instanceof ArrayBuffer ? key : key.buffer.slice(key.byteOffset, key.byteOffset + key.byteLength),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  return crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(data))
}

async function sha256Hex(data: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function getSignatureKey(
  secret: string,
  dateStamp: string,
  region: string,
  service: string,
): Promise<ArrayBuffer> {
  const kDate = await hmac(new TextEncoder().encode(`AWS4${secret}`), dateStamp)
  const kRegion = await hmac(kDate, region)
  const kService = await hmac(kRegion, service)
  return hmac(kService, 'aws4_request')
}

/** Query-string SigV4 pre-signed URL for R2/S3 PUT (UNSIGNED-PAYLOAD). */
async function presignR2PutUrl(options: {
  accountId: string
  accessKeyId: string
  secretAccessKey: string
  bucket: string
  objectKey: string
  contentType: string
  expiresSec: number
}): Promise<string> {
  const region = 'auto'
  const service = 's3'
  const host = `${options.accountId}.r2.cloudflarestorage.com`
  const canonicalUri = `/${options.bucket}/${options.objectKey
    .split('/')
    .map(encodeRfc3986)
    .join('/')}`
  const { amzDate, dateStamp } = toAmzDate(new Date())
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`
  const credential = `${options.accessKeyId}/${credentialScope}`

  const query: Record<string, string> = {
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': credential,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(options.expiresSec),
    'X-Amz-SignedHeaders': 'content-type;host',
  }
  const canonicalQuery = Object.keys(query)
    .sort()
    .map((k) => `${encodeRfc3986(k)}=${encodeRfc3986(query[k]!)}`)
    .join('&')

  const payloadHash = 'UNSIGNED-PAYLOAD'
  const canonicalHeaders = `content-type:${options.contentType}\nhost:${host}\n`
  const canonicalRequest = [
    'PUT',
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    'content-type;host',
    payloadHash,
  ].join('\n')

  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    await sha256Hex(canonicalRequest),
  ].join('\n')

  const signingKey = await getSignatureKey(options.secretAccessKey, dateStamp, region, service)
  const signatureBuf = await hmac(signingKey, stringToSign)
  const signature = [...new Uint8Array(signatureBuf)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')

  return `https://${host}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`
}

async function objectExists(options: {
  accountId: string
  accessKeyId: string
  secretAccessKey: string
  bucket: string
  objectKey: string
}): Promise<boolean> {
  // Lightweight HEAD with SigV4 header auth (not query).
  const region = 'auto'
  const service = 's3'
  const host = `${options.accountId}.r2.cloudflarestorage.com`
  const canonicalUri = `/${options.bucket}/${options.objectKey
    .split('/')
    .map(encodeRfc3986)
    .join('/')}`
  const { amzDate, dateStamp } = toAmzDate(new Date())
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`
  const payloadHash = await sha256Hex('')
  const canonicalHeaders = `host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`
  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date'
  const canonicalRequest = [
    'HEAD',
    canonicalUri,
    '',
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n')
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    await sha256Hex(canonicalRequest),
  ].join('\n')
  const signingKey = await getSignatureKey(options.secretAccessKey, dateStamp, region, service)
  const signatureBuf = await hmac(signingKey, stringToSign)
  const signature = [...new Uint8Array(signatureBuf)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
  const authorization =
    `AWS4-HMAC-SHA256 Credential=${options.accessKeyId}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`

  try {
    const res = await fetch(`https://${host}${canonicalUri}`, {
      method: 'HEAD',
      headers: {
        Authorization: authorization,
        'x-amz-content-sha256': payloadHash,
        'x-amz-date': amzDate,
      },
    })
    return res.ok
  } catch {
    return false
  }
}

Deno.serve(async (req) => {
  try {
    if (req.method === 'OPTIONS') {
      return new Response('ok', { headers: corsHeaders })
    }
    if (req.method !== 'POST') {
      return json({ error: 'Method not allowed' }, 405)
    }

    const authHeader = req.headers.get('Authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return json({ error: 'Unauthorized' }, 401)
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
    if (!supabaseUrl || !anonKey) {
      return json({ error: 'Server misconfigured' }, 500)
    }

    const userRes = await fetch(`${supabaseUrl.replace(/\/$/, '')}/auth/v1/user`, {
      headers: {
        Authorization: authHeader,
        apikey: anonKey,
      },
    })
    if (!userRes.ok) {
      return json({ error: 'Unauthorized' }, 401)
    }
    const editorRes = await fetch(
      `${supabaseUrl.replace(/\/$/, '')}/rest/v1/rpc/is_app_editor`,
      {
        method: 'POST',
        headers: {
          Authorization: authHeader,
          apikey: anonKey,
          'Content-Type': 'application/json',
        },
        body: '{}',
      },
    )
    if (!editorRes.ok || (await editorRes.json()) !== true) {
      return json({ error: 'Admin access required' }, 403)
    }

    let payload: {
      objectKey?: string
      contentType?: string
      contentLength?: number
      overwrite?: boolean
    }
    try {
      payload = await req.json()
    } catch {
      return json({ error: 'Invalid JSON body' }, 400)
    }

    const objectKey = sanitizeInsp360ObjectKey(String(payload.objectKey || ''))
    if (!objectKey) {
      return json(
        { error: 'Invalid objectKey. Use a relative path like building/tour.insp360' },
        400,
      )
    }

    const accountId = readEnv('INSP360_R2_ACCOUNT_ID')
    const accessKeyId = readEnv('INSP360_R2_ACCESS_KEY_ID')
    const secretAccessKey = readEnv('INSP360_R2_SECRET_ACCESS_KEY')
    if (!accountId || !accessKeyId || !secretAccessKey) {
      return json(
        {
          error:
            'insp360 R2 is not configured on the server. Set INSP360_R2_* secrets for this Edge Function.',
        },
        503,
      )
    }

    const bucket = getBucket()
    const contentType = String(payload.contentType || '').trim() || 'application/octet-stream'

    const existed = await objectExists({
      accountId,
      accessKeyId,
      secretAccessKey,
      bucket,
      objectKey,
    })

    if (existed && payload.overwrite !== true) {
      return json({
        ok: false,
        existed: true,
        objectKey,
        publicUrl: publicUrlForKey(objectKey),
        tourUrl: objectKey,
        error: 'A tour already exists at this Cloudflare path. Confirm overwrite to replace it.',
      })
    }

    const uploadUrl = await presignR2PutUrl({
      accountId,
      accessKeyId,
      secretAccessKey,
      bucket,
      objectKey,
      contentType,
      expiresSec: PRESIGN_EXPIRES_SEC,
    })

    return json({
      ok: true,
      existed,
      objectKey,
      uploadUrl,
      publicUrl: publicUrlForKey(objectKey),
      tourUrl: objectKey,
      expiresIn: PRESIGN_EXPIRES_SEC,
      contentType,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Upload service failed'
    return json({ error: message }, 500)
  }
})
