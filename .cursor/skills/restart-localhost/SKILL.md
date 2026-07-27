---
name: restart-localhost
description: Restarts the QR-East_Industrial_Database Vite dev server on localhost port 5174. Use when the user asks to restart localhost, restart the dev server, fix a blank page, unstick port 5174, or says start/run dev after a stuck session.
---

# Restart Localhost

Restart the local dev server for **QR-East_Industrial_Database**. Do not only tell the user what to run — execute it.

## Quick reference

| Item | Value |
|------|-------|
| Project root | `C:\Users\Robert\Projects\QR-East_Industrial_Database` |
| Local URL | http://127.0.0.1:5174/ (or http://localhost:5174/) |
| Default command | `npm run dev:restart` |

## Workflow

```
Restart progress:
- [ ] Step 1: Check existing dev terminals
- [ ] Step 2: Run restart command
- [ ] Step 3: Confirm server is up
- [ ] Step 4: Report URL to user
```

### Step 1: Check existing dev terminals

List the terminals folder. If a terminal is already running `npm run dev` or Vite on 5174, note it — `dev:restart` kills port 5174 and starts fresh. Do not touch port 5173 (QR Drawing Explorer).

### Step 2: Run restart command

From repo root:

```powershell
cd C:\Users\Robert\Projects\QR-East_Industrial_Database
npm run dev:restart
```

`dev:restart` runs `scripts/restart-dev.cmd`: kills any process listening on port 5174, waits 1s, then `npm run dev`.

Run with `block_until_ms: 0` so the dev server stays running in the background.

**Pick a different script only when the user says why:**

| Command | When |
|---------|------|
| `npm run dev` | First start, no port conflict |
| `npm run dev:restart` | Default — stuck port, blank page, or explicit restart |
| `npm run dev:window` | Dev should survive closing the Cursor terminal |
| `npm run dev:onedrive` | File-watching issues in OneDrive-synced folders |
| `npm run dev:persistent` | Vite in its own window with auto-restart on crash |

### Step 3: Confirm server is up

Poll the background terminal until output includes Vite ready (e.g. `Local:` and `5174`) or wait ~5s and read terminal output. If restart failed (port still in use, npm error), report the error and retry once with `npm run dev:restart`.

### Step 4: Report URL

Tell the user:

- Dev server restarted (or started)
- Open http://127.0.0.1:5174/
- Hard-refresh (Ctrl+Shift+R) if they still see a stale blank page

## Examples

**User:** "Restart localhost" / "dev server is stuck" / "blank page on 5174"

→ Run `npm run dev:restart` from repo root with `block_until_ms: 0`, poll until Vite shows `Local:` on 5174, report http://127.0.0.1:5174/

**User:** "Start the dev server" (no prior server, no port conflict)

→ Run `npm run dev` with `block_until_ms: 0`

**User:** "Keep dev running after I close Cursor"

→ Run `npm run dev:window` or `npm run dev:persistent`

## Do not

- Commit or push — this skill is local dev only
- Use `npm run preview` unless the user asked to preview a production build
- Kill unrelated processes except what `restart-dev.cmd` handles on port 5174 (never kill 5173)

## Additional resources

- PowerShell cheat sheet: `.cursor/rules/powershell-commands.mdc`
