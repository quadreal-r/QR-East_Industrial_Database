import { useLayoutEffect, useMemo } from 'react'
import { SearchInput } from '@/components/SearchInput/SearchInput'
import { Select } from '@/components/Select/Select'
import { LAYER_COLORS } from '@/lib/constants'
import {
  collectFilterOptions,
  reconcileFilterDropdowns,
  applyFilterSelection,
  formatTenantCountLabel,
  isTenantCountSearch,
} from '@/lib/filters'
import { resolveManagerDisplayName } from '@/lib/managerNames'
import { buildPolygonBuildingIndex, polygonsForBuilding } from '@/lib/polygonBuildings'
import { useFilterStore } from '@/stores/filterStore'
import { areAllLayersHidden, useLayerStore } from '@/stores/layerStore'
import { useSelectionStore } from '@/stores/selectionStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { DEFAULT_DQ_FILTERS, type Building, type LayerKey, type PortfolioData } from '@/types/domain'
import { useRtuPictureCountSummary } from '@/hooks/useRtuPictureCountSummary'
import { useUiStore } from '@/stores/uiStore'
import { AdvancedFilters } from './AdvancedFilters'
import { BuildingList } from './BuildingList'
import { PictureCountModal } from './PictureCountModal'
import { SearchHitNav } from './SearchHitNav'
import { StatsStrip } from './StatsStrip'
import styles from './Sidebar.module.css'

const LAYER_LABELS: Partial<Record<LayerKey, string>> = {
  rtu: 'RTUs',
  polygons: 'Polygons',
  inspection360: '360° Gates',
  sprinkler: 'Sprinkler 360°',
  electrical: 'Electrical 360°',
  hydrant: 'Hydrants',
  gas: 'Gas',
}

const LAYER_TOGGLE_KEYS = Object.keys(LAYER_LABELS) as LayerKey[]

export interface SidebarProps {
  allBuildings: Building[]
  listBuildings: Building[]
  filteredBuildings: Building[]
  portfolio: PortfolioData
}

