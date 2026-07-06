import { describe, expect, it } from 'vitest'
import {
  extractBuildingOutlines,
  parseOutlineCoordinates,
  pickBestBuildingOutline,
  ringToLatLng,
} from '@/lib/buildingFootprint'

describe('buildingFootprint', () => {
  it('converts GeoJSON rings to LatLng and drops closing point', () => {
    const ring = [
      [-79.65, 43.66],
      [-79.649, 43.661],
      [-79.651, 43.661],
      [-79.65, 43.66],
    ]
    expect(ringToLatLng(ring)).toEqual([
      { lat: 43.66, lng: -79.65 },
      { lat: 43.661, lng: -79.649 },
      { lat: 43.661, lng: -79.651 },
    ])
  })

  it('parses polygon display coordinates', () => {
    const paths = parseOutlineCoordinates({
      type: 'Polygon',
      coordinates: [
        [
          [-79.65, 43.66],
          [-79.649, 43.661],
          [-79.651, 43.661],
          [-79.65, 43.66],
        ],
      ],
    })
    expect(paths).toHaveLength(3)
  })

  it('extracts outlines from geocode results', () => {
    const outlines = extractBuildingOutlines({
      buildings: [
        {
          building_outlines: [
            {
              display_polygon: {
                type: 'Polygon',
                coordinates: [
                  [
                    [-79.65, 43.66],
                    [-79.649, 43.661],
                    [-79.651, 43.661],
                    [-79.65, 43.66],
                  ],
                ],
              },
            },
          ],
        },
      ],
    })
    expect(outlines).toHaveLength(1)
    expect(outlines[0]).toHaveLength(3)
  })

  it('picks the outline whose centroid is inside the selection', () => {
    const inside = [
      { lat: 43.667, lng: -79.652 },
      { lat: 43.668, lng: -79.652 },
      { lat: 43.668, lng: -79.651 },
    ]
    const outside = [
      { lat: 43.67, lng: -79.64 },
      { lat: 43.671, lng: -79.64 },
      { lat: 43.671, lng: -79.639 },
    ]
    const selection = {
      north: 43.669,
      south: 43.666,
      east: -79.65,
      west: -79.653,
    }
    expect(pickBestBuildingOutline([outside, inside], selection)).toEqual(inside)
  })
})
