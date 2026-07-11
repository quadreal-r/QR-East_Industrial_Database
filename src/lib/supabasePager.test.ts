import { describe, expect, it } from 'vitest'
import { SUPABASE_PAGE_SIZE, fetchAllPages } from '@/lib/supabasePager'

describe('fetchAllPages', () => {
  it('paginates past the PostgREST 1000-row cap', async () => {
    const total = SUPABASE_PAGE_SIZE + 84
    const rows = await fetchAllPages<number>(async (from, to) => {
      const page = []
      for (let i = from; i <= to && i < total; i++) page.push(i)
      return { data: page, error: null }
    })
    expect(rows).toHaveLength(total)
    expect(rows[0]).toBe(0)
    expect(rows[total - 1]).toBe(total - 1)
  })
})
