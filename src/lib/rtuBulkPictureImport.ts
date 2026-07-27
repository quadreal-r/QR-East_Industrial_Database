import {
  extractRtuUnitId,
  findRtuCandidates,
  normalizeRtuUnitCore,
  parseBulkRtuPictureFileName,
  resolveRtuCandidates,
  buildingStreetNumber,
  type ParsedBulkRtuFileName,
} from '@/lib/rtuPictureMatch'
import { importRtuPictureAtIndex } from '@/lib/rtuPictures'
import type { Building, Rtu } from '@/types/domain'

export type { ParsedBulkRtuFileName }
export {
  extractRtuUnitId,
  findRtuCandidates,
  matchFileToRtu,
  normalizeRtuUnitCore,
  parseBulkRtuPictureFileName,
  resolveRtuCandidates,
} from '@/lib/rtuPictureMatch'

export interface RtuCatalogEntry {
  building: Building
  rtu: Rtu
  streetNumber: string
  unitId: string
  unitCore: string | null
}

const IMAGE_FILE_RE = /\.(jpe?g|png|webp|heif|heic|tif{1,2})$/i

export interface RtuCatalogEntry {
  building: Building
  rtu: Rtu
  streetNumber: string
  unitId: string
}

export interface BulkRtuPictureImportSuccess {
  file: string
  buildingAddress: string
  rtuName: string
  pictureIndex: number
  storedFileName: string
}

export interface BulkRtuPictureImportResult {
  totalFiles: number
  excluded: { file: string; reason: string }[]
  imported: number
  skipped: number
  successes: BulkRtuPictureImportSuccess[]
  failures: { file: string; reason: string }[]
  warnings: { file: string; message: string }[]
  cancelled?: boolean
  completedAt: string
}

export interface BulkRtuPictureImportProgress {
  processed: number
  total: number
  currentFile: string
}

export interface BulkImportRtuPicturesOptions {
  signal?: AbortSignal
  onProgress?: (progress: BulkRtuPictureImportProgress) => void
}

export function buildRtuCatalog(buildings: Building[]): RtuCatalogEntry[] {
  const entries: RtuCatalogEntry[] = []
  for (const building of buildings) {
    const streetNumber = buildingStreetNumber(building.address)
    for (const rtu of building.rtus ?? []) {
      entries.push({
        building,
        rtu,
        streetNumber,
        unitId: extractRtuUnitId(rtu.name),
        unitCore: normalizeRtuUnitCore(rtu.name),
      })
    }
  }
  return entries
}

export function pickRtuMatch(
  candidates: RtuCatalogEntry[],
  parsed: ParsedBulkRtuFileName,
): {
  entry: RtuCatalogEntry | null
  reason?: string
} {
  if (!candidates.length) {
    return { entry: null, reason: 'No RTU matches building number and unit id in filename' }
  }

  const entry = resolveRtuCandidates(candidates, parsed)
  if (entry) return { entry }

  return {
    entry: null,
    reason: `Multiple RTU markers match building ${parsed.buildingNum} unit ${parsed.unitId} — rename file to be more specific`,
  }
}

function isImageFile(file: File): boolean {
  if (file.type.startsWith('image/')) return true
  return IMAGE_FILE_RE.test(file.name)
}

function fileRelativePath(file: File): string {
  const withPath = file as File & { webkitRelativePath?: string }
  return withPath.webkitRelativePath ?? file.name
}

/** Skip photos in folders whose name contains "old", or filenames containing "old". */
export function isExcludedOldRtuPicture(file: File): boolean {
  const relPath = fileRelativePath(file)
  const baseName = relPath.replace(/^.*[/\\]/, '')
  const nameWithoutExt = baseName.replace(IMAGE_FILE_RE, '')
  if (/old/i.test(nameWithoutExt)) return true

  const folderSegments = relPath.split(/[/\\]/).slice(0, -1)
  return folderSegments.some((segment) => /old/i.test(segment))
}

function formatReportLines(title: string, items: { file: string; detail: string }[]): string[] {
  if (!items.length) return []
  return [title, ...items.map(({ file, detail }) => `  ${file} — ${detail}`), '']
}

