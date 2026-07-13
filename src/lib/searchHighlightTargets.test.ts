import { describe, expect, it } from 'vitest'
import {
  collectClusterHighlightTargets,
  collectSearchHighlightTargets,
  metersForScreenRadius,
  metersPerScreenPixel,
} from '@/lib/searchHighlightTargets'
import type { Building } from '@/types/domain'

function building(partial: Partial<Building> & Pick<Building, 'address'>): Building {
  return {
    park: 'Dixie Business Park (x 34)',
    bu: '1',
    lat: 43.66,
    lng: -79.65,
    sqft: '1000',
    cluster: 'Dixie 2 (x 13)',
    manager: 'Manager 1',
    ...partial,
  }
}

const buildings = [
  building({
    address: '1495 Bonhill Road',
    bu: '65186',
    lat: 43.661,
    lng: -79.654,
    cluster: 'Dixie 2 (x 13)',
    buildingOperator: 'Christopher Peles',
  }),
  building({
    address: '1535 Meyerside Drive',
    bu: '65187',
    lat: 43.662,
    lng: -79.655,
    cluster: 'Dixie 1 (x 8)',
    buildingOperator: 'Christopher Peles',
  }),
  building({
    address: '2300 Bristol Circle',
    park: 'Western Business Park (x 22)',
    cluster: 'Bristol (x 4)',
    bu: '51201',
    lat: 43.58,
    lng: -79.72,
    buildingOperator: 'Ramesh Ramnarine',
  }),
]

describe('metersForScreenRadius', () => {
  it('grows meter radius when zooming out so on-screen size stays similar', () => {
    const lat = 43.66
    const radiusPx = 48
    const close = metersForScreenRadius(lat, 18, radiusPx)
    const far = metersForScreenRadius(lat, 12, radiusPx)
    expect(far).toBeGreaterThan(close * 30)
    expect(metersPerScreenPixel(lat, 12)).toBeGreaterThan(metersPerScreenPixel(lat, 18))
  })
})

describe('collectClusterHighlightTargets', () => {
  it('circles each distinct cluster in the filtered set', () => {
    const dixie = buildings.filter((b) => b.park.startsWith('Dixie'))
    const targets = collectClusterHighlightTargets(dixie)
    expect(targets.every((t) => t.kind === 'cluster')).toBe(true)
    expect(targets.map((t) => t.label)).toEqual(['Dixie 1 (x 8)', 'Dixie 2 (x 13)'])
  })

  it('returns one circle when a single cluster is selected', () => {
    const scoped = buildings.filter((b) => b.cluster === 'Bristol (x 4)')
    expect(collectClusterHighlightTargets(scoped)).toEqual([
      expect.objectContaining({ kind: 'cluster', label: 'Bristol (x 4)' }),
    ])
  })
})

describe('collectSearchHighlightTargets', () => {
  it('returns nothing for blank search', () => {
    expect(collectSearchHighlightTargets(buildings, '  ')).toEqual([])
  })

  it('circles matching buildings by address', () => {
    const targets = collectSearchHighlightTargets(buildings, 'Bonhill')
    expect(targets).toHaveLength(1)
    expect(targets[0]).toMatchObject({
      kind: 'building',
      label: '1495 Bonhill Road',
    })
  })

  it('circles each cluster inside a matching park (not one park ring)', () => {
    const targets = collectSearchHighlightTargets(buildings, 'Dixie Business')
    expect(targets.every((t) => t.kind === 'cluster')).toBe(true)
    expect(targets.map((t) => t.label).sort()).toEqual(['Dixie 1 (x 8)', 'Dixie 2 (x 13)'])
  })

  it('circles a matching cluster', () => {
    const targets = collectSearchHighlightTargets(buildings, 'Bristol')
    expect(targets).toHaveLength(1)
    expect(targets[0]).toMatchObject({
      kind: 'cluster',
      label: 'Bristol (x 4)',
    })
  })

  it('circles buildings by operator name', () => {
    const targets = collectSearchHighlightTargets(buildings, 'Peles')
    expect(targets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'building', label: '1495 Bonhill Road' }),
        expect.objectContaining({ kind: 'building', label: '1535 Meyerside Drive' }),
      ]),
    )
  })
})
