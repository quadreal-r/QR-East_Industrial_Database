import type { Building, Rtu } from '@/types/domain'

const INSTALL_YEAR_RE =
  /Date Installed[:\s]+(?:[A-Za-z]+ +\d+, +)?(\d{4})/i

/** Current calendar year (override in tests). */
export function currentYear(now: Date = new Date()): number {
  return now.getFullYear()
}

/** Parse install year from RTU description or use DB column when present. */
export function getRtuYear(rtu: Rtu): number | null {
  if (rtu.install_year != null) return rtu.install_year
  const match = rtu.description.match(INSTALL_YEAR_RE)
  return match ? parseInt(match[1]!, 10) : null
}

/** Age in whole years; null when install year is unknown. */
export function getRtuAge(rtu: Rtu, year: number = currentYear()): number | null {
  const installYear = getRtuYear(rtu)
  return installYear != null ? year - installYear : null
}

/**
 * Age as of a calendar year (e.g. Age Today = current year − install;
 * Age on Repl. Year = replacement year − install).
 */
export function ageAtCalendarYear(
  installYear: number | null | undefined,
  asOfYear: number | string | null | undefined,
): number | null {
  if (installYear == null) return null
  const y =
    typeof asOfYear === 'number' ? asOfYear : Number(String(asOfYear ?? '').trim())
  if (!Number.isFinite(y)) return null
  return y - installYear
}

/** Oldest RTU age on a building; 0 when none have a known year. */
export function oldestRtuAge(building: Building, year: number = currentYear()): number {
  let oldest = 0
  for (const rtu of building.rtus ?? []) {
    const age = getRtuAge(rtu, year)
    if (age != null && age > oldest) oldest = age
  }
  return oldest
}

const TON_RE = /\(\s*([\d.]+)\s*ton/i
const BTU_RE = /Cooling Capacity[:\s]*([\d,]+)\s*BTU/i

export interface RtuMeta {
  model: string
  serial: string
  make: string
  suite: string
  installed: string
  heating: string
  cooling: string
}

function pickFromDescription(desc: string, re: RegExp): string {
  const match = desc.match(re)
  return match?.[1]?.trim() ?? ''
}

/** Parse structured RTU fields from DB columns or legacy description text. */
export function parseRtuMeta(rtu: Rtu): RtuMeta {
  const desc = rtu.description
  return {
    model: rtu.model?.trim() || pickFromDescription(desc, /Model[:\s]+([^\r\n]+)/i),
    serial: rtu.serial?.trim() || pickFromDescription(desc, /Serial[:\s]+([^\r\n]+)/i),
    make: rtu.make?.trim() || pickFromDescription(desc, /Make[:\s]+([^\r\n]+)/i),
    suite: rtu.suite?.trim() || pickFromDescription(desc, /Suite[:\s]+([^\r\n]+)/i),
    installed: pickFromDescription(desc, /Date Installed[:\s]+([^\r\n]+)/i),
    heating:
      rtu.heating_btu?.trim() ||
      pickFromDescription(desc, /Heating(?: Capacity| Data)?[:\s]+([^\r\n]+)/i),
    cooling: pickFromDescription(desc, /Cooling Capacity[:\s]+([^\r\n]+)/i),
  }
}

/** Parse cooling tonnage from RTU description or DB column. */
export function rcbGetTons(rtu: Rtu): number | null {
  if (rtu.cooling_tons != null) return rtu.cooling_tons

  const desc = rtu.description
  const tonMatch = desc.match(TON_RE)
  if (tonMatch) return parseFloat(tonMatch[1]!)

  const btuMatch = desc.match(BTU_RE)
  if (btuMatch) {
    const btu = parseInt(btuMatch[1]!.replace(/,/g, ''), 10)
    if (btu) return Math.round((btu / 12000) * 10) / 10
  }

  return null
}
