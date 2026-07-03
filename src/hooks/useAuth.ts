import { useContext } from 'react'
import { AuthContext, type AuthContextValue } from '@/app/authContext'

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}

/** Alias for README compatibility. */
export const useAuthContext = useAuth