export function Sidebar({ allBuildings, listBuildings, filteredBuildings, portfolio }: SidebarProps) {
  const searchInput = useFilterStore((s) => s.searchInput)
  const search = useFilterStore((s) => s.search)
  const park = useFilterStore((s) => s.park)
  const cluster = useFilterStore((s) => s.cluster)
  const manager = useFilterStore((s) => s.manager)
  const buildingOperator = useFilterStore((s) => s.buildingOperator)
  const adv = useFilterStore((s) => s.adv)
  const setSearchInput = useFilterStore((s) => s.setSearchInput)
  const applySearch = useFilterStore((s) => s.applySearch)
  const applyRecentSearch = useFilterStore((s) => s.applyRecentSearch)
  const recentSearches = useFilterStore((s) => s.recentSearches)
  const clearSearch = useFilterStore((s) => s.clearSearch)
  const setPark = useFilterStore((s) => s.setPark)
  const setCluster = useFilterStore((s) => s.setCluster)
  const setManager = useFilterStore((s) => s.setManager)
  const setBuildingOperator = useFilterStore((s) => s.setBuildingOperator)
  const managerRenames = useSettingsStore((s) => s.managerRenames)

  const layers = useLayerStore((s) => s.layers)
  const showRtuPictureCount = useLayerStore((s) => s.showRtuPictureCount)
  const toggleShowRtuPictureCount = useLayerStore((s) => s.toggleShowRtuPictureCount)
  const pictureCountModalOpen = useUiStore((s) => s.pictureCountModalOpen)
  const openPictureCountModal = useUiStore((s) => s.openPictureCountModal)
  const closePictureCountModal = useUiStore((s) => s.closePictureCountModal)
  const { summary: pictureCountSummary, loading: pictureCountLoading } =
    useRtuPictureCountSummary(listBuildings)
  const toggleLayer = useLayerStore((s) => s.toggleLayer)
  const hideAllLayers = useLayerStore((s) => s.hideAllLayers)
  const showAllLayers = useLayerStore((s) => s.showAllLayers)
  const allLayersHidden = areAllLayersHidden(layers)

  const sidebarCollapsed = useSelectionStore((s) => s.sidebarCollapsed)
  const toggleSidebar = useSelectionStore((s) => s.toggleSidebar)

  const filterContext = useMemo(
    () => ({ search, park, cluster, manager, buildingOperator }),
    [search, park, cluster, manager, buildingOperator],
  )

  const polygonIndex = useMemo(
    () => buildPolygonBuildingIndex(allBuildings, portfolio.polygons),
    [allBuildings, portfolio.polygons],
  )

  const listTenantTotal = useMemo(
    () =>
      listBuildings.reduce(
        (sum, building) => sum + polygonsForBuilding(polygonIndex, building.address).length,
        0,
      ),
    [listBuildings, polygonIndex],
  )

  const tenantCountInfo = formatTenantCountLabel(listTenantTotal)
  // Count summary only for tenant-count queries — never for a single-building address search.
  const showTenantCountInfo = Boolean(tenantCountInfo) && isTenantCountSearch(search)

  const options = useMemo(
    () => collectFilterOptions(allBuildings, filterContext, polygonIndex, managerRenames),
    [allBuildings, filterContext, polygonIndex, managerRenames],
  )

  const baseFilters = useMemo(
    () => ({ search, park, cluster, manager, buildingOperator, adv, dq: DEFAULT_DQ_FILTERS }),
    [search, park, cluster, manager, buildingOperator, adv],
  )

  const handleFilterChange = (
    patch: Partial<Pick<typeof baseFilters, 'park' | 'cluster' | 'manager' | 'buildingOperator'>>,
  ) => {
    const next = applyFilterSelection(allBuildings, baseFilters, patch, polygonIndex, managerRenames)
    if (next.park !== park) setPark(next.park)
    if (next.cluster !== cluster) setCluster(next.cluster)
    if (next.manager !== manager) setManager(next.manager)
    if (next.buildingOperator !== buildingOperator) setBuildingOperator(next.buildingOperator)
  }

  useLayoutEffect(() => {
    const reconciled = reconcileFilterDropdowns(allBuildings, baseFilters, polygonIndex, managerRenames)
    if (reconciled.park !== park) setPark(reconciled.park)
    if (reconciled.cluster !== cluster) setCluster(reconciled.cluster)
    if (reconciled.manager !== manager) setManager(reconciled.manager)
    if (reconciled.buildingOperator !== buildingOperator) {
      setBuildingOperator(reconciled.buildingOperator)
    }
  }, [
    baseFilters,
    allBuildings,
    polygonIndex,
    managerRenames,
    park,
    cluster,
    manager,
    buildingOperator,
    setPark,
    setCluster,
    setManager,
    setBuildingOperator,
  ])

  return (
    <>
      {sidebarCollapsed ? (
        <button type="button" className={styles.pullTab} onClick={toggleSidebar} title="Expand sidebar">
          ▶ Panel
        </button>
      ) : null}
      <aside className={`sidebar${sidebarCollapsed ? ` ${styles.sidebarCollapsed}` : ''}`}>
        <div className="sidebar-header" style={{ position: 'relative' }}>
          <button
            type="button"
            id="sidebar-toggle-btn"
            className={styles.collapseBtn}
            onClick={toggleSidebar}
            title="Collapse sidebar"
          >
            ◀
          </button>
          <div className="logo-row">
            <img
              className="logo-wordmark"
              src="/brand/quadreal-logo-white.png"
              alt="QuadReal"
              width={160}
              height={28}
            />
          </div>
          <div className="sidebar-title">Industrial Portfolio</div>
          <div className="sidebar-meta" id="portfolio-meta">
            {allBuildings.length} buildings · Ontario
          </div>
        </div>

        <div className="controls">
          <SearchInput
            id="search"
            value={searchInput}
            onValueChange={setSearchInput}
            onApply={applySearch}
            onClear={clearSearch}
          />
          {showTenantCountInfo ? (
            <div className={styles.tenantCountInfo} id="tenant-count-info">
              {tenantCountInfo}
            </div>
          ) : null}
          {recentSearches.length > 0 ? (
            <div className={styles.recentSearches}>
              <span className={styles.recentSearchesLabel}>Recent</span>
              <div className={styles.recentSearchesList}>
                {recentSearches.map((query) => (
                  <button
                    key={query}
                    type="button"
                    className={styles.recentSearchBtn}
                    onClick={() => applyRecentSearch(query)}
                    title={`Search for ${query}`}
                  >
                    {query}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          <SearchHitNav
            buildings={allBuildings}
            polygons={portfolio.polygons}
            suiteEntrances={portfolio.suiteEntrances}
          />
          <Select
            id="park-filter"
            options={options.parks.map((p) => ({ value: p, label: p }))}
            value={park}
            onChange={(e) => handleFilterChange({ park: e.target.value })}
            placeholder="All business parks"
          />
          <Select
            id="cluster-filter"
            options={options.clusters.map((c) => ({ value: c, label: c }))}
            value={cluster}
            onChange={(e) => handleFilterChange({ cluster: e.target.value })}
            placeholder="All clusters"
          />
          <Select
            id="manager-filter"
            options={options.managers.map((m) => ({
              value: m,
              label: resolveManagerDisplayName(m, managerRenames),
            }))}
            value={manager}
            onChange={(e) => handleFilterChange({ manager: e.target.value })}
            placeholder="All property managers"
          />
          <Select
            id="building-operator-filter"
            options={options.buildingOperators.map((operator) => ({
              value: operator,
              label: operator,
            }))}
            value={buildingOperator}
            onChange={(e) => handleFilterChange({ buildingOperator: e.target.value })}
            placeholder="All building operators"
          />
        </div>

        <StatsStrip
          buildings={filteredBuildings}
          polygons={portfolio.polygons}
          totalPortfolioCount={allBuildings.length}
        />
        <AdvancedFilters />

        <div className="layer-panel">
          <div className="layer-panel-head">
            <span className="layer-panel-label">Map layers</span>
            <span className="result-count" id="result-count">
              {listBuildings.length} {listBuildings.length === 1 ? 'building' : 'buildings'}
            </span>
          </div>
          <div className="layer-toggles" id="layer-toggles">
            {LAYER_TOGGLE_KEYS.map((key) => (
              <button
                key={key}
                type="button"
                className={`layer-btn${layers[key] ? ' active' : ''}`}
                data-layer={key}
                onClick={() => toggleLayer(key)}
              >
                <span className="dot" style={{ background: LAYER_COLORS[key].fill }} />
                {LAYER_LABELS[key]}
              </button>
            ))}
          </div>
          <div className="layer-toggles" aria-label="Picture tools">
            <button
              type="button"
              className={`layer-btn${showRtuPictureCount ? ' active' : ''}`}
              onClick={toggleShowRtuPictureCount}
              onDoubleClick={(event) => {
                event.preventDefault()
                openPictureCountModal()
              }}
              title={
                showRtuPictureCount
                  ? 'Hide picture count on RTU markers (double-click for report)'
                  : 'Show picture count on RTU markers (double-click for report)'
              }
            >
              <span className="dot" style={{ background: '#38bdf8' }} />
              Pic count
            </button>
            <button
              type="button"
              className={`layer-btn${pictureCountModalOpen ? ' active' : ''}`}
              onClick={openPictureCountModal}
              title="Open picture count report"
            >
              <span className="dot" style={{ background: '#38bdf8' }} />
              Pic report
            </button>
            <button
              type="button"
              className="layer-action-btn"
              onClick={allLayersHidden ? showAllLayers : hideAllLayers}
              title={allLayersHidden ? 'Turn on all map layers' : 'Turn off all map layers'}
            >
              {allLayersHidden ? 'Show all' : 'Hide all'}
            </button>
          </div>
        </div>

        <BuildingList
          buildings={listBuildings}
          portfolio={portfolio}
          showPictureCounts={showRtuPictureCount}
          parkPictureTotals={pictureCountSummary?.parkPictureTotals}
          buildingPictureTotals={pictureCountSummary?.buildingPictureTotals}
        />
        <PictureCountModal
          open={pictureCountModalOpen}
          onClose={closePictureCountModal}
          summary={pictureCountSummary}
          loading={pictureCountLoading}
          buildingCount={listBuildings.length}
        />
      </aside>
    </>
  )
}
