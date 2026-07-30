# QR East Industrial Database — Security Briefing

**Product:** QuadReal Industrial Portfolio Map (Ontario)  
**Purpose:** Internal web application for buildings, RTUs, tenants, utilities, Capex/cost data, RTU media, and embedded QR-360° site tours  
**Audience:** IT / Cybersecurity review  
**As of:** 30 July 2026 · Live build **v1.15.3**

---

## 1. Production endpoints

| URL | Role |
|---|---|
| https://qr-database.insp360.ca/ | Primary friendly URL (recommended) |
| https://qr-east-industrial-database.pages.dev/ | Cloudflare Pages origin (same application) |
| https://github.com/quadreal-r/QR-East_Industrial_Database | Source / version history only (not the live host) |

Developer localhost only: `http://127.0.0.1:5174/`

---

## 2. High-level architecture

```
Browser
  → Cloudflare edge (Pages + optional hostname proxy)
  → Custom email OTP login wall (Pages Functions)
  → React single-page application
  → Supabase (Auth + Postgres + Row Level Security + Edge Functions)
  → Cloudflare R2 (file bytes: pictures, documents, 360° tours)
```

| Layer | Provider | Account / owner |
|---|---|---|
| Map app hosting (Pages) | Cloudflare | **quadreal** (`quadreal.rpiwin@gmail.com`) |
| Friendly hostname DNS + thin proxy Worker | Cloudflare | **krutki11** (`krutki11@gmail.com`) — zone `insp360.ca` |
| Database + Auth | Supabase Postgres | Project ref `wyiymdtlncperqpwriuk` |
| RTU pictures / documents (R2) | Cloudflare R2 | **quadreal** |
| QR-360° tour files (R2 bucket `insp360`) | Cloudflare R2 | **krutki11** |
| OTP email delivery | Resend | Verified sending domain (e.g. `insp360.ca`) |

**Important:** Two Cloudflare accounts are intentional. Map hosting and RTU media stay on **quadreal**; tour storage and the `insp360.ca` DNS zone stay on **krutki11**. Credentials must not be mixed across accounts.

---

## 3. Authentication (front door)

### Current control: custom email OTP wall

- Unauthenticated browser navigations to the application HTML are intercepted by Cloudflare Pages middleware.
- User enters work email → receives a **6-digit one-time code** (Resend) → code verified → application session cookie set.
- Fallback: Supabase magic link if Resend is restricted (allowlist is re-checked before minting the app cookie).

### Who is allowed to sign in

1. Emails ending in **`@quadreal.com`**, **or**
2. Emails explicitly added in **Manage users** (`app_roles` table)

Requesting a code for a non-allowed email is designed **not to reveal** whether the address is on the allowlist (anti-enumeration).

### Session cookies

| Cookie | Purpose | Properties |
|---|---|---|
| `bme_otp` | Pending OTP challenge (stores hash only, not the raw code) | `HttpOnly`, `Secure`, `SameSite=Lax`, ~10 minutes |
| `bme_session` | Signed app gate cookie after successful login | `HttpOnly`, `Secure`, `SameSite=Lax`, **24 hours**, HMAC-SHA-256 |

### After the wall

`/api/session` exchanges a valid gate cookie for a **Supabase Auth** session (access + refresh tokens) used by the SPA for database calls.

### Roles

| Role | Capabilities |
|---|---|
| **Viewer** | Sign in; browse; limited Cost Center edits (RTU $ allocations / notes only) |
| **Admin** | Full edit (markers, polygons, settings, media, user admin, tour publish, etc.) |

UI edit controls follow role, but **Postgres RLS and Edge Functions are the authoritative enforcement**.

### Logout

Clears gate cookies, clears browser Supabase tokens, and returns the user to the OTP wall.

### Offline kill-switch (panic)

- Entering **`pulltheplug@quadreal.com`** on the login wall immediately flips the app to **Offline** (shared panic passphrase — anyone who can reach the wall can trigger it).
- Offline **cuts application access** (HTML gate + non-admin session mint). It does **not** wipe Postgres, R2, or `app_roles` accounts.
- Reactivation: an existing **Admin** completes normal OTP on the Off Line wall; successful Admin login clears the flag and restores access for everyone.
- Flag: `app_settings` key `access_offline` (server-side service role only).

### Legacy note

Older **Cloudflare Access / Zero Trust** login was used previously. Current design expects Access **disabled** on the Pages host so the custom OTP wall is shown. Limited transitional Access JWT handling may still exist in `/api/session`.

---

## 4. Database security (Supabase)

- **Engine:** PostgreSQL with **Row Level Security (RLS)** enabled on application tables.
- **Data stored:** Building / RTU / tenant / utility markers, polygons, Capex / pricing / schedule fields, settings, RTU picture & document **metadata**, application roles, activity / audit events.
- **Typical RLS pattern:**
  - Broad **read** of portfolio map data for the application client model
  - **Writes** restricted to admins (`is_app_editor()` / `app_roles`), with a documented viewer exception for RTU allocation / notes
- **Service role key** (`SUPABASE_SERVICE_ROLE_KEY`):
  - Used only **server-side** (Pages Functions for session minting / allowlist; Edge Functions; admin / import scripts)
  - Must **never** be prefixed with `VITE_` or shipped to the browser
- **Client key:** `VITE_SUPABASE_ANON_KEY` is public by design; protection depends on RLS + Auth, not concealment of the anon key

### Edge Functions (authenticated APIs)

