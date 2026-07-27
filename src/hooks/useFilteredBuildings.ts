import { useMemo } from 'react'
import { useBuildingYearBudgetStore } from '@/stores/buildingYearBudgetStore'
import { useFilterStore } from '@/stores/filterStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { applyCostScopeFilters, applyPrimaryFilters, reconcileFilterDropdowns } from '@/lib/filters'
import { buildPolygonBuildingIndex } from '@/lib/polygonBuildings'
import type { Building, FilterState, Polygon } from '@/types/domain'

export function useFilteredBuildings(buildings: Building[], polygons: Polygon[] = []) {
  const search = useFilterStore((state) => state.search)
  const park = useFilterStore((state) => state.park)
  const cluster = useFilterStore((state) => state.cluster)
  const manager = useFilterStore((state) => state.manager)
  const buildingOperator = useFilterStore((state) => state.buildingOperator)
  const adv = useFilterStore((state) => state.adv)
  const managerRenames = useSettingsStore((state) => state.managerRenames)
  const capexStatuses = useBuildingYearBudgetStore((state) => state.statuses)

  const polygonIndex = useMemo(
    () => buildPolygonBuildingIndex(buildings, polygons),
    [buildings, polygons],
  )

  const filters: FilterState = useMemo(
    () => ({
      search,
      park,
      cluster,
      manager,
      buildingOperator,
      adv,
      dq: { gps: false, rtu: false, vacant: false, ml: false },
    }),
    [search, park, cluster, manager, buildingOperator, adv],
  )

  // Reconcile once and reuse for both filtered and cost-scope passes
  const reconciledFilters = useMemo(
    () =>
      reconcileFilterDropdowns(
        buildings,
        filters,
        polygonIndex,
        managerRenames,
        capexStatuses,
      ),
    [buildings, filters, polygonIndex, managerRenames, capexStatuses],
  )

  const filteredBuildings = useMemo(
    () =>
      applyPrimaryFilters(
        buildings,
        reconciledFilters,
        polygonIndex,
        managerRenames,
        capexStatuses,
      ),
    [buildings, reconciledFilters, polygonIndex, managerRenames, capexStatuses],
  )

  const costScopeBuildings = useMemo(
    () =>
      applyCostScopeFilters(
        buildings,
        reconciledFilters,
        polygonIndex,
        managerRenames,
        capexStatuses,
      ),
    [buildings, reconciledFilters, polygonIndex, managerRenames, capexStatuses],
  )

  return {
    filteredBuildings,
    costScopeBuildings,
    listBuildings: filteredBuildings,
    allFiltered: filteredBuildings,
    count: filteredBuildings.length,
    mapCount: filteredBuildings.length,
    filters,
    polygonIndex,
  }
}
