/** RTU picture storage: Cloudflare R2 (production) or same-origin static files, plus IndexedDB uploads. */

import {
  buildingStreetNumber,
  parseBulkRtuPictureFileName,
  normalizeRtuUnitCore,
} from '@/lib/rtuPictureMatch'
import {
  buildCloudRtuPictureFileName,
  manifestEntryToCloudFileName,
  pictureFileRtuLabel,
} from '@/lib/rtuPictureAssignNaming'
import { fetchPictureManifest, type RtuPictureManifest } from '@/data/mediaApi'
export type { RtuPictureManifest } from '@/data/mediaApi'
import { deleteRtuPictureFromCloud } from '@/data/rtuPictureDeleteApi'
import { isRtuManifestPictureHidden, loadHiddenRtuPictures, exportHiddenRtuPicturesForDeploy, clearHiddenRtuPictureCache } from '@/lib/hiddenRtuPictures'
import { rtuPictureFileUrl } from '@/lib/rtuPictureUrls'
import { isRtuPictureReachableOnCdnWithRetry } from '@/lib/rtuPictureReachability'

export { buildingStreetNumber }

export interface RtuPicture {
  fileName: string
  index: number
  /** Low-res preview URL -- caller must revoke blob URLs when done */
  thumbUrl: string
  /** Full-resolution URL (static file or stored original blob) */
  fullUrl: string
  source: 'static' | 'indexeddb'
}

const DB_NAME = 'building-map-explorer'
const DB_VERSION = 2
const STORE = 'rtuPictures'
export function clearRtuPictureManifestCache(): void {
  manifestCache = null
}

let manifestCache: RtuPictureManifest | null = null
let manifestPromise: Promise<RtuPictureManifest> | null = null

type RtuPicturesListener = () => void
const rtuPicturesListeners = new Set<RtuPicturesListener>()
let notifyRtuPicturesTimer: ReturnType<typeof setTimeout> | null = null

export function onRtuPicturesChanged(listener: RtuPicturesListener): () => void {
  rtuPicturesListeners.add(listener)
  return () => rtuPicturesListeners.delete(listener)
}

export function notifyRtuPicturesChanged(): void {
  if (notifyRtuPicturesTimer) clearTimeout(notifyRtuPicturesTimer)
  notifyRtuPicturesTimer = setTimeout(() => {
    notifyRtuPicturesTimer = null
    for (const listener of rtuPicturesListeners) listener()
  }, 80)
}

export function rtuPictureKey(buildingAddress: string, rtuName: string): string {
  return `${buildingAddress}|${rtuName}`
}

/**
 * Match manifest entries when the portfolio RTU name differs slightly from the manifest key
 * (e.g. `RTU-04 Hybrid/Dual Fuel Heat Pump` vs `RTU-04 Hybrid`).
 */
export function resolveManifestRtuKey(
  buildingAddress: string,
  rtuName: string,
  manifest: RtuPictureManifest,
): string {
  const exact = rtuPictureKey(buildingAddress, rtuName)
  const entries = manifest.entries ?? {}
  if (entries[exact]?.length) return exact

  const rtuLabel = pictureFileRtuLabel(rtuName)
  const unitCore = normalizeRtuUnitCore(rtuName)
  const prefix = `${buildingAddress}|`

  for (const key of Object.keys(entries)) {
    if (!key.startsWith(prefix) || !entries[key]?.length) continue
    const manifestRtuName = key.slice(prefix.length)
    if (pictureFileRtuLabel(manifestRtuName) === rtuLabel) return key
    if (unitCore && normalizeRtuUnitCore(manifestRtuName) === unitCore) return key
  }

  return exact
}

/** RTU label for filenames, e.g. "RTU- 04" -> "RTU-04". */
export function sanitizeRtuFileToken(rtuName: string): string {
  return rtuName
    .trim()
    .replace(/\s+/g, '')
    .replace(/[^\w.-]/g, '')
}

export function rtuPictureFileBase(buildingAddress: string, rtuName: string): string {
  return `${buildingStreetNumber(buildingAddress)}_${sanitizeRtuFileToken(rtuName)}`
}

export function rtuPictureFileName(
  buildingAddress: string,
  rtuName: string,
  index: number,
  ext: string,
): string {
  const safeExt = ext.replace(/^\./, '').toLowerCase() || 'jpg'
  return `${rtuPictureFileBase(buildingAddress, rtuName)}_(${index}).${safeExt}`
}

