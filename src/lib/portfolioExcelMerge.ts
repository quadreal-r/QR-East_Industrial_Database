import type { Building, Polygon, PortfolioData, Rtu, Utility } from '@/types/domain'
import { normalizePortfolioData } from '@/types/domain'
import {
  buildBuildingAddressIndex,
  findBuildingBySheetAddress,
  normalizeRtuName,
} from '@/lib/rtuMatch'
import { normalizeSuiteName, polygonForEntrance } from '@/lib/suiteEntrances'
import { buildingForPolygon, polygonCentroid } from '@/lib/polygonBuildings'

/** Sheets that drive live portfolio tables. */
export const ACTIVE_PORTFOLIO_SHEETS = [
  'Buildings',
  'RTUs',
  'Tenant Polygons',
  'Polygons',
  'Utilities',
] as const

/**
 * Sheets kept in the workbook for reference / future features but not applied
 * to portfolio tables on import.
 */
export const DORMANT_PORTFOLIO_SHEETS = ['RTU Pictures'] as const

function pathsFingerprint(paths: Polygon['paths']): string {
  return paths
    .map((p) => `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`)
    .join('|')
}

function coordsClose(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
  eps = 0.00005,
): boolean {
  return Math.abs(a.lat - b.lat) <= eps && Math.abs(a.lng - b.lng) <= eps
}

function mergeRtus(baseline: Building, imported: Building): Rtu[] {
  const claimed = new Set<number>()
  const next: Rtu[] = []

  for (const incoming of imported.rtus ?? []) {
    const target = normalizeRtuName(incoming.name)
    const existingIndex = (baseline.rtus ?? []).findIndex(
      (rtu, index) => !claimed.has(index) && normalizeRtuName(rtu.name) === target,
    )
    if (existingIndex >= 0) {
      claimed.add(existingIndex)
      const existing = baseline.rtus![existingIndex]!
      next.push({
        ...existing,
        name: incoming.name,
        description: incoming.description,
        lat: incoming.lat,
        lng: incoming.lng,
        model: incoming.model ?? existing.model,
        serial: incoming.serial ?? existing.serial,
        make: incoming.make ?? existing.make,
        install_date: incoming.install_date ?? existing.install_date,
        install_year: incoming.install_year ?? existing.install_year,
        heating_btu: incoming.heating_btu ?? existing.heating_btu,
        cooling_tons: incoming.cooling_tons ?? existing.cooling_tons,
        suite: incoming.suite ?? existing.suite,
      })
      continue
    }
    next.push({ ...incoming })
  }

  return next
}

function findMatchingPolygon(
  candidates: Polygon[],
  incoming: Polygon,
  claimed: Set<number>,
  buildingAddress: string | null,
  baselineBuildings: Building[],
): Polygon | null {
  const incomingFp = pathsFingerprint(incoming.paths)
  const incomingNorm = normalizeSuiteName(incoming.name)
  const incomingCentroid = polygonCentroid(incoming.paths)

  // Exact path match first.
  for (let i = 0; i < candidates.length; i++) {
    if (claimed.has(i)) continue
    if (pathsFingerprint(candidates[i]!.paths) === incomingFp) {
      return candidates[i]!
    }
  }

  // Same suite name on the same building (or unmatched building).
  for (let i = 0; i < candidates.length; i++) {
    if (claimed.has(i)) continue
    const candidate = candidates[i]!
    if (normalizeSuiteName(candidate.name) !== incomingNorm) continue
    const candidateBuilding = buildingForPolygon(baselineBuildings, candidate)
    if (buildingAddress && candidateBuilding && candidateBuilding.address !== buildingAddress) {
      continue
    }
    return candidate
  }

  // Same name + nearby centroid.
  for (let i = 0; i < candidates.length; i++) {
    if (claimed.has(i)) continue
    const candidate = candidates[i]!
    if (normalizeSuiteName(candidate.name) !== incomingNorm) continue
    if (coordsClose(polygonCentroid(candidate.paths), incomingCentroid, 0.0005)) {
      return candidate
    }
  }

  return null
}

