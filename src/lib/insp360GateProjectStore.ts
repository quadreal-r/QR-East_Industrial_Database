/** Parent-window storage for gateway .insp360 bytes (survives iframe storage quirks). */

import { clearInsp360GateHook } from '@/lib/insp360GateHooks'

const DB_NAME = 'insp360-gate-host'
const DB_VERSION = 1
const STORE = 'projects'

/** Same-origin viewer IndexedDB — Link stores the tour here first. */
const VIEWER_DB_NAME = 'insp360'
const VIEWER_DB_VERSION = 2
const VIEWER_STORE = 'kv'

export type HostGateProject = {
  name: string
  data: ArrayBuffer
  savedAt: number
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onerror = () => reject(req.error ?? new Error('Failed to open gate project DB'))
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE)
      }
    }
    req.onsuccess = () => resolve(req.result)
  })
}

function openViewerDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(VIEWER_DB_NAME, VIEWER_DB_VERSION)
    req.onerror = () => reject(req.error ?? new Error('Failed to open viewer IDB'))
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(VIEWER_STORE)) {
        db.createObjectStore(VIEWER_STORE)
      }
    }
    req.onsuccess = () => resolve(req.result)
  })
}

function idbReq<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'))
  })
}

/** Wait for the transaction to finish — closing the DB earlier can abort writes.
 * Register this BEFORE issuing requests so oncomplete is not missed.
 */
function idbTxDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'))
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'))
  })
}

/** Normalize IndexedDB / postMessage binary values into an ArrayBuffer. */
export async function binaryToArrayBuffer(value: unknown): Promise<ArrayBuffer | null> {
  if (value instanceof ArrayBuffer && value.byteLength > 0) {
    return value.slice(0)
  }
  if (ArrayBuffer.isView(value) && value.byteLength > 0) {
    const view = value as ArrayBufferView
    const copy = new Uint8Array(view.byteLength)
    copy.set(new Uint8Array(view.buffer, view.byteOffset, view.byteLength))
    return copy.buffer
  }
  if (typeof Blob !== 'undefined' && value instanceof Blob && value.size > 0) {
    try {
      return await value.arrayBuffer()
    } catch {
      return null
    }
  }
  return null
}

export async function saveHostGateProject(
  gateKey: string,
  name: string,
  data: ArrayBuffer,
): Promise<boolean> {
  const key = String(gateKey || '').trim()
  const cleaned = String(name || '').trim() || 'project.insp360'
  if (!key || !data?.byteLength) return false
  try {
    const db = await openDb()
    try {
      const tx = db.transaction(STORE, 'readwrite')
      const done = idbTxDone(tx)
      await idbReq(
        tx.objectStore(STORE).put(
          { name: cleaned, data, savedAt: Date.now() } satisfies HostGateProject,
          key,
        ),
      )
      await done
      return true
    } finally {
      db.close()
    }
  } catch (error) {
    console.warn('saveHostGateProject failed', error)
    return false
  }
}

/** Match viewer gateOpfsKey() — OPFS filenames cannot use raw gate keys. */
function gateOpfsFileName(gateKey: string): string {
  return `g_${String(gateKey || '')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .slice(0, 180)}.insp360`
}

/**
 * Copy a gate tour from the embedded viewer's IndexedDB into the host store.
 * Avoids shipping multi‑MB ArrayBuffers through postMessage (which often fails).
 */
async function readGateProjectFromViewerCache(
  gateKey: string,
  fallbackName?: string,
): Promise<{ name: string; data: ArrayBuffer } | null> {
  try {
    if (typeof caches === 'undefined') return null
    const cache = await caches.open('insp360-gate-projects')
    const res = await cache.match(`https://insp360.local/gate/${encodeURIComponent(gateKey)}`)
    if (!res?.ok) return null
    const data = await binaryToArrayBuffer(await res.blob())
    if (!data) return null
    const name =
      String(res.headers.get('X-Proj-Name') || fallbackName || '').trim() || 'project.insp360'
    return { name, data }
  } catch {
    return null
  }
}