export function parseRtuPictureIndex(fileName: string): number | null {
  const stored = fileName.match(/_\((\d+)\)\.[^.]+$/i)
  if (stored) return Number(stored[1])

  const bulk = parseBulkRtuPictureFileName(fileName)
  return bulk?.pictureIndex ?? null
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'))
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'fileName' })
        store.createIndex('rtuKey', 'rtuKey', { unique: false })
      }
    }
    req.onsuccess = () => resolve(req.result)
  })
}

interface StoredRtuPictureRow {
  fileName: string
  rtuKey: string
  index: number
  mimeType: string
  thumbBlob: Blob
  /** Original upload; older rows may only have thumbBlob */
  fullBlob?: Blob
  /** False after a successful Settings sync uploaded this file to Cloudflare */
  pendingDeploy?: boolean
}

async function idbGetAllForRtu(rtuKey: string): Promise<StoredRtuPictureRow[]> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const index = tx.objectStore(STORE).index('rtuKey')
    const req = index.getAll(rtuKey)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB read failed'))
    req.onsuccess = () => resolve((req.result as StoredRtuPictureRow[]) ?? [])
    tx.oncomplete = () => db.close()
  })
}

/** Re-key IndexedDB pictures when portfolio RTU names are shortened to match the manifest. */
export async function migrateIndexedDbRtuKeys(
  renames: Array<{ buildingAddress: string; oldName: string; newName: string }>,
): Promise<number> {
  if (!renames.length) return 0
  const db = await openDb()
  let updated = 0
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    const store = tx.objectStore(STORE)
    const req = store.getAll()
    req.onerror = () => reject(req.error ?? new Error('IndexedDB read failed'))
    req.onsuccess = () => {
      const rows = (req.result as StoredRtuPictureRow[]) ?? []
      for (const { buildingAddress, oldName, newName } of renames) {
        const oldKey = rtuPictureKey(buildingAddress, oldName)
        const newKey = rtuPictureKey(buildingAddress, newName)
        for (const row of rows) {
          if (row.rtuKey !== oldKey) continue
          store.put({ ...row, rtuKey: newKey })
          updated += 1
        }
      }
    }
    tx.oncomplete = () => {
      db.close()
      resolve()
    }
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB write failed'))
  })
  if (updated) notifyRtuPicturesChanged()
  return updated
}

/** Rename legacy spaced picture files in IndexedDB to cloud-safe names before sync. */
export async function migrateLegacyPictureFileNames(): Promise<number> {
  const rows = await idbGetAllRows()
  let migrated = 0
  for (const row of rows) {
    const sep = row.rtuKey.indexOf('|')
    if (sep < 0) continue
    const buildingAddress = row.rtuKey.slice(0, sep)
    const rtuName = row.rtuKey.slice(sep + 1)
    const canonical = manifestEntryToCloudFileName(row.fileName, buildingAddress, rtuName)
    if (canonical === row.fileName) continue
    await idbPut({ ...row, fileName: canonical, pendingDeploy: true })
    await idbDelete(row.fileName)
    migrated += 1
  }
  if (migrated) notifyRtuPicturesChanged()
  return migrated
}

async function idbPut(row: StoredRtuPictureRow): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(row)
    tx.oncomplete = () => {
      db.close()
      resolve()
    }
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB write failed'))
  })
}

async function idbGetAllRows(): Promise<StoredRtuPictureRow[]> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const req = tx.objectStore(STORE).getAll()
    req.onerror = () => reject(req.error ?? new Error('IndexedDB read failed'))
    req.onsuccess = () => resolve((req.result as StoredRtuPictureRow[]) ?? [])
    tx.oncomplete = () => db.close()
  })
}

/** All IndexedDB picture rows (for deploy bundle export). */
export async function exportIndexedDbPictureRows(): Promise<StoredRtuPictureRow[]> {
  return idbGetAllRows()
}

export interface DeployPictureEntry {
  fileName: string
  rtuKey: string
  index: number
  mimeType: string
  base64: string
}

export interface DeployPictureExportResult {
  pictures: DeployPictureEntry[]
  failedFileNames: string[]
  pendingCount: number
}

export interface PendingDeployPictureRow {
  fileName: string
  rtuKey: string
  index: number
  mimeType: string
  blob: Blob
}

