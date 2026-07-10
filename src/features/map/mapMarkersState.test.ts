import { describe, expect, it, vi } from 'vitest'

// Replace google.maps-backed helpers with test doubles so the module under
// test can run under jsdom. Positions are stored on a private field of the
// fake marker object.
vi.mock('@/lib/appMapMarker', () => ({
  getAppMarkerPosition: (marker: unknown) => {
    const pos = (marker as { __position?: { lat: number; lng: number } }).__position
    if (!pos) return null
    return { lat: () => pos.lat, lng: () => pos.lng }
  },
  setAppMarkerPosition: (marker: unknown, lat: number, lng: number) => {
    ;(marker as { __position: { lat: number; lng: number } }).__position = { lat, lng }
  },
  setBuildingMarkerContent: () => {},
  setDetailMarkerContent: () => {},
  setInspection360MarkerContent: () => {},
}))

// mapMarkersState pulls in markerStyles/colors which reach into google.maps.
// The unit under test does not touch those helpers, so stub the module out.
vi.mock('@/lib/markerStyles', () => ({
  getDetailMarkerIcon: () => ({}),
  getMarkerIcon: () => ({}),
}))
vi.mock('@/lib/mapRotation', () => ({
  fitBoundsPreserveRotation: () => {},
}))

import { applyPendingMarkerPositions } from '@/features/map/mapMarkersState'
import type { DetailMarkerEntry } from '@/features/map/mapMarkersState'
import { mergePortfolioSuiteEntrances } from '@/lib/suiteEntrances'
import type { Building, PortfolioData, SuiteEntrance } from '@/types/domain'

function fakeMarkerAt(lat: number, lng: number): DetailMarkerEntry['marker'] {
  return { __position: { lat, lng } } as unknown as DetailMarkerEntry['marker']
}

const building: Building = {
  id: 1,
  park: 'P',
  address: '100 Main St',
  bu: 'BU1',
  lat: 43.65,
  lng: -79.62,
  sqft: '1000',
  cluster: 'A',
  manager: 'Manager',
}

describe('applyPendingMarkerPositions — sphere positions survive edit-mode exit', () => {
  it('clears auto_placed when persisting a dragged suite entrance position', () => {
    const originalEntrance: SuiteEntrance = {
      building_id: 1,
      polygon_id: 5,
      name: 'Suite 7',
      description: 'Tenant A',
      lat: 43.651,
      lng: -79.621,
      auto_placed: true,
    }
    const portfolio: Pick<PortfolioData, 'buildings' | 'utilities' | 'suiteEntrances'> = {
      buildings: [building],
      utilities: [],
      suiteEntrances: [originalEntrance],
    }

    const draggedEntry: DetailMarkerEntry = {
      type: 'inspection360',
      building,
      data: { ...originalEntrance },
      marker: fakeMarkerAt(43.652, -79.622),
      dragKey: 'detail:inspection360:Suite 7:100 Main St',
    }

    const patched = applyPendingMarkerPositions(portfolio, [], [draggedEntry])
    expect(patched).not.toBeNull()
    const updatedEntrance = patched!.suiteEntrances[0]!
    expect(updatedEntrance.lat).toBe(43.652)
    expect(updatedEntrance.lng).toBe(-79.622)
    expect(updatedEntrance.auto_placed).toBe(false)
  })

  it('leaves the entrance list unchanged when the marker already matches the portfolio', () => {
    const entrance: SuiteEntrance = {
      building_id: 1,
      polygon_id: 5,
      name: 'Suite 7',
      description: 'Tenant A',
      lat: 43.651,
      lng: -79.621,
      auto_placed: false,
    }
    const portfolio = {
      buildings: [building],
      utilities: [],
      suiteEntrances: [entrance],
    }

    const entry: DetailMarkerEntry = {
      type: 'inspection360',
      building,
      data: { ...entrance },
      marker: fakeMarkerAt(entrance.lat, entrance.lng),
      dragKey: 'detail:inspection360:Suite 7:100 Main St',
    }

    const patched = applyPendingMarkerPositions(portfolio, [], [entry])
    expect(patched).toBeNull()
  })

  it('regression: dragged sphere stays put after the normalize pass that runs on state stage', () => {
    // Reproduces "sphere snaps back after turning off edit mode": if
    // applyPendingMarkerPositions leaves auto_placed=true, the very next
    // mergePortfolioSuiteEntrances pass snaps the sphere back to the
    // polygon facade.
    const originalEntrance: SuiteEntrance = {
      building_id: 1,
      polygon_id: 10,
      name: 'Suite # 7',
      description: 'Tenant A',
      lat: 43.6011,
      lng: -79.6013,
      auto_placed: true,
    }

    const polygon = {
      id: 10,
      name: 'Suite # 7',
      description: 'Tenant A',
      color: '#60a5fa',
      paths: [
        { lat: 43.601, lng: -79.601 },
        { lat: 43.602, lng: -79.601 },
        { lat: 43.602, lng: -79.602 },
      ],
    }

    const portfolio: PortfolioData = {
      buildings: [building],
      utilities: [],
      polygons: [polygon],
      suiteEntrances: [originalEntrance],
    }

    const draggedTo = { lat: 43.6035, lng: -79.6037 }
    const entry: DetailMarkerEntry = {
      type: 'inspection360',
      building,
      data: { ...originalEntrance },
      marker: fakeMarkerAt(draggedTo.lat, draggedTo.lng),
      dragKey: 'detail:inspection360:Suite # 7:100 Main St',
    }

    const patched = applyPendingMarkerPositions(portfolio, [], [entry])
    expect(patched).not.toBeNull()

    const merged = mergePortfolioSuiteEntrances({ ...portfolio, ...patched! })
    const survived = merged.suiteEntrances.find(
      (item) => item.name === originalEntrance.name && item.building_id === 1,
    )
    expect(survived).toBeDefined()
    expect(survived!.lat).toBe(draggedTo.lat)
    expect(survived!.lng).toBe(draggedTo.lng)
    expect(survived!.auto_placed).toBe(false)
  })
})
