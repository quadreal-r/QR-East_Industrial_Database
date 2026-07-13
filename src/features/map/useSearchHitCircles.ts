import { useEffect, useRef } from 'react'
import {
  collectClusterHighlightTargets,
  collectSearchHighlightTargets,
  metersForScreenRadius,
  SEARCH_HIGHLIGHT_RADIUS_PX,
  SEARCH_HIGHLIGHT_STYLE,
  type SearchHighlightTarget,
} from '@/lib/searchHighlightTargets'
import { useFilterStore } from '@/stores/filterStore'
import type { Building } from '@/types/domain'

export const MAP_DISMISS_SEARCH_HIGHLIGHTS_EVENT = 'map:dismissSearchHighlights'

export function dismissSearchHitCircles(): void {
  window.dispatchEvent(new CustomEvent(MAP_DISMISS_SEARCH_HIGHLIGHTS_EVENT))
}

interface HighlightCircle {
  circle: google.maps.Circle
  target: SearchHighlightTarget
}

function clearCircles(entries: HighlightCircle[]): void {
  for (const entry of entries) {
    entry.circle.setMap(null)
  }
}

function syncCircleRadius(map: google.maps.Map, entry: HighlightCircle): void {
  const zoom = map.getZoom()
  if (zoom == null) return
  const radiusPx = SEARCH_HIGHLIGHT_RADIUS_PX[entry.target.kind]
  entry.circle.setRadius(metersForScreenRadius(entry.target.lat, zoom, radiusPx))
}

function drawCircles(
  map: google.maps.Map,
  targets: SearchHighlightTarget[],
): HighlightCircle[] {
  const zoom = map.getZoom() ?? 12
  return targets.map((target) => {
    const radiusPx = SEARCH_HIGHLIGHT_RADIUS_PX[target.kind]
    const circle = new google.maps.Circle({
      map,
      center: { lat: target.lat, lng: target.lng },
      radius: metersForScreenRadius(target.lat, zoom, radiusPx),
      clickable: false,
      strokeColor: SEARCH_HIGHLIGHT_STYLE.strokeColor,
      strokeOpacity: SEARCH_HIGHLIGHT_STYLE.strokeOpacity,
      strokeWeight: SEARCH_HIGHLIGHT_STYLE.strokeWeight,
      fillColor: SEARCH_HIGHLIGHT_STYLE.fillColor,
      fillOpacity: SEARCH_HIGHLIGHT_STYLE.fillOpacity,
      zIndex: target.kind === 'building' ? 3 : 2,
    })
    return { circle, target }
  })
}

function highlightKey(parts: {
  search: string
  park: string
  cluster: string
  manager: string
  buildingOperator: string
}): string {
  return [
    parts.search,
    parts.park,
    parts.cluster,
    parts.manager,
    parts.buildingOperator,
  ].join('\0')
}

/**
 * Draw temporary red circles for search hits or park/cluster/manager/operator
 * filters — never pan, zoom, or rotate. Circle screen size stays constant
 * across zoom. Dismiss on map click-away.
 */
export function useSearchHitCircles(
  map: google.maps.Map | null,
  allBuildings: Building[],
  filteredBuildings: Building[],
): void {
  const search = useFilterStore((s) => s.search)
  const park = useFilterStore((s) => s.park)
  const cluster = useFilterStore((s) => s.cluster)
  const manager = useFilterStore((s) => s.manager)
  const buildingOperator = useFilterStore((s) => s.buildingOperator)
  const circlesRef = useRef<HighlightCircle[]>([])
  const dismissedRef = useRef(false)
  const lastKeyRef = useRef('')

  useEffect(() => {
    const key = highlightKey({ search, park, cluster, manager, buildingOperator })
    if (key !== lastKeyRef.current) {
      lastKeyRef.current = key
      dismissedRef.current = false
    }

    clearCircles(circlesRef.current)
    circlesRef.current = []

    if (!map || dismissedRef.current) return

    const q = search.trim()
    const hasFilter = Boolean(park || cluster || manager || buildingOperator)

    let targets: SearchHighlightTarget[] = []
    if (q) {
      targets = collectSearchHighlightTargets(allBuildings, search)
    } else if (hasFilter) {
      targets = collectClusterHighlightTargets(filteredBuildings)
    }

    if (!targets.length) return

    circlesRef.current = drawCircles(map, targets)

    const syncAll = () => {
      for (const entry of circlesRef.current) {
        syncCircleRadius(map, entry)
      }
    }
    const zoomListener = map.addListener('zoom_changed', syncAll)

    return () => {
      google.maps.event.removeListener(zoomListener)
      clearCircles(circlesRef.current)
      circlesRef.current = []
    }
  }, [map, allBuildings, filteredBuildings, search, park, cluster, manager, buildingOperator])

  useEffect(() => {
    const dismiss = () => {
      if (!circlesRef.current.length && dismissedRef.current) return
      dismissedRef.current = true
      clearCircles(circlesRef.current)
      circlesRef.current = []
    }
    window.addEventListener(MAP_DISMISS_SEARCH_HIGHLIGHTS_EVENT, dismiss)
    return () => window.removeEventListener(MAP_DISMISS_SEARCH_HIGHLIGHTS_EVENT, dismiss)
  }, [])
}
