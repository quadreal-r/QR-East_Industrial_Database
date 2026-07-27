/** Helpers for publishing a local QR-360° tour to the insp360 Cloudflare bucket. */

/** Path noise we ignore when fuzzy-matching gate ↔ R2 keys. */
const INSP360_MATCH_STOPWORDS = new Set([
  'st',
  'street',
  'ave',
  'avenue',
  'blvd',
  'boulevard',
  'rd',
  'road',
  'dr',
  'drive',
  'ln',
  'lane',
  'ct',
  'court',
  'way',
  'blg',
  'bldg',
  'building',
  'unit',
  // "suite" is kept only when followed by a number (Suite 7) — see insp360MatchTokens
  'suite',
  'the',
  'and',
  'of',
  'a',
  'an',
])

/** URL-/path-safe slug for R2 object key segments. */
export function slugInsp360PathPart(raw: string | null | undefined): string {
  const cleaned = String(raw || '')
    .normalize('NFKD')
    .replace(/[^\w.-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()
  return cleaned || 'tour'
}

/** Timestamp suffix for versioned publishes: YYYYMMDD-HHMMSS (UTC). */
export function formatInsp360VersionStamp(date: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `-${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}`
  )
}

/**
 * Suite # / utility room label for cloud keys — prefer the gate name, not the full project file name.
 * If only a project title like "60 Birmingham St — Electrical Room" is available, strip the building.
 */
export function insp360GateTourLabel(options: {
  buildingAddress?: string | null
  suiteName?: string | null
  projectName?: string | null
}): string {
  const suite = String(options.suiteName || '').trim()
  if (suite) return suite

  let fromProject = String(options.projectName || '')
    .trim()
    .replace(/\.(insp360|zip)$/i, '')
    .replace(/__\d{8}-\d{6}$/i, '')
  if (!fromProject) return 'tour'

  const building = String(options.buildingAddress || '').trim()
  if (building) {
    const buildingSlug = slugInsp360PathPart(building)
    // "60 Birmingham St — Electrical Room" → "Electrical Room"
    const stripped = fromProject
      .replace(new RegExp(`^${escapeRegExp(building)}\\s*[—–\\-:|]+\\s*`, 'i'), '')
      .replace(new RegExp(`^${escapeRegExp(building)}\\s+`, 'i'), '')
      .trim()
    if (stripped && stripped.toLowerCase() !== fromProject.toLowerCase()) {
      fromProject = stripped
    } else {
      // Also strip a leading building slug from an already-slugged title.
      const projectSlug = slugInsp360PathPart(fromProject)
      if (projectSlug.startsWith(`${buildingSlug}-`) && projectSlug.length > buildingSlug.length + 1) {
        return projectSlug.slice(buildingSlug.length + 1).replace(/-/g, ' ')
      }
    }
  }

  return fromProject || 'tour'
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Normalize a key/path/label to hyphen tokens for fuzzy matching. */
export function insp360NormalizeMatchText(raw: string | null | undefined): string {
  return slugInsp360PathPart(
    String(raw || '')
      .replace(/\.insp360$/i, '')
      .replace(/__\d{8}-\d{6}$/i, '')
      .replace(/[\\/]+/g, '-'),
  )
}

/**
 * Tokens used for flexible gate ↔ R2 matching.
 * Keeps street numbers and words; drops fill words (St, Blg, …).
 * "Suite 7" → ["suite","7"]; "Electrical Room" → ["electrical","room"].
 */
export function insp360MatchTokens(raw: string | null | undefined): string[] {
  const slug = insp360NormalizeMatchText(raw)
  if (!slug || slug === 'tour') return []
  const parts = slug.split('-').filter(Boolean)
  const out: string[] = []
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]
    if (!p) continue
    if (/^\d+$/.test(p)) {
      out.push(p)
      continue
    }
    // Keep "suite" when followed by a number (Suite 7).
    const next = parts[i + 1]
    if (p === 'suite' && next && /^\d+$/.test(next)) {
      out.push(p)
      continue
    }
    if (INSP360_MATCH_STOPWORDS.has(p)) continue
    if (p.length < 2) continue
    out.push(p)
  }
  return out
}

/** True if `token` appears as its own hyphen segment in `haystack` (avoids suite-7 vs suite-70). */
export function insp360TokenInNormalized(haystack: string, token: string): boolean {
  const h = insp360NormalizeMatchText(haystack)
  const t = String(token || '').toLowerCase()
  if (!h || !t) return false
  const parts = h.split('-')
  return parts.includes(t)
}

