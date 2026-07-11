# Import / Export

Excel round-trip for portfolio data using SheetJS (`xlsx`).

## Standards

- Sheet names: `Buildings`, `RTUs`, `Tenant Polygons`, `Utilities` (live import).
- `RTU Pictures` and any other non-active sheets are treated as **dormant** (archived for later; not applied to portfolio tables).
- Import merges onto the live portfolio by address / RTU name so database ids, saved map views, notes, and 360° gates are preserved.
- When signed in, Settings import stages changes; use Save to write to Supabase.
- CLI: `npm run import-portfolio-excel -- "C:\path\to\export.xlsx"` (optional `--dry-run`).
- Export is always client-side download; no auth required.

## Components

- `ImportExportButtons.tsx` — used in map top bar and settings modal.
