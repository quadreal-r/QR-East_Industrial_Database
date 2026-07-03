import { describe, expect, it } from 'vitest'
import { getRtuPicturesBaseUrl, usesRemoteRtuPicturesCdn } from './rtuPictureUrls'

describe('rtuPictureUrls', () => {
  it('returns a base URL ending with slash', () => {
    expect(getRtuPicturesBaseUrl()).toMatch(/\/$/)
  })

  it('reports remote CDN usage from env', () => {
    expect(typeof usesRemoteRtuPicturesCdn()).toBe('boolean')
  })
})
