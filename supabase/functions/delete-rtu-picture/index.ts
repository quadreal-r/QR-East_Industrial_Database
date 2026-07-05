import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from 'https://esm.sh/@aws-sdk/client-s3@3.699.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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

function createR2Client(): S3Client | null {
  const accountId = readEnv('R2_ACCOUNT_ID', 'CLOUDFLARE_ACCOUNT_ID')
  const accessKeyId = readEnv('R2_ACCESS_KEY_ID', 'CLOUDFLARE_R2_ACCESS_KEY_ID')
  const secretAccessKey = readEnv('R2_SECRET_ACCESS_KEY', 'CLOUDFLARE_R2_SECRET_ACCESS_KEY')
  if (!accountId || !accessKeyId || !secretAccessKey) return null

  return new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  })
}

function getR2Bucket(): string | undefined {
  return readEnv('R2_BUCKET_NAME', 'R2_BUCKET', 'CLOUDFLARE_R2_BUCKET')
}

function getR2JsonBucket(): string {
  return readEnv('R2_JSON_BUCKET', 'R2_JSON_BUCKET_NAME', 'CLOUDFLARE_R2_JSON_BUCKET') ?? 'json'
}

function getR2KeyPrefix(): string {
  const prefix = readEnv('R2_KEY_PREFIX') ?? ''
  if (!prefix) return ''
  return prefix.endsWith('/') ? prefix : `${prefix}/`
}

function r2ObjectKey(fileName: string): string {
  return `${getR2KeyPrefix()}${fileName}`
}

function pictureKey(buildingAddress: string, rtuName: string): string {
  return `${buildingAddress}|${rtuName}`
}

function collectDeleteCandidates(
  fileName: string,
  buildingAddress: string,
  rtuName: string,
): string[] {
  const names = new Set<string>([fileName])
  const paren = fileName.match(/\((\d+)\)\.[^.]+$/i)
  const dash = fileName.match(/-(\d+)\.[^.]+$/i)
  const index = paren ? Number(paren[1]) : dash ? Number(dash[1]) : null
  if (index != null) {
    const buildingNum = buildingAddress.match(/\d+/)?.[0] ?? 'unknown'
    const unit = rtuName
      .split('/')[0]
      ?.trim()
      .replace(/\s+Hybrid\b/gi, '')
      .trim()
      .match(/^RTU[-\s#]*(.+)$/i)?.[1]
      ?.replace(/\s+/g, '')
      .replace(/[^\w.-]/g, '') ?? 'unknown'
    const ext = fileName.split('.').pop() ?? 'jpg'
    names.add(`${buildingNum}-RTU-${unit}-${index}.${ext}`)
  }
  return [...names]
}

async function deleteR2Objects(client: S3Client, bucket: string, fileNames: string[]) {
  let deleted = 0
  for (const fileName of fileNames) {
    const Key = r2ObjectKey(fileName)
    try {
      await client.send(new HeadObjectCommand({ Bucket: bucket, Key }))
    } catch {
      continue
    }
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key }))
    deleted += 1
  }
  return deleted
}

async function removeFromJsonManifest(
  client: S3Client,
  jsonBucket: string,
  buildingAddress: string,
  rtuName: string,
  fileName: string,
): Promise<boolean> {
  const objectKey = 'manifest.json'
  try {
    const response = await client.send(
      new GetObjectCommand({ Bucket: jsonBucket, Key: objectKey }),
    )
    const text = await response.Body?.transformToString()
    if (!text) return false
    const manifest = JSON.parse(text) as { entries?: Record<string, string[]> }
    const key = pictureKey(buildingAddress, rtuName)
    const files = manifest.entries?.[key]
    if (!files?.length) return false
    const lower = fileName.toLowerCase()
    const kept = files.filter((name) => name.toLowerCase() !== lower)
    if (kept.length === files.length) return false
    if (kept.length) manifest.entries![key] = kept
    else delete manifest.entries![key]
    await client.send(
      new PutObjectCommand({
        Bucket: jsonBucket,
        Key: objectKey,
        Body: JSON.stringify(manifest, null, 2),
        ContentType: 'application/json',
      }),
    )
    return true
  } catch {
    return false
  }
}

Deno.serve(async (req) => {
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
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  if (!supabaseUrl || !serviceRoleKey || !anonKey) {
    return json({ error: 'Server misconfigured' }, 500)
  }

  const supabaseUser = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  })
  const {
    data: { user },
    error: userError,
  } = await supabaseUser.auth.getUser()

  if (userError || !user) {
    return json({ error: 'Unauthorized' }, 401)
  }

  let payload: { buildingAddress?: string; rtuName?: string; fileName?: string }
  try {
    payload = await req.json()
  } catch {
    return json({ error: 'Invalid JSON body' }, 400)
  }

  const buildingAddress = payload.buildingAddress?.trim()
  const rtuName = payload.rtuName?.trim()
  const fileName = payload.fileName?.trim()
  if (!buildingAddress || !rtuName || !fileName) {
    return json({ error: 'buildingAddress, rtuName, and fileName are required' }, 400)
  }

  const r2Client = createR2Client()
  const r2Bucket = getR2Bucket()
  let r2Deleted = 0
  let manifestUpdated = false

  if (r2Client && r2Bucket) {
    const candidates = collectDeleteCandidates(fileName, buildingAddress, rtuName)
    r2Deleted = await deleteR2Objects(r2Client, r2Bucket, candidates)
    manifestUpdated = await removeFromJsonManifest(
      r2Client,
      getR2JsonBucket(),
      buildingAddress,
      rtuName,
      fileName,
    )
  }

  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey)
  const { error: deleteError, count } = await supabaseAdmin
    .from('rtu_pictures')
    .delete({ count: 'exact' })
    .eq('building_address', buildingAddress)
    .eq('rtu_name', rtuName)
    .eq('file_name', fileName)

  if (deleteError) {
    return json({ error: deleteError.message }, 500)
  }

  return json({
    ok: true,
    r2Deleted,
    supabaseDeleted: (count ?? 0) > 0,
    manifestUpdated,
  })
})