/** Viewer may store large tours in OPFS when IndexedDB quota is exhausted. */
async function readGateProjectFromViewerOpfs(
  gateKey: string,
  fallbackName?: string,
): Promise<{ name: string; data: ArrayBuffer } | null> {
  try {
    if (!navigator.storage?.getDirectory) return null
    const root = await navigator.storage.getDirectory()
    const dir = await root.getDirectoryHandle('gateProjects')
    const fh = await dir.getFileHandle(gateOpfsFileName(gateKey))
    const file = await fh.getFile()
    if (!file?.size) return null
    const data = await binaryToArrayBuffer(file)
    if (!data) return null
    const name = String(fallbackName || file.name || '').trim() || 'project.insp360'
    return { name, data }
  } catch {
    return null
  }
}

export async function importGateProjectFromViewerIdb(
  gateKey: string,
  fallbackName?: string,
): Promise<boolean> {
  const key = String(gateKey || '').trim()
  if (!key) return false

  const persist = async (name: string, data: ArrayBuffer): Promise<boolean> => {
    if (await saveHostGateProject(key, name, data)) return true
    // Host IDB may be full; keep a viewer IDB copy so Link/confirm can still succeed.
    return writeViewerGateProject(key, name, data)
  }

  let nameHint = String(fallbackName || '').trim() || 'project.insp360'
  try {
    const db = await openViewerDb()
    try {
      const tx = db.transaction(VIEWER_STORE, 'readonly')
      const store = tx.objectStore(VIEWER_STORE)
      const blob = await idbReq(store.get(`gateProjBlob:${key}`))
      const rawName = await idbReq(store.get(`gateProjName:${key}`))
      if (rawName) nameHint = String(rawName).trim() || nameHint
      const data = await binaryToArrayBuffer(blob)
      if (data) return persist(nameHint, data)
    } finally {
      db.close()
    }
  } catch (error) {
    console.warn('importGateProjectFromViewerIdb failed', error)
  }
  const fromCache = await readGateProjectFromViewerCache(key, nameHint)
  if (fromCache) return persist(fromCache.name, fromCache.data)
  const fromOpfs = await readGateProjectFromViewerOpfs(key, nameHint)
  if (!fromOpfs) return false
  return persist(fromOpfs.name, fromOpfs.data)
}

/** Byte length of the viewer IndexedDB gate blob only (ignores Cache/OPFS stubs). */
export async function getViewerGateProjectByteLength(gateKey: string): Promise<number> {
  const key = String(gateKey || '').trim()
  if (!key) return 0
  try {
    const db = await openViewerDb()
    try {
      const tx = db.transaction(VIEWER_STORE, 'readonly')
      const store = tx.objectStore(VIEWER_STORE)
      const blob = await idbReq(store.get(`gateProjBlob:${key}`))
      if (typeof Blob !== 'undefined' && blob instanceof Blob) return blob.size
      if (blob instanceof ArrayBuffer) return blob.byteLength
      if (ArrayBuffer.isView(blob)) return blob.byteLength
    } finally {
      db.close()
    }
  } catch {
    /* ignore */
  }
  return 0
}

/** True when the viewer already has gate tour bytes (not just a name/bound flag). */
export async function hasViewerGateProject(gateKey: string): Promise<boolean> {
  return (await getViewerGateProjectByteLength(gateKey)) > 0
}

