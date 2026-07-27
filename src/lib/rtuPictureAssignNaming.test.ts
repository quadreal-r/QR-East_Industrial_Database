import { describe, expect, it } from 'vitest'
import {
  buildBulkRtuPictureFileName,
  buildCloudRtuPictureFileName,
  formatRtuNameForPictureFile,
  manifestEntryToCloudFileName,
} from '@/lib/rtuPictureAssignNaming'
import { RTU_PICTURE_DROP_FEET } from '@/lib/geo'
import { findNearestRtuAt, spreadStackedGpsPictures } from '@/lib/rtuPictureGpsAssign'
import type { Building } from '@/types/domain'

describe('formatRtuNameForPictureFile', () => {
  it('preserves spaces in Hybrid and other descriptors', () => {
    expect(formatRtuNameForPictureFile('RTU-06 Hybrid')).toBe('RTU-06 Hybrid')
    expect(formatRtuNameForPictureFile('RTU- 04')).toBe('RTU- 04')
  })

  it('turns slash-separated suffixes into a space', () => {
    expect(formatRtuNameForPictureFile('RTU-04 Hybrid/Dual Fuel Heat Pump')).toBe(
      'RTU-04 Hybrid Dual Fuel Heat Pump',
    )
  })
})

describe('buildCloudRtuPictureFileName', () => {
  it('uses dash format without spaces for Cloudflare R2', () => {
    expect(buildCloudRtuPictureFileName('2320 Bristol Circle', 'RTU-04 Hybrid', 1, 'jpg')).toBe(
      '2320-RTU-04-1.jpg',
    )
    expect(buildCloudRtuPictureFileName('2320 Bristol Circle', 'RTU-09', 2, 'jpg')).toBe(
      '2320-RTU-09-2.jpg',
    )
  })

  it('uses East/West site codes for Kennedy filenames', () => {
    expect(
      buildCloudRtuPictureFileName('6150 Kennedy Rd-East (A)', 'RTU- 01', 1, 'jpg'),
    ).toBe('6150E-RTU-01-1.jpg')
    expect(
      buildCloudRtuPictureFileName('6150 Kennedy Rd-West (B)', 'RTU- 10', 2, 'jpg'),
    ).toBe('6150W-RTU-10-2.jpg')
  })

  it('keeps new-naming bulk manifest names as the CDN filename', () => {
    expect(
      manifestEntryToCloudFileName(
        '2320-RTU-04 Hybrid (1).jpg',
        '2320 Bristol Circle',
        'RTU-04 Hybrid',
      ),
    ).toBe('2320-RTU-04 Hybrid (1).jpg')
    expect(
      manifestEntryToCloudFileName(
        '100-RTU-01 (1) (Audit-2024).jpg',
        '100 Leek Crescent',
        'RTU- 01',
      ),
    ).toBe('100-RTU-01 (1) (Audit-2024).jpg')
  })

  it('maps legacy underscore IndexedDB names to hyphen cloud filenames', () => {
    expect(
      manifestEntryToCloudFileName(
        '100_RTU-01_(1).jpg',
        '100 Leek Crescent',
        'RTU- 01',
      ),
    ).toBe('100-RTU-01-1.jpg')
  })

  it('maps unlabeled legacy spaced names to hyphen cloud filenames', () => {
    expect(
      manifestEntryToCloudFileName('RTU-01 (1).jpg', '100 Leek Crescent', 'RTU- 01'),
    ).toBe('100-RTU-01-1.jpg')
  })
})

describe('buildBulkRtuPictureFileName', () => {
  it('uses displayed RTU name with spaces', () => {
    expect(buildBulkRtuPictureFileName('2320 Main St', 'RTU-06 Hybrid', 3, 'jpg')).toBe(
      '2320-RTU-06 Hybrid (3).jpg',
    )
  })

  it('keeps spacing for RTU-04 Hybrid', () => {
    expect(buildBulkRtuPictureFileName('2320 Bristol Circle', 'RTU-04 Hybrid', 1, 'jpg')).toBe(
      '2320-RTU-04 Hybrid (1).jpg',
    )
  })

  it('uses only the portfolio name before a slash', () => {
    expect(
      buildBulkRtuPictureFileName(
        '2320 Bristol Circle',
        'RTU-04 Hybrid/Dual Fuel Heat Pump',
        1,
        'jpg',
      ),
    ).toBe('2320-RTU-04 Hybrid (1).jpg')
  })

  it('keeps spacing from portfolio RTU name', () => {
    expect(buildBulkRtuPictureFileName('2320 Main St', 'RTU- 4B', 3, 'jpg')).toBe(
      '2320-RTU- 4B (3).jpg',
    )
    expect(buildBulkRtuPictureFileName('100 Leek Crescent', 'RTU- 01', 1, 'jpeg')).toBe(
      '100-RTU- 01 (1).jpeg',
    )
  })
})

describe('findNearestRtuAt', () => {
  const buildings: Building[] = [
    {
      park: 'P',
      address: '100 Test Rd',
      bu: '1',
      lat: 43.6,
      lng: -79.4,
      sqft: '1',
      cluster: 'C',
      manager: 'M',
      rtus: [
        { name: 'RTU- 01', description: '', lat: 43.6001, lng: -79.4001 },
        { name: 'RTU- 02', description: '', lat: 43.61, lng: -79.41 },
      ],
    },
  ]

  it('returns nearest RTU within range', () => {
    const match = findNearestRtuAt(buildings, 43.6001, -79.4001, 100)
    expect(match?.rtu.name).toBe('RTU- 01')
  })

  it('returns null when beyond drag-assign range', () => {
    expect(findNearestRtuAt(buildings, 43.601, -79.401, RTU_PICTURE_DROP_FEET)).toBeNull()
  })

  it('returns null when too far', () => {
    expect(findNearestRtuAt(buildings, 43.7, -79.5, 50)).toBeNull()
  })
})

describe('spreadStackedGpsPictures', () => {
  it('offsets duplicate GPS positions so markers do not stack', () => {
    const base = {
      id: 'a',
      file: new File([], 'a.jpg'),
      gpsLat: 43.6,
      gpsLng: -79.4,
      lat: 43.6,
      lng: -79.4,
      originalName: 'a.jpg',
      previewUrl: 'blob:a',
    }
    const spread = spreadStackedGpsPictures([
      base,
      { ...base, id: 'b', originalName: 'b.jpg', previewUrl: 'blob:b' },
      { ...base, id: 'c', originalName: 'c.jpg', previewUrl: 'blob:c' },
    ])
    expect(spread[0]!.lat).toBe(43.6)
    expect(spread[1]!.lat).not.toBe(spread[0]!.lat)
    expect(spread[2]!.lng).not.toBe(spread[0]!.lng)
  })
})
