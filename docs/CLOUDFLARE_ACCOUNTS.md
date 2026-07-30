# Cloudflare accounts (do not mix)

QR East uses **two different Cloudflare accounts**. Keys, Wrangler login, and dashboard work must stay on the correct account.

| Account login | Short name | Owns | Used for |
|---------------|------------|------|----------|
| `krutki11@gmail.com` | **krutki11** | `insp360` R2 bucket; Wrangler host for **QR-360°-Inspections** | Tour files (`.insp360`), standalone Inspections app hosting |
| `quadreal.rpiwin@gmail.com` | **quadreal** | RTU pictures R2; RTU documents R2; Wrangler host for **qr-east-industrial-database** | Map app hosting (Pages), picture/document CDN |

## Important: cross-account access for tours

The **qr-east-industrial-database** app is hosted and deployed under the **quadreal** account (`quadreal.rpiwin@gmail.com`).

That same app also needs **read/write access to insp360 files on the krutki11 account** so the integrated QR-360° viewer can open and publish tours. That is intentional:

- Hosting / Pages / Access wall / RTU media → **quadreal**
- Tour storage (`insp360` bucket) + standalone Inspections hosting → **krutki11**
- Map app talks to krutki11’s insp360 via public CDN URL + separate `INSP360_R2_*` secrets (never reuse RTU `R2_*` keys)

Never deploy the map app with a Wrangler session logged into **krutki11**, and never upload RTU pictures with **krutki11** insp360 tokens.

## Which credentials go where

| Secret / login | Account |
|----------------|---------|
| `R2_*` / `CLOUDFLARE_*` for pictures & documents | **quadreal** |
| Wrangler deploy of `qr-east-industrial-database` Pages | **quadreal** |
| Cloudflare Access (Pages login wall) | **quadreal** |
| `INSP360_R2_*` / `VITE_INSP360_BASE_URL` | **krutki11** |
| Wrangler deploy of **QR-360°-Inspections** | **krutki11** |
| Supabase Edge Function secrets for tour publish/list (`upload-insp360-cloud`, `list-insp360-cloud`) | **krutki11** insp360 keys |

## Embedded map viewer vs standalone Inspections

| Environment | Host | Cloud tour list | Open a listed tour |
|-------------|------|-----------------|--------------------|
| **Embedded in QR-DB** (localhost, `qr-database.insp360.ca`, or pages.dev) | Map app iframe (`insp360/viewer.html?embed=1`) | Host asks Supabase `list-insp360-cloud` (signed-in); reply via `postMessage` | Public CDN (`VITE_INSP360_BASE_URL` + key) |
| **Standalone Inspections** | krutki11 Worker (`insp360.ca` / `insp360-viewer.krutki11.workers.dev`) | Same-origin Worker `/api/tours` | Worker download / R2 |

## Friendly map-app URL (`qr-database.insp360.ca`)

`insp360.ca` DNS lives on **krutki11**. The map app Pages project lives on **quadreal**. The hostname `qr-database.insp360.ca` is a small **krutki11** Worker (`qr-database`) that proxies to `qr-east-industrial-database.pages.dev`, so both addresses show the same live app.

Same R2 bucket (`insp360` on **krutki11**). Gate **Double Tour** relies on **versioned** publish keys under one gate prefix (`building/tour__YYYYMMDD-HHMMSS.insp360`) so several dates can share one display name.

## Phrase cheat sheet (for you)

| Say this | Deploys |
|----------|---------|
| **push a new build to Cloudflare quadreal** | Map app Pages (this project / Cloudflare copy) |
| **push a new build to Cloudflare krutki11** | QR-360°-Inspections Worker |
| **push a new build to Cloudflare** | Agent will ask which account |

Agent skill: `.cursor/skills/push-cloudflare-build/SKILL.md`

## Related docs

- Tours / insp360 bucket: [INSP360_R2.md](INSP360_R2.md)
- Map app Access wall (quadreal): [CLOUDFLARE_ACCESS.md](CLOUDFLARE_ACCESS.md)
