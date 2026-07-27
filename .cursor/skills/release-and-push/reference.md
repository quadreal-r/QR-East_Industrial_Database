# Release and Push — Reference

## Version display

The map topbar shows `BUILD_VERSION_LABEL` from `src/generated/buildVersion.ts`, rendered by `src/components/VersionStamp/VersionStamp.tsx`.

Dev builds append `(dev)` via `import.meta.env.DEV`.

## Version scripts

| Command | Effect |
|---------|--------|
| `npm run version:bump:if-needed` | Patch bump when local app changes are not yet covered by the current version |
| `npm run version:bump` | Force patch bump (`scripts/bump-version.mjs`) |
| `npm run version:bump:semver -- minor` | Minor bump |
| `node scripts/bump-semver.mjs major` | Major bump |

Shared logic: `scripts/lib/semver-version.mjs`.

## Policy

Bump map app **patch** locally after any uncommitted app changes (`npm run version:bump:if-needed`). Further edits get another bump; re-running with the same change set does not. A Cloudflare ship (`push-cloudflare-build`) publishes that version online.

## Files touched when a bump happens

| File | Purpose |
|------|---------|
| `package.json` | npm/package version |
| `version.build.json` | Canonical semver JSON `{ "semver": "x.y.z" }` |
| `src/generated/buildVersion.ts` | UI label + constants |
| `CHANGELOG.md` | Human-readable history |

## Commit message examples

**Feature release:**

```
feat: add keyboard shortcuts for map navigation

- Add j/k to move between markers
- Document shortcuts in settings panel
```

**Bug fix release:**

```
fix: correct marker drag anchor on rotated maps

- Recalculate offset when map bearing changes
```

**Mixed session (prefer dominant change type in subject):**

```
feat: improve RTU picture viewer zoom

- Add pinch-to-zoom on touch devices
- Fix stale thumbnail after assign rename
```

## Secret exclusions

Never stage or commit:

- `.env.local`
- `nogps-list.txt`
- `nogps-not-on-cdn.txt`

Same list as `scripts/push-live.mjs`.
