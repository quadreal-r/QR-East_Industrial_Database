export type CostPanelStage = 'minimized' | 'half' | 'full'

const COST_PANEL_STAGE_ORDER: CostPanelStage[] = ['minimized', 'half', 'full']

export function nextCostPanelStage(stage: CostPanelStage): CostPanelStage {
  const i = COST_PANEL_STAGE_ORDER.indexOf(stage)
  return COST_PANEL_STAGE_ORDER[(i + 1) % COST_PANEL_STAGE_ORDER.length]!
}
