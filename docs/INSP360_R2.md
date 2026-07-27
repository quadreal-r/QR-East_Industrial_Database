# QR-360° tours on Cloudflare R2 (`insp360` bucket)

Tours live on the **krutki11** Cloudflare account (`krutki11@gmail.com`) — separate from the **quadreal** account (`quadreal.rpiwin@gmail.com`) that hosts the map app and stores RTU pictures/documents.

**Important:** The map app (**qr-east-industrial-database**) is hosted on **quadreal**, but it is configured to reach **krutki11**’s `insp360` bucket so the integrated QR-360° Inspections viewer can open and publish tours. Full account split: [CLOUDFLARE_ACCOUNTS.md](CLOUDFLARE_ACCOUNTS.md).

## Public CDN

| Setting | Value |
|---------|--------|
| Bucket | `insp360` |
| Public URL | `https://pub-0d0f264ce842432887754b840b270786.r2.dev/` |
| App env | `VITE_INSP360_BASE_URL` (in `.env.local`) |

RTU pictures/docs keep using the original account (`VITE_RTU_PICTURES_BASE_URL` / `VITE_RTU_DOCUMENTS_BASE_URL`).

## How tours connect in the app

| Kind | Meaning |
|------|---------|
| **On this PC** | Create / Open a `.insp360` and **Link** on close. Stored in this browser only — **not** uploaded. |
| **Cloudflare** | Gate has a Tour URL (CDN). Enter QR-360° opens the shared file for anyone. |

### Publish from the app (recommended for sharing)

1. Sign in, open the gate, Create or Open the local tour, Save if you made edits.
2. Click **Publish to Cloudflare & link** in the tour top bar.
3. The app uploads to R2 and saves the Tour URL on that gate.

Requires the `upload-insp360-cloud` Edge Function + insp360 R2 secrets (see [supabase/README.md](../supabase/README.md)).

Each publish writes a **new dated version** keyed by **building address + suite/utility room name**, e.g. `60-birmingham-st-blg-1/electrical-room__20260715-101530.insp360` or `145-carrier-drive/suite-7__20260715-101530.insp360`. The gate Tour URL points at the **latest** version; older versions stay on R2 for **Double Tour**.

**Pin/map sidecar:** Pins and floor-plan edits live in a small companion file next to the tour — `….insp360` + `….tour.json` (same folder / same R2 prefix). Saving pins online or on this PC updates only that JSON (not the multi-GB photo zip). Opening a tour prefers the sidecar when present; the copy inside the zip is a fallback.

### Cloud list / Double Tour (embedded map)

In the map app, Dashboard → **Cloud (R2)** lists R2 files for that gate by matching **building address** (folder) and **suite # / utility room name** (file stem), via Supabase `list-insp360-cloud` (not the standalone Worker `/api/tours`). You must be signed in. Opening a card or Double Tour side loads from the public CDN.

Standalone Inspections on the krutki11 Worker still uses `/api/tours` unchanged.

### Paste an existing cloud URL

1. Upload via Dashboard / CLI (below), or use a URL already on the bucket.
2. **Link Cloudflare Tour** in the tour header, or **Settings → Edit 360° Gates → Tour URL**.
3. Short key example: `145-carrier/suite-7__20260715-101530.insp360` (uses `VITE_INSP360_BASE_URL`). Legacy unversioned keys still work.

## CORS (fetch + in-app publish)

In Cloudflare → **R2** → bucket **insp360** → **Settings** → **CORS policy**, paste:

```json
[
  {
    "AllowedOrigins": [
      "http://127.0.0.1:5174",
      "http://localhost:5174",
      "https://quadreal-r.github.io",
      "https://qr-east-industrial-database.pages.dev"
    ],
    "AllowedMethods": ["GET", "HEAD", "PUT"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag", "Content-Length", "Content-Type"],
    "MaxAgeSeconds": 86400
  }
]
```

- **GET / HEAD** — open cloud tours in the browser.
- **PUT** — **Publish to Cloudflare & link** (presigned upload from the app).

Without CORS, open or publish may fail in the browser even when the file is on R2.

## Upload outside the app

### Dashboard
Drag files into the R2 bucket in the Cloudflare dashboard.

### Upload script (from this project)

Uses **separate** API keys for the tour account (never reuse the pictures-account keys).

1. On the **krutki11** Cloudflare account: **R2 → Overview → Manage R2 API Tokens → Create API token**
   - Permission: Object Read & Write
   - Apply to bucket: `insp360`
2. Copy Account ID (R2 overview) + Access Key ID + Secret Access Key into `.env.local`:

```env
INSP360_R2_ACCOUNT_ID=...
INSP360_R2_ACCESS_KEY_ID=...
INSP360_R2_SECRET_ACCESS_KEY=...
INSP360_R2_BUCKET_NAME=insp360
VITE_INSP360_BASE_URL=https://pub-0d0f264ce842432887754b840b270786.r2.dev/
```

3. Upload one file:

```powershell
npm run upload:insp360 -- --file "C:\path\to\tour.insp360" --key "145-carrier/suite-7.insp360"
```

Or upload a whole folder (keeps subfolder names as keys):

```powershell
npm run upload:insp360 -- --from-folder "C:\Users\Robert\Tours" --skip-existing
```

The script prints the public URL and the short **Tour URL** value to paste into Settings → Edit 360° Gates.