| Function | Auth | Notes |
|---|---|---|
| `admin-users` | Bearer JWT + must be **admin** | User management |
| `upload-insp360-cloud` | Bearer JWT + **admin** | Issues short-lived R2 **presigned PUT** (~30 minutes) |
| `list-insp360-cloud` | Bearer JWT (signed-in user) | Lists tour objects for a sanitized prefix |
| `delete-rtu-picture` | Bearer JWT + **admin** | Deletes R2 object + metadata |

CORS on these functions is currently open (`*`), with reliance on bearer authentication and role checks for protection.

---

## 5. File / object storage (R2)

| Content | Account | Access model |
|---|---|---|
| RTU pictures | quadreal | Bytes on public CDN base URL; metadata in Supabase |
| RTU documents | quadreal | Same pattern |
| QR-360° tours (`.insp360`, covers, sidecars) | krutki11 `insp360` | Public CDN for published objects; **uploads** via short-lived signed URLs after admin auth |

**Implication:** Published media and tour URLs are **world-readable if the URL is known**. Confidentiality of media depends on unguessable object keys and operational practice, not on private buckets for those public CDN paths. Access to **upload / delete** is admin-gated.

---

## 6. Application API surface (Pages Functions)

| Method / path | Purpose |
|---|---|
| `POST /api/auth/request-code` | Start OTP |
| `POST /api/auth/verify` | Verify OTP → set `bme_session` |
| `POST /api/auth/complete` | Magic-link completion |
| `GET` / `POST /api/auth/logout` | Clear gate cookies |
| `GET /api/session` | Mint Supabase session for SPA |

Middleware protects **HTML document** navigations. Static assets and `/api/*` follow their own handlers. Auth API responses use `Cache-Control: no-store`.

**Friendly hostname:** `qr-database.insp360.ca` is a small Worker on **krutki11** that reverse-proxies to the **quadreal** Pages origin (same application; session cookies scoped to the browser hostname).

---

## 7. Secrets classification

### Browser-exposed (treat as public; protect with referrer restrictions, RLS, and storage policy)

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_GOOGLE_MAPS_API_KEY` (should be **HTTP referrer–restricted** in Google Cloud)
- `VITE_GOOGLE_MAPS_MAP_ID`
- `VITE_RTU_PICTURES_BASE_URL`
- `VITE_RTU_DOCUMENTS_BASE_URL`
- `VITE_INSP360_BASE_URL`

### Server-only (Pages secrets / Edge Function secrets / local `.env.local` — never commit)

- `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`
- `SESSION_SECRET` (HMAC for gate cookies)
- `RESEND_API_KEY`, `RESEND_FROM`
- `R2_*` (quadreal RTU media)
- `INSP360_R2_*` (krutki11 tours — separate keys)

`.env.local` and Wrangler state are gitignored.

---

## 8. Data sensitivity (for classification discussions)

Typical content includes:

- Industrial property addresses and portfolio structure (Ontario)
- Tenant / utility / RTU operational data
- Capex / replacement-year / budget fields
- Operator / manager naming and application user emails / roles
- Photos and documents of equipment
- 360° site inspection tours

Treat as **internal QuadReal operational data**. Confirm formal classification (Internal / Confidential) with the business owner.

---

## 9. Controls summary

| Control | Status |
|---|---|
| Front-door authentication | Email OTP (+ allowlist) before application HTML |
| Offline kill-switch | Panic email flips Offline; Admin OTP restores; no data wipe |
| Session cookie hardening | HttpOnly + Secure + SameSite=Lax + HMAC |
| Role-based editing | Admin vs Viewer; RLS + Edge Function checks |
| Secrets separation | Service role / R2 / Resend not in browser bundle |
| Source hosting | Live site on Cloudflare Pages, not GitHub Pages |
| Account separation | Map / RTU media (quadreal) vs tours / DNS (krutki11) |
| Transport | HTTPS on all production hosts |
| Audit | Activity events for auth / actions (admin-readable) |

---

## 10. Items cybersecurity may want to probe

1. **Public CDN media / tours** — readable by URL; confirm this matches data-classification policy.
2. **Portfolio SELECT openness** — map data is readable by the application’s Supabase client model; confirm whether that read model is acceptable. The OTP wall is the intended browser gate; API keys alone are not a secret.
3. **Edge Function CORS `*`** — acceptable only if bearer JWT + role checks are trusted as the control.
4. **Google Maps API key** — confirm HTTP referrer allowlist includes:
   - `https://qr-database.insp360.ca/*`
   - `https://qr-east-industrial-database.pages.dev/*`
   - localhost if needed for development
5. **Cross-account proxy** — `insp360.ca` Worker → Pages; review as an extra hop / trust boundary.
6. **Legacy Access path** — confirm Zero Trust Access remains disabled if OTP wall is the approved model.
7. **Documentation drift** — some older architecture notes still mention email/password; **OTP + admin/viewer** is current.

---

## 11. Contacts / ownership

| Area | Owner |
|---|---|
| Business owner | *(QuadReal — fill in)* |
| Application maintainer | Robert Piwin / project team |
| Cloudflare **quadreal** | `quadreal.rpiwin@gmail.com` |
| Cloudflare **krutki11** (tours / insp360.ca) | `krutki11@gmail.com` |
| Supabase project | `wyiymdtlncperqpwriuk` |

---

## 12. Internal technical references (repository)

- `docs/CLOUDFLARE_ACCESS.md` — login wall
- `docs/CLOUDFLARE_ACCOUNTS.md` — account split
- `docs/DATA_ARCHITECTURE.md` — data layers
- `docs/INSP360_R2.md` — tour storage
- `supabase/README.md` — database / functions
- `.env.example` — environment variable classification

---

*Document generated for QuadReal IT / Cybersecurity review. Contains architecture and control descriptions only — no secret values.*
