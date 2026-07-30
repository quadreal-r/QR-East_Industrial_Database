import { afterEach, describe, expect, it } from 'vitest'
import { normalizeAppRole, shouldBootstrapSilentSession } from '@/lib/appRoles'
import { AUTH_LOGGED_OUT_KEY } from '@/lib/cloudflareAccess'

describe('app roles', () => {
  afterEach(() => {
    localStorage.removeItem(AUTH_LOGGED_OUT_KEY)
  })

  it('defaults every unknown role to Viewer', () => {
    expect(normalizeAppRole('admin')).toBe('admin')
    expect(normalizeAppRole('viewer')).toBe('viewer')
    expect(normalizeAppRole(null)).toBe('viewer')
    expect(normalizeAppRole('editor')).toBe('viewer')
  })

  it('bootstraps silent sessions only on localhost and Access hosts', () => {
    expect(shouldBootstrapSilentSession('127.0.0.1')).toBe(true)
    expect(shouldBootstrapSilentSession('localhost')).toBe(true)
    expect(shouldBootstrapSilentSession('qr-database.insp360.ca')).toBe(true)
    expect(shouldBootstrapSilentSession('qr-east-industrial-database.pages.dev')).toBe(true)
    expect(shouldBootstrapSilentSession('preview.qr-east-industrial-database.pages.dev')).toBe(true)
    expect(shouldBootstrapSilentSession('quadreal-r.github.io')).toBe(false)
  })

  it('keeps localhost logged out after Logout, but Access hosts still bootstrap', () => {
    localStorage.setItem(AUTH_LOGGED_OUT_KEY, '1')
    // Localhost: no Access wall — latch blocks silent login until Sign in.
    expect(shouldBootstrapSilentSession('127.0.0.1')).toBe(false)
    // Access host: page load means the wall already succeeded — mint the app session.
    expect(shouldBootstrapSilentSession('qr-database.insp360.ca')).toBe(true)
    expect(shouldBootstrapSilentSession('qr-east-industrial-database.pages.dev')).toBe(true)
    expect(shouldBootstrapSilentSession('preview.qr-east-industrial-database.pages.dev')).toBe(
      true,
    )
  })
})
