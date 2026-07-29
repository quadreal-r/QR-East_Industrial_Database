import { describe, expect, it } from 'vitest'
import { toggleFullOrMinimized, toggleHalfOrMinimized } from './costPanelStage'

describe('cost panel stage toggles', () => {
  it('yellow sphere toggles half ↔ minimized', () => {
    expect(toggleHalfOrMinimized('minimized')).toBe('half')
    expect(toggleHalfOrMinimized('half')).toBe('minimized')
    expect(toggleHalfOrMinimized('full')).toBe('half')
  })

  it('green sphere toggles full ↔ minimized', () => {
    expect(toggleFullOrMinimized('minimized')).toBe('full')
    expect(toggleFullOrMinimized('full')).toBe('minimized')
    expect(toggleFullOrMinimized('half')).toBe('full')
  })
})