function mergePolygons(baseline: PortfolioData, imported: PortfolioData): Polygon[] {
  const claimed = new Set<number>()
  const next: Polygon[] = []

  for (const incoming of imported.polygons) {
    const building = buildingForPolygon(imported.buildings, incoming)
    const match = findMatchingPolygon(
      baseline.polygons,
      incoming,
      claimed,
      building?.address ?? null,
      baseline.buildings,
    )
    if (match?.id != null) {
      const index = baseline.polygons.indexOf(match)
      if (index >= 0) claimed.add(index)
      next.push({
        ...match,
        name: incoming.name,
        description: incoming.description,
        color: incoming.color,
        paths: incoming.paths,
      })
      continue
    }
    next.push({ ...incoming })
  }

  return next
}

function mergeUtilities(baseline: PortfolioData, imported: PortfolioData): Utility[] {
  const claimed = new Set<number>()
  const next: Utility[] = []

  for (const incoming of imported.utilities) {
    const existingIndex = baseline.utilities.findIndex((utility, index) => {
      if (claimed.has(index)) return false
      if (utility.utility_type !== incoming.utility_type) return false
      if (utility.name.trim().toLowerCase() !== incoming.name.trim().toLowerCase()) return false
      return coordsClose(utility, incoming, 0.0002)
    })
    if (existingIndex >= 0) {
      claimed.add(existingIndex)
      const existing = baseline.utilities[existingIndex]!
      next.push({
        ...existing,
        name: incoming.name,
        description: incoming.description,
        lat: incoming.lat,
        lng: incoming.lng,
        utility_type: incoming.utility_type,
      })
      continue
    }
    next.push({ ...incoming })
  }

  return next
}

/**
 * Overlay an Excel-imported portfolio onto the live baseline.
 * Keeps database ids, saved map cameras, building notes, and 360° gates
 * that the workbook does not carry.
 */
export function mergePortfolioExcelImport(
  baseline: PortfolioData,
  imported: PortfolioData,
): PortfolioData {
  const addressIndex = buildBuildingAddressIndex(baseline.buildings)
  const buildings: Building[] = []

  for (const incoming of imported.buildings) {
    const existing = findBuildingBySheetAddress(addressIndex, incoming.address)
    if (existing?.id != null) {
      buildings.push({
        ...existing,
        park: incoming.park,
        address: incoming.address,
        bu: incoming.bu,
        lat: incoming.lat,
        lng: incoming.lng,
        sqft: incoming.sqft,
        cluster: incoming.cluster,
        manager: incoming.manager,
        sold: incoming.sold,
        // Excel export has no notes column — preserve whatever is in the DB.
        notes: existing.notes,
        rtus: mergeRtus(existing, incoming),
      })
      continue
    }
    buildings.push({ ...incoming })
  }

  const merged: PortfolioData = {
    buildings,
    utilities: mergeUtilities(baseline, imported),
    polygons: mergePolygons(baseline, imported),
    // Keep existing gates; normalizePortfolioData will add any missing ones.
    suiteEntrances: baseline.suiteEntrances ?? [],
    portfolioMapViews: baseline.portfolioMapViews ?? {},
  }

  const normalized = normalizePortfolioData(merged)
  return {
    ...normalized,
    // Drop gates whose polygon no longer exists after the Excel overlay.
    suiteEntrances: (normalized.suiteEntrances ?? []).filter(
      (entrance) => polygonForEntrance(normalized.polygons, entrance) != null,
    ),
  }
}

/** Sheet names that should be archived for later app features, not imported now. */
export function listDormantSheetNames(sheetNames: string[]): string[] {
  const active = new Set(ACTIVE_PORTFOLIO_SHEETS.map((name) => name.toLowerCase()))
  return sheetNames.filter((name) => !active.has(name.trim().toLowerCase()))
}