/** Encode a blob as raw base64 without building a giant intermediate binary string. */
export async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = reader.result
      if (typeof dataUrl !== 'string') {
        reject(new Error('Failed to read image'))
        return
      }
      const comma = dataUrl.indexOf(',')
      resolve(comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl)
    }
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read image'))
    reader.readAsDataURL(blob)
  })
}

/** Rough upper bound for JSON size of one deploy picture entry (base64 + field overhead). */
export function estimateDeployPictureJsonBytes(blobSize: number): number {
  return Math.ceil((blobSize * 4) / 3) + 160
}

/** Pending IndexedDB rows for deploy, without loading every image into memory as base64. */
export async function listPendingDeployPictureRows(): Promise<{
  rows: PendingDeployPictureRow[]
  failedFileNames: string[]
  pendingCount: number
}> {
  const rows = await idbGetAllRows()
  const pendingRows = rows.filter((row) => row.pendingDeploy !== false)
  const deployRows: PendingDeployPictureRow[] = []
  const failedFileNames: string[] = []

  for (const row of pendingRows) {
    const blob = row.fullBlob ?? row.thumbBlob
    if (!blob || blob.size === 0) {
      failedFileNames.push(row.fileName)
      continue
    }
    deployRows.push({
      fileName: row.fileName,
      rtuKey: row.rtuKey,
      index: row.index,
      mimeType: row.mimeType,
      blob,
    })
  }

  return { rows: deployRows, failedFileNames, pendingCount: pendingRows.length }
}

export async function encodeDeployPictureEntry(
  row: PendingDeployPictureRow,
): Promise<DeployPictureEntry> {
  const base64 = await blobToBase64(row.blob)
  return {
    fileName: row.fileName,
    rtuKey: row.rtuKey,
    index: row.index,
    mimeType: row.mimeType,
    base64,
  }
}

/** IndexedDB pictures pending Cloudflare deploy (map upload / bulk import). */
export async function exportPendingPicturesForDeploy(): Promise<DeployPictureExportResult> {
  const { rows, failedFileNames, pendingCount } = await listPendingDeployPictureRows()
  const pictures: DeployPictureExportResult['pictures'] = []

  for (const row of rows) {
    try {
      pictures.push(await encodeDeployPictureEntry(row))
    } catch {
      failedFileNames.push(row.fileName)
    }
  }

  return { pictures, failedFileNames, pendingCount }
}

/** Mark map/import pictures as deployed after a successful Settings sync. */
export async function markRtuPicturesDeployed(fileNames: string[]): Promise<void> {
  if (!fileNames.length) return
  const wanted = new Set(fileNames)
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    const store = tx.objectStore(STORE)
    const req = store.getAll()
    req.onerror = () => reject(req.error ?? new Error('IndexedDB read failed'))
    req.onsuccess = () => {
      const rows = (req.result as StoredRtuPictureRow[]) ?? []
      for (const row of rows) {
        if (!wanted.has(row.fileName)) continue
        store.put({ ...row, pendingDeploy: false })
      }
    }
    tx.oncomplete = () => {
      db.close()
      notifyRtuPicturesChanged()
      resolve()
    }
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB write failed'))
  })
}

function parsePictureHideKey(hideKey: string): { rtuKey: string; fileName: string } | null {
  const sep = hideKey.lastIndexOf('|')
  if (sep < 0) return null
  return { rtuKey: hideKey.slice(0, sep), fileName: hideKey.slice(sep + 1) }
}

export function collectPictureIndicesFromManifestAndHidden(
  rtuKeys: string[],
  manifest: RtuPictureManifest,
  hiddenKeys: string[],
): Set<number> {
  const used = new Set<number>()
  for (const rtuKey of rtuKeys) {
    for (const fileName of manifest.entries[rtuKey] ?? []) {
      const idx = parseRtuPictureIndex(fileName)
      if (idx != null && idx >= 1) used.add(idx)
    }
  }
  for (const hideKey of hiddenKeys) {
    const parsed = parsePictureHideKey(hideKey)
    if (!parsed || !rtuKeys.includes(parsed.rtuKey)) continue
    const idx = parseRtuPictureIndex(parsed.fileName)
    if (idx != null && idx >= 1) used.add(idx)
  }
  return used
}

