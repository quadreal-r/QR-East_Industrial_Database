# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/).

## [1.14.75] - 2026-07-27

### Changed

- Sync the embedded Map360 viewer to v1.2.82

## [1.14.74] - 2026-07-27

### Fixed

- GitHub Actions CI tests failing without local Supabase `.env.local` credentials

## [1.14.73] - 2026-07-27

### Added

- Three-stage RTU Replacement Cost Center panel: minimized, half (map still visible), and full (covers the map, sidebar stays)

### Fixed

- RTU picture Download when viewing Cloudflare photos (CORS / canvas export)

## [1.14.71] - 2026-07-27

### Fixed

- Match RTU picture filenames like `6150E-RTU-…` / `6150W-RTU-…` to Kennedy East (A) and West (B)

### Changed

- Accept `QR-360-Inspections_v*.html` naming when syncing the embedded Map360 viewer

## [1.14.69] - 2026-07-26

### Added

- Cloudflare Access sign-in for the live site, with Admin/Viewer app roles managed from Settings
- Cloud-hosted 360° tours: publish an `.insp360` to Cloudflare R2 so any user can open it without a local copy
- Persistent tour cache (Cache API with OPFS fallback), cover previews, and download speed/progress while a cloud tour loads
- Building CAPEX budgets by year, including notes, CAPEX status, job/project type, and shared business-unit splits
- Per-RTU replacement budgets that feed the cost estimator and RCB building detail
- Activity log in Settings covering sign-ins, tour opens, imports/exports, and budget/schedule saves, with an emailed digest
- RCB Excel export plus re-import of an edited RCB report
- Excel importers for CAPEX HVAC budgets, CAPEX RTU notes, and equipment replacement years
- Search by RTU name/number and by CAPEX status
- Localhost sign-in shim so the dev server can preview Admin and Viewer roles without Access

### Changed

- Sync the embedded QR-360° viewer to v1.2.81
- Move hosting to Cloudflare Pages with Wrangler config, cache headers, a session endpoint, and a GitHub CI check workflow
- Split Cloudflare work across the krutki11 (tour storage) and quadreal (map app) accounts, documented in `docs/CLOUDFLARE_ACCOUNTS.md`
- Refresh Settings, cost banner, sidebar, and map info window presentation for the new budget fields

### Removed

- In-app Login, MFA challenge, and password reset modals, now handled by Cloudflare Access

## [1.13.0] - 2026-07-14

### Added

- Save and restore an All Buildings map camera (center, zoom, rotation) after rotating with the green overview button
- Circle tenant suites on the map when search matches a tenant name
- QuadReal brand favicon and logo assets

### Changed

- Restyle sidebar stats, Advanced filters, and map layer toggles for clearer hierarchy
- Simplify building list cards (Tenants label; drop manager, vacant, 20yr, and Notes)
- Sync embedded QR-360° viewer to v1.1.21
- Make search-hit circles outline-only so map clicks pass through to markers underneath

### Fixed

- Fix left-library thumbnail #2 staying blank when opening large Electrical Room tours

## [1.12.1] - 2026-07-13

### Changed

- Open 360° tours on the first panorama instead of resuming the last viewed photo
- Point Supabase Auth Site URL at the renamed GitHub Pages path

### Fixed

- Fix Change tour Link failing when the embed script could not call module-scoped save/mirror helpers
- Prefer the opened `.insp360` file bytes when linking so large tours do not rebuild from memory

## [1.12.0] - 2026-07-13

### Added

- Change tour for 360° gates (viewer gear and Edit 360° Gates) so you can unlink and attach a different `.insp360`

### Changed

- Point GitHub Pages base, docs, and package identity at renamed repo `QR-East_Industrial_Database`
- Sync embedded QR-360° viewer to v1.1.17

### Fixed

- Make gate tour Link more reliable when host storage is full, with clearer retry guidance on failure

## [1.11.0] - 2026-07-13

### Added

