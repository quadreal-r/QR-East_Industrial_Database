/**
 * RTU picture filename → portfolio RTU matching (review criteria 2026-06-25).
 * Applied in order; first single building+unit match wins.
 */
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

/** Non-index/year tags on filenames, e.g. (Removed), (Old). */
const PICTURE_METADATA_PAREN_RE = /\((?!(\d{4}|\d+)\))[^)]+\)\s*$/i

export function stripPictureMetadataFromRest(rest) {
  let value = rest.trim()
  while (PICTURE_METADATA_PAREN_RE.test(value)) {
    value = value.replace(PICTURE_METADATA_PAREN_RE, '').trim()
  }
  return value
}

export function hasRtuDescriptorInName(rtuName) {
  return DESCRIPTOR_PATTERNS.some((pattern) => pattern.test(rtuName))
}

export function buildingStreetNumber(address) {
  const match = address.match(/\d+/)
  if (!match) return 'unknown'
  const wing = buildingAddressWingLetter(address)
  return wing ? `${match[0]}${wing}` : match[0]
}

/** East/West wing letter: "6150 Kennedy Rd-East (A)" → E. */
export function buildingAddressWingLetter(address) {
  if (/\bEast\b/i.test(address)) return 'E'
  if (/\bWest\b/i.test(address)) return 'W'
  return null
}

/** Split site codes like "6150E" into digits + optional wing. */
export function parseBuildingSiteCode(siteCode) {
  const match = siteCode.match(/^(\d+)([A-Za-z]?)$/i)
  if (!match) return { digits: siteCode, wing: null }
  return {
    digits: match[1],
    wing: match[2] ? match[2].toUpperCase() : null,
  }
}

export function sanitizeRtuFileToken(rtuName) {
  return rtuName
    .trim()
    .replace(/\s+/g, '')
    .replace(/[^\w.-]/g, '')
}

/** Strip trailing equipment descriptors from DB RTU names (rule 5). */
export function stripRtuDescriptors(text) {
  let value = text.trim()
  for (const pattern of DESCRIPTOR_PATTERNS) {
    value = value.replace(pattern, '')
  }
  return value.trim()
}

/**
 * Normalize to unit core: number + optional letter suffix (rule 6).
 * RTU-06 / RTU-06-2024 / RTU-06 Hybrid → "6"; RTU-16A → "16A"; RTU-12B → "12B".
 * Returns null for unlabeled bulk unit 0 (rule 8).
 */
