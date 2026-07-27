/**
 * Cloudflare R2 client for QR-360° tour uploads (insp360 bucket).
 *
 * Uses a SEPARATE account from RTU pictures. Env in `.env.local`:
 *   INSP360_R2_ACCOUNT_ID
 *   INSP360_R2_ACCESS_KEY_ID
 *   INSP360_R2_SECRET_ACCESS_KEY
 *   INSP360_R2_BUCKET_NAME          (default: insp360)
 *   INSP360_R2_KEY_PREFIX           (optional, e.g. tours/)
 *   VITE_INSP360_BASE_URL           (public CDN base)
 */
import {
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'

function readEnv(...keys) {
  for (const key of keys) {
    const value = process.env[key]?.trim()
    if (value) return value
  }
  return undefined
}

function normalizeBaseUrl(url) {
  return url.endsWith('/') ? url : `${url}/`
}

export function isInsp360R2Configured() {
  return Boolean(createInsp360R2Client() && getInsp360R2Bucket())
}

export function createInsp360R2Client() {
  const accountId = readEnv('INSP360_R2_ACCOUNT_ID')
  const accessKeyId = readEnv('INSP360_R2_ACCESS_KEY_ID')
  const secretAccessKey = readEnv('INSP360_R2_SECRET_ACCESS_KEY')
  if (!accountId || !accessKeyId || !secretAccessKey) return null

  return new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  })
}

export function getInsp360R2Bucket() {
  return readEnv('INSP360_R2_BUCKET_NAME') ?? 'insp360'
}

export function getInsp360R2KeyPrefix() {
  const prefix = readEnv('INSP360_R2_KEY_PREFIX') ?? ''
  if (!prefix) return ''
  return prefix.endsWith('/') ? prefix : `${prefix}/`
}

export function getInsp360PublicBaseUrl() {
  const value = readEnv('VITE_INSP360_BASE_URL', 'INSP360_R2_PUBLIC_URL')
  return value ? normalizeBaseUrl(value) : undefined
}

export function insp360ObjectKey(relativeKey) {
  const cleaned = relativeKey.replace(/^[/\\]+/, '').replace(/\\/g, '/')
  return `${getInsp360R2KeyPrefix()}${cleaned}`
}

export function insp360PublicUrl(relativeKey) {
  const base = getInsp360PublicBaseUrl()
  if (!base) return null
  const key = insp360ObjectKey(relativeKey)
  return `${base}${key.split('/').map(encodeURIComponent).join('/')}`
}

export function guessInsp360ContentType(fileName) {
  // Keep .insp360 tours as octet-stream (matches working dashboard uploads).
  void fileName
  return 'application/octet-stream'
}

export async function listInsp360ObjectKeys() {
  const client = createInsp360R2Client()
  const bucket = getInsp360R2Bucket()
  if (!client || !bucket) return []

  const prefix = getInsp360R2KeyPrefix()
  /** @type {string[]} */
  const keys = []
  let token
  do {
    const page = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix || undefined,
        ContinuationToken: token,
      }),
    )
    for (const obj of page.Contents ?? []) {
      if (obj.Key) keys.push(obj.Key)
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined
  } while (token)
  return keys
}

export async function insp360ObjectExists(relativeKey) {
  const client = createInsp360R2Client()
  const bucket = getInsp360R2Bucket()
  if (!client || !bucket) return false
  try {
    await client.send(
      new HeadObjectCommand({
        Bucket: bucket,
        Key: insp360ObjectKey(relativeKey),
      }),
    )
    return true
  } catch (error) {
    const status = error?.$metadata?.httpStatusCode
    if (status === 404 || error?.name === 'NotFound' || error?.name === 'NoSuchKey') {
      return false
    }
    throw error
  }
}

export async function uploadInsp360FileToR2(relativeKey, body, contentType) {
  const client = createInsp360R2Client()
  const bucket = getInsp360R2Bucket()
  if (!client || !bucket) {
    throw new Error(
      'insp360 R2 is not configured. Set INSP360_R2_ACCOUNT_ID, INSP360_R2_ACCESS_KEY_ID, INSP360_R2_SECRET_ACCESS_KEY in .env.local',
    )
  }

  const key = insp360ObjectKey(relativeKey)
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType ?? guessInsp360ContentType(relativeKey),
    }),
  )
  return { key, publicUrl: insp360PublicUrl(relativeKey) }
}
