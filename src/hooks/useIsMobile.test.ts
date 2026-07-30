import { describe, expect, it } from 'vitest'
import { MOBILE_BREAKPOINT_PX } from './useIsMobile'

describe('useIsMobile', () => {
  it('uses a phone-oriented breakpoint below typical tablet landscape', () => {
    expect(MOBILE_BREAKPOINT_PX).toBe(768)
  })
})
