/** Capex Approved / Submitted / Rejected — building Capex pots only (not RTUs). */

export const CAPEX_STATUS_SEARCH_LABELS = ['Approved', 'Submitted', 'Rejected'] as const

export type CapexStatusSearchLabel = (typeof CAPEX_STATUS_SEARCH_LABELS)[number]

export interface CapexStatusSearchQuery {
  label: CapexStatusSearchLabel
  /** Optional Capex year, e.g. from `Approved, 2027`. */
  year: string | null
}

function normalizeStatusToken(token: string): CapexStatusSearchLabel | null {
  const q = token.trim().toLowerCase()
  if (q === 'approved') return 'Approved'
  if (q === 'submitted') return 'Submitted'
  if (q === 'rejected') return 'Rejected'
  return null
}

/**
 * Capex status search from the global box (filters buildings by Capex pot status).
 * - `Approved` / `Submitted` / `Rejected`
 * - `Approved, 2027` (optional year — buildings with that Capex pot year only)
 */
export function parseCapexStatusSearchQuery(search: string): CapexStatusSearchQuery | null {
  const raw = search.trim()
  if (!raw) return null

  const withComma = raw.match(/^(approved|submitted|rejected)\s*,\s*(20\d{2})\s*$/i)
  if (withComma?.[1] && withComma[2]) {
    const label = normalizeStatusToken(withComma[1])
    if (label) return { label, year: withComma[2] }
  }

  const withSpace = raw.match(/^(approved|submitted|rejected)\s+(20\d{2})\s*$/i)
  if (withSpace?.[1] && withSpace[2]) {
    const label = normalizeStatusToken(withSpace[1])
    if (label) return { label, year: withSpace[2] }
  }

  const labelOnly = normalizeStatusToken(raw)
  if (labelOnly) return { label: labelOnly, year: null }

  return null
}

/** Status label only (`Approved` / …); also matches `Approved, 2027`. */
export function parseCapexStatusSearch(search: string): CapexStatusSearchLabel | null {
  return parseCapexStatusSearchQuery(search)?.label ?? null
}

export function isCapexStatusSearch(search: string): boolean {
  return parseCapexStatusSearchQuery(search) != null
}

/** True when a stored Capex status (possibly "Approved / Submitted") includes the label. */
export function capexStatusIncludesLabel(stored: string, label: CapexStatusSearchLabel): boolean {
  const needle = label.toLowerCase()
  return stored
    .split('/')
    .map((part) => part.trim().toLowerCase())
    .some((part) => part === needle)
}

/** Building has at least one Capex pot year with the searched status (and year, if given). */
export function buildingMatchesCapexStatusSearch(
  address: string,
  label: CapexStatusSearchLabel,
  statuses: Record<string, string>,
  year: string | null = null,
): boolean {
  return matchingCapexStatusYears(address, label, statuses, year).length > 0
}

/** Pot years for a building that carry the searched Capex status. */
export function matchingCapexStatusYears(
  address: string,
  label: CapexStatusSearchLabel,
  statuses: Record<string, string>,
  year: string | null = null,
): string[] {
  const prefix = `${address}::`
  const years: string[] = []
  for (const [key, status] of Object.entries(statuses)) {
    if (!key.startsWith(prefix)) continue
    if (!capexStatusIncludesLabel(status, label)) continue
    const potYear = key.slice(prefix.length)
    if (!/^\d{4}$/.test(potYear)) continue
    if (year && potYear !== year) continue
    years.push(potYear)
  }
  return years.sort((a, b) => Number(a) - Number(b))
}
