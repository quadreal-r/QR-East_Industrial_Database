/** Persistent cache for cloud `.insp360` tours (Cache API + OPFS fallback). */

export const CLOUD_TOUR_CACHE_NAME = 'insp360-cloud-tours'
export const CLOUD_TOUR_CACHE_META_URL = 'https://insp360.local/cloud-tours/__meta__'
/** Soft cap: keep roughly 2.5 GB of cached tour bytes. */
export const CLOUD_TOUR_CACHE_MAX_BYTES = Math.floor(2.5 * 1024 * 1024 * 1024)
/** Soft cap: keep the last N distinct tour URLs. */
export const CLOUD_TOUR_CACHE_MAX_ENTRIES = 8
const OPFS_DIR = 'cloudTours'

export type CloudTourCacheMetaEntry = {
  url: string
  etag: string | null
  size: number
  cachedAt: number
  lastAccess: number
}

export type CloudTourCacheMeta = {
  entries: CloudTourCacheMetaEntry[]
}

export type CachedTour = {
  blob: Blob
  etag: string | null
  cachedAt: number
  size: number
  url: string
}

export type MatchCloudTourResult = {
  blob: Blob
  fromCache: boolean
  etag: string | null
}

/** Strip hash/query noise so the same CDN object shares one cache slot. */
export function normalizeTourCacheUrl(url: string): string {
  const trimmed = String(url || '').trim()
  if (!trimmed) return ''
  try {
    const u = new URL(trimmed)
    u.hash = ''
    // Keep query only when it looks like a version token; drop tracking params.
    if (u.search && !/[?&](v|version|etag)=/i.test(u.search)) {
      u.search = ''
    }
    return u.href
  } catch {
    return trimmed.split('#')[0] || trimmed
  }
}

/** Same-origin Cache API request URL shared by host + embedded viewer. */
export function cloudTourCacheRequestUrl(url: string): string {
  const normalized = normalizeTourCacheUrl(url)
  return `https://insp360.local/cloud-tour/${encodeURIComponent(normalized)}`
}

