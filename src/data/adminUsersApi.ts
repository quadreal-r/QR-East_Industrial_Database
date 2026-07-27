import { supabase } from '@/lib/supabaseClient'
import type { AppRole } from '@/app/authContext'

export interface AppUserRole {
  email: string
  role: AppRole
  createdAt: string
}

export async function fetchIsAppAdmin(): Promise<boolean> {
  const { data, error } = await supabase.rpc('is_app_admin')
  if (error) return false
  return Boolean(data)
}

export async function listAppUserRoles(): Promise<AppUserRole[]> {
  const { data, error } = await supabase
    .from('app_roles')
    .select('email, role, created_at')
    .order('email')
  if (error) throw error
  return (data ?? []).map((entry) => ({
    email: entry.email,
    role: entry.role === 'admin' ? 'admin' : 'viewer',
    createdAt: entry.created_at,
  }))
}

export async function saveAppUserRole(input: {
  email: string
  role: AppRole
}): Promise<AppUserRole> {
  const email = input.email.trim().toLowerCase()
  const { data, error } = await supabase
    .from('app_roles')
    .upsert({ email, role: input.role }, { onConflict: 'email' })
    .select('email, role, created_at')
    .single()
  if (error) throw error
  return {
    email: data.email,
    role: data.role === 'admin' ? 'admin' : 'viewer',
    createdAt: data.created_at,
  }
}

export async function deleteAppUserRole(email: string): Promise<void> {
  const { error } = await supabase.from('app_roles').delete().eq('email', email)
  if (error) throw error
}
