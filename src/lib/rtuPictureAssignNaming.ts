import { buildingStreetNumber, parseBulkRtuPictureFileName } from '@/lib/rtuPictureMatch'

/** Keep RTU name as shown in the app; only strip unsafe filename characters. */
export function formatRtuNameForPictureFile(rtuName: string): string {
  return rtuName
    .trim()
    .replace(/\s*\/\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[/\\:*?"<>|]/g, '')
}

/** RTU label for picture filenames — portfolio name only, not description suffix after "/". */
export function pictureFileRtuLabel(rtuName: string): string {
  const primary = rtuName.split('/')[0]?.trim() ?? rtuName.trim()
  return formatRtuNameForPictureFile(primary)
}

/** Unit token for cloud filenames, e.g. RTU-04 Hybrid → `04`, RTU-09 → `09`. */
export function rtuUnitFileSegment(rtuName: string): string {
  const label = pictureFileRtuLabel(rtuName).replace(/\s+Hybrid\b/gi, '').trim()
  const match = label.match(/^RTU[-\s#]*(.+)$/i)
  const segment = (match?.[1] ?? label).replace(/\s+/g, '')
  const cleaned = segment.replace(/[^\w.-]/g, '')
  return cleaned || 'unknown'
}

/**
 * Cloudflare / R2 filename (no spaces), matching bulk imports like `2320-RTU-09-1.jpg`.
 */
export function buildCloudRtuPictureFileName(
  buildingAddress: string,
  rtuName: string,
  pictureIndex: number,
  ext: string,
): string {
  const buildingNum = buildingStreetNumber(buildingAddress)
  const unit = rtuUnitFileSegment(rtuName)
  const safeExt = ext.replace(/^\./, '').toLowerCase() || 'jpg'
  return `${buildingNum}-RTU-${unit}-${pictureIndex}.${safeExt}`
}

/**
 * Bulk-style filename using the displayed RTU name, e.g. `2320-RTU-06 Hybrid (3).jpg`
 * (not `2320-RTU-06HYBRID (3).jpg`).
 */
export function buildBulkRtuPictureFileName(
  buildingAddress: string,
  rtuName: string,
  pictureIndex: number,
  ext: string,
): string {
  const buildingNum = buildingStreetNumber(buildingAddress)
  const rtuLabel = pictureFileRtuLabel(rtuName)
  const safeExt = ext.replace(/^\./, '').toLowerCase() || 'jpg'
  return `${buildingNum}-${rtuLabel} (${pictureIndex}).${safeExt}`
}

/** True for new-naming R2 files like `100-RTU-01…` / `6150E-RTU-01…` (not legacy `100_RTU-01_(1).jpg`). */
function isCanonicalR2ManifestFileName(fileName: string): boolean {
  const base = fileName.replace(/^.*[/\\]/, '')
  return /^\d+[A-Za-z]?-RTU/i.test(base)
}

/** Map legacy spaced manifest names to the cloud filename used on R2. */
export function manifestEntryToCloudFileName(
  fileName: string,
  buildingAddress: string,
  rtuName: string,
): string {
  if (!/[\s()]/.test(fileName)) return fileName
  // New-naming bulk files on R2 use the manifest name as-is (e.g. "100-RTU-01 (1) (Audit-2024).jpg").
  if (isCanonicalR2ManifestFileName(fileName) && parseBulkRtuPictureFileName(fileName)) {
    return fileName
  }
  const paren = fileName.match(/\((\d+)\)\.[^.]+$/i)
  const dash = fileName.match(/-(\d+)\.[^.]+$/i)
  const index =
    paren ? Number(paren[1]) : dash ? Number(dash[1]) : 1
  const ext = fileName.split('.').pop() ?? 'jpg'
  return buildCloudRtuPictureFileName(buildingAddress, rtuName, index, ext)
}
