---
name: release-and-push
description: Writes a commit message from chat work, bumps semver (1.0.2), updates CHANGELOG.md, stages all changes, commits, and pushes to main. Use when the user asks to release, ship, commit and push, update the changelog or version, or says everything is good and wants code pushed.
---

# Release and Push

End-of-session release workflow for building-map-explorer: summarize work, bump semver, update changelog, commit, push to `main` (triggers GitHub Pages deploy).

## Prerequisites

- User explicitly requested release/push (this skill is that request).
- Never commit `.env.local` or other secret files (see `scripts/push-live.mjs` exclusions).

## Workflow checklist

Copy and track:

```
Release progress:
- [ ] Step 1: Summarize chat work
- [ ] Step 2: Choose semver bump
- [ ] Step 3: Bump version files
- [ ] Step 4: Update CHANGELOG.md
- [ ] Step 5: Pre-push checks
- [ ] Step 6: Stage, commit, push
- [ ] Step 7: Report deploy links
```

## Step 1: Summarize chat work

Review the conversation and `git diff` to list what changed. Group into:

- **Added** — new features or capabilities
- **Changed** — behavior or UI updates
- **Fixed** — bug fixes
- **Removed** — deleted features or dead code

Use this summary for both the changelog entry and the commit message body.

## Step 2: Choose semver bump

Read current version from `package.json` (`version` field). Default starting point: `1.0.0`.

| Bump | When | Example |
|------|------|---------|
| **patch** | Bug fixes, small tweaks, docs-only | 1.0.1 → 1.0.2 |
| **minor** | New features, backward-compatible | 1.0.2 → 1.1.0 |
| **major** | Breaking changes | 1.1.0 → 2.0.0 |

When unsure, default to **patch**. Ask the user only for **major** unless they already indicated breaking changes.

## Step 3: Bump version files

Run from repo root (PowerShell):

```powershell
node scripts/bump-semver.mjs patch
```

Or: `npm run version:bump:semver -- patch` (same script; `npm run version:bump` is patch-only).

Replace `patch` with `minor` or `major` as chosen in Step 2.

This updates:

- `package.json` — `"version"`
- `version.build.json` — `{ "semver": "x.y.z" }`
- `src/generated/buildVersion.ts` — `BUILD_VERSION_LABEL` (displayed in map topbar via `VersionStamp`)

Version is set in the release commit before push. CI builds the committed semver as-is (no auto-bump on deploy).

## Step 4: Update CHANGELOG.md

Create `CHANGELOG.md` at repo root if missing. Use [Keep a Changelog](https://keepachangelog.com/) format.

Add a new section **at the top** (below the title):

```markdown
## [1.0.2] - 2026-07-02

### Added
- Short bullet from chat summary

### Fixed
- Short bullet from chat summary
```

Rules:

- Version and date must match Step 3.
- Omit empty `###` sections.
- One line per bullet; start with a verb ("Add", "Fix", "Update").
- Only document work from this session (plus any uncommitted diff being shipped).

## Step 5: Pre-push checks

Run in order:

```powershell
git pull origin main
npm run typecheck
npm run lint
npm run test
```

Fix failures before committing. Do not skip unless the user explicitly says to.

## Step 6: Stage, commit, push

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

3. Commit using repo convention (`feat:`, `fix:`, `chore:` prefix + imperative summary):

```powershell
git commit -m "$( @'
feat: short summary of main change

- Bullet matching changelog
- Another bullet if needed

EOF
'@ )"
```

On Windows PowerShell without heredoc, use a quoted `-m` for the subject and `-m` again for the body, or write the message to a temp file.

Commit subject should align with the changelog headline. Include `CHANGELOG.md` and version files in the commit.

4. Push:

```powershell
git pull --rebase origin main
git push origin main
```

Alternative: `npm run push-live -- "feat: your subject"` runs checks and push but **does not** bump semver or write changelog — prefer the full workflow above when using this skill.

## Step 7: Report deploy links

Tell the user:

- Actions: https://github.com/quadreal-r/building-map-explorer/actions/workflows/deploy.yml
- Live site: https://quadreal-r.github.io/building-map-explorer/
- New version label (from `BUILD_VERSION_LABEL`)
- Deploy takes ~5–10 minutes; hard-refresh when done

## Additional resources

- CI/version migration details: [reference.md](reference.md)
- Push checklist and R2 media: `.cursor/rules/push-new-build.mdc`
