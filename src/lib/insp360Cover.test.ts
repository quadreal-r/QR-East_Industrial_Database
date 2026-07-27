import { zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import {
  extractInsp360CoverBlob,
  extractInsp360CoverBytes,
  insp360CoverCompanionKey,
  insp360TourCompanionKey,
} from '@/lib/insp360Cover'

describe('insp360Cover', () => {
  it('builds companion cover keys beside the tour', () => {
    expect(insp360CoverCompanionKey('60-birmingham/electrical-room__20260715.insp360')).toBe(
      '60-birmingham/electrical-room__20260715.cover.jpg',
    )
    expect(insp360CoverCompanionKey('tour.INSP360')).toBe('tour.cover.jpg')
  })

  it('builds .tour.json companion keys', () => {
    expect(insp360TourCompanionKey('60-birmingham/electrical-room__20260715.insp360')).toBe(
      '60-birmingham/electrical-room__20260715.tour.json',
    )
    expect(insp360TourCompanionKey('tour.ZIP')).toBe('tour.tour.json')
  })

  it('extracts preview.jpg from an .insp360 zip without reading other photos', () => {
    // Minimal JPEG SOI/EOI markers — enough for extract to return the bytes.
    const preview = new Uint8Array([0xff, 0xd8, 0xff, 0xd9, 0x01, 0x02, 0x03])
    const other = new Uint8Array(2000).fill(7)
    const zipped = zipSync(
      {
        'preview.jpg': preview,
        'photos/big.jpg': other,
      },
      { level: 0 },
    )
    const buf = zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength)
    const extracted = extractInsp360CoverBytes(buf)
    expect(extracted).not.toBeNull()
    expect(extracted!.name.toLowerCase()).toContain('preview.jpg')
    expect(Array.from(extracted!.bytes.slice(0, 4))).toEqual([0xff, 0xd8, 0xff, 0xd9])
    expect(extractInsp360CoverBlob(buf)?.type).toMatch(/^image\//)
  })
})
