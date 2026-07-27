import { describe, expect, it } from 'vitest'
import {
  CLOUD_TOUR_CACHE_MAX_BYTES,
  CLOUD_TOUR_CACHE_MAX_ENTRIES,
  cloudTourCacheRequestUrl,
  etagMatches,
  normalizeTourCacheUrl,
  selectCloudTourLruVictims,
  type CloudTourCacheMetaEntry,
} from '@/lib/insp360TourCache'

describe('insp360TourCache', () => {
  it('normalizes tour URLs (strip hash; drop unrelated query)', () => {
    expect(normalizeTourCacheUrl(' https://cdn.example/tours/a.insp360#frag ')).toBe(
      'https://cdn.example/tours/a.insp360',
    )
    expect(normalizeTourCacheUrl('https://cdn.example/tours/a.insp360?utm=1')).toBe(
      'https://cdn.example/tours/a.insp360',
    )
    expect(normalizeTourCacheUrl('https://cdn.example/tours/a.insp360?v=2')).toBe(
      'https://cdn.example/tours/a.insp360?v=2',
    )
  })

  it('builds a stable Cache API request URL from the tour URL', () => {
    const url = 'https://cdn.example/tours/suite.insp360'
    expect(cloudTourCacheRequestUrl(url)).toBe(
      `https://insp360.local/cloud-tour/${encodeURIComponent(url)}`,
    )
    expect(cloudTourCacheRequestUrl(`${url}#x`)).toBe(cloudTourCacheRequestUrl(url))
  })

  it('compares ETags ignoring weak markers and quotes', () => {
    expect(etagMatches('"abc"', 'abc')).toBe(true)
    expect(etagMatches('W/"abc"', '"abc"')).toBe(true)
    expect(etagMatches('abc', 'xyz')).toBe(false)
    expect(etagMatches(null, 'abc')).toBe(false)
    expect(etagMatches('', '')).toBe(false)
  })

  it('evicts oldest tours when over entry or byte caps', () => {
    const now = 1_000_000
    const entries: CloudTourCacheMetaEntry[] = [
      { url: 'https://a/1.insp360', etag: '1', size: 100, cachedAt: now, lastAccess: now - 400 },
      { url: 'https://a/2.insp360', etag: '2', size: 100, cachedAt: now, lastAccess: now - 300 },
      { url: 'https://a/3.insp360', etag: '3', size: 100, cachedAt: now, lastAccess: now - 200 },
      { url: 'https://a/4.insp360', etag: '4', size: 100, cachedAt: now, lastAccess: now - 100 },
    ]
    expect(
      selectCloudTourLruVictims(entries, { maxEntries: 2, maxBytes: CLOUD_TOUR_CACHE_MAX_BYTES }),
    ).toEqual(['https://a/1.insp360', 'https://a/2.insp360'])

    const big: CloudTourCacheMetaEntry[] = [
      { url: 'https://a/old.insp360', etag: null, size: 900, cachedAt: now, lastAccess: now - 50 },
      { url: 'https://a/keep.insp360', etag: null, size: 200, cachedAt: now, lastAccess: now },
    ]
    expect(
      selectCloudTourLruVictims(big, {
        maxEntries: CLOUD_TOUR_CACHE_MAX_ENTRIES,
        maxBytes: 1000,
        keepUrl: 'https://a/keep.insp360',
      }),
    ).toEqual(['https://a/old.insp360'])
  })

  it('does not evict the tour currently being kept', () => {
    const now = Date.now()
    const entries: CloudTourCacheMetaEntry[] = Array.from({ length: 10 }, (_, i) => ({
      url: `https://a/${i}.insp360`,
      etag: String(i),
      size: 10,
      cachedAt: now,
      lastAccess: now - (10 - i) * 1000,
    }))
    const victims = selectCloudTourLruVictims(entries, {
      maxEntries: 3,
      keepUrl: 'https://a/0.insp360',
    })
    expect(victims).not.toContain('https://a/0.insp360')
    expect(victims.length).toBeGreaterThan(0)
  })
})
