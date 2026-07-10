import type { Building, LatLng, Polygon } from '@/types/domain'
import { polygonCentroid } from '@/lib/polygonBuildings'

type FacadeSide = 'north' | 'south' | 'east' | 'west'

interface Bounds {
  north: number
  south: number
  east: number
  west: number
}

interface Edge {
  start: LatLng
  end: LatLng
  midpoint: LatLng
  lengthSq: number
}

function polygonEdges(paths: LatLng[]): Edge[] {
  if (paths.length < 2) return []
  const edges: Edge[] = []
  for (let i = 0; i < paths.length; i++) {
    const start = paths[i]!
    const end = paths[(i + 1) % paths.length]!
    edges.push({
      start,
      end,
      midpoint: { lat: (start.lat + end.lat) / 2, lng: (start.lng + end.lng) / 2 },
      lengthSq: (start.lat - end.lat) ** 2 + (start.lng - end.lng) ** 2,
    })
  }
  return edges
}

function buildingAnchor(building: Building): LatLng {
  if (Number.isFinite(building.lat) && Number.isFinite(building.lng)) {
    return { lat: building.lat, lng: building.lng }
  }
  return { lat: 0, lng: 0 }
}

function boundsOfPolygons(polygons: Polygon[]): Bounds {
  let north = -Infinity
  let south = Infinity
  let east = -Infinity
  let west = Infinity
  for (const polygon of polygons) {
    for (const point of polygon.paths) {
      north = Math.max(north, point.lat)
      south = Math.min(south, point.lat)
      east = Math.max(east, point.lng)
      west = Math.min(west, point.lng)
    }
  }
  return { north, south, east, west }
}

function boundsOfPolygon(paths: LatLng[]): Bounds {
  return boundsOfPolygons([{ paths, name: '', description: '', color: '' }])
}

function edgeTolerance(bounds: Bounds): number {
  const span = Math.max(bounds.north - bounds.south, bounds.east - bounds.west, 1e-9)
  return span * 0.02
}

function distanceToFacadeSide(point: LatLng, side: FacadeSide, bounds: Bounds): number {
  switch (side) {
    case 'north':
      return bounds.north - point.lat
    case 'south':
      return point.lat - bounds.south
    case 'east':
      return bounds.east - point.lng
    case 'west':
      return point.lng - bounds.west
  }
}

function edgeOnFacadeSide(edge: Edge, side: FacadeSide, bounds: Bounds, tolerance: number): boolean {
  return (
    distanceToFacadeSide(edge.start, side, bounds) <= tolerance &&
    distanceToFacadeSide(edge.end, side, bounds) <= tolerance
  )
}

function pointsClose(a: LatLng, b: LatLng, tolerance: number): boolean {
  return Math.abs(a.lat - b.lat) <= tolerance && Math.abs(a.lng - b.lng) <= tolerance
}

function edgesMatch(a: Edge, b: Edge, tolerance: number): boolean {
  return (
    (pointsClose(a.start, b.start, tolerance) && pointsClose(a.end, b.end, tolerance)) ||
    (pointsClose(a.start, b.end, tolerance) && pointsClose(a.end, b.start, tolerance))
  )
}

function isSharedInteriorEdge(
  edge: Edge,
  polygon: Polygon,
  siblings: Polygon[],
  tolerance: number,
): boolean {
  for (const sibling of siblings) {
    if (sibling === polygon) continue
    if (sibling.id != null && polygon.id != null && sibling.id === polygon.id) continue
    for (const otherEdge of polygonEdges(sibling.paths)) {
      if (edgesMatch(edge, otherEdge, tolerance)) return true
    }
  }
  return false
}

function connectedComponent(polygon: Polygon, siblings: Polygon[], tolerance: number): Polygon[] {
  const component: Polygon[] = []
  const queue: Polygon[] = [polygon]
  const seen = new Set<Polygon>()

  while (queue.length) {
    const current = queue.shift()!
    if (seen.has(current)) continue
    seen.add(current)
    component.push(current)

    for (const candidate of siblings) {
      if (seen.has(candidate)) continue
      let touches = false
      for (const edge of polygonEdges(current.paths)) {
        for (const otherEdge of polygonEdges(candidate.paths)) {
          if (edgesMatch(edge, otherEdge, tolerance)) {
            touches = true
            break
          }
        }
        if (touches) break
      }
      if (touches) queue.push(candidate)
    }
  }

  return component
}

