# Building Map Explorer

QuadReal Industrial Portfolio Map — a strongly typed React SPA for exploring buildings, RTUs, tenants, utilities, and polygons on Google Maps.

**Live site:** https://quadreal-r.github.io/building-map-explorer/

## Stack

- **Frontend:** Vite + React 19 + TypeScript (strict)
- **State:** Zustand (UI/filters) + TanStack Query (data)
- **Database:** Supabase (Postgres + Auth + RLS)
- **Media:** Cloudflare R2 (RTU picture/document binaries only)
- **Map:** Google Maps JavaScript API (vector map)
- **Deploy:** GitHub Actions → GitHub Pages

## Quick start

```bash
git clone git@github.com:quadreal-r/building-map-explorer.git
cd building-map-explorer
npm install
cp .env.example .env.local   # add your keys
npm run dev
```

Open http://localhost:5173/ after `npm run dev`.

**Requires Supabase env vars** — the app loads structured map data from Postgres at runtime.

## Environment variables

| Variable | Description |
|----------|-------------|
| `VITE_SUPABASE_URL` | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon key (public, RLS-protected) |
| `VITE_GOOGLE_MAPS_API_KEY` | Google Maps API key (HTTP referrer restricted) |
| `VITE_GOOGLE_MAPS_MAP_ID` | Vector map ID (default: `8e5479ffab76936efa73ede6`) |
| `VITE_RTU_PICTURES_BASE_URL` | Cloudflare R2 public URL for RTU pictures |
| `VITE_RTU_DOCUMENTS_BASE_URL` | Cloudflare R2 public URL for RTU documents |

Set the same `VITE_*` values as **GitHub repository secrets** for CI deploys.

**R2 upload secrets** (GitHub Actions + local upload scripts only — not bundled into the app):

| Secret | Description |
|--------|-------------|
| `R2_ACCOUNT_ID` | Cloudflare account ID |
| `R2_ACCESS_KEY_ID` | R2 API token access key |
| `R2_SECRET_ACCESS_KEY` | R2 API token secret |
| `R2_BUCKET_NAME` | R2 bucket name |
| `R2_KEY_PREFIX` | Optional object prefix (e.g. `rtu-pictures/`) |

Aliases `CLOUDFLARE_*` are also supported in scripts and CI.

**Local-only** (migration script):

| Variable | Description |
|----------|-------------|
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key for `npm run migrate-json-to-supabase` |

## Auth & editing

Sign in from **Settings → Account** (email/password via Supabase Auth).

| Role | Capabilities |
|------|--------------|
| **Anonymous** | Browse map, filters, cost estimator, Excel export |
| **Authenticated** | Edit markers, polygons, notes, schedule, pricing, settings; import Excel to Supabase |

Edits write **directly to Supabase** — there is no Settings sync or JSON deploy step for map data.

## Scripts

| Command | Purpose |
|---------|---------|
| `npm run dev` | Local dev server |
| `npm run build` | Production build |
| `npm run test` | Vitest unit tests |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript check |
| `npm run push-live` | Test, commit, push to `main` |
| `npm run migrate-json-to-supabase` | One-time import from legacy `supabase/data/*.json` |
| `npm run upload-rtu-pictures-r2` | Upload local RTU images to Cloudflare R2 |
| `npm run upload-rtu-documents-r2` | Upload RTU documents to R2 |
| `npm run sync-rtu-pictures-r2` | Compare manifest vs R2 and upload missing files |

## RTU pictures & documents

- **Metadata** (which files belong to each RTU) lives in Supabase (`rtu_pictures`, `rtu_documents`).
- **Binary files** live on Cloudflare R2; the app loads them via `VITE_RTU_PICTURES_BASE_URL` and `VITE_RTU_DOCUMENTS_BASE_URL`.

Upload binaries with the R2 scripts above, then ensure metadata rows exist in Supabase (via the app or migration).

## Database setup

1. Apply migrations — see [`supabase/README.md`](supabase/README.md):

   ```powershell
   npm run db:push
   ```

2. If upgrading from legacy JSON (schedule, pricing, media metadata): `npm run migrate-json-to-supabase`

RLS: **public read**, **authenticated write**.

Full architecture: [`docs/DATA_ARCHITECTURE.md`](docs/DATA_ARCHITECTURE.md)

## Commit and push

See [HELP.md](HELP.md#push-a-new-build-full-checklist) for the full **push new build** checklist.

## Project structure

Each folder contains a `README.md` describing coding standards for that layer:

```
src/
  app/          App shell, providers, auth
  components/   Reusable UI (Button, Chip, Modal, …)
  data/         Supabase API modules
  features/     Sidebar, map, cost estimator, auth, settings
  hooks/        Data and filter hooks
  lib/          Pure logic (filters, RTU, cost estimator)
  stores/       Zustand stores
  types/        Domain + database types
  styles/       Legacy CSS (ported from original HTML)
supabase/       Migrations, legacy JSON snapshots
scripts/        Data extraction and R2 utilities
.github/        CI/CD workflow
```

## Legacy migration

The original single-file app (`building_map_explorer_v2026_06_20_3.html`) is parsed by `scripts/extract.ts` into normalized SQL + JSON snapshots. Use `npm run migrate-json-to-supabase` to load those snapshots into Postgres.

## License

Private — QuadReal Property Group.
