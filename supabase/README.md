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

## Regenerate TypeScript types

```powershell
npx supabase gen types typescript --project-id wyiymdtlncperqpwriuk > src/types/database.types.ts
```

## Legacy JSON under `data/`

The `supabase/data/` folder holds legacy JSON snapshots used only by:

- `scripts/extract.ts` (legacy HTML migration)
- `scripts/migrate-json-to-supabase.mjs` (one-time import)

The running app reads from Supabase, not these files.