function boundsSeparation(a: Bounds, b: Bounds): number {
  const latGap = Math.max(0, Math.max(a.south - b.north, b.south - a.north))
  const lngGap = Math.max(0, Math.max(a.west - b.east, b.west - a.east))
  return Math.max(latGap, lngGap)
}

function separatedWingPolygons(component: Polygon[], allSiblings: Polygon[], tolerance: number): Polygon[] {
  const componentSet = new Set(component)
  const componentBounds = boundsOfPolygons(component)
  return allSiblings.filter((polygon) => {
    if (componentSet.has(polygon)) return false
    const gap = boundsSeparation(componentBounds, boundsOfPolygons([polygon]))
    return gap > tolerance
  })
}

function exteriorPerimeterOnSide(
  component: Polygon[],
  siblings: Polygon[],
  side: FacadeSide,
  bounds: Bounds,
  tolerance: number,
): number {
  let total = 0
  for (const polygon of component) {
    for (const edge of polygonEdges(polygon.paths)) {
      if (isSharedInteriorEdge(edge, polygon, siblings, tolerance)) continue
      if (edgeOnFacadeSide(edge, side, bounds, tolerance)) {
        total += Math.sqrt(edge.lengthSq)
      }
    }
  }
  return total
}

function facadeSideCenter(side: FacadeSide, bounds: Bounds): LatLng {
  switch (side) {
    case 'north':
      return { lat: bounds.north, lng: (bounds.east + bounds.west) / 2 }
    case 'south':
      return { lat: bounds.south, lng: (bounds.east + bounds.west) / 2 }
    case 'east':
      return { lat: (bounds.north + bounds.south) / 2, lng: bounds.east }
    case 'west':
      return { lat: (bounds.north + bounds.south) / 2, lng: bounds.west }
  }
}

function outwardDistanceFromCenter(side: FacadeSide, bounds: Bounds): number {
  const center = {
    lat: (bounds.north + bounds.south) / 2,
    lng: (bounds.east + bounds.west) / 2,
  }
  switch (side) {
    case 'north':
      return bounds.north - center.lat
    case 'south':
      return center.lat - bounds.south
    case 'east':
      return bounds.east - center.lng
    case 'west':
      return center.lng - bounds.west
  }
}

function pickFacadeSideForComponent(
  component: Polygon[],
  allSiblings: Polygon[],
  anchor: LatLng,
): FacadeSide {
  const bounds = boundsOfPolygons(component)
  const tolerance = edgeTolerance(bounds)
  const separatedWings = separatedWingPolygons(component, allSiblings, tolerance)
  const sides: FacadeSide[] = ['east', 'west', 'north', 'south']

  let bestSide: FacadeSide = 'east'
  let bestScore = -Infinity

  for (const side of sides) {
    const perimeter = exteriorPerimeterOnSide(component, allSiblings, side, bounds, tolerance)
    if (perimeter <= tolerance) continue

    let score = perimeter + outwardDistanceFromCenter(side, bounds)

    if (separatedWings.length) {
      const sideCenter = facadeSideCenter(side, bounds)
      let nearestWingDistSq = Infinity
      for (const wing of separatedWings) {
        const wingCenter = polygonCentroid(wing.paths)
        const dSq =
          (sideCenter.lat - wingCenter.lat) ** 2 + (sideCenter.lng - wingCenter.lng) ** 2
        nearestWingDistSq = Math.min(nearestWingDistSq, dSq)
      }
      // Prefer sides that are FAR from the other wings. On U/L/C-shaped
      // buildings this puts the gate on the outer parking-lot wall rather
      // than in the shared interior courtyard.
      score += Math.sqrt(nearestWingDistSq) * 1e4
    } else {
      const sideCenter = facadeSideCenter(side, bounds)
      const anchorDistance =
        (sideCenter.lat - anchor.lat) ** 2 + (sideCenter.lng - anchor.lng) ** 2
      score -= anchorDistance * 1e3
    }

    if (score > bestScore) {
      bestScore = score
      bestSide = side
    }
  }

  // Legacy tie-breaker for single-wing buildings only: for a north-south
  // elongated stack (typical rectangular strip), prefer an east/west facade.
  // For multi-wing buildings the "far from other wings" scoring above already
  // picks the correct outward side and must not be overridden here.
  if (separatedWings.length === 0) {
    const verticalPerimeter =
      exteriorPerimeterOnSide(component, allSiblings, 'east', bounds, tolerance) +
      exteriorPerimeterOnSide(component, allSiblings, 'west', bounds, tolerance)
    const horizontalPerimeter =
      exteriorPerimeterOnSide(component, allSiblings, 'north', bounds, tolerance) +
      exteriorPerimeterOnSide(component, allSiblings, 'south', bounds, tolerance)

    if (verticalPerimeter >= horizontalPerimeter * 0.5) {
      const eastPerimeter = exteriorPerimeterOnSide(component, allSiblings, 'east', bounds, tolerance)
      const westPerimeter = exteriorPerimeterOnSide(component, allSiblings, 'west', bounds, tolerance)
      if (eastPerimeter > 0 || westPerimeter > 0) {
        return eastPerimeter >= westPerimeter ? 'east' : 'west'
      }
    }
  }

  return bestSide
}

