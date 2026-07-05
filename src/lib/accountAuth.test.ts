import { describe, expect, it } from 'vitest'
import { isPasskeySupported, totpQrDataUrl } from './accountAuth'

describe('totpQrDataUrl', () => {
  it('encodes svg for use in an img src', () => {
    const url = totpQrDataUrl('<svg xmlns="http://www.w3.org/2000/svg"></svg>')
    expect(url.startsWith('data:image/svg+xml;charset=utf-8,')).toBe(true)
    expect(decodeURIComponent(url.split(',')[1]!)).toContain('<svg')
  })
})

describe('isPasskeySupported', () => {
  it('returns a boolean', () => {
    expect(typeof isPasskeySupported()).toBe('boolean')
  })
})
