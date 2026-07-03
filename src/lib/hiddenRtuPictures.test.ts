import { describe, expect, it, beforeEach, vi } from 'vitest'
import {
  hideRtuManifestPicture,
  isRtuManifestPictureHidden,
  clearHiddenRtuPictureCache,
} from '@/lib/hiddenRtuPictures'

vi.mock('@/data/mediaApi', () => ({
  fetchHiddenPictureKeys: vi.fn(async () => new Set<string>()),
  setPictureHidden: vi.fn(async () => undefined),
}))

vi.mock('@/lib/rtuPictures', () => ({
  notifyRtuPicturesChanged: vi.fn(),
}))

describe('hiddenRtuPictures', () => {
  beforeEach(() => {
    clearHiddenRtuPictureCache()
    vi.clearAllMocks()
  })

  it('hides and checks manifest picture keys', async () => {
    const key = '2320 Bristol Circle|RTU-04 Hybrid'
    const fileName = '2320-RTU-04HYBRID (1).jpg'
    expect(isRtuManifestPictureHidden(key, fileName)).toBe(false)
    await hideRtuManifestPicture(key, fileName)
    expect(isRtuManifestPictureHidden(key, fileName)).toBe(true)
  })
})
