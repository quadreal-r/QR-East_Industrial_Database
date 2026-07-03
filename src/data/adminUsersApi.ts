import { supabase } from '@/lib/supabaseClient'

export interface AppUser {
  id: string
  email: string
  name: string
  createdAt: string
}

type AdminUsersResponse =
  | { users: AppUser[] }
  | { user: AppUser }
  | { ok: true }
  | { error: string }

async function invokeAdminUsers(body: Record<string, unknown>): Promise<AdminUsersResponse> {
  const { data: sessionData } = await supabase.auth.getSession()
  if (!sessionData.session?.access_token) {
    throw new Error('Sign in required')
  }

  const { data, error } = await supabase.functions.invoke<AdminUsersResponse>('admin-users', {
    body,
  })

  if (error) {
    throw new Error(error.message || 'User admin request failed')
  }

  if (data && typeof data === 'object' && 'error' in data && typeof data.error === 'string') {
    throw new Error(data.error)
  }

  if (!data) {
    throw new Error('Empty response from user admin service')
  }

  return data
}

export async function fetchIsAppAdmin(): Promise<boolean> {
  const { data, error } = await supabase.rpc('is_app_admin')
  if (error) return false
  return Boolean(data)
}

export async function listAppUsers(): Promise<AppUser[]> {
  const data = await invokeAdminUsers({ action: 'list' })
  if (!('users' in data) || !Array.isArray(data.users)) {
    throw new Error('Unexpected response when listing users')
  }
  return data.users
}

export async function createAppUser(input: {
  name: string
  email: string
  password: string
}): Promise<AppUser> {
  const data = await invokeAdminUsers({
    action: 'create',
    name: input.name.trim(),
    email: input.email.trim(),
    password: input.password,
  })
  if (!('user' in data) || !data.user) {
    throw new Error('Unexpected response when creating user')
  }
  return data.user
}

export async function deleteAppUser(userId: string): Promise<void> {
  await invokeAdminUsers({ action: 'delete', userId })
}