/** Picture slots already used by manifest, IndexedDB, or hidden entries for this RTU. */
export async function occupiedPictureIndicesForRtu(
  buildingAddress: string,
  rtuName: string,
  manifest?: RtuPictureManifest,
): Promise<Set<number>> {
  await loadHiddenRtuPictures()
  const resolvedManifest = manifest ?? (await loadRtuPictureManifest())
  const key = rtuPictureKey(buildingAddress, rtuName)
  const manifestKey = resolveManifestRtuKey(buildingAddress, rtuName, resolvedManifest)
  const keys = manifestKey === key ? [key] : [key, manifestKey]
  const used = collectPictureIndicesFromManifestAndHidden(
    keys,
    resolvedManifest,
    exportHiddenRtuPicturesForDeploy(),
  )

  for (const rtuKey of keys) {
    for (const row of await idbGetAllForRtu(rtuKey)) {
      if (row.index >= 1) used.add(row.index)
    }
  }

  return used
}

export async function nextAvailablePictureIndex(
  buildingAddress: string,
  rtuName: string,
): Promise<number> {
  const manifest = await loadRtuPictureManifest()
  const used = await occupiedPictureIndicesForRtu(buildingAddress, rtuName, manifest)
  let candidate = 1
  while (
    used.has(candidate) ||
    (await cloudFilenameBlockedForNewUpload(buildingAddress, rtuName, candidate, manifest))
  ) {
    candidate++
  }
  return candidate
}

/** Skip auto-assigning an index when CDN already has that filename but manifest does not claim it for this RTU. */
async function cloudFilenameBlockedForNewUpload(
  buildingAddress: string,
  rtuName: string,
  index: number,
  manifest: RtuPictureManifest,
): Promise<boolean> {
  const fileName = buildCloudRtuPictureFileName(buildingAddress, rtuName, index, 'jpg')
  if (!(await cloudRtuPictureReachable(fileName))) return false

  const key = rtuPictureKey(buildingAddress, rtuName)
  const manifestKey = resolveManifestRtuKey(buildingAddress, rtuName, manifest)
  const manifestFile = manifestFileAtIndex(manifest, key, index)
  if (manifestFile && !isRtuManifestPictureHidden(manifestKey, manifestFile)) {
    return true
  }
  // Old/hidden CDN file still at this path -- use the next index instead of reusing the filename.
  return true
}

async function cloudRtuPictureReachable(fileName: string): Promise<boolean> {
  return isRtuPictureReachableOnCdnWithRetry(fileName)
}

function splitRtuPictureKey(rtuKey: string): { buildingAddress: string; rtuName: string } {
  const pipe = rtuKey.indexOf('|')
  if (pipe < 0) return { buildingAddress: rtuKey, rtuName: '' }
  return { buildingAddress: rtuKey.slice(0, pipe), rtuName: rtuKey.slice(pipe + 1) }
}

function manifestFileAtIndex(
  manifest: RtuPictureManifest,
  rtuKey: string,
  index: number,
): string | null {
  const { buildingAddress, rtuName } = splitRtuPictureKey(rtuKey)
  const manifestKey = resolveManifestRtuKey(buildingAddress, rtuName, manifest)
  for (const fileName of manifest.entries[manifestKey] ?? []) {
    if (isRtuManifestPictureHidden(manifestKey, fileName)) continue
    if (parseRtuPictureIndex(fileName) === index) return fileName
  }
  return null
}

/** True when Cloudflare manifest already lists the same picture slot (same cloud filename). */
export function isIndexedDbRowSatisfiedByManifest(
  manifest: RtuPictureManifest,
  row: Pick<StoredRtuPictureRow, 'fileName' | 'rtuKey' | 'index'>,
): boolean {
  const manifestFile = manifestSlotForRow(manifest, row)
  if (!manifestFile) return false
  const { buildingAddress, rtuName } = splitRtuPictureKey(row.rtuKey)
  const rowCloud = manifestEntryToCloudFileName(row.fileName, buildingAddress, rtuName)
  const manifestCloud = manifestEntryToCloudFileName(manifestFile, buildingAddress, rtuName)
  return rowCloud === manifestCloud
}

