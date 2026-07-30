import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ACCESS_OFFLINE_KEY,
  PULL_THE_PLUG_EMAIL,
  buildAccessOfflineValue,
  decideOfflineCodeRequest,
  decideOfflineVerify,
  getAccessOffline,
  isAppAdmin,
  isPullThePlugEmail,
  parseAccessOfflineValue,
  setAccessOffline,
} from '../../functions/lib/accessOffline'

const maybeSingle = vi.fn()
const upsert = vi.fn()
const eq = vi.fn(() => ({ maybeSingle }))
const select = vi.fn(() => ({ eq }))
const from = vi.fn(() => ({ select, upsert }))

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({ from })),
}))

describe('accessOffline helpers', () => {
  const env = {
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role',
  }

  beforeEach(() => {
    maybeSingle.mockReset()
    upsert.mockReset()
    eq.mockClear()
    select.mockClear()
    from.mockClear()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('detects pull-the-plug email case-insensitively', () => {
    expect(isPullThePlugEmail(PULL_THE_PLUG_EMAIL)).toBe(true)
    expect(isPullThePlugEmail('  PullThePlug@QuadReal.com ')).toBe(true)
    expect(isPullThePlugEmail('someone@quadreal.com')).toBe(false)
  })

  it('parses access_offline values', () => {
    expect(parseAccessOfflineValue({ offline: true })).toBe(true)
    expect(parseAccessOfflineValue({ offline: false })).toBe(false)
    expect(parseAccessOfflineValue(null)).toBe(false)
    expect(parseAccessOfflineValue({})).toBe(false)
  })

  it('builds access_offline values with metadata', () => {
    const value = buildAccessOfflineValue(true, { setBy: ' PullThePlug@QuadReal.com ' })
    expect(value.offline).toBe(true)
    expect(value.setBy).toBe(PULL_THE_PLUG_EMAIL)
    expect(value.setAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('reads offline flag via service role', async () => {
    maybeSingle.mockResolvedValueOnce({ data: { value: { offline: true } }, error: null })
    await expect(getAccessOffline(env)).resolves.toBe(true)
    expect(from).toHaveBeenCalledWith('app_settings')
    expect(eq).toHaveBeenCalledWith('key', ACCESS_OFFLINE_KEY)
  })

  it('writes offline flag via upsert', async () => {
    upsert.mockResolvedValueOnce({ error: null })
    await setAccessOffline(env, true, { setBy: PULL_THE_PLUG_EMAIL })
    expect(from).toHaveBeenCalledWith('app_settings')
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        key: ACCESS_OFFLINE_KEY,
        value: expect.objectContaining({
          offline: true,
          setBy: PULL_THE_PLUG_EMAIL,
        }),
      }),
      { onConflict: 'key' },
    )
  })

  it('treats app_roles admin as Admin and viewers as not', async () => {
    maybeSingle.mockResolvedValueOnce({ data: { role: 'admin' }, error: null })
    await expect(isAppAdmin('admin@example.com', env)).resolves.toBe(true)

    maybeSingle.mockResolvedValueOnce({ data: { role: 'viewer' }, error: null })
    await expect(isAppAdmin('viewer@example.com', env)).resolves.toBe(false)

    maybeSingle.mockResolvedValueOnce({ data: null, error: null })
    await expect(isAppAdmin('missing@example.com', env)).resolves.toBe(false)
  })

  it('decides pull-the-plug / admin OTP / non-admin block for code requests', () => {
    expect(
      decideOfflineCodeRequest({
        email: PULL_THE_PLUG_EMAIL,
        offline: false,
        isAdmin: false,
      }),
    ).toEqual({ action: 'pull_plug' })

    expect(
      decideOfflineCodeRequest({
        email: 'viewer@example.com',
        offline: true,
        isAdmin: false,
      }),
    ).toEqual({
      action: 'block_non_admin',
      error: 'The app is offline. Only an Admin can sign in to restore access.',
    })

    expect(
      decideOfflineCodeRequest({
        email: 'admin@example.com',
        offline: true,
        isAdmin: true,
      }),
    ).toEqual({ action: 'continue' })

    expect(
      decideOfflineCodeRequest({
        email: 'anyone@example.com',
        offline: false,
        isAdmin: false,
      }),
    ).toEqual({ action: 'continue' })
  })

  it('clears offline for Admin verify and refuses viewers', () => {
    expect(decideOfflineVerify({ offline: true, isAdmin: true })).toEqual({
      action: 'clear_offline',
    })
    expect(decideOfflineVerify({ offline: true, isAdmin: false })).toEqual({
      action: 'refuse',
      error: 'The app is offline. Only an Admin can restore access.',
    })
    expect(decideOfflineVerify({ offline: false, isAdmin: false })).toEqual({
      action: 'continue',
    })
  })
})
