import { useEffect, useRef } from 'react'
import {
  createAppMarker,
  setAppMarkerMap,
  type AppMapMarker,
} from '@/lib/appMapMarker'
import {
  collectClusterHighlightTargets,
  collectSearchHighlightTargets,
  SEARCH_HIGHLIGHT_RADIUS_PX,
  SEARCH_HIGHLIGHT_STYLE,
  type SearchHighlightKind,
  type SearchHighlightTarget,
} from '@/lib/searchHighlightTargets'
import { MAP_PULSE_SEARCH_HIGHLIGHTS_EVENT } from '@/lib/searchHits'
import { useFilterStore } from '@/stores/filterStore'
import { useSelectionStore } from '@/stores/selectionStore'
import type { Building, Polygon, SuiteEntrance } from '@/types/domain'

export const MAP_DISMISS_SEARCH_HIGHLIGHTS_EVENT = 'map:dismissSearchHighlights'

/** Above building labels (10), detail pins (20), and pending picture markers (2000). */
const SEARCH_HIT_CIRCLE_Z_INDEX = 50_000

export function dismissSearchHitCircles(): void {
  window.dispatchEvent(new CustomEvent(MAP_DISMISS_SEARCH_HIGHLIGHTS_EVENT))
}

interface HighlightCircle {
  marker: AppMapMarker
  target: SearchHighlightTarget
}

