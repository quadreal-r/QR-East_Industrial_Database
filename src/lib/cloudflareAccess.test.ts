import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  AUTH_LOGGED_OUT_KEY,
  CLOUDFLARE_ACCESS_TEAM_HOST,
  clearAuthLoggedOutLatch,
  clearBrowserAuthStorage,
  cloudflareAccessAppLogoutUrl,
  cloudflareAccessLogoutUrl,
  cloudflareAccessTeamLogoutUrl,
  isAuthLoggedOutLatchSet,
  isCloudflareAccessHost,
  markAuthLoggedOutLatch,
  redirectToCloudflareAccessApp,
  redirectToCloudflareAccessWall,
} from '@/lib/cloudflareAccess'

describe('cloudflareAccess', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    localStorage.clear()
    sessionStorage.clear()
  })

  it('detects the production and preview Access hosts', () => {
    expect(isCloudflareAccessHost('qr-east-industrial-database.pages.dev')).toBe(true)
    expect(isCloudflareAccessHost('6d67dbce.qr-east-industrial-database.pages.dev')).toBe(true)
    expect(isCloudflareAccessHost('127.0.0.1')).toBe(false)
    expect(isCloudflareAccessHost('quadreal-r.github.io')).toBe(false)
  })

  it('builds app and team logout URLs that never nest another logout in returnTo', () => {
    const origin = 'https://qr-east-industrial-database.pages.dev'
    const appRoot = `${origin}/`
    expect(cloudflareAccessAppLogoutUrl(origin)).toBe(
      `${origin}/cdn-cgi/access/logout?returnTo=${encodeURIComponent(appRoot)}`,
    )
    expect(cloudflareAccessLogoutUrl(origin)).toBe(cloudflareAccessAppLogoutUrl(origin))
    expect(cloudflareAccessTeamLogoutUrl(appRoot)).toBe(
      `https://${CLOUDFLARE_ACCESS_TEAM_HOST}/cdn-cgi/access/logout?returnTo=${encodeURIComponent(appRoot)}`,
    )
    // Nesting another logout URL in returnTo is what shows "Failed to log out."
    expect(cloudflareAccessAppLogoutUrl(origin)).not.toContain(
      encodeURIComponent('/cdn-cgi/access/logout'),
    )
    expect(cloudflareAccessTeamLogoutUrl(appRoot)).not.toContain(
      encodeURIComponent('/cdn-cgi/access/logout'),
    )
  })

  it('redirects Access hosts through app logout back to the app (auth wall)', async () => {
    const replace = vi.fn()
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('window', {
      location: {
        hostname: 'qr-east-industrial-database.pages.dev',
        origin: 'https://qr-east-industrial-database.pages.dev',
        replace,
      },
    })
    await redirectToCloudflareAccessWall()
    const origin = 'https://qr-east-industrial-database.pages.dev'
    const appRoot = `${origin}/`
    // Full navigation to app logout only — team logout was showing "Failed to log out".
    expect(fetchMock).not.toHaveBeenCalled()
    expect(replace).toHaveBeenCalledWith(
      `${origin}/cdn-cgi/access/logout?returnTo=${encodeURIComponent(appRoot)}`,
    )
  })

  it('keeps localhost Logout on the local app (no production Access logout)', async () => {
    const replace = vi.fn()
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('window', {
      location: {
        hostname: '127.0.0.1',
        origin: 'http://127.0.0.1:5173',
        replace,
      },
    })
    await redirectToCloudflareAccessWall()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(replace).toHaveBeenCalledWith('http://127.0.0.1:5173/')
  })

  it('clears auth storage and sets the logged-out latch', () => {
    localStorage.setItem('sb-abc-auth-token', '{"access_token":"x"}')
    localStorage.setItem('sb-abc-auth-token-code-verifier', 'y')
    localStorage.setItem('bme-settings', '{}')
    sessionStorage.setItem('scratch', '1')
    clearBrowserAuthStorage()
    expect(localStorage.getItem('sb-abc-auth-token')).toBeNull()
    expect(localStorage.getItem('sb-abc-auth-token-code-verifier')).toBeNull()
    expect(localStorage.getItem('bme-settings')).toBe('{}')
    expect(sessionStorage.getItem('scratch')).toBeNull()
    expect(isAuthLoggedOutLatchSet()).toBe(true)
    expect(localStorage.getItem(AUTH_LOGGED_OUT_KEY)).toBe('1')
    clearAuthLoggedOutLatch()
    expect(isAuthLoggedOutLatchSet()).toBe(false)
    markAuthLoggedOutLatch()
    expect(isAuthLoggedOutLatchSet()).toBe(true)
  })

  it('reloads localhost Sign in after clearing the latch', () => {
    const reload = vi.fn()
    markAuthLoggedOutLatch()
    vi.stubGlobal('window', {
      location: {
        hostname: '127.0.0.1',
        origin: 'http://127.0.0.1:5173',
        reload,
        replace: vi.fn(),
      },
    })
    redirectToCloudflareAccessApp()
    expect(isAuthLoggedOutLatchSet()).toBe(false)
    expect(reload).toHaveBeenCalled()
  })
})
