import { createClient } from '@supabase/supabase-js'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import { pickLocalDevEmail, type LocalDevAs } from './src/lib/localDevEmail'

const projectRoot = path.resolve(__dirname)

function localSessionPlugin(env: Record<string, string>): Plugin {
  return {
    name: 'local-supabase-session',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/api/session', async (request, response) => {
        response.setHeader('Content-Type', 'application/json')
        response.setHeader('Cache-Control', 'no-store')
        if (request.method !== 'GET') {
          response.statusCode = 405
          response.end(JSON.stringify({ error: 'Method not allowed' }))
          return
        }

        const supabaseUrl = env.SUPABASE_URL || env.VITE_SUPABASE_URL
        const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY
        if (!supabaseUrl || !serviceRoleKey) {
          response.statusCode = 500
          response.end(JSON.stringify({ error: 'Set SUPABASE_SERVICE_ROLE_KEY in .env.local' }))
          return
        }

        try {
          const admin = createClient(supabaseUrl, serviceRoleKey, {
            auth: { autoRefreshToken: false, persistSession: false },
          })
          const requestUrl = new URL(request.url || '/api/session', 'http://127.0.0.1')
          const asParam = requestUrl.searchParams.get('as')
          const as: LocalDevAs | null =
            asParam === 'admin' || asParam === 'viewer' ? asParam : null

          const { data: roleRows, error: rolesError } = await admin
            .from('app_roles')
            .select('email, role')
            .order('created_at')
          if (rolesError) throw rolesError

          const adminEmails = (roleRows ?? [])
            .filter((row) => row.role === 'admin' && typeof row.email === 'string')
            .map((row) => row.email as string)
          const viewerEmails = (roleRows ?? [])
            .filter((row) => row.role === 'viewer' && typeof row.email === 'string')
            .map((row) => row.email as string)

          const email = pickLocalDevEmail({
            as,
            configuredEmail: env.LOCAL_DEV_EMAIL ?? '',
            adminEmails,
            viewerEmails,
          })

          // Respect Manage users / app_roles. Never force Admin on every refresh —
          // that was overwriting Viewer demotions during local testing.
          const { data: existingRole, error: roleLookupError } = await admin
            .from('app_roles')
            .select('role')
            .eq('email', email)
            .maybeSingle()
          if (roleLookupError) throw roleLookupError

          let role: 'admin' | 'viewer'
          if (existingRole?.role === 'admin' || existingRole?.role === 'viewer') {
            role = existingRole.role
          } else {
            // First local login only: seed Admin so a fresh machine is usable.
            const { error: seedError } = await admin
              .from('app_roles')
              .insert({ email, role: 'admin' })
            if (seedError) throw seedError
            role = 'admin'
          }

          const { data: link, error: linkError } = await admin.auth.admin.generateLink({
            type: 'magiclink',
            email,
          })
          if (linkError) throw linkError
          const tokenHash = link.properties?.hashed_token
          if (!tokenHash) throw new Error('Supabase did not return a session token')

          const { data: verified, error: verifyError } = await admin.auth.verifyOtp({
            type: 'email',
            token_hash: tokenHash,
          })
          if (verifyError) throw verifyError
          if (!verified.session) throw new Error('Supabase did not create a session')

          response.end(
            JSON.stringify({
              access_token: verified.session.access_token,
              refresh_token: verified.session.refresh_token,
              email,
              role,
            }),
          )
        } catch (error) {
          console.error('Could not create local Supabase session', error)
          response.statusCode = 500
          response.end(
            JSON.stringify({
              error: error instanceof Error ? error.message : 'Could not create local session',
            }),
          )
        }
      })
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, projectRoot, '')
  return {
  plugins: [react(), localSessionPlugin(env)],
  // Site root (`/`) for local + Cloudflare Pages.
  base: process.env.VITE_BASE?.trim() || '/',
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
  // Only crawl the map app entry. public/insp360/viewer.html is a standalone
  // embed (CDN import map) and must not be treated as a Vite dependency root.
  optimizeDeps: {
    entries: ['index.html'],
  },
  server: {
    host: '127.0.0.1',
    // 5173 is reserved for QR Drawing Explorer on this machine.
    port: 5174,
    strictPort: true,
    open: '/',
    // Keep the dev process alive through transient client disconnects (hard refresh, tab close).
    watch: {
      // OneDrive / sync folders can touch .env and config files and trigger restart storms.
      ignored: [
        '**/vite.config.ts',
        '**/.env*',
        '**/dist/**',
        '**/dist-portable/**',
        '**/reports/**',
        '**/supabase/data/**',
        '**/public/database/**',
        (watchPath: string) => !path.resolve(watchPath).startsWith(projectRoot),
      ],
    },
  },
  }
})
