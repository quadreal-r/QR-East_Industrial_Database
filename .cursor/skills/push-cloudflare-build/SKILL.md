---
name: push-cloudflare-build
description: >-
  Commits and pushes to GitHub for version tracking, then deploys a Cloudflare
  build. Use when the user says "push a new build to Cloudflare", "push a new
  build to Cloudflare quadreal", or "push a new build to Cloudflare krutki11"
  (or similar deploy/publish phrases).
---

# Push Cloudflare Build

Parse the account name from the user’s phrase. Preferred forms:

| User says | Account | What deploys |
|-----------|---------|----------------|
| **push a new build to Cloudflare quadreal** | **quadreal** (`quadreal.rpiwin@gmail.com`) | Map app → Cloudflare Pages |
| **push a new build to Cloudflare krutki11** | **krutki11** (`krutki11@gmail.com`) | QR-360-Inspections → Workers |
| **push a new build to Cloudflare** *(no name)* | Ask once (numbered prompt below) | Do not guess |

When the account name is missing, ask **exactly**:

```
Which Cloudflare account should this go to?

1. quadreal — map app (Cost Center / Pages)
2. krutki11 — QR-360° Inspections viewer only
```

Never deploy the map app while Wrangler is on krutki11, or Inspections while on quadreal.

**Hosting vs versioning**

- **Live site** = Cloudflare only (not GitHub Pages).
- **GitHub** = source history / version tracking. Every quadreal ship must **commit + push** before (or with) the Cloudflare deploy so online never races ahead of `main` again.

Full account split: `docs/CLOUDFLARE_ACCOUNTS.md`

---

## Path A — quadreal (map app)

| Item | Value |
|------|-------|
| Git + deploy folder | `C:\Users\Robert\Projects\QR-East_Industrial_Database` |
| Optional mirror | `C:\Users\Robert\Projects\QR-East_Industrial_Database-Cloudflare` (keep aligned after ship; not the git source) |
| Wrangler login | **quadreal** only |
| Live URL | https://qr-east-industrial-database.pages.dev/ |

Always sync the embedded QR-360° viewer before deploy (map topbar `v1.14.x` ≠ viewer `Map360-v1.2.x`).

### Checklist

```
quadreal ship progress:
- [ ] Step 1: Confirm Wrangler is quadreal
- [ ] Step 2: Version bump + changelog if needed
- [ ] Step 3: Sync QR-360 viewer
- [ ] Step 4: typecheck, lint, test
- [ ] Step 5: Commit + push to GitHub main
- [ ] Step 6: Deploy to Cloudflare Pages
- [ ] Step 7: Mirror to Cloudflare folder (optional but recommended)
- [ ] Step 8: Report live URL + version + commit
```

### Steps

**1. Confirm Wrangler account**

```powershell
cd C:\Users\Robert\Projects\QR-East_Industrial_Database
npx wrangler whoami
```

Must show **quadreal.rpiwin@gmail.com** / account `ed62b8514615e386084ffd47455ec775`. If not: `npx wrangler logout` then `npx wrangler login` and pick **quadreal**.

**2. Version + changelog**

```powershell
npm run version:bump:if-needed
```

If `package.json` version differs from `HEAD`, update `CHANGELOG.md` (same rules as `release-and-push`).

**3. Sync embedded viewer**

```powershell
npm run sync:qr360-viewer
```

**4. Checks**

```powershell
npm run typecheck
npm run lint
npm test
```

Fix failures before continuing.

**5. Commit + push (GitHub version tracking)**

This step is required even when Cloudflare deploy is the main goal.

```powershell
git pull origin main
git status
git diff
git log -5 --oneline
```

Stage everything except secrets (never `.env.local`, `nogps-list.txt`, `nogps-not-on-cdn.txt`):

```powershell
git add -A
git reset HEAD -- .env.local
git reset HEAD -- nogps-list.txt
git reset HEAD -- nogps-not-on-cdn.txt
```

Commit with repo style (`feat:` / `fix:` / `chore:` + imperative summary). Include version files + `CHANGELOG.md` when bumped.

```powershell
git pull --rebase origin main
git push origin main
```

If there is nothing to commit, still confirm `main` is pushed and matches the tree you are about to deploy.

**6. Deploy Cloudflare Pages**

```powershell
npm run deploy
```

(`build:pages` then `wrangler pages deploy` for project `qr-east-industrial-database`.)

**7. Mirror to Cloudflare working copy**

So the no-git Cloudflare folder does not drift:

```powershell
robocopy "C:\Users\Robert\Projects\QR-East_Industrial_Database" "C:\Users\Robert\Projects\QR-East_Industrial_Database-Cloudflare" /MIR /XD node_modules .git dist coverage .tmp-pages-functions /XF .env.local
```

Robocopy exit codes 0–7 are success; treat ≥8 as failure.

**8. Report**

- Live: https://qr-east-industrial-database.pages.dev/
- Topbar version (`BUILD_VERSION_LABEL`)
- GitHub commit on `main`
- Remind: hard-refresh (Ctrl+Shift+R); GitHub Pages is no longer the live site

---

## Path B — krutki11 (QR-360-Inspections)

| Item | Value |
|------|-------|
| Folder | `C:\Users\Robert\Projects\QR-360-Inspections\cloudflare` |
| Command | `npm run deploy` (runs `sync-viewer` then `wrangler deploy`) |
| Wrangler login | **krutki11** only (`account_id` `e46c718ce72e30e61182c9b1c04cf286`) |
| Live URL | https://insp360-viewer.krutki11.workers.dev |
| Details | `C:\Users\Robert\Projects\QR-360-Inspections\cloudflare\README.md` |

### Checklist

```
krutki11 deploy progress:
- [ ] Step 1: cd Inspections cloudflare folder
- [ ] Step 2: Confirm Wrangler is krutki11
- [ ] Step 3: Commit + push Inspections git changes (if that repo has a remote and dirty tree)
- [ ] Step 4: npm run deploy
- [ ] Step 5: Report live URL
```

```powershell
cd C:\Users\Robert\Projects\QR-360-Inspections\cloudflare
npx wrangler whoami
npm run deploy
```

If `account_id` does not match authenticated accounts: `npx wrangler logout` then `npx wrangler login` and pick **krutki11**.

Report https://insp360-viewer.krutki11.workers.dev and remind them this did **not** update the map app.

---

## Do not

- Default to an account when the name is missing — ask with the numbered 1/2 prompt above
- Mix Wrangler logins across paths
- Deploy Cloudflare without committing/pushing map-app changes to GitHub (Path A)
- Treat a GitHub-only push (`push-live` / `release-and-push`) as a live Cloudflare deploy
- Revive GitHub Pages hosting workflows
