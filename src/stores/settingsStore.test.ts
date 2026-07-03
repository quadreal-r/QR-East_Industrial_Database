import { describe, expect, it } from 'vitest'
import { fetchSettings, saveSettings } from '@/data/settingsApi'

describe('settingsApi', () => {
  it('exports fetch and save helpers', () => {
    expect(typeof fetchSettings).toBe('function')
    expect(typeof saveSettings).toBe('function')
  })
})
