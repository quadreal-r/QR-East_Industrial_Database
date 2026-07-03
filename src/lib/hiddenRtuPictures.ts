/** Hidden RTU pictures stored in Supabase `rtu_pictures.hidden`. */

import { fetchHiddenPictureKeys, setPictureHidden } from '@/data/mediaApi'
import { notifyRtuPicturesChanged } from '@/lib/rtuPictures'

let hiddenCache: Set<string> | null = null
let hiddenLoad: Promise<Set<string>> | null = null

function pictureHideKey(rtuKey: string, fileName: string): string {
  return `${rtuKey}|${fileName}`
}

export async function loadHiddenRtuPictures(): Promise<boolean> {
  if (hiddenLoad) {
    await hiddenLoad
    return (hiddenCache?.size ?? 0) > 0
  }
  hiddenLoad = (async () => {
    hiddenCache = await fetchHiddenPictureKeys()
    return hiddenCache
  })()
  await hiddenLoad
  return (hiddenCache?.size ?? 0) > 0
}

export function clearHiddenRtuPictureCache(): void {
  hiddenCache = null
  hiddenLoad = null
}

function allHiddenKeys(): Set<string> {
  return hiddenCache ?? new Set()
}

/** @deprecated Use loadHiddenRtuPictures */
export const loadBundledHiddenRtuPictures = loadHiddenRtuPictures

export function isRtuManifestPictureHidden(rtuKey: string, fileName: string): boolean {
  return allHiddenKeys().has(pictureHideKey(rtuKey, fileName))
}

export async function hideRtuManifestPicture(
  rtuKey: string,
  fileName: string,
): Promise<void> {
  const sep = rtuKey.indexOf('|')
  if (sep < 0) return
  const buildingAddress = rtuKey.slice(0, sep)
  const rtuName = rtuKey.slice(sep + 1)
  await setPictureHidden(buildingAddress, rtuName, fileName, true)
  hiddenCache ??= new Set()
  hiddenCache.add(pictureHideKey(rtuKey, fileName))
  notifyRtuPicturesChanged()
}

export async function unhideRtuManifestPicture(
  rtuKey: string,
  fileName: string,
): Promise<void> {
  const sep = rtuKey.indexOf('|')
  if (sep < 0) return
  const buildingAddress = rtuKey.slice(0, sep)
  const rtuName = rtuKey.slice(sep + 1)
  await setPictureHidden(buildingAddress, rtuName, fileName, false)
  hiddenCache?.delete(pictureHideKey(rtuKey, fileName))
  notifyRtuPicturesChanged()
}

/** @deprecated Sync removed — hidden state lives in Supabase only. */
export function exportHiddenRtuPicturesForDeploy(): string[] {
  return [...allHiddenKeys()]
}

/** @deprecated Sync removed */
export function readLocalHiddenRtuPictureKeys(): string[] {
  return [...allHiddenKeys()]
}

export async function migrateHiddenRtuPictureKeys(
  renames: Array<{ buildingAddress: string; oldName: string; newName: string }>,
): Promise<void> {
  if (!renames.length) return
  clearHiddenRtuPictureCache()
  await loadHiddenRtuPictures()
}

/** @deprecated Sync removed */
export function clearLocalHiddenRtuPictures(): void {
  clearHiddenRtuPictureCache()
}

/** @deprecated Sync removed */
export function countUnsyncedLocalHiddenRtuPictures(): number {
  return 0
}
