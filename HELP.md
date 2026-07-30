# How to work in this project

## To run the project

- In the top bar of cursor, select view -> terminal
- Type and enter "npm run dev", the project will then be running locally on your machine at "http://localhost:5174/"
- Enter that url in the browser to access your site
- **Refreshing the browser does not start or stop the server.** They are separate: the server runs in the terminal; refresh only reloads the page in the browser.
- **Keep the dev terminal open** the whole time you work. If you close the terminal tab, close Cursor, or shut the laptop, the server stops and `http://localhost:5174/` will not load until you start it again.
- If the page is blank or won't load:
  - Check the terminal — you should see `VITE ... ready`. If the terminal is gone or shows a prompt with no server, run `npm run dev` again (see [To restart the dev server](#to-restart-the-dev-server)).
  - Run `npm install` if you just pulled new code
  - Copy `.env.example` to `.env.local` and add your keys (Supabase + Google Maps)
- Changes to the code will automatically be reflected onto the site, no need to restart the website, you can simply refresh the page

## Login and roles

- The cloud site uses **Cloudflare Access** as its only login. There is no second app password,
  passkey, or authenticator prompt.
- **Admin** can edit, import, publish, delete, and manage roles. **Viewer** can browse and export
  downloads but cannot change shared data.
- Admins assign roles in **Settings → Account → Manage users**. The Cloudflare Access email
  allowlist separately controls who can enter the site.
- Localhost has no Access wall. Set `LOCAL_DEV_EMAIL` and the server-only
  `SUPABASE_SERVICE_ROLE_KEY` in `.env.local`. The first local login seeds that email as Admin;
  after that, Manage users controls Admin vs Viewer (localhost no longer overwrites the role).

## To restart the dev server

Use this when `http://localhost:5174/` is blank, stuck, or the terminal shows errors after pulling new code.

**Option A — restart script (recommended on Windows):**

```powershell
cd C:\Users\Robert\Projects\QR-East_Industrial_Database
npm run dev:restart
```

This stops whatever is using port 5174, then starts the dev server again.

**Option B — manual restart:**

1. In the terminal where `npm run dev` is running, press **Ctrl+C**
2. Start it again:

```powershell
cd C:\Users\Robert\Projects\QR-East_Industrial_Database
npm run dev
```

**OneDrive / synced folders:** use `npm run dev:onedrive` instead of `npm run dev` if the normal dev command has file-watching issues.

**Keep server running in its own window (recommended):** opens a separate Command Prompt that stays up even if you close Cursor's terminal:

```powershell
cd C:\Users\Robert\Projects\QR-East_Industrial_Database
npm run dev:window
```

A window titled **Building Map Explorer Dev** should stay open with `VITE ... ready`. Leave it open while you use the app.


## To make code changes

- When you want to implement something new, you should start a new chat (new agent in top left)
- type "/programmer" first then ask for your feature (ex: "/programmer make all buttons blue")
- When it is done working, it will ask you to verify everything works, keep working with the agent until you are satisfied
- You may want to run the command "npm test" after its done its work, it should say all tests pass - if it doesnt just copy the output of the terminal and give it to the agent and tell it to fix it. Then make sure npm test is all passed and continue to next step.
- Once done, you can say "Everything is good now, push the code"

## To commit and push

There is no `npm run commit` or `npm run push`. Use git from the project folder.

### Git workflow (code changes)

```powershell
cd C:\Users\Robert\Projects\QR-East_Industrial_Database
git pull origin main
npm run typecheck
npm run lint
npm test
git status
git add .
git commit -m "fix: short description of what changed"
git push origin main
```

Pushing to **main** saves version history on GitHub and runs CI checks. It does **not** update the live Cloudflare site.

To update the live site, say: **"push a new build to Cloudflare quadreal"**.

**Push rejected?** Remote has commits you do not have:

```powershell
git pull origin main
git push origin main
```

If `git pull` reports merge conflicts, fix the listed files, then:

```powershell
git add .
git commit -m "merge: integrate remote main"
git push origin main
```

Or tell the agent: **"Everything is good now, push the code"** (it will pull, merge, and push when needed).

Or use **`npm run push-live`** — runs tests, commits, and pushes to GitHub only.

### Map / portfolio data changes

Map data lives in **Supabase Postgres**. Sign in from **Settings → Account**, then edit markers, schedule, pricing, etc. Changes save directly to the database — no deploy step for portfolio JSON.

See [docs/DATA_ARCHITECTURE.md](docs/DATA_ARCHITECTURE.md) for the full data model.

**One-time import from legacy JSON:**

```powershell
npm run migrate-json-to-supabase
```

Requires `SUPABASE_SERVICE_ROLE_KEY` in `.env.local`.

### RTU pictures and documents

- **Metadata** (which files belong to each RTU) is in Supabase.
- **Binary files** are on Cloudflare R2.

Upload binaries with:

```powershell
npm run upload-rtu-pictures-r2 -- --from-folder "C:/path/to/pictures"
npm run upload-rtu-documents-r2 -- --from-folder "C:/path/to/docs" --skip-existing
```

### Before you push

- Never commit `.env.local` (secrets) — it is gitignored

## Push a new build (full checklist)

Use this when local dev looks good and you want **online to match** your code.

**Important:** The live site is **Cloudflare Pages**. GitHub is for version history. Uncommitted local code will not appear online until you ship with the Cloudflare skill.

### A. Code / UI changes (preferred)

Tell the agent: **"push a new build to Cloudflare quadreal"**

That flow: version bump → changelog if needed → sync 360 viewer → tests → **commit + push to GitHub** → deploy Cloudflare → mirror the Cloudflare working folder.

Manual equivalent:

```powershell
cd C:\Users\Robert\Projects\QR-East_Industrial_Database
git pull origin main
npm run version:bump:if-needed
npm run sync:qr360-viewer
npm run lint
npm run typecheck
npm run test
git status
git add .
git commit -m "feat: short description of what changed"
git push origin main
npm run deploy
```

GitHub-only (no live update): **`npm run push-live`**.

### B. Map data changes

Sign in to the app and edit — data saves to Supabase immediately. No git push needed for portfolio changes.

### C. RTU documents (PDFs on R2)

```powershell
npm run upload-rtu-documents-r2 -- --from-folder "C:/path/to/RTU-Documents" --all-files --skip-existing
```

Ensure document metadata rows exist in Supabase (via the app while signed in).

### D. After any Cloudflare deploy

1. Open https://qr-database.insp360.ca/ (or https://qr-east-industrial-database.pages.dev/)
2. Hard-refresh (Ctrl+Shift+R)
3. Confirm the topbar version matches what you shipped

### Shortcut for the agent

Say: **"push a new build to Cloudflare quadreal"** — commit, push GitHub, and deploy live.

Say: **"Everything is good now, push the code"** — same as a full Cloudflare ship when you want online updated.

Cursor also loads `.cursor/rules/push-new-build.mdc` and `.cursor/skills/push-cloudflare-build/SKILL.md` when you ask to deploy.

## Tips
- For complex requests: When you do "/programmer do this feature" press the plus button on the left side of the chat box and select "plan" and then on the far right of the chat box where it says "auto", click that, uncheck auto, then change that to "Opus" and then send your request. It will build out a plan for your feature, the plan should open when its done and you will see a button that says "Build plan" and the agent select next to it "Auto" (leave it on auto) then press build plan. This will generally give you better results for what you want to do 
    - If the request is fairly simple, you don't have to do this whole plan process, you can just do "/programmer do this thing" directly
