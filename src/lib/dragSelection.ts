import type { LayerKey, PortfolioData, Rtu, Utility, UtilityType } from '@/types/domain'
import { UTILITY_LAYER_MAP } from '@/lib/constants'
import { findSuiteEntrance, matchesSuiteEntrance } from '@/lib/suiteEntrances'

export type DragItemKind = 'building' | 'detail' | 'polygon' | 'utility'

export function buildingDragKey(address: string): string {
  return `building:${address}`
}

export function detailDragKey(
  layerKey: LayerKey,
  name: string,
  buildingAddress?: string | null,
): string {
  return `detail:${layerKey}:${name}:${buildingAddress ?? ''}`
}

export function utilityDragKey(
  utility: Pick<Utility, 'utility_type' | 'name' | 'description'>,
): string {
  return `utility:${utility.utility_type}\0${utility.description}\0${utility.name}`
}

export function matchesUtility(
  a: Pick<Utility, 'utility_type' | 'name' | 'description'>,
  b: Pick<Utility, 'utility_type' | 'name' | 'description'>,
): boolean {
  return (
    a.utility_type === b.utility_type &&
    a.name === b.name &&
    a.description === b.description
  )
}

export function polygonDragKey(name: string, description: string): string {
  return `polygon:${name}\0${description}`
}

function parseUtilityDragKey(
  key: string,
): { utility_type: UtilityType; description: string; name: string } | null {
  if (!key.startsWith('utility:')) return null
  const raw = key.slice('utility:'.length)
  const parts = raw.split('\0')
  if (parts.length < 3) return null
  return {
    utility_type: parts[0] as UtilityType,
    description: parts[1]!,
    name: parts[2]!,
  }
}

export function parseDragKey(key: string): { kind: DragItemKind; parts: string[] } | null {
  if (key.startsWith('building:')) {
    return { kind: 'building', parts: [key.slice('building:'.length)] }
  }
  if (key.startsWith('utility:')) {
    const utility = parseUtilityDragKey(key)
    if (!utility) return null
    return {
      kind: 'utility',
      parts: [utility.utility_type, utility.description, utility.name],
    }
  }
  if (key.startsWith('polygon:')) {
    const raw = key.slice('polygon:'.length)
    const sep = raw.indexOf('\0')
    if (sep < 0) return null
    return { kind: 'polygon', parts: [raw.slice(0, sep), raw.slice(sep + 1)] }
  }
  if (key.startsWith('detail:')) {
    const parts = key.slice('detail:'.length).split(':')
    if (parts.length < 2) return null
    const layerKey = parts[0]!
    const name = parts[1]!
    const buildingAddress = parts.slice(2).join(':')
    return { kind: 'detail', parts: [layerKey, name, buildingAddress] }
  }
  return null
}

export interface GroupDragSnapshot {
  buildings: Record<string, { lat: number; lng: number }>
  details: Array<{
    key: string
    layerKey: LayerKey
    name: string
    buildingAddress: string
    utilityType?: UtilityType
    utilityDescription?: string
    lat: number
    lng: number
  }>
  polygons: Record<string, { paths: Array<{ lat: number; lng: number }> }>
}

export function buildGroupDragSnapshot(
  portfolio: PortfolioData,
  keys: string[],
): GroupDragSnapshot {
  const snapshot: GroupDragSnapshot = {
    buildings: {},
    details: [],
    polygons: {},
  }

  for (const key of keys) {
    const parsed = parseDragKey(key)
    if (!parsed) continue

    if (parsed.kind === 'building') {
      const address = parsed.parts[0]!
      const building = portfolio.buildings.find((b) => b.address === address)
      if (building) snapshot.buildings[address] = { lat: building.lat, lng: building.lng }
      continue
    }

    if (parsed.kind === 'polygon') {
      const [name, description] = parsed.parts
      const polygon = portfolio.polygons.find((p) => p.name === name && p.description === description)
      if (polygon) {
        snapshot.polygons[key] = {
          paths: polygon.paths.map((pt) => ({ lat: pt.lat, lng: pt.lng })),
        }
      }
      continue
    }

    if (parsed.kind === 'utility') {
      const [utilityType, description, name] = parsed.parts as [UtilityType, string, string]
      const utility = portfolio.utilities.find((u) =>
        matchesUtility(u, { utility_type: utilityType, description, name }),
      )
      if (utility) {
        snapshot.details.push({
          key,
          layerKey: UTILITY_LAYER_MAP[utility.utility_type],
          name: utility.name,
          buildingAddress: '',
          utilityType: utility.utility_type,
          utilityDescription: utility.description,
          lat: utility.lat,
          lng: utility.lng,
        })
      }
      continue
    }

    const [layerKey, name, buildingAddress] = parsed.parts as [LayerKey, string, string]
    if (layerKey === 'inspection360') {
      const building = buildingAddress
        ? portfolio.buildings.find((b) => b.address === buildingAddress)
        : undefined
      const entrance =
        findSuiteEntrance(portfolio.suiteEntrances ?? [], {
          name,
          building_id: building?.id,
        }) ??
        (portfolio.suiteEntrances ?? []).find((item) =>
          matchesSuiteEntrance(item, { name, building_id: item.building_id }),
        )
      if (entrance) {
        const resolvedBuilding =
          building ??
          (entrance.building_id != null
            ? portfolio.buildings.find((b) => b.id === entrance.building_id)
            : undefined)
        snapshot.details.push({
          key,
          layerKey,
          name: entrance.name,
          buildingAddress: resolvedBuilding?.address ?? buildingAddress,
          lat: entrance.lat,
          lng: entrance.lng,
        })
      }
      continue
    }

    if (layerKey === 'rtu' && buildingAddress) {
      const building = portfolio.buildings.find((b) => b.address === buildingAddress)
      const rtu = building?.rtus?.find((r) => r.name === name)
      if (rtu) {
        snapshot.details.push({
          key,
          layerKey,
          name,
          buildingAddress,
          lat: rtu.lat,
          lng: rtu.lng,
        })
      }
      continue
    }
  }

  return snapshot
}

