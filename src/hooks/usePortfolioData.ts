import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  fetchPortfolio,
  savePortfolio,
  savePortfolioChanges,
  saveBuildingMapView,
  type BuildingMapView,
} from '@/data/portfolioApi'
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

export interface SaveBuildingMapViewInput {
  buildingId: number
  view: BuildingMapView | null
}

/** Persist (or clear) one building's saved map camera without touching the staged-edit flow. */
export function useSaveBuildingMapView() {
  const queryClient = useQueryClient()
  const { isAuthenticated } = useAuth()

  return useMutation({
    mutationFn: async ({ buildingId, view }: SaveBuildingMapViewInput) => {
      if (!isAuthenticated) {
        throw new Error('Sign in to save map position.')
      }
      await saveBuildingMapView(buildingId, view)
      return { buildingId, view }
    },
    retry: false,
    onSuccess: ({ buildingId, view }) => {
      queryClient.setQueryData<PortfolioData>(PORTFOLIO_QUERY_KEY, (prev) => {
        if (!prev) return prev
        return {
          ...prev,
          buildings: prev.buildings.map((building) =>
            building.id === buildingId
              ? {
                  ...building,
                  mapLat: view?.lat ?? null,
                  mapLng: view?.lng ?? null,
                  mapZoom: view?.zoom ?? null,
                  mapHeading: view?.heading ?? null,
                  mapTilt: view?.tilt ?? null,
                }
              : building,
          ),
        }
      })
    },
  })
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
