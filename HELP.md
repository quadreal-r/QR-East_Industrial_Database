# How to work in this project

## To run the project

- In the top bar of cursor, select view -> terminal
- Type and enter "npm run dev", the project will then be running locally on your machine at "http://localhost:5173/"
- Enter that url in the browser to access your site
- **Refreshing the browser does not start or stop the server.** They are separate: the server runs in the terminal; refresh only reloads the page in the browser.
- **Keep the dev terminal open** the whole time you work. If you close the terminal tab, close Cursor, or shut the laptop, the server stops and `http://localhost:5173/` will not load until you start it again.
- If the page is blank or won't load:
  - Check the terminal — you should see `VITE ... ready`. If the terminal is gone or shows a prompt with no server, run `npm run dev` again (see [To restart the dev server](#to-restart-the-dev-server)).
  - Run `npm install` if you just pulled new code
  - Copy `.env.example` to `.env.local` and add your keys (Supabase + Google Maps)
- Changes to the code will automatically be reflected onto the site, no need to restart the website, you can simply refresh the page

## To restart the dev server

Use this when `http://localhost:5173/` is blank, stuck, or the terminal shows errors after pulling new code.

**Option A — restart script (recommended on Windows):**

```powershell
cd C:\Users\Robert\Projects\building-map-explorer
npm run dev:restart
```

This stops whatever is using port 5173, then starts the dev server again.

**Option B — manual restart:**

1. In the terminal where `npm run dev` is running, press **Ctrl+C**
2. Start it again:

```powershell
cd C:\Users\Robert\Projects\building-map-explorer
npm run dev
```

**OneDrive / synced folders:** use `npm run dev:onedrive` instead of `npm run dev` if the normal dev command has file-watching issues.

**Keep server running in its own window (recommended):** opens a separate Command Prompt that stays up even if you close Cursor's terminal:

```powershell
cd C:\Users\Robert\Projects\building-map-explorer
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
cd C:\Users\Robert\Projects\building-map-explorer
git pull origin main
npm run typecheck
npm run lint
npm test
git status
git add .
git commit -m "fix: short description of what changed"
git push origin main
```

Pushing to **main** triggers GitHub Actions, which builds and publishes the site to GitHub Pages.

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

Or use **`npm run push-live`** — runs tests, commits, and pushes.

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

**Important:** The live site is built from **GitHub `main`**, not your laptop. Uncommitted local code will not appear online.

### A. Code / UI changes

```powershell
cd C:\Users\Robert\Projects\building-map-explorer
git pull origin main
npm run lint
npm run typecheck
npm run test
git status
git add .
git commit -m "feat: short description of what changed"
git push origin main
```

Or use **`npm run push-live`**.

### B. Map data changes

Sign in to the app and edit — data saves to Supabase immediately. No git push needed for portfolio changes.

### C. RTU documents (PDFs on R2)

```powershell
npm run upload-rtu-documents-r2 -- --from-folder "C:/path/to/RTU-Documents" --all-files --skip-existing
```

Ensure document metadata rows exist in Supabase (via the app while signed in).

### D. After any deploy

1. Watch Actions: https://github.com/quadreal-r/building-map-explorer/actions
2. When green, open https://quadreal-r.github.io/building-map-explorer/
3. Hard-refresh (Ctrl+Shift+R)

### Shortcut for the agent

Say: **"Everything is good now, push the code"** — the agent should pull, test, commit, and push to `main`.

Cursor also loads `.cursor/rules/push-new-build.mdc` when you ask to deploy or push a build.

## Tips
- For complex requests: When you do "/programmer do this feature" press the plus button on the left side of the chat box and select "plan" and then on the far right of the chat box where it says "auto", click that, uncheck auto, then change that to "Opus" and then send your request. It will build out a plan for your feature, the plan should open when its done and you will see a button that says "Build plan" and the agent select next to it "Auto" (leave it on auto) then press build plan. This will generally give you better results for what you want to do 
    - If the request is fairly simple, you don't have to do this whole plan process, you can just do "/programmer do this thing" directly
