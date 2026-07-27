import { describe, expect, it } from 'vitest'
import { errorMessage } from '@/lib/errorMessage'

describe('errorMessage', () => {
  it('reads Error messages', () => {
    expect(errorMessage(new Error('Save failed'))).toBe('Save failed')
  })

  it('reads nested error objects instead of showing [object Object]', () => {
    expect(
      errorMessage({
        error: { message: 'JWTExpired: "exp" claim timestamp check failed' },
      }),
    ).toBe('JWTExpired: "exp" claim timestamp check failed')
    expect(errorMessage({ detail: { code: 'bad', reason: 'nope' } })).toContain('bad')
  })

  it('ignores the useless [object Object] string and uses the fallback', () => {
    expect(errorMessage('[object Object]', 'Could not connect')).toBe('Could not connect')
    expect(errorMessage({ message: '[object Object]' }, 'Could not connect')).toBe(
      'Could not connect',
    )
  })
})