function manifestSlotForRow(
  manifest: RtuPictureManifest,
  row: Pick<StoredRtuPictureRow, 'fileName' | 'rtuKey' | 'index'>,
): string | null {
  const fromIndex = manifestFileAtIndex(manifest, row.rtuKey, row.index)
  if (fromIndex) return fromIndex
  const parsed = parseRtuPictureIndex(row.fileName)
  if (parsed != null && parsed !== row.index) {
    return manifestFileAtIndex(manifest, row.rtuKey, parsed)
  }

  const { buildingAddress, rtuName } = splitRtuPictureKey(row.rtuKey)
  const unitCore = normalizeRtuUnitCore(rtuName)
  if (!unitCore) return null
  const buildingNum = buildingStreetNumber(buildingAddress)
  const indices = new Set<number>()
  if (row.index >= 1) indices.add(row.index)
  if (parsed != null && parsed >= 1) indices.add(parsed)

  for (const [key, files] of Object.entries(manifest.entries ?? {})) {
    const sep = key.indexOf('|')
    if (sep < 0) continue
    const mBuilding = key.slice(0, sep)
    const mRtu = key.slice(sep + 1)
    if (buildingStreetNumber(mBuilding) !== buildingNum) continue
    if (normalizeRtuUnitCore(mRtu) !== unitCore) continue
    for (const fileName of files) {
      if (isRtuManifestPictureHidden(key, fileName)) continue
      const idx = parseRtuPictureIndex(fileName)
      if (idx != null && indices.has(idx)) return fileName
    }
  }

  return null
}

/** All manifest filenames plus cloud-normalized variants (for stale IndexedDB matching). */
function buildManifestCloudNameSet(manifest: RtuPictureManifest): Set<string> {
  const names = new Set<string>()
  for (const [rtuKey, files] of Object.entries(manifest.entries ?? {})) {
    const { buildingAddress, rtuName } = splitRtuPictureKey(rtuKey)
    for (const fileName of files) {
      names.add(fileName)
      names.add(manifestEntryToCloudFileName(fileName, buildingAddress, rtuName))
    }
  }
  return names
}

function rowFileNamesInManifest(manifest: RtuPictureManifest, row: StoredRtuPictureRow): boolean {
  const cloudNames = buildManifestCloudNameSet(manifest)
  const { buildingAddress, rtuName } = splitRtuPictureKey(row.rtuKey)
  const cloudRow = manifestEntryToCloudFileName(row.fileName, buildingAddress, rtuName)
  return cloudNames.has(row.fileName) || cloudNames.has(cloudRow)
}

function isStalePendingRow(manifest: RtuPictureManifest, row: StoredRtuPictureRow): boolean {
  if (rowFileNamesInManifest(manifest, row)) return true
  if (isIndexedDbRowSatisfiedByManifest(manifest, row)) return true
  // Do not match manifest index slots alone -- a pending local row can be a new photo at the
  // next index while an older file still occupies that slot in the cloud manifest.
  return false
}

/** @internal Tests only */
export function isStalePendingRowForTests(
  manifest: RtuPictureManifest,
  row: StoredRtuPictureRow,
): boolean {
  return isStalePendingRow(manifest, row)
}

/** Pending IndexedDB pictures that still need a Cloudflare upload (excludes manifest/CDN matches). */
export async function countPendingPicturesNeedingCloudUpload(): Promise<number> {
  const manifest = await loadRtuPictureManifest()
  const rows = await idbGetAllRows()
  let count = 0
  for (const row of rows) {
    if (row.pendingDeploy === false) continue
    if ((row.fullBlob?.size ?? 0) === 0) continue
    if (isStalePendingRow(manifest, row)) continue
    count++
  }
  return count
}

async function idbDeleteMany(fileNames: string[]): Promise<void> {
  if (!fileNames.length) return
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    const store = tx.objectStore(STORE)
    for (const fileName of fileNames) store.delete(fileName)
    tx.oncomplete = () => {
      db.close()
      resolve()
    }
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB delete failed'))
  })
}

/**
 * Drop stale IndexedDB copies when Cloudflare already serves that RTU picture slot.
 * Fixes false "942 pictures waiting to upload" after pictures are already on R2/CDN.
 */
