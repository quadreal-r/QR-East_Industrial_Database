# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/).

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
