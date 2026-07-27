/**
 * RTU picture filename → portfolio RTU matching (review criteria 2026-06-25).
 * Mirrors scripts/lib/rtu-picture-match.mjs for app bulk import.
 */

import type { Building, Rtu } from '@/types/domain'

const IMAGE_FILE_RE = /\.(jpe?g|png|webp|heif|heic|tif{1,2})$/i
const RTU_PREFIX_RE = /^(?:RTU?s?|RTU#|RT|S)[-_\s#]*/i
const YEAR_TOKEN_RE = /(?:^|[-_\s])(19\d{2}|20\d{2})(?=$|[-_\s])/g

const DESCRIPTOR_PATTERNS = [
  /(?:\s+|-)hybrid\b/gi,
  /\s+cooling\s+only\b/gi,
  /\s*\(\s*air\s+heater\s*\)/gi,
  /\s*\(\s*no\s+label\s*\)/gi,
  /\s*\(\s*split\s+ac\s+unit\s*\)/gi,
  /\s*\(\s*tenant\s*\)/gi,
  /\s+ml\b/gi,
  /\s+dx\s+cooling.*$/gi,
  /\s+electric\s+only.*$/gi,
  /\s+heat\s+pump.*$/gi,
]

const PICTURE_METADATA_PAREN_RE = /\((?!(\d{4}|\d+)\))[^)]+\)\s*$/i

export function stripPictureMetadataFromRest(rest: string): string {
  let value = rest.trim()
  while (PICTURE_METADATA_PAREN_RE.test(value)) {
    value = value.replace(PICTURE_METADATA_PAREN_RE, '').trim()
  }
  return value
}

export function hasRtuDescriptorInName(rtuName: string): boolean {
  return DESCRIPTOR_PATTERNS.some((pattern) => pattern.test(rtuName))
}

export interface ParsedBulkRtuFileName {
  buildingNum: string
  rtuToken: string
  unitId: string
  unitCore: string | null
  pictureIndex: number
  requiresReview: boolean
  installYear?: number
}

export interface RtuCatalogEntry {
  building: Building
  rtu: Rtu
  streetNumber: string
  unitId: string
  unitCore: string | null
}

export function stripRtuDescriptors(text: string): string {
  let value = text.trim()
  for (const pattern of DESCRIPTOR_PATTERNS) {
    value = value.replace(pattern, '')
  }
  return value.trim()
}

export function normalizeRtuUnitCore(input: string): string | null {
  if (!input.trim()) return null

  let token = stripRtuDescriptors(input)
  token = token.replace(RTU_PREFIX_RE, '')
  token = token.replace(/\([^)]*\)/g, ' ')
  token = token.replace(YEAR_TOKEN_RE, ' ')
  token = token.replace(/[-_\s]+/g, ' ').trim()

  if (!token) return null
  if (/^0+$/i.test(token.replace(/\s/g, ''))) return null

  const match =
    token.match(/^0*(\d+)([A-Za-z]\w*)?$/) ?? token.match(/^(\d+[A-Za-z]\w*)$/)
  if (!match) return null

  const numeric = String(Number(match[1]))
  const suffix = (match[2] ?? '').toUpperCase()
  return `${numeric}${suffix}`
}

