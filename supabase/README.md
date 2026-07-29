# Supabase

Project ref: `wyiymdtlncperqpwriuk`  
URL: `https://wyiymdtlncperqpwriuk.supabase.co`

## CLI setup (one time)

The repo includes `supabase/config.toml` from `supabase init`. Install the CLI as a dev dependency (`npm install`) or use `npx supabase`.

1. Create a personal access token: [Supabase Account → Access Tokens](https://supabase.com/dashboard/account/tokens)
2. Add to `.env.local` (not committed):

   ```env
   SUPABASE_ACCESS_TOKEN=sbp_...
   SUPABASE_DB_PASSWORD=your-database-password
   ```

3. Log in and link the project:

   ```powershell
   $env:SUPABASE_ACCESS_TOKEN = (Get-Content .env.local | Select-String '^SUPABASE_ACCESS_TOKEN=').ToString().Split('=',2)[1]
   npm run supabase:link
   ```

   When prompted for the database password, use the value from Supabase **Project Settings → Database** (or set `$env:SUPABASE_DB_PASSWORD` before linking).

Linking writes `.supabase/` (gitignored) with the remote project ref.

## Apply migrations (`db push`)

Remote history already includes `20260621172809_initial_schema`. Pending local migrations:

| File | Purpose |
|------|---------|
| `20260622120000_seed_legacy_data.sql` | Portfolio seed (buildings, RTUs, etc.) |
| `20260703024457_auth_admins.sql` | Legacy admin list; migrated into `app_roles` |
| `20260703000000_schedule_pricing_media.sql` | Schedule columns, pricing, picture/document metadata |
| `20260703042952_building_map_view.sql` | Per-building saved map camera (center, zoom, heading, tilt) |
| `20260704171200_building_map_imagery_mode.sql` | Saved map imagery provider (google, esri) per building |
| `20260717210049_access_app_roles.sql` | Access-only auth: `app_roles` table (`admin`/`viewer`), `is_app_admin`, `is_app_editor`, `get_my_app_role`; tightens write RLS on portfolio tables to editors only |

```powershell
# Preview what would run
npm run db:push:dry-run

# Apply pending migrations
npm run db:push

# Verify history
npm run db:migration-list
```

If the CLI reports a history mismatch, repair with the version shown in the dashboard:

```powershell
npx supabase migration repair --linked --status applied 20260621172809
```

## Import JSON data (after schema is applied)

```powershell
npm run migrate-json-to-supabase
```

Requires `SUPABASE_SERVICE_ROLE_KEY` in `.env.local`. Use this for schedule, pricing, and picture/document metadata from `supabase/data/*.json` (the seed migration does not include those).

## RLS

- **Anonymous:** `SELECT` on all tables
- **Viewer:** read-only, plus UPDATE on `rtus.budget` and `rtus.replacement_note` (Cost Center RTU $ Allocation and notes)
- **Admin:** read/write through `is_app_editor()`

Cloudflare Access is the only cloud login. The app silently creates a Supabase session so RLS
still applies. Unknown Access emails default to Viewer.

## Admin user management

1. Apply `20260717210049_access_app_roles.sql`.
2. Bootstrap an Admin if needed:

   ```sql
   INSERT INTO app_roles (email, role) VALUES ('you@example.com', 'admin');
   ```

Admins use **Settings → Account → Manage users** to assign Admin or Viewer by email.
Cloudflare's Access allowlist separately controls who may enter the cloud site.

Admins can also open **Settings → Account → Activity log** to fetch / download / email a
digest of sign-ins, time in app, 360° tour opens, and map edits. Events are stored in
`activity_events` (migration `20260723180000_activity_events.sql`).

## RTU picture delete (Cloudflare R2)

Deleting a picture from the map invokes the `delete-rtu-picture` Edge Function (authenticated users). It removes the object from the R2 pictures bucket, updates `manifest.json` in the JSON bucket, and deletes the Supabase `rtu_pictures` row.

1. Set Edge Function secrets (Dashboard → Edge Functions → Secrets, or CLI):

   ```powershell
   npx supabase secrets set R2_ACCOUNT_ID=... R2_ACCESS_KEY_ID=... R2_SECRET_ACCESS_KEY=... R2_BUCKET_NAME=rtu-pictures --project-ref wyiymdtlncperqpwriuk
   ```

   Optional: `R2_JSON_BUCKET`, `R2_KEY_PREFIX` (same as local `.env.local`).

2. Deploy:

   ```powershell
   npx supabase functions deploy delete-rtu-picture --project-ref wyiymdtlncperqpwriuk
   ```

## QR-360° tour publish (insp360 R2)

**Publish to Cloudflare & link** in the tour top bar asks this Edge Function for a short-lived R2 **PUT** URL, then the browser uploads the `.insp360` directly (large files never go through Supabase).

Uses the **krutki11** Cloudflare account (`insp360` bucket) — separate secrets from RTU pictures on **quadreal**. The map app is hosted on quadreal but is given access to krutki11 tours for the integrated QR-360° viewer. See [docs/CLOUDFLARE_ACCOUNTS.md](../docs/CLOUDFLARE_ACCOUNTS.md).

1. Set Edge Function secrets:

   ```powershell
   npx supabase secrets set INSP360_R2_ACCOUNT_ID=... INSP360_R2_ACCESS_KEY_ID=... INSP360_R2_SECRET_ACCESS_KEY=... INSP360_R2_BUCKET_NAME=insp360 INSP360_R2_PUBLIC_URL=https://pub-0d0f264ce842432887754b840b270786.r2.dev/ --project-ref wyiymdtlncperqpwriuk
   ```

   Optional: `INSP360_R2_KEY_PREFIX` (same idea as local `INSP360_R2_KEY_PREFIX`).

2. Deploy upload + list:

   ```powershell
   npx supabase functions deploy upload-insp360-cloud --project-ref wyiymdtlncperqpwriuk
   npx supabase functions deploy list-insp360-cloud --project-ref wyiymdtlncperqpwriuk
   ```

3. Update the insp360 bucket **CORS** policy to allow `PUT` / `GET` from your app origins (see `docs/INSP360_R2.md`).

Signed-in users can publish and list gate-scoped cloud tours (Dashboard → Cloud in the embedded viewer). Paste-URL / CLI upload still work as fallbacks.

## RTU picture reconcile (R2 → manifest + Supabase)

When files are deleted directly in the Cloudflare R2 dashboard, the live map still reads **Supabase** until metadata is reconciled.

Rebuild `manifest.json` from the R2 bucket and remove orphaned `rtu_pictures` rows (files in Supabase but not on R2):

```powershell
# Preview changes
npm run reconcile-rtu-pictures -- --dry-run

# Apply: local manifest + JSON bucket + Supabase
npm run reconcile-rtu-pictures
```

Requires R2 credentials and `SUPABASE_SERVICE_ROLE_KEY` in `.env.local`. Hard-refresh the app after sync.

## Regenerate TypeScript types

```powershell
npx supabase gen types typescript --project-id wyiymdtlncperqpwriuk > src/types/database.types.ts
```

## Legacy JSON under `data/`

The `supabase/data/` folder holds legacy JSON snapshots used only by:

- `scripts/extract.ts` (legacy HTML migration)
- `scripts/migrate-json-to-supabase.mjs` (one-time import)

The running app reads from Supabase, not these files.
