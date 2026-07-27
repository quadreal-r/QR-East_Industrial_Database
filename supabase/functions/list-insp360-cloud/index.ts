/**
 * List .insp360 objects from the insp360 R2 bucket (gate-scoped Double Tour).
 *
 * Secrets (same as upload-insp360-cloud):
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
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}

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

function publicUrlForKey(objectKey: string): string | null {
  const base = getPublicBaseUrl()
  if (!base) return null
  return `${base}${objectKey.split('/').map(encodeURIComponent).join('/')}`
}

/**
 * Sanitize a list prefix.
 * - Normal: `building/tour` or a short hint like `60` (street #) so spacey root keys still list.
 * - `*` / `__all__`: list the whole insp360 key-space (auth already required); client filters.
 */
function sanitizePrefix(raw: string): string | null {
  let prefix = String(raw || '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
  if (!prefix || prefix.includes('..') || prefix.includes('://')) return null
  if (prefix === '*' || prefix === '__all__') {
    return getKeyPrefix()
  }
  prefix = prefix
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
  if (!prefix || prefix.length > 200) return null
  return `${getKeyPrefix()}${prefix}`
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

type ListedTour = {
  key: string
  size: number
  uploaded: string | null
  publicUrl: string | null
  coverKey?: string | null
  coverUrl?: string | null
}

async function listR2Objects(options: {
  accountId: string
  accessKeyId: string
  secretAccessKey: string
  bucket: string
  prefix: string
}): Promise<ListedTour[]> {
  const region = 'auto'
  const service = 's3'
  const host = `${options.accountId}.r2.cloudflarestorage.com`
  const tours: ListedTour[] = []
  let continuationToken: string | undefined

  do {
    const query: Record<string, string> = {
      'list-type': '2',
      'max-keys': '1000',
      prefix: options.prefix,
    }
    if (continuationToken) query['continuation-token'] = continuationToken

    const canonicalQuery = Object.keys(query)
      .sort()
      .map((k) => `${encodeRfc3986(k)}=${encodeRfc3986(query[k]!)}`)
      .join('&')

    const { amzDate, dateStamp } = toAmzDate(new Date())
    const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`
    const payloadHash = await sha256Hex('')
    const canonicalHeaders = `host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`
    const signedHeaders = 'host;x-amz-content-sha256;x-amz-date'
    const canonicalUri = `/${options.bucket}`
    const canonicalRequest = [
      'GET',
      canonicalUri,
      canonicalQuery,
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

    const res = await fetch(`https://${host}${canonicalUri}?${canonicalQuery}`, {
      method: 'GET',
      headers: {
        Authorization: authorization,
        'x-amz-content-sha256': payloadHash,
        'x-amz-date': amzDate,
      },
    })
    if (!res.ok) {
      const body = await res.text()
      throw new Error(`R2 list failed (${res.status}): ${body.slice(0, 200)}`)
    }

    const xml = await res.text()
    const contents = [...xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)]
    const objects: { key: string; size: number; uploaded: string | null }[] = []
    for (const match of contents) {
      const block = match[1] || ''
      const key = block.match(/<Key>([^<]+)<\/Key>/)?.[1]
      if (!key) continue
      const size = Number(block.match(/<Size>(\d+)<\/Size>/)?.[1] || 0)
      const lastModified = block.match(/<LastModified>([^<]+)<\/LastModified>/)?.[1] || null
      objects.push({ key, size, uploaded: lastModified })
    }

    const coverKeys = new Set(
      objects.filter((o) => /\.cover\.jpe?g$/i.test(o.key)).map((o) => o.key),
    )
    for (const o of objects) {
      if (!/\.insp360$/i.test(o.key)) continue
      if (/\.cover\.jpe?g$/i.test(o.key)) continue
      const coverKey = o.key.replace(/\.insp360$/i, '') + '.cover.jpg'
      const hasCover = coverKeys.has(coverKey)
      tours.push({
        key: o.key,
        size: o.size,
        uploaded: o.uploaded,
        publicUrl: publicUrlForKey(o.key),
        coverKey: hasCover ? coverKey : null,
        coverUrl: hasCover ? publicUrlForKey(coverKey) : null,
      })
    }

    const truncated = /<IsTruncated>true<\/IsTruncated>/i.test(xml)
    continuationToken = truncated
      ? xml.match(/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/)?.[1]
      : undefined
  } while (continuationToken)

  tours.sort((a, b) => String(b.uploaded || '').localeCompare(String(a.uploaded || '')))
  return tours
}

Deno.serve(async (req) => {
  try {
    if (req.method === 'OPTIONS') {
      return new Response('ok', { headers: corsHeaders })
    }
    if (req.method !== 'GET' && req.method !== 'POST') {
      return json({ error: 'Method not allowed' }, 405)
    }

    const authHeader = req.headers.get('Authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return json({ error: 'Unauthorized — sign in to list cloud tours.' }, 401)
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

    let prefixRaw = ''
    if (req.method === 'GET') {
      prefixRaw = new URL(req.url).searchParams.get('prefix') || ''
    } else {
      try {
        const body = (await req.json()) as { prefix?: string }
        prefixRaw = String(body.prefix || '')
      } catch {
        return json({ error: 'Invalid JSON body' }, 400)
      }
    }

    const prefix = sanitizePrefix(prefixRaw)
    if (!prefix) {
      return json(
        {
          error:
            'Missing or invalid prefix. Pass a gate stem like building/tour (no leading slash).',
        },
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

    const tours = await listR2Objects({
      accountId,
      accessKeyId,
      secretAccessKey,
      bucket: getBucket(),
      prefix,
    })

    return json({ tours, prefix })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'List service failed'
    return json({ error: message }, 500)
  }
})
