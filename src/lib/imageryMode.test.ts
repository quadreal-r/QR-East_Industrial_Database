import { describe, expect, it } from 'vitest'
import { imageryModeIdFromIndex, imageryModeIndexFromId } from '@/lib/imageryMode'

describe('imageryModeIndexFromId', () => {
  it('maps known ids to indices', () => {
    expect(imageryModeIndexFromId('google')).toBe(0)
    expect(imageryModeIndexFromId('esri')).toBe(1)
  })

  it('defaults unknown values to google', () => {
    expect(imageryModeIndexFromId(null)).toBe(0)
    expect(imageryModeIndexFromId(undefined)).toBe(0)
  })
})

describe('imageryModeIdFromIndex', () => {
  it('maps indices to ids', () => {
    expect(imageryModeIdFromIndex(0)).toBe('google')
    expect(imageryModeIdFromIndex(1)).toBe('esri')
  })

  it('wraps out-of-range indices', () => {
    expect(imageryModeIdFromIndex(2)).toBe('google')
    expect(imageryModeIdFromIndex(-1)).toBe('esri')
  })
})
