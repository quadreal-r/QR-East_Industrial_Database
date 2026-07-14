import { useCallback, useMemo, useState } from 'react'
import { collectSearchHits, openSearchHit, type SearchHit } from '@/lib/searchHits'
import { useFilterStore } from '@/stores/filterStore'
import type { Building, Polygon, SuiteEntrance } from '@/types/domain'

export interface SearchHitNavProps {
  buildings: Building[]
  polygons: Polygon[]
  suiteEntrances?: SuiteEntrance[]
}

function SearchHitNavInner({ hits }: { hits: SearchHit[] }) {
  const [index, setIndex] = useState(0)

  const openHit = useCallback((target: SearchHit, i: number) => {
    setIndex(i)
    openSearchHit(target)
  }, [])

  // Do not auto-zoom to the first hit — search circles + frame handle map focus.

  if (hits.length <= 1) return null

  const safeIndex = Math.min(index, hits.length - 1)
  const hit = hits[safeIndex]!

  const panTo = (i: number) => {
    const next = ((i % hits.length) + hits.length) % hits.length
    openHit(hits[next]!, next)
  }

  return (
    <div
      id="search-hit-nav"
      style={{
        display: 'flex',
        gap: 6,
        alignItems: 'center',
        padding: '5px 14px 6px',
        fontSize: 11,
        color: 'var(--text-muted)',
        borderBottom: '1px solid var(--border)',
        background: 'var(--surface2)',
      }}
    >
      <span id="shn-count" title={hit.label} style={{ flex: 1, fontFamily: "'DM Mono', monospace" }}>
        {safeIndex + 1} of {hits.length}
      </span>
      <button type="button" className="btn-action" style={{ padding: '2px 8px' }} onClick={() => panTo(safeIndex - 1)}>
        ← Prev
      </button>
      <button type="button" className="btn-action" style={{ padding: '2px 8px' }} onClick={() => panTo(safeIndex + 1)}>
        Next →
      </button>
    </div>
  )
}

/** Prev/next navigation when search matches RTU markers, tenant polygons, or buildings. */
export function SearchHitNav({
  buildings,
  polygons,
  suiteEntrances = [],
}: SearchHitNavProps) {
  const search = useFilterStore((s) => s.search).trim()

  const hits = useMemo(
    (): SearchHit[] => collectSearchHits(buildings, polygons, search, suiteEntrances),
    [buildings, polygons, suiteEntrances, search],
  )

  if (!hits.length) return null

  return <SearchHitNavInner key={search} hits={hits} />
}