- Building operator fields (operator, phone, ops manager, GM, VP) with filters and Excel/import support
- Linked 360° gate tours that remember the on-disk `.insp360` and reopen from Reconnect when needed
- QR-360° viewer sync script (`npm run sync:qr360-viewer`) so the live embed stays on `insp360/viewer.html`
- Search-hit map circles and clearer highlight targets when stepping through sidebar results
- Portfolio Excel extra-sheet merge helpers and last-import file memory

### Changed

- Store map camera per building only (remove portfolio-level map views)
- Prefer opening large linked tours from the picked file/handle instead of hanging on a full browser cache copy

### Fixed

- Open linked Electrical/Sprinkler gate tours into photos after Enter / Reconnect (including ~100MB+ projects)
- Bridge viewer module APIs so reconnect can call `openProject` from the embed integration script

## [1.10.0] - 2026-07-11

### Added

- Electrical and sprinkler room 360° sphere gates with tour URL linking in Edit 360° Gates
- Per-gate memory in the 360° viewer so opening a gateway reopens that gate’s project (no Recent projects list)

### Changed

- Make sprinkler markers yellow and electrical markers green, and 15% smaller than suite gates
- Soften building-click zoom: skip zoom when already close in; if zoomed out 4+ levels, zoom to detail − 1

## [1.9.0] - 2026-07-11

### Added

- Move button on building address popups so you can reposition building pins and save
- Portfolio Excel merge/import that updates the live database from workbook sheets (with dormant RTU Pictures archive support)
- Supabase pager so portfolio and media loads fetch past the 1000-row API limit
- Open Project in the 360° viewer when a suite gate has no tour URL linked yet

### Changed

- Route popup Move through Edit Positions so dragged markers stage the Save bar reliably
- Raise Save bar stacking so it stays visible over the map

### Fixed

- Stage 360° gate moves (including clearing auto-placed snap-back) so Save appears after repositioning
- Remove Delete from 360° gate popups (keep Open viewer and Move)

## [1.8.0] - 2026-07-10

### Added

- Inspection 360° suite entrance markers on the map with a full-screen tour viewer
- Add Inspection 360 panel and editor settings to place and link suite tours
- Suite entrance data model with polygon linking and inspection URL fields (database migration)
- Layer toggle and edit-mode save/diff support for Inspection 360 markers

### Changed

- Extend map markers, drag selection, and group drag so Inspection 360 markers move and select with other map items

## [1.7.2] - 2026-07-06

### Fixed

- Widen replacement year dropdown so labels like 2026 (default) are fully visible

## [1.7.1] - 2026-07-06

### Added

- RTU pricing per tonnage sheet in replacement cost Excel and PDF exports
- Delete polygon vertices by selecting a point and pressing Delete or Backspace

### Fixed

- Stop map zoom when scrolling to the end of an address or info popup

## [1.7.0] - 2026-07-06

### Added

- PDF export for RTU replacement cost estimates (presentation layout matching Excel)
- Presentation-style Excel export for replacement cost with Dashboard, By Building, Cost of Waiting, By Unit Size, and All Units sheets
- Building footprint snap when drawing tenant polygons on the map
- Polygon editor settings for snap distance and building alignment

### Changed

- Format dollar amounts with $ and comma separators and show percentages with two decimals in replacement cost exports
- Auto-size Excel export columns to fit cell content
- Remove extra comment rows and the Share of Plan column from the replacement cost Excel report
- Slim down replacement year dropdown fields in the building cost detail view
- Improve polygon draw panel controls and building snap feedback

## [1.6.2] - 2026-07-05

### Added

- Always-on Cursor rules for non-coder collaboration and programmer implementation workflow
- Delete button in RTU picture viewer with confirmation (removes from Cloudflare R2 and the map)

### Changed

- Expand restart-localhost agent skill with examples and `dev:persistent` option
- Update agent shortcut table to reference programmer rule instead of `/programmer` prefix

## [1.6.1] - 2026-07-05

### Added

- `npm run reconcile-rtu-pictures` rebuilds the picture manifest from R2 and syncs Supabase (removes rows for files deleted on Cloudflare, upserts new files)

### Changed

- Reconcile keeps all duplicate slot files in the manifest when rebuilding from R2
- JSON bucket upload failure during reconcile is non-fatal when Supabase sync succeeds

