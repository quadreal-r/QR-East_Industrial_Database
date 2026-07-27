import { describe, expect, it } from 'vitest'

// Mirror scripts/lib/semver-version.mjs rollover rules (kept here so tsc need not resolve .mjs).
const SEMVER_PATCH_MAX = 99

function normalizeSemverParts({
  major,
  minor,
  patch,
}: {
  major: number
  minor: number
  patch: number
}) {
  let maj = major
  let min = minor
  let pat = patch
  while (pat > SEMVER_PATCH_MAX) {
    pat -= SEMVER_PATCH_MAX + 1
    min += 1
  }
  while (min > SEMVER_PATCH_MAX) {
    min -= SEMVER_PATCH_MAX + 1
    maj += 1
  }
  return { major: maj, minor: min, patch: pat }
}

function bumpSemver(
  current: { major: number; minor: number; patch: number },
  kind: 'patch' | 'minor' | 'major',
) {
  const { major, minor, patch } = normalizeSemverParts(current)
  if (kind === 'major') return { major: major + 1, minor: 0, patch: 0 }
  if (kind === 'minor') return { major, minor: minor + 1, patch: 0 }
  if (patch >= SEMVER_PATCH_MAX) {
    return normalizeSemverParts({ major, minor: minor + 1, patch: 0 })
  }
  return { major, minor, patch: patch + 1 }
}

function formatSemver({
  major,
  minor,
  patch,
}: {
  major: number
  minor: number
  patch: number
}) {
  return `${major}.${minor}.${patch}`
}

describe('semver patch rollover at 99', () => {
  it('keeps patch bumps under the limit', () => {
    expect(bumpSemver({ major: 1, minor: 13, patch: 98 }, 'patch')).toEqual({
      major: 1,
      minor: 13,
      patch: 99,
    })
  })

  it('rolls 1.13.99 → 1.14.0', () => {
    expect(bumpSemver({ major: 1, minor: 13, patch: 99 }, 'patch')).toEqual({
      major: 1,
      minor: 14,
      patch: 0,
    })
  })

  it('matches the 1.1.99 → 1.2.0 example', () => {
    expect(bumpSemver({ major: 1, minor: 1, patch: SEMVER_PATCH_MAX }, 'patch')).toEqual({
      major: 1,
      minor: 2,
      patch: 0,
    })
  })

  it('normalizes overflow already past 99', () => {
    expect(formatSemver(normalizeSemverParts({ major: 1, minor: 13, patch: 105 }))).toBe(
      '1.14.5',
    )
  })
})
