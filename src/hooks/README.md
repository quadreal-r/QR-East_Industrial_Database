# Hooks

React hooks for data loading, authentication, and derived building lists.

## `usePortfolioData`

Loads portfolio data via React Query. When Supabase env vars are configured, fetches `buildings`, `rtus`, `tenants`, `utilities`, and `polygons` tables. On missing config or fetch errors, falls back to static JSON in `supabase/data/`.

Requires a `QueryClientProvider` in the app root.

## `useAuth`

Reads the silent Supabase session bootstrapped from `/api/session` (Cloudflare Access identity in the cloud, `LOCAL_DEV_EMAIL` / local Admin·Viewer buttons on localhost). Exposes `session`, `user`, `isLoading`, `isAuthenticated`, `role` (`'admin' | 'viewer' | null`), `canEdit`, `error`, `isLocalDev`, `signInAsLocal`, and `signOut` (clears the app session, then on `*.pages.dev` clears Cloudflare Access cookies and returns you to the Access login wall). Edit UI should gate on `canEdit`, not `isAuthenticated`.

## `useFilteredBuildings`

Combines `filterStore` with `@/lib/filters` (`applyPrimaryFilters`, `passDqFilter`, `reconcileFilterDropdowns`):

- `filteredBuildings` — map-visible buildings (search, dropdowns, advanced filters)
- `listBuildings` — sidebar list (adds data-quality chip filters)
- `count` / `mapCount` — result counts

Auto-resets park/cluster/manager dropdowns when the search term no longer matches the current selection (legacy behavior).

```ts
const { data } = usePortfolioData()
const { filteredBuildings, listBuildings, count } = useFilteredBuildings(
  data?.buildings ?? [],
)
```
