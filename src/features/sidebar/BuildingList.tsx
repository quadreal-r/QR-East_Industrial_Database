import { getColor } from '@/lib/colors'
import { RTU_AGE_CRITICAL, RTU_AGE_WARN } from '@/lib/constants'
import { hasPlaceholderGps, hasVacant, mlCount } from '@/lib/dataQuality'
import { formatSqft } from '@/lib/format'
import { resolveManagerDisplayName } from '@/lib/managerNames'
import { showToastError, showToastSuccess } from '@/lib/toast'
import { oldestRtuAge } from '@/lib/rtu'
import { Tag } from '@/components/Tag/Tag'
import { useAuth } from '@/hooks/useAuth'
import { useSelectionStore } from '@/stores/selectionStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { buildPolygonBuildingIndex, polygonsForBuilding } from '@/lib/polygonBuildings'
import { requestBuildingMapFocus } from '@/lib/searchHits'
import { formatPictureCountSuffix } from '@/lib/rtuPictureCountSummary'
import type { Building, PortfolioData } from '@/types/domain'

export interface BuildingListProps {
  buildings: Building[]
  portfolio: PortfolioData
  onNotesChange: (portfolio: PortfolioData) => void
  showPictureCounts?: boolean
  parkPictureTotals?: Map<string, number>
  buildingPictureTotals?: Map<string, number>
}

export function BuildingList({
  buildings,
  portfolio,
  onNotesChange,
  showPictureCounts = false,
  parkPictureTotals,
  buildingPictureTotals,
}: BuildingListProps) {
  const currentBuilding = useSelectionStore((s) => s.currentBuilding)
  const managerRenames = useSettingsStore((s) => s.managerRenames)
  const { isAuthenticated } = useAuth()
  const polygonIndex = buildPolygonBuildingIndex(portfolio.buildings, portfolio.polygons)

  const openNotesEditor = (address: string) => {
    if (!isAuthenticated) {
      showToastError('Sign in to edit building notes.')
      return
    }
    const building = portfolio.buildings.find((b) => b.address === address)
    if (!building) return
    const current = building.notes ?? ''
    const newNotes = window.prompt(`Notes for ${address}\n(leave blank to clear):`, current)
    if (newNotes === null) return
    const nextBuildings = portfolio.buildings.map((b) =>
      b.address === address ? { ...b, notes: newNotes.trim() || null } : b,
    )
    onNotesChange({
      ...portfolio,
      buildings: nextBuildings,
    })
    showToastSuccess('✓ Notes saved — save to keep them.')
  }

  if (!buildings.length) {
    return (
      <div className="building-list" id="building-list">
        <div className="no-results">No buildings match your filters.</div>
      </div>
    )
  }

  const groups = new Map<string, Building[]>()
  for (const b of buildings) {
    const list = groups.get(b.park) ?? []
    list.push(b)
    groups.set(b.park, list)
  }

  return (
    <div className="building-list" id="building-list">
      {[...groups.entries()].map(([park, items]) => {
        const color = getColor(park)
        return (
          <div key={park}>
            <div className="group-label">
              <span
                style={{
                  display: 'inline-block',
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: color,
                  flexShrink: 0,
                }}
              />
              {park}
              {showPictureCounts
                ? formatPictureCountSuffix(parkPictureTotals?.get(park) ?? 0)
                : null}
            </div>
            {items.map((b) => {
              const sold = b.sold || b.address.includes('SOLD')
              const age = oldestRtuAge(b)
              const gpsBad = hasPlaceholderGps(b)
              const ml = mlCount(b)
              const tenantPolygons = polygonsForBuilding(polygonIndex, b.address)
              const vac = hasVacant(b, tenantPolygons)
              const sqftDisp = formatSqft(b.sqft)
              const mgr = resolveManagerDisplayName(b.manager ?? '', managerRenames)
              const isActive = currentBuilding?.address === b.address

              return (
                <div
                  key={b.address}
                  className={`building-item${isActive ? ' active' : ''}`}
                  onClick={() => requestBuildingMapFocus(b.address)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') requestBuildingMapFocus(b.address)
                  }}
                  role="button"
                  tabIndex={0}
                >
                  <div className="building-addr">
                    {b.address}
                    {showPictureCounts
                      ? formatPictureCountSuffix(buildingPictureTotals?.get(b.address) ?? 0)
                      : null}
                  </div>
                  <div className="building-tags">
                    {sqftDisp ? <Tag variant="sqft">{sqftDisp}</Tag> : null}
                    {b.rtus?.length ? <Tag variant="rtu">{b.rtus.length} RTUs</Tag> : null}
                    {tenantPolygons.length ? (
                      <Tag variant="tenant">{tenantPolygons.length} tenant polygons</Tag>
                    ) : null}
                    {mgr ? <Tag variant="pm">{mgr.split(' ')[0]}</Tag> : null}
                    {gpsBad ? (
                      <Tag variant="gps-bad" title="Placeholder GPS">
                        📍?
                      </Tag>
                    ) : null}
                    {ml ? (
                      <Tag variant="ml" title={`${ml} missing lamicoid(s)`}>
                        ML×{ml}
                      </Tag>
                    ) : null}
                    {age >= RTU_AGE_CRITICAL ? (
                      <Tag variant="old-rtu" title={`Oldest RTU: ${age} yrs`}>
                        🔥{age}yr
                      </Tag>
                    ) : age >= RTU_AGE_WARN ? (
                      <Tag variant="old-rtu" title={`Oldest RTU: ${age} yrs`}>
                        {age}yr RTU
                      </Tag>
                    ) : null}
                    {vac ? (
                      <Tag variant="vacant" title="Has vacant unit(s)">
                        VACANT
                      </Tag>
                    ) : null}
                    {b.notes ? (
                      <Tag variant="ml" title="Has notes">
                        📝
                      </Tag>
                    ) : null}
                    {sold ? <Tag variant="sold">SOLD</Tag> : null}
                  </div>
                  {isAuthenticated ? (
                    <button
                      type="button"
                      className="bldg-notes-btn"
                      onClick={(e) => {
                        e.stopPropagation()
                        openNotesEditor(b.address)
                      }}
                    >
                      {b.notes ? '📝 Notes' : '+ Notes'}
                    </button>
                  ) : null}
                </div>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}