export function applyDeltaToSnapshot(
  snapshot: GroupDragSnapshot,
  dLat: number,
  dLng: number,
): GroupDragSnapshot {
  const buildings: GroupDragSnapshot['buildings'] = {}
  for (const [address, pos] of Object.entries(snapshot.buildings)) {
    buildings[address] = { lat: pos.lat + dLat, lng: pos.lng + dLng }
  }

  const details = snapshot.details.map((item) => ({
    ...item,
    lat: item.lat + dLat,
    lng: item.lng + dLng,
  }))

  const polygons: GroupDragSnapshot['polygons'] = {}
  for (const [key, poly] of Object.entries(snapshot.polygons)) {
    polygons[key] = {
      paths: poly.paths.map((pt) => ({ lat: pt.lat + dLat, lng: pt.lng + dLng })),
    }
  }

  return { buildings, details, polygons }
}

export function applySnapshotToPortfolio(
  portfolio: PortfolioData,
  snapshot: GroupDragSnapshot,
): PortfolioData {
  let buildings = portfolio.buildings
  let utilities = portfolio.utilities
  let polygons = portfolio.polygons
  let suiteEntrances = portfolio.suiteEntrances ?? []

  if (Object.keys(snapshot.buildings).length > 0) {
    buildings = buildings.map((b) => {
      const pos = snapshot.buildings[b.address]
      return pos ? { ...b, lat: pos.lat, lng: pos.lng } : b
    })
  }

  if (snapshot.details.length > 0) {
    for (const item of snapshot.details) {
      if (item.layerKey === 'rtu' && item.buildingAddress) {
        buildings = buildings.map((b) => {
          if (b.address !== item.buildingAddress) return b
          return {
            ...b,
            rtus: b.rtus?.map((r: Rtu) =>
              r.name === item.name ? { ...r, lat: item.lat, lng: item.lng } : r,
            ),
          }
        })
      } else if (item.layerKey === 'inspection360') {
        const building = item.buildingAddress
          ? portfolio.buildings.find((b) => b.address === item.buildingAddress)
          : undefined
        const target =
          findSuiteEntrance(suiteEntrances, {
            name: item.name,
            building_id: building?.id,
          }) ??
          suiteEntrances.find((entrance) =>
            matchesSuiteEntrance(entrance, { name: item.name, building_id: entrance.building_id }),
          )
        if (target) {
          suiteEntrances = suiteEntrances.map((entrance) =>
            matchesSuiteEntrance(entrance, target)
              ? { ...entrance, lat: item.lat, lng: item.lng, auto_placed: false }
              : entrance,
          )
        }
      } else if (item.utilityType != null) {
        utilities = utilities.map((u) =>
          matchesUtility(u, {
            utility_type: item.utilityType!,
            name: item.name,
            description: item.utilityDescription ?? '',
          })
            ? { ...u, lat: item.lat, lng: item.lng }
            : u,
        )
      }
    }
  }

  if (Object.keys(snapshot.polygons).length > 0) {
    polygons = polygons.map((p) => {
      const key = polygonDragKey(p.name, p.description)
      const next = snapshot.polygons[key]
      return next ? { ...p, paths: next.paths } : p
    })
  }

  return { ...portfolio, buildings, utilities, polygons, suiteEntrances }
}

export function cloneSnapshot(snapshot: GroupDragSnapshot): GroupDragSnapshot {
  return {
    buildings: { ...snapshot.buildings },
    details: snapshot.details.map((item) => ({ ...item })),
    polygons: Object.fromEntries(
      Object.entries(snapshot.polygons).map(([key, poly]) => [
        key,
        { paths: poly.paths.map((pt) => ({ ...pt })) },
      ]),
    ),
  }
}
