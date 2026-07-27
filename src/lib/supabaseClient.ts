import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.types'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim()
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim()

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey)

/** Link to the project's Supabase dashboard, derived from the configured URL. */
export const supabaseDashboardUrl = (() => {
  const ref = supabaseUrl?.match(/^https?:\/\/([a-z0-9]+)\.supabase\.co/i)?.[1]
  return ref ? `https://supabase.com/dashboard/project/${ref}` : 'https://supabase.com/dashboard'
})()

function createSupabaseClient() {
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      'Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. Copy .env.example to .env.local and add your Supabase project credentials.',
    )
  }
  return createClient<Database>(supabaseUrl, supabaseAnonKey)
}

/** Typed Supabase client — requires env vars (no offline fallback). */
export const supabase = createSupabaseClient()
