import { describe, expect, it } from 'vitest'
import { nextCostPanelStage } from './costPanelStage'

describe('cost panel stage cycle', () => {
  it('cycles minimized → half → full → minimized', () => {
    expect(nextCostPanelStage('minimized')).toBe('half')
    expect(nextCostPanelStage('half')).toBe('full')
    expect(nextCostPanelStage('full')).toBe('minimized')
  })
})