/**
 * Stable stem for a gate tour (no extension, no version).
 * Always: `building-address/suite-or-utility-room`
 * Example: `60-birmingham-st-blg-1/electrical-room`
 */
export function insp360GateCloudStem(options: {
  buildingAddress?: string | null
  suiteName?: string | null
  projectName?: string | null
}): string {
  const building = slugInsp360PathPart(options.buildingAddress || 'building')
  const tour = slugInsp360PathPart(insp360GateTourLabel(options))
  return `${building}/${tour}`
}

/**
 * R2 ListObjects prefix hint for this gate.
 * Prefer the street number ("60") so both `60 Birmingham….insp360` and
 * `60-birmingham-st-blg-1/…` are returned; client filters with flexible match.
 * Pass `*` when there is no street number (list whole bucket, then filter).
 */
export function insp360GateCloudPrefix(options: {
  buildingAddress?: string | null
  suiteName?: string | null
  projectName?: string | null
}): string {
  const building = String(options.buildingAddress || '').trim()
  const digits = building.match(/\d+/)?.[0]
  if (digits) return digits
  const names = insp360MatchTokens(building).filter((t) => !/^\d+$/.test(t))
  if (names[0]) return names[0]
  return '*'
}

/**
 * True when an R2 object key belongs to this gate's building address.
 * Address match is enough (street # + distinctive street name). Suite/room
 * name is not required — e.g. any "60 Birmingham…" tour is OK at that gate.
 */
export function insp360CloudKeyMatchesGate(
  objectKey: string,
  options: {
    buildingAddress?: string | null
    suiteName?: string | null
    projectName?: string | null
  },
): boolean {
  const key = String(objectKey || '')
    .trim()
    .replace(/^\/+/, '')
    .replace(/\\/g, '/')
  if (!key.toLowerCase().endsWith('.insp360')) return false

  const keyNorm = insp360NormalizeMatchText(key)
  if (!keyNorm) return false

  const buildingRaw = String(options.buildingAddress || '').trim()
  if (!buildingRaw) return false

  // Prefer the leading street number only (ignore "Blg 1" / unit numbers).
  const streetNumber = buildingRaw.match(/^\s*(\d+)\b/)?.[1] || null
  const buildingNames = insp360MatchTokens(buildingRaw).filter((t) => !/^\d+$/.test(t))

  // Building: street # (if any) + at least one distinctive name word (e.g. birmingham).
  return (
    (streetNumber ? insp360TokenInNormalized(keyNorm, streetNumber) : true) &&
    (buildingNames.length === 0 ||
      buildingNames.some((n) => insp360TokenInNormalized(keyNorm, n)))
  )
}

/**
 * Human gate title used when checking / updating a tour name.
 * e.g. "60 Birmingham St (Blg 1) — Electrical Room"
 */
export function insp360SuggestedGateTourLabel(options: {
  buildingAddress?: string | null
  suiteName?: string | null
  title?: string | null
}): string {
  const building = String(options.buildingAddress || '').trim()
  const suite = String(options.suiteName || options.title || '').trim()
  if (building && suite) return `${building} — ${suite}`
  return suite || building || ''
}

/**
 * Short building stem for .insp360 filenames.
 * "60 Birmingham St (Blg 1)" → "60 Birmingham"
 */
