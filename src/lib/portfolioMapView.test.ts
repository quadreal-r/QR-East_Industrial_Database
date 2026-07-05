import { describe, expect, it } from 'vitest'
import {
  formatPortfolioFilterLabel,
  getPortfolioSavedView,
  hasPortfolioSavedView,
  serializePortfolioFilterKey,
} from '@/lib/portfolioMapView'

describe('serializePortfolioFilterKey', () => {
  it('joins park, cluster, and manager with pipes', () => {
    expect(
      serializePortfolioFilterKey({ park: 'Dixie', cluster: 'North', manager: 'Jane' }),
    ).toBe('Dixie|North|Jane')
    expect(serializePortfolioFilterKey({ park: '', cluster: 'A', manager: '' })).toBe('|A|')
  })
})

describe('formatPortfolioFilterLabel', () => {
  it('lists only active filters', () => {
    expect(formatPortfolioFilterLabel({ park: '', cluster: '', manager: '' })).toBe(
      'All buildings',
    )
    expect(formatPortfolioFilterLabel({ park: 'Dixie', cluster: '', manager: '' })).toBe(
      'Park: Dixie',
    )
    expect(
      formatPortfolioFilterLabel({ park: 'Dixie', cluster: 'North', manager: 'Jane' }),
    ).toBe('Park: Dixie, Cluster: North, Manager: Jane')
  })
})

describe('getPortfolioSavedView', () => {
  const views = {
    'Dixie||': {
      mapLat: 43.5,
      mapLng: -79.6,
      mapZoom: 14,
      mapHeading: 90,
      mapTilt: 0,
      mapImageryMode: 'google' as const,
    },
  }

  it('returns a view when the filter key matches', () => {
    const view = getPortfolioSavedView(views, { park: 'Dixie', cluster: '', manager: '' })
    expect(view).toEqual({
      lat: 43.5,
      lng: -79.6,
      zoom: 14,
      heading: 90,
      tilt: 0,
      imageryMode: 'google',
    })
  })

  it('returns a view for the all-buildings filter key', () => {
    const allBuildingsViews = {
      '||': {
        mapLat: 44,
        mapLng: -80,
        mapZoom: 11,
        mapHeading: 45,
        mapTilt: 0,
        mapImageryMode: 'esri' as const,
      },
    }
    expect(getPortfolioSavedView(allBuildingsViews, { park: '', cluster: '', manager: '' })).toEqual(
      {
        lat: 44,
        lng: -80,
        zoom: 11,
        heading: 45,
        tilt: 0,
        imageryMode: 'esri',
      },
    )
  })

  it('returns null when no row or incomplete camera', () => {
    expect(getPortfolioSavedView({}, { park: 'Dixie', cluster: '', manager: '' })).toBeNull()
    expect(
      getPortfolioSavedView(
        { '||': { mapLat: 1, mapLng: 2, mapZoom: null, mapHeading: 0, mapTilt: null, mapImageryMode: null } },
        { park: '', cluster: '', manager: '' },
      ),
    ).toBeNull()
  })
})

describe('hasPortfolioSavedView', () => {
  it('mirrors getPortfolioSavedView', () => {
    const views = {
      '|Cluster A|': {
        mapLat: 1,
        mapLng: 2,
        mapZoom: 12,
        mapHeading: 45,
        mapTilt: null,
        mapImageryMode: null,
      },
    }
    expect(hasPortfolioSavedView(views, { park: '', cluster: 'Cluster A', manager: '' })).toBe(true)
    expect(hasPortfolioSavedView(views, { park: '', cluster: 'Other', manager: '' })).toBe(false)
  })
})
