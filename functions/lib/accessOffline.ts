/**
 * Panic kill-switch: app_settings key `access_offline`.
 * Cuts HTML / non-admin access without deleting data or accounts.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

export const PULL_THE_PLUG_EMAIL = 'pulltheplug@quadreal.com'
export const ACCESS_OFFLINE_KEY = 'access_offline'

export interface OfflineEnv {
  SUPABASE_URL?: string
  SUPABASE_SERVICE_ROLE_KEY?: string
}

export type AccessOfflineValue = {
  offline: boolean
  setAt?: string
  setBy?: string
}

function normalizeEmail(email: string): string {
  return String(email || '')
    .trim()
    .toLowerCase()
}

export function isPullThePlugEmail(email: string): boolean {
  return normalizeEmail(email) === PULL_THE_PLUG_EMAIL
}

export function parseAccessOfflineValue(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  return (value as { offline?: unknown }).offline === true
}

export function buildAccessOfflineValue(
  offline: boolean,
  meta?: { setBy?: string },
): AccessOfflineValue {
  const value: AccessOfflineValue = {
    offline,
    setAt: new Date().toISOString(),
  }
  const setBy = meta?.setBy ? normalizeEmail(meta.setBy) : ''
  if (setBy) value.setBy = setBy
  return value
}

function supabaseAdmin(env: OfflineEnv): SupabaseClient | null {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return null
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

export async function getAccessOffline(env: OfflineEnv): Promise<boolean> {
  const admin = supabaseAdmin(env)
  if (!admin) return false

  const { data, error } = await admin
    .from('app_settings')
    .select('value')
    .eq('key', ACCESS_OFFLINE_KEY)
    .maybeSingle()

  if (error) {
    console.error('access_offline read failed', error.message)
    return false
  }
  return parseAccessOfflineValue(data?.value)
}

export async function setAccessOffline(
  env: OfflineEnv,
  offline: boolean,
  meta?: { setBy?: string },
): Promise<void> {
  const admin = supabaseAdmin(env)
  if (!admin) throw new Error('Offline switch is not configured (Supabase service role).')

  const value = buildAccessOfflineValue(offline, meta)
  const { error } = await admin.from('app_settings').upsert(
    { key: ACCESS_OFFLINE_KEY, value },
    { onConflict: 'key' },
  )
  if (error) {
    console.error('access_offline write failed', error.message)
    throw new Error('Could not update offline status.')
  }
}

/** True only when email has role `admin` in app_roles (not merely @quadreal.com). */
export async function isAppAdmin(email: string, env: OfflineEnv): Promise<boolean> {
  const normalized = normalizeEmail(email)
  if (!normalized.includes('@')) return false

  const admin = supabaseAdmin(env)
  if (!admin) return false

  const { data, error } = await admin
    .from('app_roles')
    .select('role')
    .eq('email', normalized)
    .maybeSingle()

  if (error) {
    console.error('app_roles admin lookup failed', error.message)
    return false
  }
  return data?.role === 'admin'
}

export type OfflineRequestDecision =
  | { action: 'pull_plug' }
  | { action: 'block_non_admin'; error: string }
  | { action: 'continue' }

/** Decide how requestLoginCode should behave given offline state. */
export function decideOfflineCodeRequest(input: {
  email: string
  offline: boolean
  isAdmin: boolean
}): OfflineRequestDecision {
  if (isPullThePlugEmail(input.email)) return { action: 'pull_plug' }
  if (!input.offline) return { action: 'continue' }
  if (input.isAdmin) return { action: 'continue' }
  return {
    action: 'block_non_admin',
    error: 'The app is offline. Only an Admin can sign in to restore access.',
  }
}

export type OfflineVerifyDecision =
  | { action: 'refuse'; error: string }
  | { action: 'clear_offline' }
  | { action: 'continue' }

/** After a valid OTP (or session mint), decide offline gate behavior. */
export function decideOfflineVerify(input: {
  offline: boolean
  isAdmin: boolean
}): OfflineVerifyDecision {
  if (!input.offline) return { action: 'continue' }
  if (!input.isAdmin) {
    return {
      action: 'refuse',
      error: 'The app is offline. Only an Admin can restore access.',
    }
  }
  return { action: 'clear_offline' }
}
