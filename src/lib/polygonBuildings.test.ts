import { describe, expect, it } from 'vitest'
import type { Building, Polygon } from '@/types/domain'
import {
  buildingForPolygon,
  buildPolygonBuildingIndex,
  formatSuiteExportLabel,
  nearestBuilding,
  nearestBuildingForPolygon,
  parseSuiteImportLabel,
  polygonMatchesSearch,
  polygonOptionKey,
  resolvePolygonEditorSelection,
} from '@/lib/polygonBuildings'

const bristol2320: Building = {
  park: 'Western Business Park (x 22)',
  address: '2320 Bristol Circle',
  bu: '51202',
  lat: 43.5164587,
  lng: -79.6769601,
  sqft: '58,051',
  cluster: 'Bristol / Brighton (x 4)',
  manager: 'Josh Starkey',
  rtus: [
    {
      name: 'RTU-14',
      description: '',
      lat: 43.5161231,
      lng: -79.677797,
    },
  ],
}

const brighton2910: Building = {
  park: 'Western Business Park (x 22)',
  address: '2910 Brighton Road',
  bu: '51204',
  lat: 43.515678,
  lng: -79.678188,
  sqft: '25,825',
  cluster: 'Bristol / Brighton (x 4)',
  manager: 'Josh Starkey',
  rtus: [
    {
      name: 'RTU-01',
      description: '',
      lat: 43.5155779,
      lng: -79.6779795,
    },
  ],
}

const mcsPolygon: Polygon = {
  name: 'Unit # 8',
  description: 'MCS Facility Support (K&S Services)',
  color: '#fb923c',
  paths: [
    { lat: 43.51622543356956, lng: -79.67781547405374 },
    { lat: 43.5161975130104, lng: -79.67778482678236 },
    { lat: 43.5161398031456, lng: -79.67789226060326 },
    { lat: 43.51595365941766, lng: -79.67768698407323 },
    { lat: 43.51600525241409, lng: -79.67759381975341 },
  ],
}

describe('polygonBuildings', () => {
  it('assigns MCS Unit #8 to 2320 Bristol using RTU proximity, not 2910 Brighton pin', () => {
    const buildings = [brighton2910, bristol2320]
    const lat = 43.5162
    const lng = -79.6778

    expect(nearestBuilding(buildings, lat, lng)?.address).toBe('2910 Brighton Road')
    expect(nearestBuildingForPolygon(buildings, lat, lng)?.address).toBe('2320 Bristol Circle')
    expect(buildingForPolygon(buildings, mcsPolygon)?.address).toBe('2320 Bristol Circle')
  })

  it('indexes tenant polygons under the resolved building address', () => {
    const index = buildPolygonBuildingIndex([brighton2910, bristol2320], [mcsPolygon])
    expect(index.get('2320 Bristol Circle')).toHaveLength(1)
    expect(index.get('2910 Brighton Road')).toHaveLength(0)
  })

  it('formats suite labels with building address for Excel export', () => {
    expect(formatSuiteExportLabel('Unit # 8', '2320 Bristol Circle')).toBe(
      'Unit # 8 — 2320 Bristol Circle',
    )
    expect(parseSuiteImportLabel('Unit # 8 — 2320 Bristol Circle')).toBe('Unit # 8')
  })

  it('matches polygons by building address in editor search', () => {
    expect(polygonMatchesSearch(mcsPolygon, [brighton2910, bristol2320], '2320 Bristol')).toBe(true)
    expect(polygonMatchesSearch(mcsPolygon, [brighton2910, bristol2320], '2910 Brighton')).toBe(false)
  })

  it('prefers the viewed polygon, then the current building, when opening the editor', () => {
    const otherPolygon: Polygon = {
      name: 'Unit # 1',
      description: 'Other tenant',
      color: '#60a5fa',
      paths: [
        { lat: 43.5155779, lng: -79.6779795 },
        { lat: 43.5156, lng: -79.6781 },
        { lat: 43.5155, lng: -79.6779 },
      ],
    }
    const polygons = [otherPolygon, mcsPolygon]

    expect(
      resolvePolygonEditorSelection(polygons, [bristol2320], {
        viewedPolygon: { name: 'Unit # 8', description: mcsPolygon.description },
        buildingAddress: '2910 Brighton Road',
      }),
    ).toBe(polygonOptionKey(mcsPolygon))

    expect(
      resolvePolygonEditorSelection([mcsPolygon], [bristol2320], {
        buildingAddress: '2320 Bristol Circle',
      }),
    ).toBe(polygonOptionKey(mcsPolygon))
  })
})