/** Plain-text report for download or copy after a bulk upload finishes. */
export function formatBulkRtuPictureImportReport(result: BulkRtuPictureImportResult): string {
  const status = result.cancelled ? 'Cancelled' : 'Completed'
  const lines = [
    'RTU Picture Bulk Import Report',
    `Status: ${status}`,
    `Completed: ${result.completedAt}`,
    '',
    'Summary',
    `  Total files in folder: ${result.totalFiles}`,
    `  Excluded before import: ${result.excluded.length}`,
    `  Imported: ${result.imported}`,
    `  Skipped (errors): ${result.skipped}`,
    `  Warnings: ${result.warnings.length}`,
    '',
  ]

  lines.push(
    ...formatReportLines(
      `Imported pictures (${result.successes.length})`,
      result.successes.map((s) => ({
        file: s.file,
        detail: `${s.rtuName} @ ${s.buildingAddress} (#${s.pictureIndex}) → ${s.storedFileName}`,
      })),
    ),
  )

  lines.push(
    ...formatReportLines(
      `Warnings (${result.warnings.length})`,
      result.warnings.map((w) => ({ file: w.file, detail: w.message })),
    ),
  )

  lines.push(
    ...formatReportLines(
      `Skipped / failed (${result.failures.length})`,
      result.failures.map((f) => ({ file: f.file, detail: f.reason })),
    ),
  )

  lines.push(
    ...formatReportLines(
      `Excluded (${result.excluded.length})`,
      result.excluded.map((e) => ({ file: e.file, detail: e.reason })),
    ),
  )

  return lines.join('\n').trimEnd() + '\n'
}

export async function bulkImportRtuPictures(
  buildings: Building[],
  files: File[],
  options: BulkImportRtuPicturesOptions = {},
): Promise<BulkRtuPictureImportResult> {
  const { signal, onProgress } = options
  const catalog = buildRtuCatalog(buildings)
  const excluded: { file: string; reason: string }[] = []
  const eligible: File[] = []

  for (const file of files) {
    const relPath = fileRelativePath(file)
    if (!isImageFile(file)) {
      excluded.push({ file: relPath, reason: 'Not an image file' })
      continue
    }
    if (isExcludedOldRtuPicture(file)) {
      excluded.push({ file: relPath, reason: 'Excluded (path or filename contains "old")' })
      continue
    }
    eligible.push(file)
  }

  const result: BulkRtuPictureImportResult = {
    totalFiles: files.length,
    excluded,
    imported: 0,
    skipped: 0,
    successes: [],
    failures: [],
    warnings: [],
    completedAt: new Date().toISOString(),
  }
  const total = eligible.length

  for (let i = 0; i < eligible.length; i++) {
    if (signal?.aborted) {
      result.cancelled = true
      break
    }

    const file = eligible[i]!
    onProgress?.({ processed: i, total, currentFile: file.name })

    const parsed = parseBulkRtuPictureFileName(file.name)
    if (!parsed) {
      result.skipped += 1
      result.failures.push({
        file: file.name,
        reason: 'Filename does not match bulk RTU pattern (e.g. 1590-RTU-04-1.jpg)',
      })
      onProgress?.({ processed: i + 1, total, currentFile: file.name })
      continue
    }

    if (!parsed.unitId || parsed.pictureIndex < 1) {
      result.skipped += 1
      result.failures.push({ file: file.name, reason: 'Invalid RTU unit or picture index in filename' })
      onProgress?.({ processed: i + 1, total, currentFile: file.name })
      continue
    }

    if (signal?.aborted) {
      result.cancelled = true
      break
    }

    const candidates = findRtuCandidates(catalog, parsed)

    if (signal?.aborted) {
      result.cancelled = true
      break
    }

    const { entry, reason } = pickRtuMatch(candidates, parsed)

    if (!entry) {
      result.skipped += 1
      result.failures.push({ file: file.name, reason: reason ?? 'No matching RTU marker' })
      onProgress?.({ processed: i + 1, total, currentFile: file.name })
      continue
    }

    try {
      const storedFileName = await importRtuPictureAtIndex(
        entry.building.address,
        entry.rtu.name,
        file,
        parsed.pictureIndex,
      )
      result.imported += 1
      result.successes.push({
        file: file.name,
        buildingAddress: entry.building.address,
        rtuName: entry.rtu.name,
        pictureIndex: parsed.pictureIndex,
        storedFileName,
      })
    } catch (e) {
      result.skipped += 1
      result.failures.push({
        file: file.name,
        reason: e instanceof Error ? e.message : 'Import failed',
      })
    }

    onProgress?.({ processed: i + 1, total, currentFile: file.name })
  }

  result.completedAt = new Date().toISOString()
  return result
}