export function extractRtuUnitId(token: string): string {
  const trimmed = token.trim()
  const prefixed = trimmed.match(/^(?:RTU?s?|RTU#|RT|S)[-_\s#]?(.+)$/i)
  const core = (prefixed?.[1] ?? trimmed).trim()
  return core.toUpperCase().replace(/\s+/g, '')
}

export function isUnlabeledBulkUnitCore(core: string | null): boolean {
  return core == null
}

/**
 * East/West wing letter from addresses like "6150 Kennedy Rd-East (A)" → E.
 * Used so picture filenames can be `6150E-RTU-…` / `6150W-RTU-…`.
 */
export function buildingAddressWingLetter(address: string): 'E' | 'W' | null {
  if (/\bEast\b/i.test(address)) return 'E'
  if (/\bWest\b/i.test(address)) return 'W'
  return null
}

/**
 * Site code for picture filenames: street digits plus optional wing letter.
 * "1590 South Gateway Rd." → "1590"; "6150 Kennedy Rd-East (A)" → "6150E".
 */
export function buildingStreetNumber(address: string): string {
  const match = address.match(/\d+/)
  if (!match) return 'unknown'
  const wing = buildingAddressWingLetter(address)
  return wing ? `${match[0]}${wing}` : match[0]!
}

/** Split site codes like "6150E" into digits + optional wing. */
export function parseBuildingSiteCode(siteCode: string): {
  digits: string
  wing: string | null
} {
  const match = siteCode.match(/^(\d+)([A-Za-z]?)$/i)
  if (!match) return { digits: siteCode, wing: null }
  return {
    digits: match[1]!,
    wing: match[2] ? match[2]!.toUpperCase() : null,
  }
}

export function parseBulkRtuPictureFileName(fileName: string): ParsedBulkRtuFileName | null {
  const base = fileName.replace(/^.*[/\\]/, '').replace(IMAGE_FILE_RE, '')
  if (!base) return null

  // Optional wing letter after street # (6150E-RTU-01…, 6150W-RTU-01…).
  const buildingMatch = base.match(/^(\d+[A-Za-z]?)[-_\s]+(.+)$/)
  if (!buildingMatch) return null

  let rest = buildingMatch[2]!.trim()
  rest = stripPictureMetadataFromRest(rest)
  let pictureIndex = 1
  let installYear: number | undefined

  const parenYear = rest.match(/\((\d{4})\)\s*$/)
  if (parenYear) {
    installYear = Number(parenYear[1])
    rest = rest.slice(0, parenYear.index).trim()
  }

  const parenIndex = rest.match(/\((\d+)\)\s*$/)
  if (parenIndex) {
    pictureIndex = Number(parenIndex[1])
    rest = rest.slice(0, parenIndex.index).trim()
  }

  rest = stripPictureMetadataFromRest(rest)

  if (!/^(?:RTU?s?|RTU#|RT|S)/i.test(rest)) return null

  const parts = rest.split(/[-_\s]+/)
  if (parts.length < 2) return null

  let rtuToken: string
  if (parts.length === 2) {
    rtuToken = `${parts[0]}-${parts[1]}`
  } else {
    const last = parts[parts.length - 1]!
    const lastNum = Number(last)
    const isYear = last.length === 4 && lastNum >= 1900 && lastNum <= 2100
    const isIndex = !isYear && /^\d+$/.test(last)

    if (isYear) {
      installYear = lastNum
      rtuToken = parts.slice(0, -1).join('-')
      pictureIndex = 1
    } else if (isIndex) {
      pictureIndex = lastNum
      rtuToken = parts.slice(0, -1).join('-')
    } else {
      rtuToken = parts.join('-')
    }
  }

  const unitCore = normalizeRtuUnitCore(rtuToken)

  return {
    buildingNum: buildingMatch[1]!.toUpperCase(),
    rtuToken,
    unitId: extractRtuUnitId(rtuToken),
    unitCore,
    pictureIndex,
    requiresReview: unitCore == null,
    ...(installYear != null ? { installYear } : {}),
  }
}

export function buildRtuCatalog(
  buildings: Building[],
): RtuCatalogEntry[] {
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

/**
 * Resolve catalog rows for a parsed filename site code.
 * Exact match preferred; also bridges bare `6150` ↔ winged `6150E` during rename.
 */
export function findRtuCandidates(
  catalog: RtuCatalogEntry[],
  parsed: ParsedBulkRtuFileName,
): RtuCatalogEntry[] {
  if (parsed.requiresReview || parsed.unitCore == null) return []

  const exact = catalog.filter(
    (entry) =>
      entry.streetNumber === parsed.buildingNum && entry.unitCore === parsed.unitCore,
  )
  if (exact.length) return exact

  const file = parseBuildingSiteCode(parsed.buildingNum)

  // File has wing (6150E); portfolio still bare (6150).
  if (file.wing) {
    return catalog.filter(
      (entry) =>
        entry.streetNumber === file.digits && entry.unitCore === parsed.unitCore,
    )
  }

  // File bare (6150); portfolio has wing(s). Only match when a single site exists.
  const siteCodes = new Set(
    catalog
      .filter((entry) => parseBuildingSiteCode(entry.streetNumber).digits === file.digits)
      .map((entry) => entry.streetNumber),
  )
  if (siteCodes.size !== 1) return []
  const onlySite = [...siteCodes][0]!
  return catalog.filter(
    (entry) => entry.streetNumber === onlySite && entry.unitCore === parsed.unitCore,
  )
}

function normalizeUnitIdForMatch(unitId: string): string {
  return unitId.replace(/^0+/, '').toUpperCase() || unitId.toUpperCase()
}

export function scoreRtuFilenameMatch(
  entry: RtuCatalogEntry,
  parsed: ParsedBulkRtuFileName,
): number {
  if (entry.unitCore !== parsed.unitCore) return -1

  const dbId = extractRtuUnitId(stripRtuDescriptors(entry.rtu.name))
  const fileId = parsed.unitId
  let score = 80

  if (dbId === fileId) score += 20
  else if (normalizeUnitIdForMatch(dbId) === normalizeUnitIdForMatch(fileId)) score += 10
  else if (
    parsed.unitCore != null &&
    normalizeUnitIdForMatch(dbId) === normalizeUnitIdForMatch(parsed.unitCore)
  ) {
    score += 10
  }

  const fileHasHybrid = /hybrid/i.test(parsed.rtuToken)
  const dbHasHybrid = hasRtuDescriptorInName(entry.rtu.name)
  if (dbHasHybrid && !fileHasHybrid) score -= 25

  return score
}

export function resolveRtuCandidates(
  candidates: RtuCatalogEntry[],
  parsed: ParsedBulkRtuFileName,
): RtuCatalogEntry | null {
  if (!candidates.length) return null

  const scored = candidates
    .map((entry) => ({ entry, score: scoreRtuFilenameMatch(entry, parsed) }))
    .filter((row) => row.score >= 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      const aDesc = hasRtuDescriptorInName(a.entry.rtu.name) ? 1 : 0
      const bDesc = hasRtuDescriptorInName(b.entry.rtu.name) ? 1 : 0
      if (aDesc !== bDesc) return aDesc - bDesc
      return a.entry.rtu.name.localeCompare(b.entry.rtu.name)
    })

  return scored[0]?.entry ?? null
}

export function matchFileToRtu(
  catalog: RtuCatalogEntry[],
  fileName: string,
): { entry?: RtuCatalogEntry; pictureIndex?: number; error?: string } {
  const bulk = parseBulkRtuPictureFileName(fileName)
  if (!bulk) return { error: 'Unrecognized filename' }
  if (bulk.requiresReview || bulk.unitCore == null) {
    return { error: 'Unlabeled bulk unit (RTU-0) requires manual review' }
  }

  const candidates = findRtuCandidates(catalog, bulk)
  const entry = resolveRtuCandidates(candidates, bulk)
  if (entry) {
    return { entry, pictureIndex: bulk.pictureIndex }
  }
  if (!candidates.length) return { error: 'No RTU match in portfolio' }
  return { error: `Ambiguous bulk name (${candidates.length} RTUs)` }
}
