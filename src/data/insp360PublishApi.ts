import { guessInsp360UploadContentType } from '@/lib/insp360Publish'
import { insp360CoverCompanionKey, insp360TourCompanionKey } from '@/lib/insp360Cover'
import { supabase } from '@/lib/supabaseClient'

export type Insp360PresignSuccess = {
  ok: true
  existed: boolean
  objectKey: string
  uploadUrl: string
  publicUrl: string | null
  tourUrl: string
  expiresIn: number
  contentType: string
}

export type Insp360PresignConflict = {
  ok: false
  existed: true
  objectKey: string
  publicUrl: string | null
  tourUrl: string
  error: string
}

type PresignResponse = Insp360PresignSuccess | Insp360PresignConflict | { error: string }

async function requireAccessToken(action = 'publish tours to Cloudflare'): Promise<string> {
  const { data: sessionData } = await supabase.auth.getSession()
  const token = sessionData.session?.access_token
  if (!token) throw new Error(`Sign in to ${action}.`)
  return token
}

export type Insp360CloudTourRow = {
  key: string
  size: number
  uploaded: string | null
  publicUrl: string | null
  /** Public CDN URL for `.cover.jpg` sidecar when present. */
  coverUrl?: string | null
  coverKey?: string | null
}

/** List .insp360 objects on the insp360 R2 bucket (signed-in users). Prefix may be `*` for a full list. */
export async function listInsp360CloudTours(prefix: string): Promise<Insp360CloudTourRow[]> {
  const cleaned = String(prefix || '')
    .trim()
    .replace(/^\/+/, '')
  if (!cleaned) throw new Error('Missing cloud list prefix for this gate.')
  // `*` = whole bucket (Edge Function); host still filters with insp360CloudKeyMatchesGate.

  const token = await requireAccessToken('list cloud tours for this gate')
  const { url, anonKey } = functionsBaseUrl()
  const endpoint = `${url}/functions/v1/list-insp360-cloud?prefix=${encodeURIComponent(cleaned)}`

  let response: Response
  try {
    response = await fetch(endpoint, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: anonKey,
      },
    })
  } catch (error) {
    throw new Error(
      error instanceof Error
        ? `Could not reach cloud tour list (${error.message}).`
        : 'Could not reach cloud tour list.',
      { cause: error },
    )
  }

  const text = await response.text()
  let data: { tours?: Insp360CloudTourRow[]; error?: string } | null
  try {
    data = text ? (JSON.parse(text) as { tours?: Insp360CloudTourRow[]; error?: string }) : null
  } catch {
    throw new Error(
      text.startsWith('<')
        ? 'Cloud tour list returned HTML instead of JSON. Deploy the list-insp360-cloud Edge Function.'
        : 'Cloud tour list returned invalid JSON.',
    )
  }

  if (!response.ok) {
    throw new Error(data?.error || text.slice(0, 200) || `Cloud list failed (${response.status})`)
  }

  return Array.isArray(data?.tours) ? data.tours : []
}

function functionsBaseUrl(): { url: string; anonKey: string } {
  const url = import.meta.env.VITE_SUPABASE_URL?.trim()?.replace(/\/$/, '')
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim()
  if (!url || !anonKey) {
    throw new Error('Supabase is not configured in this environment.')
  }
  return { url, anonKey }
}