export function insp360ShortBuildingFileStem(buildingAddress?: string | null): string {
  return String(buildingAddress || '')
    .replace(/\(.*?\)/g, ' ')
    .replace(/[\u2013\u2014]/g, ' ')
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(
      /\b(drive|dr|road|rd|crescent|cres|avenue|ave|street|st|boulevard|blvd|court|ct|way|lane|ln|place|pl|parkway|pkwy|circle|cir|terrace|trail|trl|gate|grove|close|row|hwy|highway|line|sideroad|concession|conc)\b/gi,
      ' ',
    )
    .replace(/\b(blg|bldg|building)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Suggested .insp360 filename when saving / renaming a tour to match the gateway.
 * e.g. "60 Birmingham Electrical Room.insp360" (not "60-Electrical Room.insp360").
 */
export function insp360SuggestedGateTourFileName(options: {
  buildingAddress?: string | null
  suiteName?: string | null
  title?: string | null
}): string {
  const stem = insp360ShortBuildingFileStem(options.buildingAddress)
  const building = String(options.buildingAddress || '').trim()
  let room = String(options.suiteName || options.title || '')
    .trim()
    .replace(/\.(insp360|zip)$/i, '')
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  if (stem && room) {
    if (building) {
      room = room
        .replace(new RegExp(`^${escapeRegExp(building)}\\s*[—–\\-:|]+\\s*`, 'i'), '')
        .trim()
    }
    room = room
      .replace(new RegExp(`^${escapeRegExp(stem)}\\s*[—–\\-:|]?\\s*`, 'i'), '')
      .replace(/^\d{1,6}[\s\-–—]+/, '')
      .trim()
    if (!room) return `${stem}.insp360`
    return `${stem} ${room}.insp360`
  }
  if (room) return /\.(insp360|zip)$/i.test(room) ? room : `${room}.insp360`
  if (stem) return `${stem}.insp360`
  return 'tour.insp360'
}

/**
 * True when an open tour's name/key looks like it belongs to this gate's building
 * (address match only — same rules as cloud list filtering).
 */
export function insp360TourNameMatchesGate(
  tourNameOrKey: string | null | undefined,
  options: {
    buildingAddress?: string | null
    suiteName?: string | null
    projectName?: string | null
  },
): boolean {
  const raw = String(tourNameOrKey || '').trim()
  if (!raw) return false
  const asKey = raw.replace(/\\/g, '/')
  const withExt = /\.insp360$/i.test(asKey) ? asKey : `${asKey.replace(/\.(zip)$/i, '')}.insp360`
  return insp360CloudKeyMatchesGate(withExt, options)
}

/**
 * Plain-language warning when a tour file does not match this gateway's address.
 * Returns null when the address matches (or gate context is incomplete).
 */
export function insp360GateTourMismatchMessage(options: {
  tourName?: string | null
  buildingAddress?: string | null
  suiteName?: string | null
  title?: string | null
}): string | null {
  const tourName = String(options.tourName || '').trim()
  const building = String(options.buildingAddress || '').trim()
  const suite = String(options.suiteName || options.title || '').trim()
  if (!tourName || !building) return null
  if (
    insp360TourNameMatchesGate(tourName, {
      buildingAddress: building,
      suiteName: suite,
      projectName: tourName,
    })
  ) {
    return null
  }
  const tourLabel = tourName
    .replace(/\\/g, '/')
    .split('/')
    .pop()!
    .replace(/\.(insp360|zip)$/i, '')
    .trim() || tourName
  const gateLabel = insp360SuggestedGateTourLabel({
    buildingAddress: building,
    suiteName: suite,
  })
  return (
    `“${tourLabel}” does not look like it belongs to this building (${building}). ` +
    `You can still view it, but do not link it here unless that is intentional.` +
    (gateLabel && gateLabel !== building ? ` Gateway: ${gateLabel}.` : '')
  )
}

/**
 * Build a relative R2 object key for a gate tour publish.
 * Default: versioned `building/suite-or-room__YYYYMMDD-HHMMSS.insp360`.
 * Pass `versioned: false` for the legacy single-slot key.
 */
export function buildInsp360PublishObjectKey(options: {
  buildingAddress?: string | null
  suiteName?: string | null
  projectName?: string | null
  /** When true (default), append a UTC timestamp so each publish is a new object. */
  versioned?: boolean
  /** Override clock for tests. */
  now?: Date
}): string {
  const stem = insp360GateCloudStem(options)
  if (options.versioned === false) return `${stem}.insp360`
  const stamp = formatInsp360VersionStamp(options.now ?? new Date())
  return `${stem}__${stamp}.insp360`
}

/**
 * Human label for a cloud key (same for all versions of a gate tour).
 * `building/tour__20260715-143022.insp360` → `tour`
 * `building/tour.insp360` → `tour`
 */
export function insp360TourDisplayName(objectKey: string): string {
  const base =
    String(objectKey || '')
      .split('/')
      .pop() || String(objectKey || '')
  return base.replace(/\.insp360$/i, '').replace(/__\d{8}-\d{6}$/i, '') || 'tour'
}

/** Prefer octet-stream for tours; JSON for pin/map sidecars. */
export function guessInsp360UploadContentType(fileName?: string | null): string {
  if (/\.tour\.json$/i.test(String(fileName || ''))) return 'application/json; charset=utf-8'
  if (/\.cover\.jpe?g$/i.test(String(fileName || ''))) return 'image/jpeg'
  return 'application/octet-stream'
}