export function normalizeRtuUnitCore(input) {
  if (!input?.trim()) return null

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

/** Legacy helper — raw token after RTU/RT/S prefix (not used for final match). */
export function extractRtuUnitId(token) {
  const trimmed = token.trim()
  const prefixed = trimmed.match(/^(?:RTU?s?|RTU#|RT|S)[-_\s#]?(.+)$/i)
  const core = (prefixed?.[1] ?? trimmed).trim()
  return core.toUpperCase().replace(/\s+/g, '')
}

export function isUnlabeledBulkUnitCore(core) {
  return core == null
}

/** Audit / bulk folder names: 1590-RTU-04-2.jpg, 6150E-RTU-01-1.jpg */
export function parseBulkRtuPictureFileName(fileName) {
  const base = fileName.replace(/^.*[/\\]/, '').replace(IMAGE_FILE_RE, '')
  if (!base) return null

  const buildingMatch = base.match(/^(\d+[A-Za-z]?)[-_\s]+(.+)$/)
  if (!buildingMatch) return null

  let rest = buildingMatch[2].trim()
  rest = stripPictureMetadataFromRest(rest)
  let pictureIndex = 1
  let installYear

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

  let rtuToken
  if (parts.length === 2) {
    rtuToken = `${parts[0]}-${parts[1]}`
  } else {
    const last = parts[parts.length - 1]
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
  if (unitCore == null) {
    return {
      buildingNum: buildingMatch[1].toUpperCase(),
      rtuToken,
      unitId: extractRtuUnitId(rtuToken),
      unitCore: null,
      pictureIndex,
      requiresReview: true,
      ...(installYear != null ? { installYear } : {}),
    }
  }

  return {
    buildingNum: buildingMatch[1].toUpperCase(),
    rtuToken,
    unitId: extractRtuUnitId(rtuToken),
    unitCore,
    pictureIndex,
    requiresReview: false,
    ...(installYear != null ? { installYear } : {}),
  }
}

/** App / deploy stored names: 1590_RTU-04_(2).jpg or 6150E_RTU-01_(1).jpg */
export function parseStoredRtuPictureFileName(fileName) {
  const base = fileName.replace(/^.*[/\\]/, '')
  const match = base.match(/^(\d+[A-Za-z]?)_([^_]+)_\((\d+)\)(\.[^.]+)$/i)
  if (!match) return null
  return {
    buildingNum: match[1].toUpperCase(),
    rtuFileToken: match[2],
    pictureIndex: Number(match[3]),
  }
}

export function buildRtuCatalog(buildings) {
  const entries = []
  for (const building of buildings) {
    const streetNumber = buildingStreetNumber(building.address)
    for (const rtu of building.rtus ?? []) {
      entries.push({
        building,
        rtu,
        streetNumber,
        unitId: extractRtuUnitId(rtu.name),
        unitCore: normalizeRtuUnitCore(rtu.name),
        fileToken: sanitizeRtuFileToken(rtu.name),
      })
    }
  }
  return entries
}

function findCandidatesByCore(catalog, buildingNum, unitCore) {
  const exact = catalog.filter(
    (entry) => entry.streetNumber === buildingNum && entry.unitCore === unitCore,
  )
  if (exact.length) return exact

  const file = parseBuildingSiteCode(buildingNum)

  if (file.wing) {
    return catalog.filter(
      (entry) => entry.streetNumber === file.digits && entry.unitCore === unitCore,
    )
  }

  const siteCodes = new Set(
    catalog
      .filter((entry) => parseBuildingSiteCode(entry.streetNumber).digits === file.digits)
      .map((entry) => entry.streetNumber),
  )
  if (siteCodes.size !== 1) return []
  const onlySite = [...siteCodes][0]
  return catalog.filter(
    (entry) => entry.streetNumber === onlySite && entry.unitCore === unitCore,
  )
}

function normalizeUnitIdForMatch(unitId) {
  return unitId.replace(/^0+/, '').toUpperCase() || unitId.toUpperCase()
}

/** Score how well a portfolio RTU matches a parsed filename (building # + unit only). */
export function scoreRtuFilenameMatch(entry, parsed) {
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

/** Pick one RTU when several share the same building # and unit core (no GPS). */
export function resolveRtuCandidates(candidates, parsed) {
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

export function matchFileToRtu(catalog, fileName) {
  const stored = parseStoredRtuPictureFileName(fileName)
  if (stored) {
    const storedCore = normalizeRtuUnitCore(stored.rtuFileToken)
    const storedCandidates = storedCore
      ? findCandidatesByCore(catalog, stored.buildingNum, storedCore)
      : catalog.filter((entry) => {
          const sameSite =
            entry.streetNumber === stored.buildingNum ||
            parseBuildingSiteCode(entry.streetNumber).digits ===
              parseBuildingSiteCode(stored.buildingNum).digits
          return (
            sameSite &&
            entry.fileToken.toUpperCase() === stored.rtuFileToken.toUpperCase()
          )
        })
    if (storedCandidates.length === 1) {
      return { entry: storedCandidates[0], pictureIndex: stored.pictureIndex }
    }
    if (storedCandidates.length > 1) {
      return { error: `Ambiguous stored name (${storedCandidates.length} RTUs)` }
    }
  }

  const bulk = parseBulkRtuPictureFileName(fileName)
  if (!bulk) return { error: 'Unrecognized filename' }

  if (bulk.requiresReview || bulk.unitCore == null) {
    return { error: 'Unlabeled bulk unit (RTU-0) requires manual review' }
  }

  const candidates = findCandidatesByCore(catalog, bulk.buildingNum, bulk.unitCore)
  if (!candidates.length) {
    return { error: 'No RTU match in portfolio' }
  }

  const entry = resolveRtuCandidates(candidates, bulk)
  if (entry) {
    return { entry, pictureIndex: bulk.pictureIndex }
  }
  return { error: `Ambiguous bulk name (${candidates.length} RTUs)` }
}

/** Prefer 1590_RTU-04_(2).jpg / 100-RTU-01-1.jpg over 100-RTU-01.jpg at same index. */
export function pictureFileExplicitness(fileName) {
  if (/_\(\d+\)\.[^.]+$/i.test(fileName)) return 2
  if (/-\d+\.[^.]+$/i.test(fileName)) return 1
  return 0
}

export function shouldPreferPictureFile(incomingName, existingName) {
  return pictureFileExplicitness(incomingName) > pictureFileExplicitness(existingName)
}

export function rtuPictureKey(buildingAddress, rtuName) {
  return `${buildingAddress}|${rtuName}`
}

export function isImageFileName(fileName) {
  return IMAGE_FILE_RE.test(fileName)
}
