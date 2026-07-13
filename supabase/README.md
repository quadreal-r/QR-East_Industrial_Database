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
| `20260703024457_auth_admins.sql` | Admin user list + `is_app_admin()` for Settings user management |
| `20260703000000_schedule_pricing_media.sql` | Schedule columns, pricing, picture/document metadata |
| `20260703042952_building_map_view.sql` | Per-building saved map camera (center, zoom, heading, tilt) |
| `20260704171200_building_map_imagery_mode.sql` | Saved map imagery provider (google, esri) per building |

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
- **Authenticated:** full read/write

Create editor accounts in Supabase Auth (email/password), or use **Settings → Manage users** after you are listed as an admin.

## Auth redirect URLs (password reset)

Password-reset emails redirect to the app. In the [Supabase dashboard](https://supabase.com/dashboard/project/wyiymdtlncperqpwriuk/auth/url-configuration) set:

| Setting | Value |
|---------|--------|
| **Site URL** | `https://quadreal-r.github.io/QR-East_Industrial_Database/` |
| **Redirect URLs** | `http://127.0.0.1:5173`, `http://localhost:5173`, `https://quadreal-r.github.io/QR-East_Industrial_Database/` |

Local dev runs on port **5173** (not 3000). If reset links point at the wrong host, the page will be blank.

The app shows **Set new password** when you open a valid recovery link. Sign in → **Forgot password?** sends a new email.

## Admin user management

1. Apply migration `20260703024457_auth_admins.sql` (`npm run db:push`).
2. Promote your account (SQL editor or `psql`):

   ```sql
   INSERT INTO auth_admins (email) VALUES ('you@example.com');
   ```

3. Deploy the Edge Function (uses the project service role; never expose that key in the browser):

   ```powershell
   npx supabase functions deploy admin-users --project-ref wyiymdtlncperqpwriuk
   ```

Signed-in admins see **Settings → Manage users** to add (name, email, password) or delete editor accounts.

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
