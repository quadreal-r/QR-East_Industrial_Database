import { describe, expect, it } from 'vitest'
import {
  appRolesExportFilename,
  buildAppRolesCsv,
  parseAppRolesCsv,
  planAppRoleImport,
  roleLabel,
} from '@/lib/appUserRolesCsv'

describe('appUserRolesCsv', () => {
  it('labels roles for messages', () => {
    expect(roleLabel('admin')).toBe('Admin')
    expect(roleLabel('viewer')).toBe('Viewer')
  })

  it('builds a sorted email,role CSV', () => {
    expect(
      buildAppRolesCsv([
        { email: 'Zed@Example.com', role: 'admin' },
        { email: 'ann@example.com', role: 'viewer' },
      ]),
    ).toBe('email,role\nann@example.com,viewer\nzed@example.com,admin\n')
  })

  it('names export files with a date stamp', () => {
    expect(appRolesExportFilename(new Date('2026-07-27T12:00:00Z'))).toBe(
      'qr-east-users-2026-07-27.csv',
    )
  })

  it('parses headered CSV and rejects bad rows', () => {
    const parsed = parseAppRolesCsv(
      [
        'email,role',
        'ann@example.com,viewer',
        'bob@example.com,admin',
        'not-an-email,viewer',
        'ann@example.com,admin',
        'cara@example.com,editor',
      ].join('\n'),
    )
    expect(parsed.rows).toEqual([
      { email: 'ann@example.com', role: 'viewer' },
      { email: 'bob@example.com', role: 'admin' },
    ])
    expect(parsed.errors).toEqual([
      'Line 4: invalid email.',
      'Line 5: duplicate email ann@example.com in file.',
      'Line 6: role must be admin or viewer (got "editor").',
    ])
  })

  it('accepts role,email column order', () => {
    const parsed = parseAppRolesCsv('role,email\nadmin,lead@example.com\n')
    expect(parsed.rows).toEqual([{ email: 'lead@example.com', role: 'admin' }])
    expect(parsed.errors).toEqual([])
  })

  it('plans only real additions and role changes', () => {
    const plan = planAppRoleImport(
      [
        { email: 'ann@example.com', role: 'viewer' },
        { email: 'bob@example.com', role: 'admin' },
      ],
      [
        { email: 'ann@example.com', role: 'viewer' },
        { email: 'bob@example.com', role: 'viewer' },
        { email: 'cara@example.com', role: 'admin' },
      ],
    )
    expect(plan).toEqual({
      toSave: [
        { email: 'bob@example.com', role: 'viewer' },
        { email: 'cara@example.com', role: 'admin' },
      ],
      alreadyMatch: 1,
      roleChanges: 1,
      additions: 1,
    })
  })
})
