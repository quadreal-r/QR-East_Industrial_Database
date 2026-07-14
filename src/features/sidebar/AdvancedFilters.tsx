import { Chip } from '@/components/Chip/Chip'
import { useFilterStore } from '@/stores/filterStore'
import type { AdvFilterState, AdvFilterValue } from '@/types/domain'

const ROWS: { key: keyof AdvFilterState; label: string }[] = [
  { key: 'vacant', label: 'Vacant' },
  { key: 'rtu', label: 'Old RTU' },
  { key: 'hasrtu', label: 'RTUs' },
  { key: 'ml', label: 'Missing ML' },
]

const CHIP_LABELS: Record<keyof AdvFilterState, Record<AdvFilterValue, string>> = {
  vacant: { yes: 'Has Vacant', no: 'Fully Leased', any: 'Any' },
  rtu: { yes: 'Has 20+ yr', no: 'All New', any: 'Any' },
  hasrtu: { yes: 'Has RTUs', no: 'No RTUs', any: 'Any' },
  ml: { yes: 'Has ML', no: 'None', any: 'Any' },
}

function chipVariant(value: AdvFilterValue): 'adv-yes' | 'adv-no' | 'adv-any' {
  if (value === 'yes') return 'adv-yes'
  if (value === 'no') return 'adv-no'
  return 'adv-any'
}

export function AdvancedFilters() {
  const adv = useFilterStore((s) => s.adv)
  const advPanelOpen = useFilterStore((s) => s.advPanelOpen)
  const toggleAdvPanel = useFilterStore((s) => s.toggleAdvPanel)
  const setAdvFilter = useFilterStore((s) => s.setAdvFilter)
  const clearAdvFilters = useFilterStore((s) => s.clearAdvFilters)

  return (
    <>
      <button
        type="button"
        id="adv-filter-toggle"
        className={advPanelOpen ? 'open' : ''}
        onClick={toggleAdvPanel}
      >
        <span className="afg-arrow">▶</span>
        Advanced filters
      </button>
      <div id="adv-filter-panel" className={advPanelOpen ? 'open' : ''}>
        {ROWS.map(({ key, label }) => (
          <div key={key} className="af-row">
            <span className="af-label">{label}</span>
            {(['any', 'yes', 'no'] as AdvFilterValue[]).map((value) => (
              <Chip
                key={value}
                variant={chipVariant(value)}
                active={adv[key] === value}
                className={`af-chip${adv[key] === value ? ` on-${value}` : ''}`}
                onClick={() => setAdvFilter(key, value)}
              >
                {CHIP_LABELS[key][value]}
              </Chip>
            ))}
          </div>
        ))}
        <div className="af-row">
          <button type="button" className="af-clear" onClick={clearAdvFilters}>
            ✕ Clear filters
          </button>
        </div>
      </div>
    </>
  )
}
