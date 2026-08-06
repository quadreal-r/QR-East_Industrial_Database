# AGENTS.md

## Cursor Cloud specific instructions

Building Map Explorer is a **client-only React SPA** (Vite + React 19 + TypeScript). There is **no local backend server, database, or container** to run — Supabase, Google Maps, and Cloudflare R2 are external hosted dependencies. The only local service is the Vite dev server.

### Running the app

- `npm run dev` serves the app on http://localhost:5173/ (see `package.json`).
- The dev server starts and the UI renders **without any environment variables**. In this mode the app runs **read-only / static**: it loads bundled portfolio JSON from `supabase/data/` instead of Supabase. Browsing buildings, search, filters, the cost estimator, and Excel export all work offline this way.
- Expected (not a bug): with no `VITE_GOOGLE_MAPS_API_KEY`, the right-hand map panel shows a blue **"Map placeholder — Set VITE_GOOGLE_MAPS_API_KEY in .env.local"** message. Sidebar/list/filter/cost features still work.

### Full end-to-end (auth + editing) requires secrets

To exercise login, editing markers/notes/polygons, and Excel-import-to-DB, copy `.env.example` → `.env.local` and supply `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, and `VITE_GOOGLE_MAPS_API_KEY` (plus a Supabase project with `supabase/migrations/*` and `supabase/seed.sql` applied). Vite only reads `VITE_`-prefixed vars; restart `npm run dev` after editing `.env.local`.

### Lint / test / build (CI gates, all defined in `package.json`)

- `npm run lint` — ESLint
- `npm run typecheck` — `tsc -b --noEmit`
- `npm run test` — Vitest (jsdom)
- `npm run build` — `tsc -b && vite build && npm run build:portable`

Gotcha: `npm run build` regenerates `public/portable-template.html` (the single-file portable bundle) as a side effect of `build:portable`. This is committed and normally regenerates identically; double-check `git status` before committing build output so you don't accidentally include it.
