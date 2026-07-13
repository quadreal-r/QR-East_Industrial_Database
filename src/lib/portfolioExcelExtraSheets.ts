import type { Building, PortfolioData, SuiteEntrance, Utility } from '@/types/domain'
import {
  findNearestBuildingByDistance,
  nearestBuilding,
} from '@/lib/polygonBuildings'
import { buildingForEntrance } from '@/lib/suiteEntrances'
import { buildBuildingOperatorExportRows, BUILDING_OPERATOR_EXPORT_HEADERS } from '@/lib/buildingOperators'

export { BUILDING_OPERATOR_EXPORT_HEADERS, buildBuildingOperatorExportRows }

export const GATEWAY_EXPORT_HEADERS = [
  'Kind',
  'Building Address',
  'Name',
  'Description',
  'Latitude',
  'Longitude',
  'Inspection URL',
  'Auto Placed',
  'Polygon Id',
  'Id',
] as const

function gatewayKindForUtility(utility: Utility): 'Electrical' | 'Sprinkler' | null {
  if (utility.utility_type === 'Electrical Rooms') return 'Electrical'
  if (utility.utility_type === 'Sprinkler Rooms') return 'Sprinkler'
  return null
}

function suiteBuildingAddress(buildings: Building[], entrance: SuiteEntrance): string {
  const linked = buildingForEntrance(buildings, entrance)
  if (linked?.address) return linked.address
  return nearestBuilding(buildings, entrance.lat, entrance.lng)?.address ?? ''
}

function autoPlacedLabel(value: boolean | undefined): string {
  if (value === true) return 'Yes'
  if (value === false) return 'No'
  return ''
}

/** Rows for the Excel "360 Gateways" sheet (suite + electrical + sprinkler). */
export function build360GatewayExportRows(data: PortfolioData): unknown[][] {
  const buildings = data.buildings
  const rows: unknown[][] = []

  for (const entrance of data.suiteEntrances ?? []) {
    rows.push([
      'Suite',
      suiteBuildingAddress(buildings, entrance),
      entrance.name,
      entrance.description ?? '',
      parseFloat(entrance.lat.toFixed(7)),
      parseFloat(entrance.lng.toFixed(7)),
      entrance.inspection_url ?? '',
      autoPlacedLabel(entrance.auto_placed),
      entrance.polygon_id ?? '',
      entrance.id ?? '',
    ])
  }

  for (const utility of data.utilities ?? []) {
    const kind = gatewayKindForUtility(utility)
    if (!kind) continue
    const nearest = findNearestBuildingByDistance(buildings, utility.lat, utility.lng)
    rows.push([
      kind,
      nearest?.building.address ?? '',
      utility.name,
      utility.description ?? '',
      parseFloat(utility.lat.toFixed(7)),
      parseFloat(utility.lng.toFixed(7)),
      utility.inspection_url ?? '',
      '',
      '',
      utility.id ?? '',
    ])
  }

  rows.sort((a, b) => {
    const kindCmp = String(a[0]).localeCompare(String(b[0]))
    if (kindCmp) return kindCmp
    const addressCmp = String(a[1]).localeCompare(String(b[1]))
    if (addressCmp) return addressCmp
    return String(a[2]).localeCompare(String(b[2]))
  })

  return rows
}
