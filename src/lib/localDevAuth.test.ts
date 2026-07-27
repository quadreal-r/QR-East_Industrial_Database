import { afterEach, describe, expect, it } from 'vitest'
import {
  LOCAL_DEV_AS_KEY,
  clearLocalDevAs,
  getLocalDevAs,
  isLocalDevHost,
  pickLocalDevEmail,
  setLocalDevAs,
} from '@/lib/localDevAuth'

describe('localDevAuth', () => {
  afterEach(() => {
    localStorage.removeItem(LOCAL_DEV_AS_KEY)
  })

  it('detects localhost hosts only', () => {
    expect(isLocalDevHost('127.0.0.1')).toBe(true)
    expect(isLocalDevHost('localhost')).toBe(true)
    expect(isLocalDevHost('qr-east-industrial-database.pages.dev')).toBe(false)
  })

  it('stores the localhost Admin / Viewer sign-in choice', () => {
    expect(getLocalDevAs()).toBeNull()
    setLocalDevAs('admin')
    expect(getLocalDevAs()).toBe('admin')
    setLocalDevAs('viewer')
    expect(getLocalDevAs()).toBe('viewer')
    clearLocalDevAs()
    expect(getLocalDevAs()).toBeNull()
  })

  it('picks Admin / Viewer emails from Manage users when switching roles', () => {
    expect(
      pickLocalDevEmail({
        as: 'admin',
        configuredEmail: 'viewer@example.com',
        adminEmails: ['admin@example.com'],
        viewerEmails: ['viewer@example.com'],
      }),
    ).toBe('admin@example.com')

    expect(
      pickLocalDevEmail({
        as: 'viewer',
        configuredEmail: 'admin@example.com',
        adminEmails: ['admin@example.com'],
        viewerEmails: ['viewer@example.com'],
      }),
    ).toBe('viewer@example.com')

    expect(
      pickLocalDevEmail({
        as: 'admin',
        configuredEmail: 'admin@example.com',
        adminEmails: ['admin@example.com', 'other-admin@example.com'],
        viewerEmails: ['viewer@example.com'],
      }),
    ).toBe('admin@example.com')
  })

  it('defaults to LOCAL_DEV_EMAIL when no role override is set', () => {
    expect(
      pickLocalDevEmail({
        as: null,
        configuredEmail: 'dev@example.com',
        adminEmails: ['admin@example.com'],
        viewerEmails: [],
      }),
    ).toBe('dev@example.com')
  })
})
