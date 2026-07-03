# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/).

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