export async function reconcilePendingDeployWithCloud(): Promise<number> {
  const manifest = await loadRtuPictureManifest()
  const rows = await idbGetAllRows()
  const pending = rows.filter((row) => row.pendingDeploy !== false)
  if (!pending.length) return 0

  const deleteRedundant: string[] = []
  const needsCdnCheck: StoredRtuPictureRow[] = []

  for (const row of pending) {
    const blob = row.fullBlob ?? row.thumbBlob
    if (!blob || blob.size === 0) {
      deleteRedundant.push(row.fileName)
      continue
    }
    if (isStalePendingRow(manifest, row)) {
      deleteRedundant.push(row.fileName)
      continue
    }
    needsCdnCheck.push(row)
  }

  if (deleteRedundant.length) await idbDeleteMany(deleteRedundant)

  const deleteOnCdn: string[] = []
  const concurrency = 12
  let cursor = 0
  async function cdnWorker() {
    while (cursor < needsCdnCheck.length) {
      const row = needsCdnCheck[cursor++]!
      const { buildingAddress, rtuName } = splitRtuPictureKey(row.rtuKey)
      const candidates = [
        row.fileName,
        manifestEntryToCloudFileName(row.fileName, buildingAddress, rtuName),
      ]
      const manifestFile = manifestSlotForRow(manifest, row)
      if (manifestFile) {
        candidates.push(
          manifestFile,
          manifestEntryToCloudFileName(manifestFile, buildingAddress, rtuName),
        )
      }
      for (const name of [...new Set(candidates)]) {
        if (!(await cloudRtuPictureReachable(name))) continue
        if (isIndexedDbRowSatisfiedByManifest(manifest, row)) {
          deleteOnCdn.push(row.fileName)
          break
        }
        const manifestFile = manifestFileAtIndex(manifest, row.rtuKey, row.index)
        if (!manifestFile) {
          // Orphan CDN file at this path -- keep local replacement pending upload.
          continue
        }
        const { buildingAddress, rtuName } = splitRtuPictureKey(row.rtuKey)
        const manifestKey = resolveManifestRtuKey(buildingAddress, rtuName, manifest)
        if (isRtuManifestPictureHidden(manifestKey, manifestFile)) continue
        const rowCloud = manifestEntryToCloudFileName(row.fileName, buildingAddress, rtuName)
        const manifestCloud = manifestEntryToCloudFileName(manifestFile, buildingAddress, rtuName)
        if (rowCloud === manifestCloud) {
          deleteOnCdn.push(row.fileName)
          break
        }
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => cdnWorker()))
  if (deleteOnCdn.length) await idbDeleteMany(deleteOnCdn)

  const reconciled = deleteRedundant.length + deleteOnCdn.length
  if (reconciled) notifyRtuPicturesChanged()
  return reconciled
}

/** Remove stale browser copies of pictures already on Cloudflare; returns counts for UI. */
export async function clearStaleLocalRtuPictures(): Promise<{
  removed: number
  remaining: number
}> {
  const removed = await reconcilePendingDeployWithCloud()
  const remaining = await countPendingPicturesNeedingCloudUpload()
  return { removed, remaining }
}

/** Remove every RTU picture stored in this browser (IndexedDB). Returns rows deleted. */
export async function clearAllLocalRtuPictures(): Promise<number> {
  const rows = await idbGetAllRows()
  const fileNames = rows.map((row) => row.fileName)
  if (fileNames.length) await idbDeleteMany(fileNames)
  if (fileNames.length) notifyRtuPicturesChanged()
  return fileNames.length
}

/** Wipe browser RTU picture storage and manifest cache (map badges + viewer). */
export async function clearLocalRtuPictureStorage(): Promise<number> {
  clearRtuPictureManifestCache()
  const removed = await clearAllLocalRtuPictures()
  notifyRtuPicturesChanged()
  return removed
}

/** Drop all RTU pictures on this PC that were never synced to Cloudflare. */
export async function discardPendingLocalRtuPictures(): Promise<number> {
  const rows = await idbGetAllRows()
  const toDelete = rows.filter((row) => row.pendingDeploy !== false).map((row) => row.fileName)
  if (toDelete.length) await idbDeleteMany(toDelete)
  if (toDelete.length) notifyRtuPicturesChanged()
  return toDelete.length
}

/** Picture count per RTU key (`buildingAddress|rtuName`), merging manifest + IndexedDB. */
export async function getRtuPictureCountMap(): Promise<Map<string, number>> {
  const manifest = await loadRtuPictureManifest()
  const rows = await idbGetAllRows()
  const countByKey = new Map<string, number>()

  for (const [key, files] of Object.entries(manifest.entries ?? {})) {
    let count = 0
    for (const fileName of files) {
      if (isRtuManifestPictureHidden(key, fileName)) continue
      count += 1
    }
    if (count) countByKey.set(key, count)
  }

  for (const row of rows) {
    const manifestFiles = manifest.entries[row.rtuKey] ?? []
    if (manifestFiles.includes(row.fileName)) continue
    countByKey.set(row.rtuKey, (countByKey.get(row.rtuKey) ?? 0) + 1)
  }

  return countByKey
}

export async function loadRtuPictureManifest(): Promise<RtuPictureManifest> {
  if (manifestCache) return manifestCache
  if (manifestPromise) return manifestPromise
  manifestPromise = (async () => {
    try {
      await loadHiddenRtuPictures()
      manifestCache = await fetchPictureManifest()
      return manifestCache
    } finally {
      manifestPromise = null
    }
  })()
  return manifestPromise
}

async function createThumbnail(file: File, maxWidth = 320): Promise<Blob> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, maxWidth / bitmap.width)
  const width = Math.max(1, Math.round(bitmap.width * scale))
  const height = Math.max(1, Math.round(bitmap.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    bitmap.close()
    throw new Error('Canvas not supported')
  }
  ctx.drawImage(bitmap, 0, 0, width, height)
  bitmap.close()
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Thumbnail encode failed'))),
      'image/jpeg',
      0.72,
    )
  })
}