function hexToRgba(hex: string, alpha: number): string {
  const raw = hex.replace('#', '')
  const full = raw.length === 3 ? raw.split('').map((c) => c + c).join('') : raw
  const r = Number.parseInt(full.slice(0, 2), 16)
  const g = Number.parseInt(full.slice(2, 4), 16)
  const b = Number.parseInt(full.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

/** DOM ring so it stacks with Advanced Marker address labels (map Circle sits under them). */
function buildSearchHitCircleContent(kind: SearchHighlightKind): HTMLElement {
  const radiusPx = SEARCH_HIGHLIGHT_RADIUS_PX[kind]
  const size = radiusPx * 2
  const root = document.createElement('div')
  root.className = 'search-hit-circle'
  root.style.width = `${size}px`
  root.style.height = `${size}px`
  root.style.borderRadius = '50%'
  root.style.boxSizing = 'border-box'
  root.style.border = `${SEARCH_HIGHLIGHT_STYLE.strokeWeight}px solid ${hexToRgba(
    SEARCH_HIGHLIGHT_STYLE.strokeColor,
    SEARCH_HIGHLIGHT_STYLE.strokeOpacity,
  )}`
  // Transparent fill — outline only — so markers underneath stay visible and clickable.
  root.style.backgroundColor = 'transparent'
  root.style.pointerEvents = 'none'
  root.setAttribute('aria-hidden', 'true')
  return root
}

function clearCircles(entries: HighlightCircle[]): void {
  for (const entry of entries) {
    setAppMarkerMap(entry.marker, null)
  }
}

function circleBelongsToBuilding(target: SearchHighlightTarget, address: string): boolean {
  const want = address.trim().toLowerCase()
  if (!want) return false
  if (target.buildingAddress?.trim().toLowerCase() === want) return true
  if (target.kind === 'building' && target.label.trim().toLowerCase() === want) return true
  if (target.label.toLowerCase().startsWith(`${want} ·`)) return true
  return false
}

/** Restart the 3-beat attention pulse on matching search rings. */
function pulseCirclesForBuilding(entries: HighlightCircle[], address: string): void {
  for (const entry of entries) {
    if (!circleBelongsToBuilding(entry.target, address)) continue
    const root = entry.marker.querySelector('.search-hit-circle') as HTMLElement | null
    if (!root) continue
    root.classList.remove('search-hit-circle-pulse')
    // Force restart so a second click pulses again.
    void root.offsetWidth
    root.classList.add('search-hit-circle-pulse')
  }
}

function drawCircles(
  map: google.maps.Map,
  targets: SearchHighlightTarget[],
): HighlightCircle[] {
  return targets.map((target) => {
    const marker = createAppMarker({
      map,
      position: { lat: target.lat, lng: target.lng },
      zIndex: SEARCH_HIT_CIRCLE_Z_INDEX,
      clickable: false,
      content: buildSearchHitCircleContent(target.kind),
      anchorLeft: '-50%',
      anchorTop: '-50%',
      collisionBehavior: google.maps.CollisionBehavior.REQUIRED,
    })
    // Host element must also ignore hits — content pointer-events alone is not enough.
    marker.style.pointerEvents = 'none'
    marker.setAttribute('data-search-hit-circle', '1')
    if (target.buildingAddress) {
      marker.setAttribute('data-search-hit-building', target.buildingAddress)
    }
    marker.gmpClickable = false
    return { marker, target }
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
 * filters. Circle screen size stays constant across zoom. Drawn as Advanced
 * Markers so rings sit above address text. Dismiss on map click-away.
 * Category filter changes (no text search) open the All Buildings overview
 * on Google imagery and leave red rings only on the chosen category.
 */
export function useSearchHitCircles(
  map: google.maps.Map | null,
  allBuildings: Building[],
  filteredBuildings: Building[],
  polygons: Polygon[] = [],
  suiteEntrances: SuiteEntrance[] = [],
  onCategoryFilterOverview?: () => void,
): void {
  const search = useFilterStore((s) => s.search)
  const park = useFilterStore((s) => s.park)
  const cluster = useFilterStore((s) => s.cluster)
  const manager = useFilterStore((s) => s.manager)
  const buildingOperator = useFilterStore((s) => s.buildingOperator)
  const circlesRef = useRef<HighlightCircle[]>([])
  const dismissedRef = useRef(false)
  const lastKeyRef = useRef('')
  const overviewRef = useRef(onCategoryFilterOverview)

  useEffect(() => {
    overviewRef.current = onCategoryFilterOverview
  }, [onCategoryFilterOverview])

  useEffect(() => {
    const key = highlightKey({ search, park, cluster, manager, buildingOperator })
    const keyChanged = key !== lastKeyRef.current
    if (keyChanged) {
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
      targets = collectSearchHighlightTargets(allBuildings, search, {
        polygons,
        suiteEntrances,
      })
    } else if (hasFilter) {
      targets = collectClusterHighlightTargets(filteredBuildings)
    }

    if (targets.length) {
      circlesRef.current = drawCircles(map, targets)
    }

    // Like All Buildings + category on Google: full portfolio overview, red rings
    // only on the filter. Skip text search, clear-filters, and data refreshes.
    if (keyChanged && !q && hasFilter) {
      useSelectionStore.getState().clearSelection()
      overviewRef.current?.()
    }

    return () => {
      clearCircles(circlesRef.current)
      circlesRef.current = []
    }
  }, [
    map,
    allBuildings,
    filteredBuildings,
    polygons,
    suiteEntrances,
    search,
    park,
    cluster,
    manager,
    buildingOperator,
  ])

  useEffect(() => {
    const dismiss = () => {
      if (!circlesRef.current.length && dismissedRef.current) return
      dismissedRef.current = true
      clearCircles(circlesRef.current)
      circlesRef.current = []
    }
    const pulse = (e: Event) => {
      const address = String(
        (e as CustomEvent<{ address?: string }>).detail?.address || '',
      ).trim()
      if (!address || !circlesRef.current.length) return
      pulseCirclesForBuilding(circlesRef.current, address)
    }
    window.addEventListener(MAP_DISMISS_SEARCH_HIGHLIGHTS_EVENT, dismiss)
    window.addEventListener(MAP_PULSE_SEARCH_HIGHLIGHTS_EVENT, pulse)
    return () => {
      window.removeEventListener(MAP_DISMISS_SEARCH_HIGHLIGHTS_EVENT, dismiss)
      window.removeEventListener(MAP_PULSE_SEARCH_HIGHLIGHTS_EVENT, pulse)
    }
  }, [])
}
