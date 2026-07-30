import { useEffect, useLayoutEffect, useMemo } from 'react'
import { SearchInput } from '@/components/SearchInput/SearchInput'
import { Select } from '@/components/Select/Select'
import {
  applyFilterSelection,
  collectFilterOptions,
  reconcileFilterDropdowns,
} from '@/lib/filters'
import { resolveManagerDisplayName } from '@/lib/managerNames'
import { buildPolygonBuildingIndex } from '@/lib/polygonBuildings'
import { BuildingList } from '@/features/sidebar/BuildingList'
import { SearchHitNav } from '@/features/sidebar/SearchHitNav'
import { useBuildingYearBudgetStore } from '@/stores/buildingYearBudgetStore'
import { useFilterStore } from '@/stores/filterStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { DEFAULT_DQ_FILTERS, type Building, type PortfolioData } from '@/types/domain'
import styles from './MobileSearchSheet.module.css'

export interface MobileSearchSheetProps {
  open: boolean
  onClose: () => void
  allBuildings: Building[]
  listBuildings: Building[]
  portfolio: PortfolioData
}

export function MobileSearchSheet({
  open,
  onClose,
  allBuildings,
  listBuildings,
  portfolio,
}: MobileSearchSheetProps) {
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
  const capexStatuses = useBuildingYearBudgetStore((s) => s.statuses)

  const filterContext = useMemo(
    () => ({ search, park, cluster, manager, buildingOperator }),
    [search, park, cluster, manager, buildingOperator],
  )

  const polygonIndex = useMemo(
    () => buildPolygonBuildingIndex(allBuildings, portfolio.polygons),
    [allBuildings, portfolio.polygons],
  )

  const options = useMemo(
    () =>
      collectFilterOptions(
        allBuildings,
        filterContext,
        polygonIndex,
        managerRenames,
        capexStatuses,
      ),
    [allBuildings, filterContext, polygonIndex, managerRenames, capexStatuses],
  )

  const baseFilters = useMemo(
    () => ({ search, park, cluster, manager, buildingOperator, adv, dq: DEFAULT_DQ_FILTERS }),
    [search, park, cluster, manager, buildingOperator, adv],
  )

  const handleFilterChange = (
    patch: Partial<Pick<typeof baseFilters, 'park' | 'cluster' | 'manager' | 'buildingOperator'>>,
  ) => {
    const next = applyFilterSelection(
      allBuildings,
      baseFilters,
      patch,
      polygonIndex,
      managerRenames,
      capexStatuses,
    )
    if (next.park !== park) setPark(next.park)
    if (next.cluster !== cluster) setCluster(next.cluster)
    if (next.manager !== manager) setManager(next.manager)
    if (next.buildingOperator !== buildingOperator) setBuildingOperator(next.buildingOperator)
  }

  useLayoutEffect(() => {
    if (!open) return
    const reconciled = reconcileFilterDropdowns(
      allBuildings,
      baseFilters,
      polygonIndex,
      managerRenames,
      capexStatuses,
    )
    if (reconciled.park !== park) setPark(reconciled.park)
    if (reconciled.cluster !== cluster) setCluster(reconciled.cluster)
    if (reconciled.manager !== manager) setManager(reconciled.manager)
    if (reconciled.buildingOperator !== buildingOperator) {
      setBuildingOperator(reconciled.buildingOperator)
    }
  }, [
    open,
    baseFilters,
    allBuildings,
    polygonIndex,
    managerRenames,
    capexStatuses,
    park,
    cluster,
    manager,
    buildingOperator,
    setPark,
    setCluster,
    setManager,
    setBuildingOperator,
  ])

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  // Tap a building in the list → focus map and close the sheet.
  useEffect(() => {
    if (!open) return
    const onOpenBuilding = () => onClose()
    window.addEventListener('map:openBuilding', onOpenBuilding)
    return () => window.removeEventListener('map:openBuilding', onOpenBuilding)
  }, [open, onClose])

  if (!open) return null

  return (
    <>
      <button
        type="button"
        className={styles.backdrop}
        aria-label="Close building search"
        onClick={onClose}
      />
      <div
        className={styles.sheet}
        role="dialog"
        aria-modal="true"
        aria-label="Search buildings"
      >
        <div className={styles.handleRow}>
          <div className={styles.handle} aria-hidden />
        </div>
        <div className={styles.header}>
          <div className={styles.titleBlock}>
            <div className={styles.title}>Find a building</div>
            <div className={styles.meta}>{allBuildings.length} buildings · Ontario</div>
          </div>
          <button type="button" className={styles.closeBtn} onClick={onClose}>
            Map
          </button>
        </div>

        <div className={styles.controls}>
          <SearchInput
            id="mobile-search"
            value={searchInput}
            onValueChange={setSearchInput}
            onApply={applySearch}
            onClear={clearSearch}
            placeholder="Address, BU #, tenant, RTU…"
            title="Search address, BU #, tenant, or RTU"
            autoFocus
          />
          {recentSearches.length > 0 ? (
            <div className={styles.recentSearches}>
              <span className={styles.recentLabel}>Recent</span>
              <div className={styles.recentList}>
                {recentSearches.map((query) => (
                  <button
                    key={query}
                    type="button"
                    className={styles.recentBtn}
                    onClick={() => applyRecentSearch(query)}
                    title={`Search for ${query}`}
                  >
                    {query}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          <div className={styles.filters}>
            <Select
              id="mobile-park-filter"
              options={options.parks.map((p) => ({ value: p, label: p }))}
              value={park}
              onChange={(e) => handleFilterChange({ park: e.target.value })}
              placeholder="All parks"
            />
            <Select
              id="mobile-cluster-filter"
              options={options.clusters.map((c) => ({ value: c, label: c }))}
              value={cluster}
              onChange={(e) => handleFilterChange({ cluster: e.target.value })}
              placeholder="All clusters"
            />
            <Select
              id="mobile-manager-filter"
              options={options.managers.map((m) => ({
                value: m,
                label: resolveManagerDisplayName(m, managerRenames),
              }))}
              value={manager}
              onChange={(e) => handleFilterChange({ manager: e.target.value })}
              placeholder="All managers"
            />
            <Select
              id="mobile-operator-filter"
              options={options.buildingOperators.map((operator) => ({
                value: operator,
                label: operator,
              }))}
              value={buildingOperator}
              onChange={(e) => handleFilterChange({ buildingOperator: e.target.value })}
              placeholder="All operators"
            />
          </div>
        </div>

        <SearchHitNav
          buildings={allBuildings}
          polygons={portfolio.polygons}
          suiteEntrances={portfolio.suiteEntrances}
        />

        <div className={styles.resultHead}>
          <span className={styles.resultCount}>
            {listBuildings.length} {listBuildings.length === 1 ? 'building' : 'buildings'}
          </span>
        </div>

        <div className={styles.listWrap}>
          <BuildingList
            buildings={listBuildings}
            portfolio={portfolio}
            showPictureCounts={false}
          />
        </div>
      </div>
    </>
  )
}