/** Ask the Edge Function for a short-lived R2 PUT URL (does not upload bytes). */
export async function requestInsp360UploadUrl(input: {
  objectKey: string
  contentType?: string
  contentLength?: number
  overwrite?: boolean
}): Promise<Insp360PresignSuccess | Insp360PresignConflict> {
  const token = await requireAccessToken()
  const { url, anonKey } = functionsBaseUrl()
  const endpoint = `${url}/functions/v1/upload-insp360-cloud`


  let response: Response
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: anonKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        objectKey: input.objectKey,
        contentType: input.contentType,
        contentLength: input.contentLength,
        overwrite: input.overwrite === true,
      }),
    })
  } catch (error) {
    // #region agent log
    fetch('http://127.0.0.1:7574/ingest/5d9a1b8d-28ec-4647-bad2-07deacdce245',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'f50159'},body:JSON.stringify({sessionId:'f50159',runId:'pre-fix',hypothesisId:'C',location:'insp360PublishApi.ts:presignNetwork',message:'presign fetch threw',data:{objectKey:input.objectKey,error:error instanceof Error?error.message:String(error)},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    throw new Error(
      error instanceof Error
        ? `Could not reach tour upload service (${error.message}). Check you are online, signed in, and try again in a moment.`
        : 'Could not reach tour upload service. Check you are online, signed in, and try again in a moment.',
      { cause: error },
    )
  }

  const text = await response.text()
  // #region agent log
  fetch('http://127.0.0.1:7574/ingest/5d9a1b8d-28ec-4647-bad2-07deacdce245',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'f50159'},body:JSON.stringify({sessionId:'f50159',runId:'pre-fix',hypothesisId:'C',location:'insp360PublishApi.ts:presignResponse',message:'presign response',data:{status:response.status,ok:response.ok,objectKey:input.objectKey,bodyPreview:text.slice(0,160)},timestamp:Date.now()})}).catch(()=>{});
  // #endregion
  let data: PresignResponse | null
  try {
    data = text ? (JSON.parse(text) as PresignResponse) : null
  } catch {
    data = null
  }


  if (!response.ok) {
    const msg =
      data && typeof data === 'object' && 'error' in data && data.error
        ? String(data.error)
        : text.slice(0, 200) || `Tour upload service failed (${response.status})`
    throw new Error(msg)
  }

  if (!data || typeof data !== 'object') {
    throw new Error('Empty response from tour upload service')
  }

  const payload = data as PresignResponse
  if ('ok' in payload && payload.ok === false) {
    return payload
  }

  if (
    !('ok' in payload) ||
    payload.ok !== true ||
    !('uploadUrl' in payload) ||
    !payload.uploadUrl
  ) {
    const msg =
      'error' in payload && payload.error
        ? String(payload.error)
        : ''
    throw new Error(msg || 'Could not start Cloudflare upload')
  }

  return payload
}

