import { describe, expect, it } from 'vitest'
import { hasPortfolioMapView, parsePortfolioMapView } from '@/lib/portfolioMapView'

describe('parsePortfolioMapView', () => {
  it('parses a complete camera', () => {
    expect(
      parsePortfolioMapView({
        lat: 43.5,
        lng: -79.6,
        zoom: 12,
        heading: 45,
        tilt: 30,
        imageryMode: 'esri',
      }),
    ).toEqual({
      lat: 43.5,
      lng: -79.6,
      zoom: 12,
      heading: 45,
      tilt: 30,
      imageryMode: 'esri',
    })
  })

  it('defaults tilt and imagery when omitted', () => {
    expect(
      parsePortfolioMapView({
        lat: 43.5,
        lng: -79.6,
        zoom: 12,
        heading: 0,
      }),
    ).toEqual({
      lat: 43.5,
      lng: -79.6,
      zoom: 12,
      heading: 0,
      tilt: 0,
      imageryMode: null,
    })
  })

  it('returns null when required fields are missing', () => {
    expect(parsePortfolioMapView(null)).toBeNull()
    expect(parsePortfolioMapView({})).toBeNull()
    expect(parsePortfolioMapView({ lat: 1, lng: 2, zoom: 10 })).toBeNull()
  })
})

describe('hasPortfolioMapView', () => {
  it('is true only when a view is present', () => {
    expect(hasPortfolioMapView(null)).toBe(false)
    expect(
      hasPortfolioMapView({
        lat: 1,
        lng: 2,
        zoom: 10,
        heading: 0,
        tilt: 0,
        imageryMode: null,
      }),
    ).toBe(true)
  })
})