/**
 * Ideal center of this suite on the wing's shared facade line — used only as
 * a target to snap onto the suite's own polygon boundary, so spheres line up
 * in a row without ever leaving the polygon outline.
 */
function idealFacadeLinePoint(
  suiteBounds: Bounds,
  componentBounds: Bounds,
  facadeSide: FacadeSide,
): LatLng {
  switch (facadeSide) {
    case 'east':
      return {
        lng: componentBounds.east,
        lat: (suiteBounds.north + suiteBounds.south) / 2,
      }
    case 'west':
      return {
        lng: componentBounds.west,
        lat: (suiteBounds.north + suiteBounds.south) / 2,
      }
    case 'north':
      return {
        lat: componentBounds.north,
        lng: (suiteBounds.east + suiteBounds.west) / 2,
      }
    case 'south':
      return {
        lat: componentBounds.south,
        lng: (suiteBounds.east + suiteBounds.west) / 2,
      }
  }
}

function closestPointOnSegment(point: LatLng, start: LatLng, end: LatLng): LatLng {
  const dx = end.lng - start.lng
  const dy = end.lat - start.lat
  const lenSq = dx * dx + dy * dy
  if (lenSq < 1e-18) return start
  let t = ((point.lng - start.lng) * dx + (point.lat - start.lat) * dy) / lenSq
  t = Math.max(0, Math.min(1, t))
  return { lat: start.lat + t * dy, lng: start.lng + t * dx }
}

/** Nearest point that actually lies on the polygon's own boundary line. */
function closestPointOnPolygonBoundary(paths: LatLng[], target: LatLng): LatLng {
  const edges = polygonEdges(paths)
  let best = edges[0]?.start ?? target
  let bestDistSq = Infinity
  for (const edge of edges) {
    const candidate = closestPointOnSegment(target, edge.start, edge.end)
    const distSq = (candidate.lat - target.lat) ** 2 + (candidate.lng - target.lng) ** 2
    if (distSq < bestDistSq) {
      bestDistSq = distSq
      best = candidate
    }
  }
  return best
}

/**
 * Gate on the suite's own outside wall — snapped onto the polygon boundary so
 * it never floats off the building, while staying aligned with neighboring
 * suite spheres on the same facade row as closely as the shape allows.
 */
export function facadeEntrancePosition(
  polygon: Polygon,
  building: Building,
  buildingPolygons: Polygon[] = [],
): { lat: number; lng: number } {
  const paths = polygon.paths
  if (paths.length < 3) return polygonCentroid(paths)

  const anchor = buildingAnchor(building)
  const siblings = buildingPolygons.length > 0 ? buildingPolygons : [polygon]
  const tolerance = edgeTolerance(boundsOfPolygons(siblings))
  const component = connectedComponent(polygon, siblings, tolerance)
  const componentBounds = boundsOfPolygons(component)
  const suiteBounds = boundsOfPolygon(paths)
  const facadeSide = pickFacadeSideForComponent(component, siblings, anchor)

  const idealPoint = idealFacadeLinePoint(suiteBounds, componentBounds, facadeSide)
  return closestPointOnPolygonBoundary(paths, idealPoint)
}
