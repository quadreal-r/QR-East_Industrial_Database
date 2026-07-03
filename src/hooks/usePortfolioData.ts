import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchPortfolio, savePortfolio } from '@/data/portfolioApi'
import type { PortfolioData } from '@/types/domain'
import { useAuth } from '@/hooks/useAuth'

export type { PortfolioData } from '@/types/domain'

export const PORTFOLIO_QUERY_KEY = ['portfolio'] as const

export function usePortfolioData() {
  return useQuery({
    queryKey: PORTFOLIO_QUERY_KEY,
    queryFn: fetchPortfolio,
    staleTime: 60_000,
  })
}

export function useSavePortfolio() {
  const queryClient = useQueryClient()
  const { isAuthenticated } = useAuth()

  return useMutation({
    mutationFn: async (portfolio: PortfolioData) => {
      if (!isAuthenticated) {
        throw new Error('Sign in to save portfolio changes.')
      }
      return savePortfolio(portfolio)
    },
    onSuccess: (portfolio) => {
      queryClient.setQueryData(PORTFOLIO_QUERY_KEY, portfolio)
    },
  })
}