function fileExtension(file: File): string {
  const fromName = file.name.split('.').pop()?.toLowerCase()
  if (fromName && /^[a-z0-9]{2,5}$/.test(fromName)) return fromName
  const mime = file.type.split('/')[1]
  return mime === 'jpeg' ? 'jpg' : mime || 'jpg'
}

export async function listRtuPictures(
  buildingAddress: string,
  rtuName: string,
): Promise<RtuPicture[]> {
  const key = rtuPictureKey(buildingAddress, rtuName)
  const manifest = await loadRtuPictureManifest()
  const manifestKey = resolveManifestRtuKey(buildingAddress, rtuName, manifest)
  const staticNames = manifest.entries[manifestKey] ?? []
  const idbRows = [
    ...(await idbGetAllForRtu(key)),
    ...(manifestKey !== key ? await idbGetAllForRtu(manifestKey) : []),
  ]
  const idbByFileName = new Map(idbRows.map((row) => [row.fileName, row]))

  const pictures: RtuPicture[] = []

  for (const fileName of staticNames) {
    if (isRtuManifestPictureHidden(manifestKey, fileName)) continue
    const index = parseRtuPictureIndex(fileName) ?? 0
    const idbRow = idbByFileName.get(fileName)
    if (idbRow) {
      const fullBlob = idbRow.fullBlob ?? idbRow.thumbBlob
      const thumbUrl = URL.createObjectURL(idbRow.thumbBlob)
      const fullUrl = fullBlob === idbRow.thumbBlob ? thumbUrl : URL.createObjectURL(fullBlob)
      pictures.push({
        fileName: idbRow.fileName,
        index: idbRow.index,
        thumbUrl,
        fullUrl,
        source: 'indexeddb',
      })
      continue
    }
    const url = rtuPictureFileUrl(fileName)
    pictures.push({
      fileName,
      index,
      thumbUrl: url,
      fullUrl: url,
      source: 'static',
    })
  }

  const manifestFileSet = new Set(staticNames)
  for (const row of idbRows) {
    if (manifestFileSet.has(row.fileName)) continue
    const fullBlob = row.fullBlob ?? row.thumbBlob
    const thumbUrl = URL.createObjectURL(row.thumbBlob)
    const fullUrl = fullBlob === row.thumbBlob ? thumbUrl : URL.createObjectURL(fullBlob)
    pictures.push({
      fileName: row.fileName,
      index: row.index,
      thumbUrl,
      fullUrl,
      source: 'indexeddb',
    })
  }

  return pictures
}

async function idbDelete(fileName: string): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).delete(fileName)
    tx.oncomplete = () => {
      db.close()
      resolve()
    }
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB delete failed'))
  })
}

async function idbDeleteByRtuAndIndex(rtuKey: string, index: number): Promise<void> {
  const rows = await idbGetAllForRtu(rtuKey)
  await Promise.all(rows.filter((row) => row.index === index).map((row) => idbDelete(row.fileName)))
}

let importPictureQueue: Promise<unknown> = Promise.resolve()

