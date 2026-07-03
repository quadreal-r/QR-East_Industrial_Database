import { describe, expect, it } from 'vitest'
import { PORTFOLIO_QUERY_KEY } from '@/hooks/usePortfolioData'

describe('usePortfolioData', () => {
  it('uses a stable portfolio query key', () => {
    expect(PORTFOLIO_QUERY_KEY).toEqual(['portfolio'])
  })
})
