# QR-360° viewer (linked to Building Map Explorer)

This folder holds the **versioned** QR-360° inspection viewer that the main app embeds.

## Link to the main program

| Role | Path |
|------|------|
| Versioned copy (this folder) | `qr360-viewer/QR-360°_viewer_vX.Y.Z.html` |
| Live embed (iframe URL) | `public/insp360/viewer.html` |
| App code that opens it | `src/lib/insp360Viewer.ts` → `insp360/viewer.html` |

The main program always loads **`public/insp360/viewer.html`**. That file is a replaced copy of the latest version from this folder — do not edit it by hand.

## Source of truth

```
C:\Users\Robert\Projects\QR-360°-Inspections\QR-360°-Inspections
```

Put new builds there as:

```
QR-360°_viewer_v1.1.3.html
```

## Sync (replace old with new)

From `QR-East_Industrial_Database`:

```powershell
npm run sync:qr360-viewer
```

This will:

1. Find the newest `QR-360°_viewer_v*.html` in the Inspections folder  
2. Copy it here (replacing older versioned files)  
3. Replace `public/insp360/viewer.html` so gates / sphere open the new build  

Metadata is written to `CURRENT.json`.