async function importRtuPictureAtIndexImpl(
  buildingAddress: string,
  rtuName: string,
  file: File,
  index: number,
  options?: { fileName?: string },
): Promise<string> {
  if (!file.type.startsWith('image/') && !/\.(jpe?g|png|webp|heif|heic|tif{1,2})$/i.test(file.name)) {
    throw new Error('Not an image file')
  }
  if (index < 1) throw new Error('Picture index must be at least 1')

  const key = rtuPictureKey(buildingAddress, rtuName)
  // Remove any prior upload at this index (including different file extensions).
  await idbDeleteByRtuAndIndex(key, index)

  const ext = fileExtension(file)
  const fileName = options?.fileName
    ? manifestEntryToCloudFileName(
        options.fileName,
        buildingAddress,
        rtuName,
      )
    : buildCloudRtuPictureFileName(buildingAddress, rtuName, index, ext)
  const thumbBlob = await createThumbnail(file)
  await idbPut({
    fileName,
    rtuKey: key,
    index,
    mimeType: file.type || 'image/jpeg',
    thumbBlob,
    fullBlob: file,
    pendingDeploy: true,
  })
  notifyRtuPicturesChanged()
  return fileName
}

/** Store or replace a picture at a specific index (bulk import / explicit numbering). */
export async function importRtuPictureAtIndex(
  buildingAddress: string,
  rtuName: string,
  file: File,
  index?: number,
  options?: { fileName?: string },
): Promise<string> {
  const run = importPictureQueue.then(async () => {
    const resolvedIndex =
      index != null && index >= 1
        ? index
        : await nextAvailablePictureIndex(buildingAddress, rtuName)
    return importRtuPictureAtIndexImpl(buildingAddress, rtuName, file, resolvedIndex, options)
  })
  importPictureQueue = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

/** Persist the current edited image back to the map (IndexedDB, pending Cloudflare deploy). */
export async function saveRtuPictureEdit(
  buildingAddress: string,
  rtuName: string,
  index: number,
  blob: Blob,
  fileName: string,
): Promise<string> {
  const mimeType = blob.type || 'image/jpeg'
  const safeName = fileName.includes('.')
    ? fileName
    : `${fileName}.${mimeType === 'image/png' ? 'png' : 'jpg'}`
  const file = new File([blob], safeName, { type: mimeType })
  return importRtuPictureAtIndex(buildingAddress, rtuName, file, index, { fileName: safeName })
}

export async function deleteRtuPicture(
  buildingAddress: string,
  rtuName: string,
  fileName: string,
): Promise<'deleted' | 'not-found'> {
  const pictures = await listRtuPictures(buildingAddress, rtuName)
  const pic = pictures.find((p) => p.fileName === fileName)
  if (!pic) return 'not-found'

  if (pic.source === 'indexeddb') {
    revokeRtuPictureUrls([pic])
  }

  const manifest = await loadRtuPictureManifest()
  const manifestKey = resolveManifestRtuKey(buildingAddress, rtuName, manifest)
  const onCloud = (manifest.entries[manifestKey] ?? []).includes(fileName)

  if (onCloud) {
    await deleteRtuPictureFromCloud({ buildingAddress, rtuName, fileName })
  }

  try {
    await idbDelete(fileName)
  } catch {
    /* no local copy */
  }

  clearRtuPictureManifestCache()
  clearHiddenRtuPictureCache()
  notifyRtuPicturesChanged()
  return 'deleted'
}

export function revokeRtuPictureUrls(pictures: RtuPicture[]): void {
  for (const pic of pictures) {
    if (pic.source !== 'indexeddb') continue
    URL.revokeObjectURL(pic.thumbUrl)
    if (pic.fullUrl !== pic.thumbUrl) URL.revokeObjectURL(pic.fullUrl)
  }
}

export async function addRtuPicturesFromFiles(
  buildingAddress: string,
  rtuName: string,
  files: File[],
): Promise<RtuPicture[]> {
  if (!files.length) return listRtuPictures(buildingAddress, rtuName)

  const imageFiles = files.filter(
    (file) => file.type.startsWith('image/') || /\.(jpe?g|png|webp|heif|heic|tif{1,2})$/i.test(file.name),
  )
  if (!imageFiles.length) return listRtuPictures(buildingAddress, rtuName)

  const existing = await listRtuPictures(buildingAddress, rtuName)
  revokeRtuPictureUrls(existing.filter((p) => p.source === 'indexeddb'))

  const used = await occupiedPictureIndicesForRtu(buildingAddress, rtuName)
  let nextIndex = 1
  while (used.has(nextIndex)) nextIndex++

  for (const file of imageFiles) {
    await importRtuPictureAtIndex(buildingAddress, rtuName, file, nextIndex)
    used.add(nextIndex)
    nextIndex += 1
    while (used.has(nextIndex)) nextIndex++
  }

  return listRtuPictures(buildingAddress, rtuName)
}

export { hideRtuManifestPicture } from '@/lib/hiddenRtuPictures'
