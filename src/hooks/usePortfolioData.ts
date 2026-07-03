import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchPortfolio, savePortfolio, savePortfolioChanges } from '@/data/portfolioApi'
import type { PortfolioData } from '@/types/domain'
import { useAuth } from '@/hooks/useAuth'

export type { PortfolioData } from '@/types/domain'

export const PORTFOLIO_QUERY_KEY = ['portfolio'] as const

export interface UsePortfolioDataOptions {
  /** When true, skip background refetch so staged edits keep a stable baseline. */
  suspendRefetch?: boolean
}

export function usePortfolioData(_options: UsePortfolioDataOptions = {}) {
  return useQuery({
    queryKey: PORTFOLIO_QUERY_KEY,
    queryFn: fetchPortfolio,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    refetchOnReconnect: false,
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
    retry: false,
    onSuccess: (portfolio) => {
      queryClient.setQueryData(PORTFOLIO_QUERY_KEY, portfolio)
    },
  })
}

export interface SavePendingPortfolioInput {
  baseline: PortfolioData
  pending: PortfolioData
}

export function useSavePendingPortfolio() {
  const queryClient = useQueryClient()
  const { isAuthenticated } = useAuth()

  return useMutation({
    mutationFn: async ({ baseline, pending }: SavePendingPortfolioInput) => {
      if (!isAuthenticated) {
        throw new Error('Sign in to save portfolio changes.')
      }
      return savePortfolioChanges(baseline, pending)
    },
    retry: false,
    onSuccess: (portfolio) => {
      queryClient.setQueryData(PORTFOLIO_QUERY_KEY, portfolio)
    },
  })
}
