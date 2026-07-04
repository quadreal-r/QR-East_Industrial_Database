# AGENTS.md

## Cursor Cloud specific instructions

Building Map Explorer is a single Vite + React 19 + TypeScript SPA (no custom backend). The backend is hosted Supabase (Postgres + Auth + RLS); Google Maps renders the map; Cloudflare R2 serves RTU media binaries. Standard commands live in `README.md` and `package.json` (`dev`, `build`, `lint`, `typecheck`, `test`). The `dev:*` npm variants are Windows-only `.cmd` wrappers — on Linux just use `npm run dev` (serves at `http://127.0.0.1:5173/`, `strictPort`).

### Environment variables are required at module load — for BOTH dev and tests
`src/lib/supabaseClient.ts` and `src/lib/env.ts` throw at import time when `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, or `VITE_GOOGLE_MAPS_API_KEY` are missing. There is no offline fallback. Consequences:
- `npm run dev` won't boot without them.
- `npm test` fails ~14 test files (e.g. anything importing `data/mediaApi`, `data/settingsApi`) with "Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY" even though those tests don't hit the network. The other ~34 files / 145 tests still pass. With the vars present, all 48 files / 232 tests pass.
- `npm run lint`, `npm run typecheck`, and `npm run build` do NOT need env vars (Vite doesn't execute the modules during build).

Provide the vars via a gitignored `.env.local` (see `.env.example` for the key names). The three `VITE_*` runtime keys are public: the Supabase anon key is RLS-protected (public read) and, along with the referrer-restricted Google Maps key, is already shipped in the public deployed bundle at `https://quadreal-r.github.io/building-map-explorer/`. For unit tests alone, any non-empty placeholder values work (`VITE_SUPABASE_URL` must be a valid `http(s)` URL); for running the app end-to-end you need the real public values so Supabase data loads and the map renders.

### Running the app
Start the dev server long-lived (e.g. tmux) since it must stay up while testing. Anonymous users can browse the map, filter, use the cost estimator, and export Excel. Editing (markers, polygons, notes, schedule, pricing, settings) requires signing in via Settings → Account (Supabase email/password) — no test account is bundled. On localhost the Google Maps vector map may log a benign "failed to load a Vector Map, falling back to raster" console error; the map still renders and is fully usable.
