import { describe, expect, it } from 'vitest'
import { errorMessage } from '@/lib/errorMessage'

describe('errorMessage', () => {
  it('reads Error messages', () => {
    expect(errorMessage(new Error('Save failed'))).toBe('Save failed')
  })

  it('reads Supabase-style error objects', () => {
    expect(
      errorMessage({
        message: 'column tenants.polygon_id does not exist',
        details: 'Check migration',
      }),
    ).toBe('column tenants.polygon_id does not exist\nCheck migration')
  })
})
