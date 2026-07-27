import { insp360ProjectDisplayName } from '@/lib/insp360GateHooks'
import { buildInspection360GateKey, type Inspection360GateKind } from '@/lib/insp360Viewer'
import type { PortfolioData, SuiteEntrance, Utility } from '@/types/domain'

function parseGateKey(
  gateKey: string,
):
  | { kind: Inspection360GateKind; id: number }
  | { kind: Inspection360GateKind; buildingId: string; name: string }
  | null {
  const parts = gateKey.split(':')
  const kind = parts[0]
  if (kind !== 'suite' && kind !== 'electrical' && kind !== 'sprinkler') return null
  if (parts[1] === 'tmp' && parts.length >= 4) {
    return { kind, buildingId: parts[2]!, name: parts.slice(3).join(':') }
  }
  const id = Number(parts[1])
  if (!Number.isFinite(id)) return null
  return { kind, id }
}

function suiteMatchesKey(entrance: SuiteEntrance, gateKey: string, buildingId?: number | null): boolean {
  return (
    buildInspection360GateKey('suite', entrance, entrance.building_id ?? buildingId) === gateKey
  )
}

function utilityMatchesKey(
  utility: Utility,
  kind: 'electrical' | 'sprinkler',
  gateKey: string,
): boolean {
  return buildInspection360GateKey(kind, utility) === gateKey
}

function matchesParsedSuite(
  entrance: SuiteEntrance,
  parsed: NonNullable<ReturnType<typeof parseGateKey>>,
  key: string,
): boolean {
  if ('id' in parsed) return entrance.id === parsed.id
  return suiteMatchesKey(
    entrance,
    key,
    parsed.buildingId === 'x' ? null : Number(parsed.buildingId) || null,
  )
}

function matchesParsedUtility(
  utility: Utility,
  parsed: NonNullable<ReturnType<typeof parseGateKey>>,
  key: string,
): boolean {
  if (parsed.kind !== 'electrical' && parsed.kind !== 'sprinkler') return false
  if ('id' in parsed) return utility.id === parsed.id
  return utilityMatchesKey(utility, parsed.kind, key)
}

/**
 * Set or clear the permanent Tour URL (`inspection_url`) for a gateway.
 * Returns null when nothing in the portfolio changed.
 */
export function setGateTourUrlInPortfolio(
  portfolio: PortfolioData,
  gateKey: string | null | undefined,
  inspectionUrl: string | null | undefined,
): PortfolioData | null {
  const key = String(gateKey || '').trim()
  if (!key) return null
  const parsed = parseGateKey(key)
  if (!parsed) return null
  const nextUrl = String(inspectionUrl || '').trim() || null

  if (parsed.kind === 'suite') {
    let changed = false
    const suiteEntrances = portfolio.suiteEntrances.map((entrance) => {
      if (!matchesParsedSuite(entrance, parsed, key)) return entrance
      const prev = entrance.inspection_url?.trim() || null
      if (prev === nextUrl) return entrance
      changed = true
      return { ...entrance, inspection_url: nextUrl }
    })
    return changed ? { ...portfolio, suiteEntrances } : null
  }

  let changed = false
  const utilities = portfolio.utilities.map((utility) => {
    if (!matchesParsedUtility(utility, parsed, key)) return utility
    const prev = utility.inspection_url?.trim() || null
    if (prev === nextUrl) return utility
    changed = true
    return { ...utility, inspection_url: nextUrl }
  })
  return changed ? { ...portfolio, utilities } : null
}

/** Clear the permanent Tour URL for a gateway. */
export function clearGateTourLinkInPortfolio(
  portfolio: PortfolioData,
  gateKey: string | null | undefined,
): PortfolioData | null {
  return setGateTourUrlInPortfolio(portfolio, gateKey, null)
}

/** Read the current permanent Tour URL for a gateway from live portfolio data. */
export function getGateInspectionUrlFromPortfolio(
  portfolio: PortfolioData,
  gateKey: string | null | undefined,
): string | null {
  const key = String(gateKey || '').trim()
  if (!key) return null
  const parsed = parseGateKey(key)
  if (!parsed) return null
  if (parsed.kind === 'suite') {
    const entrance = portfolio.suiteEntrances.find((item) => matchesParsedSuite(item, parsed, key))
    return entrance?.inspection_url?.trim() || null
  }
  const utility = portfolio.utilities.find((item) => matchesParsedUtility(item, parsed, key))
  return utility?.inspection_url?.trim() || null
}

/** Confirm copy when removing a local or online tour link from a gateway. */
export function insp360RemoveTourConfirmMessage(projectName: string | null | undefined): string {
  const label = insp360ProjectDisplayName(projectName) || 'this tour'
  return `Remove “${label}” from this gateway? The gate will show “Not connected yet” until you link a tour again.`
}

/** Normalize pasted cloud tour text before saving / opening. */
export function normalizeCloudTourUrlInput(raw: string): string {
  return raw.trim().replace(/^['"]|['"]$/g, '')
}