/** Wait until tour bytes exist in viewer or host storage; optionally copy viewer → host. */
export async function confirmGateProjectStored(
  gateKey: string,
  options?: { importToHost?: boolean; maxWaitMs?: number; fallbackName?: string },
): Promise<boolean> {
  const key = String(gateKey || '').trim()
  if (!key) return false
  const maxWaitMs = options?.maxWaitMs ?? 12000
  const importToHost = options?.importToHost !== false
  const fallbackName = options?.fallbackName
  const start = Date.now()
  while (Date.now() - start < maxWaitMs) {
    if (await hasHostGateProject(key)) return true
    if (importToHost) {
      // Always try IDB → Cache → OPFS. Large tours often land only in Cache/OPFS.
      await importGateProjectFromViewerIdb(key, fallbackName)
      if (await hasHostGateProject(key)) return true
    }
    if (await hasViewerGateProject(key)) return true
    await new Promise((r) => window.setTimeout(r, 150))
  }
  if (await hasHostGateProject(key)) return true
  if (importToHost) await importGateProjectFromViewerIdb(key, fallbackName)
  return (await hasHostGateProject(key)) || (await hasViewerGateProject(key))
}

export async function loadHostGateProject(gateKey: string): Promise<HostGateProject | null> {
  const key = String(gateKey || '').trim()
  if (!key) return null
  try {
    const db = await openDb()
    try {
      const tx = db.transaction(STORE, 'readonly')
      const row = await idbReq<{ name?: string; data?: unknown; savedAt?: number } | undefined>(
        tx.objectStore(STORE).get(key),
      )
      const data = await binaryToArrayBuffer(row?.data)
      if (!data) return null
      const name = String(row?.name || '').trim() || 'project.insp360'
      return { name, data, savedAt: Number(row?.savedAt) || Date.now() }
    } finally {
      db.close()
    }
  } catch {
    return null
  }
}

export async function deleteHostGateProject(gateKey: string): Promise<void> {
  const key = String(gateKey || '').trim()
  if (!key) return
  try {
    const db = await openDb()
    try {
      const tx = db.transaction(STORE, 'readwrite')
      await idbReq(tx.objectStore(STORE).delete(key))
    } finally {
      db.close()
    }
  } catch {
    /* ignore */
  }
}

/** Remove viewer IndexedDB + cache + OPFS copies for a gate so a new tour can be linked. */
export async function clearViewerGateProject(gateKey: string): Promise<void> {
  const key = String(gateKey || '').trim()
  if (!key) return
  try {
    const db = await openViewerDb()
    try {
      const tx = db.transaction(VIEWER_STORE, 'readwrite')
      const done = idbTxDone(tx)
      const store = tx.objectStore(VIEWER_STORE)
      await idbReq(store.delete(`gateProjBlob:${key}`))
      await idbReq(store.delete(`gateProjName:${key}`))
      await idbReq(store.delete(`gateProjBound:${key}`))
      await idbReq(store.delete(`gateProj:${key}`))
      await done
    } finally {
      db.close()
    }
  } catch {
    /* ignore */
  }
  try {
    if (typeof caches !== 'undefined') {
      const cache = await caches.open('insp360-gate-projects')
      await cache.delete(`https://insp360.local/gate/${encodeURIComponent(key)}`)
    }
  } catch {
    /* optional */
  }
  try {
    if (navigator.storage?.getDirectory) {
      const root = await navigator.storage.getDirectory()
      const dir = await root.getDirectoryHandle('gateProjects')
      await dir.removeEntry(gateOpfsFileName(key))
    }
  } catch {
    /* optional — OPFS may be empty */
  }
}

/** Clear the saved gateway↔tour link (localStorage hook + host/viewer copies). */
export async function unlinkInsp360GateTour(gateKey: string): Promise<void> {
  const key = String(gateKey || '').trim()
  if (!key) return
  clearInsp360GateHook(key)
  await deleteHostGateProject(key)
  await clearViewerGateProject(key)
}

export async function hasHostGateProject(gateKey: string): Promise<boolean> {
  return (await loadHostGateProject(gateKey)) != null
}

/**
 * Seed the embedded viewer's IndexedDB from host-stored bytes.
 * Same-origin iframe shares this DB — avoids huge postMessage transfers that fail on large tours.
 */
