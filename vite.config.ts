import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

const GITHUB_PAGES_BASE = '/QR-East_Industrial_Database/'

/** Dev uses base `/`. Redirect GitHub Pages bookmarks so asset paths stay correct. */
function devGithubPagesRedirect(): Plugin {
  return {
    name: 'dev-github-pages-redirect',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url ?? '/'
        if (url === GITHUB_PAGES_BASE || url.startsWith(`${GITHUB_PAGES_BASE}?`)) {
          const qs = url.includes('?') ? url.slice(url.indexOf('?')) : ''
          res.writeHead(302, { Location: `/${qs}` })
          res.end()
          return
        }
        if (url.startsWith(GITHUB_PAGES_BASE)) {
          const rest = url.slice(GITHUB_PAGES_BASE.length) || ''
          res.writeHead(302, { Location: `/${rest}` })
          res.end()
          return
        }
        next()
      })
    },
  }
}

const projectRoot = path.resolve(__dirname)

export default defineConfig(({ command }) => ({
  plugins: [react(), ...(command === 'serve' ? [devGithubPagesRedirect()] : [])],
  // GitHub Pages needs the subpath; local dev is simpler at http://localhost:5173/
  base: command === 'serve' ? '/' : GITHUB_PAGES_BASE,
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
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
}))
