# App shell

Root layout and providers for the React app.

| File | Role |
|------|------|
| `AppShell.tsx` | Sidebar + map column + cost banner + modals |
| `providers.tsx` | `QueryClientProvider` + `AuthProvider` |
| `authContext.tsx` | Supabase session context |

## Data loading

`usePortfolioData` loads from Supabase when env is configured; otherwise (or on fetch error) it falls back to bundled JSON under `supabase/data/`.

Excel import updates local state and the React Query cache (`portfolio` key).

## SPA routing

Cloudflare Pages serves `dist/` at the site root. Keep `public/_headers` for cache/security headers. A `public/404.html` may still exist from the old GitHub Pages setup; it is not required for Cloudflare hosting.

## Entry

`src/main.tsx` mounts `<Providers><App /></Providers>` and imports `src/styles/legacy.css`.
