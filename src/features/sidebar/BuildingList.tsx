import { getColor } from '@/lib/colors'
import { hasPlaceholderGps, mlCount } from '@/lib/dataQuality'
import { formatTenantCountLabel } from '@/lib/filters'
import { formatSqft } from '@/lib/format'
import { Tag } from '@/components/Tag/Tag'
import { useSelectionStore } from '@/stores/selectionStore'
import { buildPolygonBuildingIndex, polygonsForBuilding } from '@/lib/polygonBuildings'
import { requestBuildingMapFocus } from '@/lib/searchHits'
import { formatPictureCountSuffix } from '@/lib/rtuPictureCountSummary'
import type { Building, PortfolioData } from '@/types/domain'

export interface BuildingListProps {
  buildings: Building[]
  portfolio: PortfolioData
  showPictureCounts?: boolean
  parkPictureTotals?: Map<string, number>
  buildingPictureTotals?: Map<string, number>
}

export function BuildingList({
  buildings,
  portfolio,
  showPictureCounts = false,
  parkPictureTotals,
  buildingPictureTotals,
}: BuildingListProps) {
  const currentBuilding = useSelectionStore((s) => s.currentBuilding)
  const polygonIndex = buildPolygonBuildingIndex(portfolio.buildings, portfolio.polygons)

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
              const gpsBad = hasPlaceholderGps(b)
              const ml = mlCount(b)
              const tenantPolygons = polygonsForBuilding(polygonIndex, b.address)
              const sqftDisp = formatSqft(b.sqft)
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
                      <Tag variant="tenant">{formatTenantCountLabel(tenantPolygons.length)}</Tag>
                    ) : null}
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
                    {sold ? <Tag variant="sold">SOLD</Tag> : null}
                  </div>
                </div>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}