/** PUT tour bytes to the signed R2 URL. */
export async function putInsp360TourToSignedUrl(input: {
  uploadUrl: string
  data: ArrayBuffer
  contentType?: string
  onProgress?: (done: number, total: number) => void
}): Promise<void> {
  const total = Math.max(0, input.data.byteLength)
  const contentType = input.contentType || 'application/octet-stream'
  const report = (done: number) => {
    if (!input.onProgress) return
    const safeTotal = total > 0 ? total : Math.max(done, 1)
    input.onProgress(Math.min(done, safeTotal), safeTotal)
  }

  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', input.uploadUrl, true)
    xhr.setRequestHeader('Content-Type', contentType)
    // Known ArrayBuffer size — always report against that total (R2 PUT may omit lengthComputable).
    // #region agent log
    fetch('http://127.0.0.1:7574/ingest/5d9a1b8d-28ec-4647-bad2-07deacdce245',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'f50159'},body:JSON.stringify({sessionId:'f50159',runId:'pre-fix',hypothesisId:'D',location:'insp360PublishApi.ts:putStart',message:'R2 PUT starting',data:{total,contentType,uploadHost:(()=>{try{return new URL(input.uploadUrl).host}catch{return 'bad-url'}})()},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    report(0)
    xhr.upload.onprogress = (event) => {
      const loaded = Number(event.loaded) || 0
      report(total > 0 ? Math.min(loaded, total) : loaded)
    }
    xhr.onload = () => {
      // #region agent log
      fetch('http://127.0.0.1:7574/ingest/5d9a1b8d-28ec-4647-bad2-07deacdce245',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'f50159'},body:JSON.stringify({sessionId:'f50159',runId:'pre-fix',hypothesisId:'D',location:'insp360PublishApi.ts:putLoad',message:'R2 PUT onload',data:{status:xhr.status,total},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      if (xhr.status >= 200 && xhr.status < 300) {
        report(total > 0 ? total : 1)
        resolve()
        return
      }
      reject(new Error(`Cloudflare upload failed (${xhr.status})`))
    }
    xhr.onerror = () => {
      // #region agent log
      fetch('http://127.0.0.1:7574/ingest/5d9a1b8d-28ec-4647-bad2-07deacdce245',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'f50159'},body:JSON.stringify({sessionId:'f50159',runId:'pre-fix',hypothesisId:'D',location:'insp360PublishApi.ts:putError',message:'R2 PUT network error',data:{total},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      reject(new Error('Cloudflare upload network error'))
    }
    xhr.send(input.data)
  })
}

/** Presign + PUT + return the short Tour URL to store on the gate. */
export async function publishInsp360TourToCloud(input: {
  objectKey: string
  data: ArrayBuffer
  fileName?: string | null
  overwrite?: boolean
  coverBlob?: Blob | null
  /** Optional pin/map sidecar text or Blob (uploaded as `.tour.json`). */
  tourJson?: string | Blob | null
  onProgress?: (done: number, total: number) => void
}): Promise<{ objectKey: string; tourUrl: string; publicUrl: string | null }> {
  const contentType = guessInsp360UploadContentType(input.fileName || input.objectKey)
  const presign = await requestInsp360UploadUrl({
    objectKey: input.objectKey,
    contentType,
    contentLength: input.data.byteLength,
    overwrite: input.overwrite,
  })

  if (!presign.ok) {
    throw new Error(presign.error || 'A tour already exists at this Cloudflare path.')
  }

  const putContentType = presign.contentType || contentType
  await putInsp360TourToSignedUrl({
    uploadUrl: presign.uploadUrl,
    data: input.data,
    contentType: putContentType,
    onProgress: input.onProgress,
  })

  // Best-effort dashboard thumbnail sidecar (does not fail the publish).
  if (input.coverBlob && input.coverBlob.size > 0) {
    try {
      const coverKey = insp360CoverCompanionKey(presign.objectKey)
      const coverPresign = await requestInsp360UploadUrl({
        objectKey: coverKey,
        contentType: input.coverBlob.type || 'image/jpeg',
        contentLength: input.coverBlob.size,
        overwrite: true,
      })
      if (coverPresign.ok) {
        const coverBuf = await input.coverBlob.arrayBuffer()
        await putInsp360TourToSignedUrl({
          uploadUrl: coverPresign.uploadUrl,
          data: coverBuf,
          contentType: coverPresign.contentType || input.coverBlob.type || 'image/jpeg',
        })
      }
    } catch {
      /* cover is optional */
    }
  }

  // Best-effort pin/map sidecar (does not fail the publish).
  if (input.tourJson != null && input.tourJson !== '') {
    try {
      await publishInsp360TourJsonToCloud({
        tourObjectKey: presign.objectKey,
        tourJson: input.tourJson,
      })
    } catch {
      /* tour.json sidecar is optional on first publish */
    }
  }

  return {
    objectKey: presign.objectKey,
    tourUrl: presign.tourUrl || presign.objectKey,
    publicUrl: presign.publicUrl,
  }
}

/** Upload only the pin/map sidecar for an existing cloud tour (fast online edits). */
export async function publishInsp360TourJsonToCloud(input: {
  tourObjectKey: string
  tourJson: string | Blob
}): Promise<{ objectKey: string; publicUrl: string | null }> {
  const tourJsonKey = insp360TourCompanionKey(input.tourObjectKey)
  const blob =
    typeof input.tourJson === 'string'
      ? new Blob([input.tourJson], { type: 'application/json; charset=utf-8' })
      : input.tourJson
  if (!blob || !blob.size) throw new Error('Empty tour.json payload.')
  const buf = await blob.arrayBuffer()
  const contentType = blob.type || 'application/json; charset=utf-8'
  const presign = await requestInsp360UploadUrl({
    objectKey: tourJsonKey,
    contentType,
    contentLength: buf.byteLength,
    overwrite: true,
  })
  if (!presign.ok) {
    throw new Error(presign.error || 'Could not upload tour.json sidecar.')
  }
  await putInsp360TourToSignedUrl({
    uploadUrl: presign.uploadUrl,
    data: buf,
    contentType: presign.contentType || contentType,
  })
  return { objectKey: tourJsonKey, publicUrl: presign.publicUrl }
}