export async function writeViewerGateProject(
  gateKey: string,
  name: string,
  data: ArrayBuffer,
): Promise<boolean> {
  const key = String(gateKey || '').trim()
  const cleaned = String(name || '').trim() || 'project.insp360'
  if (!key || !data?.byteLength) return false
  const blob = new Blob([data], { type: 'application/zip' })
  try {
    const db = await openViewerDb()
    try {
      const tx = db.transaction(VIEWER_STORE, 'readwrite')
      const done = idbTxDone(tx)
      const store = tx.objectStore(VIEWER_STORE)
      await idbReq(store.put(blob, `gateProjBlob:${key}`))
      await idbReq(store.put(cleaned, `gateProjName:${key}`))
      await idbReq(store.put(1, `gateProjBound:${key}`))
      await done
    } finally {
      db.close()
    }
  } catch (error) {
    console.warn('writeViewerGateProject IDB failed', error)
    return false
  }
  try {
    if (typeof caches !== 'undefined') {
      const cache = await caches.open('insp360-gate-projects')
      const headers = new Headers({
        'Content-Type': 'application/zip',
        'X-Proj-Name': cleaned,
      })
      await cache.put(
        `https://insp360.local/gate/${encodeURIComponent(key)}`,
        new Response(blob, { headers }),
      )
    }
  } catch {
    /* Cache is optional backup */
  }
  return true
}

/** Remember the on-disk .insp360 FileSystemFileHandle for fast reopen (same-origin viewer IDB). */
export async function writeViewerGateFileHandle(
  gateKey: string,
  handle: FileSystemFileHandle,
  name?: string,
): Promise<boolean> {
  const key = String(gateKey || '').trim()
  if (!key || !handle) return false
  try {
    const db = await openViewerDb()
    try {
      const tx = db.transaction(VIEWER_STORE, 'readwrite')
      const done = idbTxDone(tx)
      const store = tx.objectStore(VIEWER_STORE)
      await idbReq(store.put(handle, `gateProj:${key}`))
      const cleaned =
        String(name || handle.name || '').trim() || 'project.insp360'
      await idbReq(store.put(cleaned, `gateProjName:${key}`))
      await idbReq(store.put(1, `gateProjBound:${key}`))
      await done
    } finally {
      db.close()
    }
    return true
  } catch (error) {
    console.warn('writeViewerGateFileHandle failed', error)
    return false
  }
}

/**
 * Ensure the viewer can open a linked tour: prefer host bytes, seed viewer storage, return name.
 * Do NOT rewrite viewer IndexedDB when bytes already exist — concurrent rewrite while the
 * iframe is unzipping a large tour hangs auto-open on reopen.
 */
export async function prepareViewerGateProject(
  gateKey: string,
  fallbackName?: string,
): Promise<{ name: string; seeded: boolean; reused?: boolean } | null> {
  const key = String(gateKey || '').trim()
  if (!key) return null

  let stored = await loadHostGateProject(key)
  if (!stored) {
    await importGateProjectFromViewerIdb(key, fallbackName)
    stored = await loadHostGateProject(key)
  }

  if (stored) {
    const viewerLen = await getViewerGateProjectByteLength(key)
    // Only skip rewrite when IDB already has the same-sized tour. Cache/OPFS stubs caused
    // false "ready" and left Enter on the create/open dashboard.
    if (viewerLen > 0 && viewerLen === stored.data.byteLength) {
      return { name: stored.name, seeded: true, reused: true }
    }
    const seeded = await writeViewerGateProject(key, stored.name, stored.data)
    return { name: stored.name, seeded, reused: false }
  }

  const viewerLen = await getViewerGateProjectByteLength(key)
  if (viewerLen > 0) {
    const name = String(fallbackName || '').trim() || 'project.insp360'
    return { name, seeded: true, reused: true }
  }

  return null
}
