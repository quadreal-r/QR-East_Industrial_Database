import type { Building } from '@/types/domain'
import { resolveManagerDisplayName } from '@/lib/managerNames'

export const BUILDING_OPERATOR_SHEET = 'Building Operators'

/** Canonical on-site operators — always offered in the sidebar filter. */
export const KNOWN_BUILDING_OPERATORS = [
  'Aaron Meecham',
  'Christopher Peles',
  'Emanuel Furtado',
  'Francisco Sarmiento',
  'Michael Gregory',
  'Mohamad Tartoussi',
  'Ramesh Ramnarine',
] as const

export const BUILDING_OPERATOR_EXPORT_HEADERS = [
  'Building Address',
  'BU #',
  'Portfolio',
  'Property Manager',
  'Building Operator',
  'Operator Phone',
  'Ops Manager (Region)',
  'GM Ops',
  'VP',
] as const

export interface BuildingOperatorSheetRow {
  buildingAddress: string
  bu: string
  park: string
  propertyManager: string
  buildingOperator: string
  operatorPhone: string
  opsManager: string
  gmOps: string
  vp: string
}

function normalizeKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ')
}

/** Sidebar dropdown list: the seven known operators (stable roster). */
export function collectBuildingOperatorFilterOptions(_buildings: Building[] = []): string[] {
  return [...KNOWN_BUILDING_OPERATORS]
}

/** True when the Excel row is a real building roster entry (not a totals footer). */
export function isBuildingOperatorDataRow(row: BuildingOperatorSheetRow): boolean {
  if (!row.buildingOperator.trim() && !row.bu.trim()) return false
  if (/^buildings per operator/i.test(row.buildingAddress)) return false
  // Footer rows use the operator name in the address column and a count in BU #.
  if (!row.park.trim() && /^\d{1,3}$/.test(row.bu.trim()) && !row.propertyManager.trim()) {
    return false
  }
  return Boolean(row.bu.trim() || row.buildingAddress.trim())
}

export function parseBuildingOperatorSheetRow(row: Record<string, unknown>): BuildingOperatorSheetRow {
  const str = (value: unknown) => String(value ?? '').trim()
  return {
    buildingAddress: str(row['Building Address']),
    bu: str(row['BU #']),
    park: str(row['Portfolio']),
    propertyManager: str(row['Property Manager']),
    buildingOperator: str(row['Building Operator']),
    operatorPhone: str(row['Operator Phone']),
    opsManager: str(row['Ops Manager (Region)']),
    gmOps: str(row['GM Ops']),
    vp: str(row['VP']),
  }
}

export function buildingOperatorFieldsFromRow(row: BuildingOperatorSheetRow): Pick<
  Building,
  'buildingOperator' | 'operatorPhone' | 'opsManager' | 'gmOps' | 'vp'
> {
  return {
    buildingOperator: row.buildingOperator || null,
    operatorPhone: row.operatorPhone || null,
    opsManager: row.opsManager || null,
    gmOps: row.gmOps || null,
    vp: row.vp || null,
  }
}

/** Apply Building Operators sheet rows onto buildings, matching by BU # then address. */
export function applyBuildingOperatorSheet(
  buildings: Building[],
  rows: BuildingOperatorSheetRow[],
): Building[] {
  const dataRows = rows.filter(isBuildingOperatorDataRow)
  if (!dataRows.length) return buildings

  const byBu = new Map<string, BuildingOperatorSheetRow>()
  const byAddress = new Map<string, BuildingOperatorSheetRow>()
  for (const row of dataRows) {
    if (row.bu) byBu.set(normalizeKey(row.bu), row)
    if (row.buildingAddress) byAddress.set(normalizeKey(row.buildingAddress), row)
  }

  return buildings.map((building) => {
    const match =
      (building.bu ? byBu.get(normalizeKey(building.bu)) : undefined) ??
      byAddress.get(normalizeKey(building.address))
    if (!match) return building
    return {
      ...building,
      ...buildingOperatorFieldsFromRow(match),
    }
  })
}

/** Rows for the Excel "Building Operators" sheet. */
export function buildBuildingOperatorExportRows(
  buildings: Building[],
  managerRenames: Record<string, string> = {},
): unknown[][] {
  return [...buildings]
    .sort((a, b) => a.address.localeCompare(b.address))
    .map((building) => [
      building.address,
      building.bu ?? '',
      building.park,
      resolveManagerDisplayName(building.manager ?? '', managerRenames) || building.manager || '',
      building.buildingOperator ?? '',
      building.operatorPhone ?? '',
      building.opsManager ?? '',
      building.gmOps ?? '',
      building.vp ?? '',
    ])
}
