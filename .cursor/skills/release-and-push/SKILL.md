---
name: release-and-push
description: >-
  Summarize chat work, ensure local version bump after app changes,
  update CHANGELOG.md when version moved, commit, and push to main.
  Use when the user asks to release, ship, commit and push, or says
  everything is good and wants code pushed. For a live Cloudflare
  deploy, prefer push-cloudflare-build (includes commit + push).
---

# Release and Push

Push workflow for QR-East_Industrial_Database: summarize work, ensure version policy, update changelog if needed, commit, push to `main` (**GitHub version tracking only**).

**Live hosting is Cloudflare Pages**, not GitHub Pages. Pushing to `main` runs CI checks only — it does **not** update the live site.

To update the live site as well, use **`push-cloudflare-build`** (quadreal path), which commits, pushes, and deploys.

**Version policy:**

- While coding, any local app changes bump the map app patch version (`npm run version:bump:if-needed`).
- A Cloudflare ship publishes that local version online.
- Before commit, run `version:bump:if-needed` once more (safe no-op if this change set was already bumped).

## Prerequisites

- User explicitly requested release/push (this skill is that request).
- Never commit `.env.local` or other secret files (see `scripts/push-live.mjs` exclusions).

## Workflow checklist

Copy and track:

```
Release progress:
- [ ] Step 1: Summarize chat work
- [ ] Step 2: Ensure local version
- [ ] Step 3: Update CHANGELOG.md if version moved
- [ ] Step 4: Pre-push checks
- [ ] Step 5: Stage, commit, push
- [ ] Step 6: Report GitHub + remind about Cloudflare
```

## Step 1: Summarize chat work

Review the conversation and `git diff` to list what changed. Group into:

- **Added** — new features or capabilities
- **Changed** — behavior or UI updates
- **Fixed** — bug fixes
- **Removed** — deleted features or dead code

Use this summary for both the changelog entry (when version moved) and the commit message body.

## Step 2: Ensure local version

```powershell
npm run version:bump:if-needed
```

This bumps **patch** when there are uncommitted app changes not already covered by the current local version. For an intentional **minor** or **major**, run `node scripts/bump-semver.mjs minor|major` instead (ask only for major unless they already indicated breaking changes).

Version files updated when a bump happens:

- `package.json` — `"version"`
- `version.build.json` — `{ "semver": "x.y.z" }`
- `src/generated/buildVersion.ts` — `BUILD_VERSION_LABEL` (map topbar)

## Step 3: Update CHANGELOG.md if version moved

If `package.json` version differs from `HEAD`, add a Keep a Changelog section for that version. Skip changelog edits when the version did not change.

```markdown
## [1.0.2] - 2026-07-02

### Added
- Short bullet from chat summary

### Fixed
- Short bullet from chat summary
```

Rules:

- Version and date must match the local semver.
- Omit empty `###` sections.
- One line per bullet; start with a verb ("Add", "Fix", "Update").
- Only document work from this session (plus any uncommitted diff being shipped).

## Step 4: Pre-push checks

Run in order:

```powershell
git pull origin main
npm run typecheck
npm run lint
npm run test
```

Fix failures before committing. Do not skip unless the user explicitly says to.

## Step 5: Stage, commit, push

1. Inspect changes:

```powershell
git status
git diff
git log -5 --oneline
```

2. Stage everything except secrets:

```powershell
git add -A
git reset HEAD -- .env.local
git reset HEAD -- nogps-list.txt
git reset HEAD -- nogps-not-on-cdn.txt
```

3. Commit using repo convention (`feat:`, `fix:`, `chore:` prefix + imperative summary). Include `CHANGELOG.md` and version files when they changed.

4. Push:

```powershell
git pull --rebase origin main
git push origin main
```

## Step 6: Report

Tell the user:

- Code is on GitHub `main` (version history)
- CI: https://github.com/quadreal-r/QR-East_Industrial_Database/actions/workflows/ci.yml
- Live site is **not** updated by this push alone
- To publish live: say **push a new build to Cloudflare quadreal** (uses `push-cloudflare-build`)
- Version label from `BUILD_VERSION_LABEL`

If they clearly wanted the live site updated (e.g. "everything is good, push the code" after verifying the app), prefer running **`push-cloudflare-build`** (quadreal) instead of this GitHub-only flow.

## Additional resources

- CI/version details: [reference.md](reference.md)
- Live Cloudflare ship: `.cursor/skills/push-cloudflare-build/SKILL.md`
- R2 media: `.cursor/rules/push-new-build.mdc`
