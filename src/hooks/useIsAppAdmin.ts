import { useQuery } from '@tanstack/react-query'
import { fetchIsAppAdmin } from '@/data/adminUsersApi'
import { useAuth } from '@/hooks/useAuth'

export function useIsAppAdmin() {
  const { isAuthenticated } = useAuth()

  return useQuery({
    queryKey: ['isAppAdmin'],
    queryFn: fetchIsAppAdmin,
    enabled: isAuthenticated,
    staleTime: 5 * 60 * 1000,
  })
}
