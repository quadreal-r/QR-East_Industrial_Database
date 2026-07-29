export type CostPanelStage = 'minimized' | 'half' | 'full'

/** Yellow sphere: half screen ↔ minimized (from full, opens half). */
export function toggleHalfOrMinimized(stage: CostPanelStage): CostPanelStage {
  return stage === 'half' ? 'minimized' : 'half'
}

/** Green sphere: full screen ↔ minimized (from half, opens full). */
export function toggleFullOrMinimized(stage: CostPanelStage): CostPanelStage {
  return stage === 'full' ? 'minimized' : 'full'
}
