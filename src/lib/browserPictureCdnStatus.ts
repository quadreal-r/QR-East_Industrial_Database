import { manifestEntryToCloudFileName } from '@/lib/rtuPictureAssignNaming'
import { verifyRtuPicturesOnCdn } from '@/lib/rtuPictureCdnStatus'
import { usesRemoteRtuPicturesCdn } from '@/lib/rtuPictureUrls'
import type { RtuPictureManifest } from '@/data/mediaApi'

const SAMPLE_SIZE = 12

function splitRtuKey(rtuKey: string): { buildingAddress: string; rtuName: string } {
  const pipe = rtuKey.indexOf('|')
  if (pipe < 0) return { buildingAddress: rtuKey, rtuName: '' }
  return { buildingAddress: rtuKey.slice(0, pipe), rtuName: rtuKey.slice(pipe + 1) }
}

export function countManifestPictures(manifest: RtuPictureManifest): number {
  let count = 0
  for (const files of Object.values(manifest.entries ?? {})) {
    count += files.length
  }
  return count
}

/** Unique manifest + cloud filenames for CDN checks. */
export function collectManifestCloudFileNames(manifest: RtuPictureManifest): string[] {
  const names = new Set<string>()
  for (const [rtuKey, files] of Object.entries(manifest.entries ?? {})) {
    const { buildingAddress, rtuName } = splitRtuKey(rtuKey)
    for (const fileName of files) {
      names.add(fileName)
      names.add(manifestEntryToCloudFileName(fileName, buildingAddress, rtuName))
    }
  }
  return [...names]
}

function markAll(names: Iterable<string>, value: boolean): Map<string, boolean> {
  const map = new Map<string, boolean>()
  for (const name of names) map.set(name, value)
  return map
}

/**
 * Browser-friendly CDN status check for RTU pictures.
 * Avoids loading thousands of images (HEAD is blocked by CORS on R2).
 */
export async function buildBrowserPictureCdnStatus(
  manifest: RtuPictureManifest,
): Promise<{ statusByFile: Map<string, boolean>; verificationNote: string }> {
  const names = collectManifestCloudFileNames(manifest)
  const manifestCount = countManifestPictures(manifest)

  if (!usesRemoteRtuPicturesCdn()) {
    return {
      statusByFile: markAll(names, false),
      verificationNote: 'CDN URL not configured in this build',
    }
  }

  const sample = names.slice(0, SAMPLE_SIZE)
  if (!sample.length) {
    return {
      statusByFile: new Map(),
      verificationNote: 'No manifest pictures',
    }
  }

  const verified = await verifyRtuPicturesOnCdn(sample, 4)
  const okCount = sample.filter((fileName) => verified.get(fileName)).length

  if (okCount === sample.length) {
    return {
      statusByFile: markAll(names, true),
      verificationNote: `Sample CDN check (${okCount}/${sample.length} reachable, ${manifestCount} total)`,
    }
  }

  const statusByFile = markAll(names, false)
  for (const fileName of sample) {
    if (verified.get(fileName)) statusByFile.set(fileName, true)
  }

  return {
    statusByFile,
    verificationNote: `Sample CDN check (${okCount}/${sample.length} reachable)`,
  }
}
