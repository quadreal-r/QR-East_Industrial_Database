/** RTU document links — metadata from Supabase, files from Cloudflare R2. */

import { fetchDocumentManifest } from '@/data/mediaApi'
import { rtuDocumentFileUrl } from '@/lib/rtuDocumentUrls'
import { resolveManifestRtuKey, rtuPictureKey, type RtuPictureManifest } from '@/lib/rtuPictures'

export interface RtuDocumentsManifest {
  entries: Record<string, string[]>
}

export interface RtuDocument {
  fileName: string
  url: string
  label: string
}

let manifestCache: RtuDocumentsManifest | null = null
let manifestPromise: Promise<RtuDocumentsManifest> | null = null

export function clearRtuDocumentsManifestCache(): void {
  manifestCache = null
  manifestPromise = null
}

export async function loadRtuDocumentsManifest(): Promise<RtuDocumentsManifest> {
  if (manifestCache) return manifestCache
  if (manifestPromise) return manifestPromise

  manifestPromise = (async () => {
    try {
      manifestCache = await fetchDocumentManifest()
      return manifestCache
    } finally {
      manifestPromise = null
    }
  })()

  return manifestPromise
}

export async function listRtuDocuments(
  buildingAddress: string,
  rtuName: string,
): Promise<RtuDocument[]> {
  const manifest = await loadRtuDocumentsManifest()
  const pictureManifest = manifest as RtuPictureManifest
  const key = resolveManifestRtuKey(buildingAddress, rtuName, pictureManifest)
  const files = manifest.entries[key] ?? manifest.entries[rtuPictureKey(buildingAddress, rtuName)] ?? []

  return files.map((fileName) => ({
    fileName,
    url: rtuDocumentFileUrl(fileName),
    label: fileName.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' '),
  }))
}