## [1.6.0] - 2026-07-05

### Added

- Show every RTU picture file on the map, including duplicates at the same slot number (e.g. Audit-2024 and Audit-None pairs)
- Delete RTU pictures from the map with removal from Cloudflare R2, the JSON manifest bucket, and Supabase via a new `delete-rtu-picture` Edge Function

### Changed

- Picture count badges and galleries count total files instead of unique slot numbers
- Replace **Hide** with **Delete** for cloud-hosted pictures in the RTU picture viewer

## [1.5.1] - 2026-07-04

### Fixed

- Paginate Supabase picture and document manifest fetches so RTUs with metadata beyond the 1,000-row API limit show all photos (e.g. 2320 RTU-04B Hybrid missing picture 3)

### Changed

- Folder RTU picture uploads now upsert Supabase `rtu_pictures` rows after R2 upload so new batches appear in the app without a manual sync

## [1.5.0] - 2026-07-04

### Added

- Settings **Account** page with sign-in, passkeys, password change, and authenticator-app MFA
- MFA challenge and password-reset modals for Supabase auth flows
- Portfolio map views saved to Supabase for park/cluster/manager filters and the **All Buildings** view
- Save rotation and zoom prompt after rotating the map in a filtered or all-buildings portfolio view
- Saved satellite imagery mode (Google/Esri) on building and portfolio map views

### Changed

- Show **Signed in as** above the Account button on the main Settings screen
- Make error and warning messages use high-contrast red alert callouts
- Default Google satellite imagery to labels off; labels stay on only when toggled manually in the map control
- Move account sign-in out of the main Settings list into the dedicated Account sub-page

## [1.4.0] - 2026-07-04

### Added

- Per-building saved map view (center, zoom, heading, tilt) stored in Supabase
- Save map position prompt after rotating the map while focused on a building (sign-in required)
- Restore saved map view when opening a building from search or the sidebar
- Clear saved map position from the save prompt overlay

### Changed

- Building imports no longer wipe existing saved map views unless map fields are explicitly set

## [1.3.1] - 2026-07-03

### Fixed

- Database export is now zip-compressed, shrinking the file roughly 7x (~1.9 MB to ~0.27 MB) with identical content
- Frozen header panes now actually apply in the export (SheetJS ignored the previous setting): top row on Buildings/RTUs/Tenant Polygons/Utilities and row 7 on RTU Pictures

## [1.3.0] - 2026-07-02

### Added

- Confirm-password field and a show/hide password toggle when creating accounts in Settings → Manage users
- Settings **Open Supabase dashboard** link for admins (opens the project dashboard in a new tab)

### Changed

- RTU info-window rows now wrap long values vertically instead of overflowing horizontally
- Export database RTUs sheet no longer duplicates Heating/Cooling Capacity (columns J/K) inside the Notes column (N)
- Renamed the `auth_admins` migration to match the applied remote version

## [1.2.0] - 2026-07-02

### Added

- Settings **Edit Polygons** tool to edit vertex points, show on map, or delete tenant polygons
- Settings **Manage users** for Supabase admins to add or delete editor accounts (name, email, password)
- Right-drag to pan the map while Edit Multiple Positions is active
- Supabase `auth_admins` migration and `admin-users` Edge Function for secure user management

### Changed

- Polygon info popup is read-only; edit/move/delete actions moved to Settings
- Building address popup no longer offers Move (use Edit Multiple Positions instead)

### Removed

- Clear all local RTU pictures button from Settings

## [1.1.0] - 2026-07-02

### Added

- Staged edit mode with a floating Save bar and grouped summary of pending changes
- Incremental Supabase save that applies only entities changed since the last saved baseline

### Changed

- Map, polygon, and notes edits stage locally until Save; Discard reverts to the last-saved state
- Ctrl/Cmd+S saves staged changes instead of showing an auto-save message

### Fixed

- Save no longer re-syncs the entire portfolio (hundreds of RTU/building requests) for a single edit
- Save UI stuck in loading state and repeated network request loops during save