export function etagMatches(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = String(a || '')
    .trim()
    .replace(/^W\//i, '')
    .replace(/"/g, '')
  const right = String(b || '')
    .trim()
    .replace(/^W\//i, '')
    .replace(/"/g, '')
  if (!left || !right) return false
  return left === right
}

/** Pure LRU victim picker — used by put + tests. */
export function selectCloudTourLruVictims(
  entries: CloudTourCacheMetaEntry[],
  options?: { maxBytes?: number; maxEntries?: number; keepUrl?: string | null },
): string[] {
  const maxBytes = options?.maxBytes ?? CLOUD_TOUR_CACHE_MAX_BYTES
  const maxEntries = options?.maxEntries ?? CLOUD_TOUR_CACHE_MAX_ENTRIES
  const keepUrl = options?.keepUrl ? normalizeTourCacheUrl(options.keepUrl) : null
  const sorted = [...entries].sort((a, b) => a.lastAccess - b.lastAccess)
  const victims: string[] = []
  let total = sorted.reduce((sum, e) => sum + Math.max(0, e.size || 0), 0)
  let count = sorted.length

  const canEvict = (url: string) => {
    const n = normalizeTourCacheUrl(url)
    return !keepUrl || n !== keepUrl
  }

  while (count > maxEntries || total > maxBytes) {
    const next = sorted.find((e) => canEvict(e.url) && !victims.includes(e.url))
    if (!next) break
    victims.push(next.url)
    total -= Math.max(0, next.size || 0)
    count -= 1
  }
  return victims
}

function opfsFileName(url: string): string {
  const normalized = normalizeTourCacheUrl(url)
  let hash = 0
  for (let i = 0; i < normalized.length; i++) {
    hash = (hash * 31 + normalized.charCodeAt(i)) >>> 0
  }
  return `t_${hash.toString(16)}_${normalized.length}.insp360`
}

async function openCloudTourCache(): Promise<Cache | null> {
  if (typeof caches === 'undefined') return null
  try {
    return await caches.open(CLOUD_TOUR_CACHE_NAME)
  } catch {
    return null
  }
}

async function readMeta(cache: Cache | null): Promise<CloudTourCacheMeta> {
  if (!cache) return { entries: [] }
  try {
    const res = await cache.match(CLOUD_TOUR_CACHE_META_URL)
    if (!res) return { entries: [] }
    const data = (await res.json()) as CloudTourCacheMeta
    if (!data || !Array.isArray(data.entries)) return { entries: [] }
    return {
      entries: data.entries
        .map((e) => ({
          url: normalizeTourCacheUrl(String(e?.url || '')),
          etag: e?.etag != null ? String(e.etag) : null,
          size: Math.max(0, Number(e?.size) || 0),
          cachedAt: Number(e?.cachedAt) || 0,
          lastAccess: Number(e?.lastAccess) || Number(e?.cachedAt) || 0,
        }))
        .filter((e) => e.url),
    }
  } catch {
    return { entries: [] }
  }
}

async function writeMeta(cache: Cache | null, meta: CloudTourCacheMeta): Promise<void> {
  if (!cache) return
  try {
    await cache.put(
      CLOUD_TOUR_CACHE_META_URL,
      new Response(JSON.stringify(meta), {
        headers: { 'Content-Type': 'application/json' },
      }),
    )
  } catch {
    /* quota / private mode */
  }
}

async function touchMeta(
  cache: Cache | null,
  url: string,
  patch?: Partial<CloudTourCacheMetaEntry>,
): Promise<void> {
  const normalized = normalizeTourCacheUrl(url)
  if (!normalized) return
  const meta = await readMeta(cache)
  const now = Date.now()
  const idx = meta.entries.findIndex((e) => e.url === normalized)
  if (idx >= 0) {
    const cur = meta.entries[idx]!
    meta.entries[idx] = {
      ...cur,
      ...patch,
      url: normalized,
      lastAccess: now,
      cachedAt: patch?.cachedAt ?? cur.cachedAt ?? now,
    }
  } else {
    meta.entries.push({
      url: normalized,
      etag: patch?.etag ?? null,
      size: patch?.size ?? 0,
      cachedAt: patch?.cachedAt ?? now,
      lastAccess: now,
    })
  }
  await writeMeta(cache, meta)
}

async function opfsDir(create: boolean): Promise<FileSystemDirectoryHandle | null> {
  if (!navigator.storage?.getDirectory) return null
  try {
    const root = await navigator.storage.getDirectory()
    return await root.getDirectoryHandle(OPFS_DIR, { create })
  } catch {
    return null
  }
}

async function readOpfsTour(url: string): Promise<Blob | null> {
  try {
    const dir = await opfsDir(false)
    if (!dir) return null
    const fh = await dir.getFileHandle(opfsFileName(url))
    const file = await fh.getFile()
    return file?.size ? file : null
  } catch {
    return null
  }
}

async function writeOpfsTour(url: string, blob: Blob): Promise<boolean> {
  if (!blob?.size) return false
  try {
    const dir = await opfsDir(true)
    if (!dir) return false
    const fh = await dir.getFileHandle(opfsFileName(url), { create: true })
    const w = await fh.createWritable()
    await w.write(blob)
    await w.close()
    return true
  } catch {
    return false
  }
}

async function deleteOpfsTour(url: string): Promise<void> {
  try {
    const dir = await opfsDir(false)
    if (!dir) return
    await dir.removeEntry(opfsFileName(url))
  } catch {
    /* optional */
  }
}

async function evictIfNeeded(cache: Cache | null, keepUrl?: string | null): Promise<void> {
  const meta = await readMeta(cache)
  const victims = selectCloudTourLruVictims(meta.entries, { keepUrl })
  if (!victims.length) return
  for (const victim of victims) {
    await deleteCachedTour(victim)
  }
}

export async function getCachedTour(url: string): Promise<CachedTour | null> {
  const normalized = normalizeTourCacheUrl(url)
  if (!normalized) return null
  const cache = await openCloudTourCache()
  const meta = await readMeta(cache)
  const entry = meta.entries.find((e) => e.url === normalized) || null

  if (cache) {
    try {
      const res = await cache.match(cloudTourCacheRequestUrl(normalized))
      if (res) {
        const blob = await res.blob()
        if (blob?.size) {
          const etag = res.headers.get('ETag') || entry?.etag || null
          const cachedAt = Number(res.headers.get('X-Cached-At') || entry?.cachedAt) || Date.now()
          await touchMeta(cache, normalized, { etag, size: blob.size, cachedAt })
          return { blob, etag, cachedAt, size: blob.size, url: normalized }
        }
      }
    } catch {
      /* fall through to OPFS */
    }
  }

  const opfsBlob = await readOpfsTour(normalized)
  if (!opfsBlob?.size) return null
  const etag = entry?.etag || null
  const cachedAt = entry?.cachedAt || Date.now()
  await touchMeta(cache, normalized, { etag, size: opfsBlob.size, cachedAt })
  return { blob: opfsBlob, etag, cachedAt, size: opfsBlob.size, url: normalized }
}

export async function putCachedTour(
  url: string,
  blob: Blob,
  etag?: string | null,
): Promise<boolean> {
  const normalized = normalizeTourCacheUrl(url)
  if (!normalized || !blob?.size) return false
  const cache = await openCloudTourCache()
  const now = Date.now()
  const tag = etag != null ? String(etag).trim() || null : null
  let wrote = false

  if (cache) {
    try {
      const headers = new Headers({
        'Content-Type': blob.type || 'application/zip',
        'X-Cached-At': String(now),
      })
      if (tag) headers.set('ETag', tag)
      await cache.put(cloudTourCacheRequestUrl(normalized), new Response(blob, { headers }))
      wrote = true
    } catch {
      wrote = false
    }
  }

  if (!wrote) {
    wrote = await writeOpfsTour(normalized, blob)
  } else {
    // Best-effort OPFS mirror for browsers that drop Cache entries under pressure.
    void writeOpfsTour(normalized, blob)
  }

  if (!wrote) return false

  await touchMeta(cache, normalized, {
    etag: tag,
    size: blob.size,
    cachedAt: now,
  })
  await evictIfNeeded(cache, normalized)
  return true
}

export async function deleteCachedTour(url: string): Promise<void> {
  const normalized = normalizeTourCacheUrl(url)
  if (!normalized) return
  const cache = await openCloudTourCache()
  if (cache) {
    try {
      await cache.delete(cloudTourCacheRequestUrl(normalized))
    } catch {
      /* ignore */
    }
  }
  await deleteOpfsTour(normalized)
  const meta = await readMeta(cache)
  meta.entries = meta.entries.filter((e) => e.url !== normalized)
  await writeMeta(cache, meta)
}

async function headRevalidate(
  url: string,
  etag: string | null,
  signal?: AbortSignal,
): Promise<'fresh' | 'stale' | 'unknown'> {
  try {
    const headers: HeadersInit = {}
    if (etag) headers['If-None-Match'] = etag
    const res = await fetch(url, { method: 'HEAD', headers, signal, cache: 'no-store' })
    if (res.status === 304) return 'fresh'
    if (res.ok) {
      const remote = res.headers.get('ETag')
      if (etag && remote && etagMatches(etag, remote)) return 'fresh'
      if (etag && remote && !etagMatches(etag, remote)) return 'stale'
      // No usable ETag comparison — treat as unknown so GET can refresh.
      return remote ? 'stale' : 'unknown'
    }
    return 'unknown'
  } catch {
    return 'unknown'
  }
}

async function downloadTourBlob(
  url: string,
  options?: {
    signal?: AbortSignal
    etag?: string | null
    onProgress?: (done: number, total: number) => void
  },
): Promise<{ blob: Blob; etag: string | null }> {
  const headers: HeadersInit = {}
  if (options?.etag) headers['If-None-Match'] = options.etag
  const res = await fetch(url, { method: 'GET', headers, signal: options?.signal, cache: 'no-store' })
  if (res.status === 304 && options?.etag) {
    const cached = await getCachedTour(url)
    if (cached) return { blob: cached.blob, etag: cached.etag }
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const etag = res.headers.get('ETag')
  const total = Number(res.headers.get('Content-Length')) || 0
  if (res.body && typeof res.body.getReader === 'function' && options?.onProgress) {
    const reader = res.body.getReader()
    const chunks: Uint8Array[] = []
    let received = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (value?.byteLength) {
        chunks.push(value)
        received += value.byteLength
        options.onProgress(received, total > 0 ? total : received)
      }
    }
    const blob = new Blob(chunks as BlobPart[], {
      type: res.headers.get('Content-Type') || 'application/zip',
    })
    return { blob, etag }
  }
  const blob = await res.blob()
  options?.onProgress?.(blob.size, blob.size)
  return { blob, etag }
}

/**
 * Read-through cloud tour fetch: prefer valid cache, else download and store.
 * On `forceDownload`, skips cache read (used after corrupt-cache recovery).
 */
export async function matchCloudTour(
  url: string,
  options?: {
    signal?: AbortSignal
    forceDownload?: boolean
    onProgress?: (done: number, total: number) => void
  },
): Promise<MatchCloudTourResult> {
  const normalized = normalizeTourCacheUrl(url)
  if (!normalized) throw new Error('Missing tour URL')

  if (!options?.forceDownload) {
    const cached = await getCachedTour(normalized)
    if (cached?.blob?.size) {
      const status = await headRevalidate(normalized, cached.etag, options?.signal)
      if (status === 'fresh' || status === 'unknown') {
        // unknown: offline / HEAD blocked — still use cache for speed
        options?.onProgress?.(cached.size, cached.size)
        return { blob: cached.blob, fromCache: true, etag: cached.etag }
      }
      // stale → fall through to download
    }
  }

  const { blob, etag } = await downloadTourBlob(normalized, {
    signal: options?.signal,
    onProgress: options?.onProgress,
  })
  if (!blob?.size) throw new Error('Empty tour download')
  await putCachedTour(normalized, blob, etag)
  return { blob, fromCache: false, etag }
}

/** Background warm for gate info-window intent. Safe to abort. */
export async function prefetchInsp360Tour(
  url: string,
  options?: { signal?: AbortSignal },
): Promise<boolean> {
  const normalized = normalizeTourCacheUrl(url)
  if (!normalized) return false
  try {
    if (options?.signal?.aborted) return false
    const existing = await getCachedTour(normalized)
    if (existing?.blob?.size) {
      const status = await headRevalidate(normalized, existing.etag, options?.signal)
      if (status === 'fresh' || status === 'unknown') return true
    }
    await matchCloudTour(normalized, { signal: options?.signal, forceDownload: !existing })
    return true
  } catch (error) {
    if (options?.signal?.aborted) return false
    console.warn('prefetchInsp360Tour failed', error)
    return false
  }
}
