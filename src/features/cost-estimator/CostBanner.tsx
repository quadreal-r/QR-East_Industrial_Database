import { useMemo, useRef, useState } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { currentYear } from '@/lib/rtu'
import { parseCapexStatusSearchQuery } from '@/lib/capexStatusSearch'
import { CAPEX_HVAC_YEAR_COLUMNS } from '@/lib/capexHvacBudgetImport'
import {
  buildingYearBudgetKey,
  filterBuildingYearBudgetsForView,
  sumSharedBuildingYearBudgets,
} from '@/lib/buildingYearBudget'
import {
  buildCapexShareGroupsByBu,
  capexBudgetDedupeKey,
  capexPotOwnerAddress,
  capexShareAddresses,
} from '@/lib/capexSharedBu'
import {
  RCB_DEFAULT_BASIS,
  RCB_DEFAULT_THRESHOLD,
  RCB_DEFAULT_YEAR,
  RCB_REPL_YEAR_NONE,
  RCB_YEARS,
} from '@/lib/constants'
import {
  formatRtuTons,
  rcbCompute,
  rcbLineItemsForBuilding,
  rcbLineItemsWithReplacementYears,
  rcbMoney,
  rcbProjectionFromTierQuantities,
  rcbSanitizeReplacementYearAssignments,
  rcbScheduleYearOptions,
  rcbTierBreakdownForItems,
  type RcbBuildingSummary,
  type RcbScheduledLineItem,
} from '@/lib/costEstimator'
import { importCostExcelFile } from '@/lib/costExcelImport'
import { exportRcbExcel } from '@/lib/excel'
import { rcbExportFilenameScope } from '@/lib/rcbExcelExport'
import { exportRcbPdf } from '@/lib/rcbPdf'
import { formatFilterScope } from '@/lib/format'
import { collectRtuNameSearchMatches } from '@/lib/rtuNameSearch'
import { STORAGE_KEYS } from '@/lib/storageKeys'
import { showToastError, showToastSuccess } from '@/lib/toast'
import { useFilterStore } from '@/stores/filterStore'
import { useBuildingYearBudgetStore } from '@/stores/buildingYearBudgetStore'
import { useRtuBudgetStore } from '@/stores/rtuBudgetStore'
import { useRtuPricingStore } from '@/stores/rtuPricingStore'
import { useRtuScheduleStore } from '@/stores/rtuScheduleStore'
import type { Building, CostBasis } from '@/types/domain'
import { RcbBuildingDetail } from './RcbBuildingDetail'
import type { CostPanelStage } from './costPanelStage'
import styles from './CostBanner.module.css'

export interface CostBannerProps {
  buildings: Building[]
}

type SortKey = keyof RcbBuildingSummary

const THR_MIN = 0
const THR_MAX = 60

function excludedBudgetKey(address: string, year: string): string {
  return `${address}::${year}`
}

function readExcludedBudgets(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.rcbExcludedBudgets)
    if (!raw) return new Set()
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return new Set()
    return new Set(parsed.filter((item): item is string => typeof item === 'string' && item.includes('::')))
  } catch {
    return new Set()
  }
}

function persistExcludedBudgets(keys: Set<string>): void {
  try {
    localStorage.setItem(STORAGE_KEYS.rcbExcludedBudgets, JSON.stringify([...keys]))
  } catch {
    /* ignore */
  }
}

export function CostBanner({ buildings }: CostBannerProps) {
  const { canEdit } = useAuth()
  const importInputRef = useRef<HTMLInputElement>(null)
  const [threshold, setThreshold] = useState(RCB_DEFAULT_THRESHOLD)
  const [basis, setBasis] = useState<CostBasis>(RCB_DEFAULT_BASIS)
  const [year, setYear] = useState(RCB_DEFAULT_YEAR)
  const [panelStage, setPanelStage] = useState<CostPanelStage>('minimized')
  const [selectedBuildingAddress, setSelectedBuildingAddress] = useState<string | null>(null)
  const [buildingYearFilter, setBuildingYearFilter] = useState('')
  const [budgetedOnly, setBudgetedOnly] = useState(false)
  const [sort, setSort] = useState<{ key: SortKey; dir: -1 | 1 }>({ key: 'cost', dir: -1 })
  const [importBusy, setImportBusy] = useState(false)
  /** Building+year Capex pots excluded from budget totals (Remove checkbox). */
  const [excludedBudgets, setExcludedBudgets] = useState<Set<string>>(readExcludedBudgets)

  const replacementYearByRtu = useRtuScheduleStore((s) => s.replacementYears)
  const replacementNotesByRtu = useRtuScheduleStore((s) => s.notes)
  const setRtuReplacementYear = useRtuScheduleStore((s) => s.setReplacementYear)
  const applyRcbReportMerge = useRtuScheduleStore((s) => s.applyRcbReportMerge)
  const applyEquipmentImport = useRtuScheduleStore((s) => s.applyEquipmentImport)
  const budgets = useRtuBudgetStore((s) => s.budgets)
  const applyBudgetMerge = useRtuBudgetStore((s) => s.applyBudgetMerge)
  const buildingYearBudgets = useBuildingYearBudgetStore((s) => s.pots)
  const buildingYearNotes = useBuildingYearBudgetStore((s) => s.notes)
  const potStatuses = useBuildingYearBudgetStore((s) => s.statuses)
  const pricingRows = useRtuPricingStore((s) => s.rows)
  const applyRcbReportPricingMerge = useRtuPricingStore((s) => s.applyRcbReportPricingMerge)
  const applyPricingImport = useRtuPricingStore((s) => s.applyPricingImport)
  const importPricingWorkbook = useRtuPricingStore((s) => s.importWorkbook)

  const search = useFilterStore((s) => s.search)
  const park = useFilterStore((s) => s.park)
  const cluster = useFilterStore((s) => s.cluster)
  const manager = useFilterStore((s) => s.manager)

  const scopeLabel = formatFilterScope({ search, park, cluster, manager })

  const pricingTable = useRtuPricingStore((s) => s.pricingTable)
  const pricingRevision = useRtuPricingStore((s) => s.revision)

  const statusSearchQuery = parseCapexStatusSearchQuery(search)
  const statusSearchLabel = statusSearchQuery?.label ?? null
  const statusSearchYear = statusSearchQuery?.year ?? null
  /** Pricing year for estimates — independent of Capex pot / Repl. year filter. */
  const pricingYear = (RCB_YEARS[basis] ?? [RCB_DEFAULT_YEAR])[0] ?? RCB_DEFAULT_YEAR

  /** Global search like "hybrid" → flat RTU list in Cost Center (name match only). */
  const rtuNameMatches = useMemo(
    () => collectRtuNameSearchMatches(buildings, search),
    [buildings, search],
  )
  const rtuNameSearchQuery = rtuNameMatches ? search.trim() : null

  const yearOptions = useMemo(() => {
    const base = rcbScheduleYearOptions(basis, pricingYear, replacementYearByRtu)
    // Capex years start at 2025; Hybrid pricing years start at 2026 — keep Capex years selectable.
    const potKeys = Object.keys(buildingYearBudgets)
    const potYears = (
      selectedBuildingAddress
        ? potKeys
            .filter((key) => key.startsWith(`${selectedBuildingAddress}::`))
            .map((key) => key.slice(selectedBuildingAddress.length + 2))
        : potKeys.map((key) => key.split('::')[1] ?? '')
    ).filter((y) => /^\d{4}$/.test(y))
    return [...new Set([...base, ...CAPEX_HVAC_YEAR_COLUMNS, ...potYears])]
      .filter((y) => /^\d{4}$/.test(y))
      .sort((a, b) => Number(a) - Number(b))
  }, [basis, pricingYear, replacementYearByRtu, selectedBuildingAddress, buildingYearBudgets])

  const sanitizedReplacementYearByRtu = useMemo(
    () => rcbSanitizeReplacementYearAssignments(replacementYearByRtu, yearOptions, pricingYear),
    [replacementYearByRtu, yearOptions, pricingYear],
  )

  /** Years that appear in assigned Repl. year fields (dropdown range). */
  const assignedYearOptions = useMemo(() => {
    const years = new Set<string>()
    for (const y of Object.values(sanitizedReplacementYearByRtu)) {
      if (/^\d{4}$/.test(y)) years.add(y)
    }
    return [...years].sort((a, b) => Number(a) - Number(b))
  }, [sanitizedReplacementYearByRtu])

  /**
   * Active Repl. / Capex year for the chooser and building list.
   * Empty string = All. `none` = unassigned only. Otherwise a calendar year.
   */
  const isNoneYearFilter = !statusSearchYear && year === RCB_REPL_YEAR_NONE
  const displayYear =
    statusSearchYear ??
    (year === '' || isNoneYearFilter
      ? ''
      : assignedYearOptions.includes(year)
        ? year
        : (assignedYearOptions[0] ?? year))

  const yearLabel = isNoneYearFilter ? 'None' : displayYear || 'All'

  /** Age eligibility uses calendar year when a Repl. Year is selected; otherwise today. */
  const ageAsOfYear = displayYear ? Number(displayYear) : undefined

  const result = useMemo(() => {
    void pricingRevision
    return rcbCompute(buildings, {
      basis,
      year: pricingYear,
      threshold,
      scope: scopeLabel,
      pricingTable,
      currentYear: ageAsOfYear,
    })
  }, [
    buildings,
    basis,
    pricingYear,
    threshold,
    scopeLabel,
    pricingTable,
    pricingRevision,
    ageAsOfYear,
  ])

  /** Options shown in the Repl. Year chooser (assigned years + locked search year if needed). */
  const replChooserOptions = useMemo(() => {
    const years = new Set(assignedYearOptions)
    if (statusSearchYear) years.add(statusSearchYear)
    return [...years].sort((a, b) => Number(a) - Number(b))
  }, [assignedYearOptions, statusSearchYear])

  /** All ages — Cost Center RTU-name search (e.g. hybrid) should list every matching unit. */
  const rtuNameSearchItems = useMemo(() => {
    if (!rtuNameSearchQuery) return null
    void pricingRevision
    const q = rtuNameSearchQuery.toLowerCase()
    const allAges = rcbCompute(buildings, {
      basis,
      year: pricingYear,
      threshold: 0,
      scope: scopeLabel,
      pricingTable,
      currentYear: ageAsOfYear,
    })
    const matched = allAges.lineItems.filter((item) => item.rtu.toLowerCase().includes(q))
    if (!matched.length) return null
    return rcbLineItemsWithReplacementYears(
      matched,
      allAges.basis,
      pricingYear,
      sanitizedReplacementYearByRtu,
      pricingTable,
    )
  }, [
    rtuNameSearchQuery,
    buildings,
    basis,
    pricingYear,
    scopeLabel,
    pricingTable,
    pricingRevision,
    sanitizedReplacementYearByRtu,
    ageAsOfYear,
  ])

  const rtuNameSearchActive = Boolean(rtuNameSearchItems && !selectedBuildingAddress)

  /** Search forces at least half-open; otherwise use the user's stage. */
  const effectiveStage: CostPanelStage =
    panelStage === 'minimized' && rtuNameSearchActive ? 'half' : panelStage
  const detailExpanded = effectiveStage !== 'minimized'

  const handleSetRtuReplacementYear = (address: string, rtu: string, replacementYear: string) => {
    setRtuReplacementYear(address, rtu, replacementYear, pricingYear)
  }

  /** All aged RTUs with assignment labels (cost/age unchanged). */
  const scheduledLineItems = useMemo(() => {
    void pricingRevision
    return rcbLineItemsWithReplacementYears(
      result.lineItems,
      result.basis,
      pricingYear,
      sanitizedReplacementYearByRtu,
      pricingTable,
    )
  }, [
    result.lineItems,
    result.basis,
    pricingYear,
    sanitizedReplacementYearByRtu,
    pricingTable,
    pricingRevision,
  ])

  /**
   * RTUs with an explicit Repl. Year assignment matching the chooser.
   * All = every aged RTU. None = only RTUs with no assignment.
   */
  const yearScopedLineItems = useMemo(() => {
    if (isNoneYearFilter) {
      return scheduledLineItems.filter((item) => {
        const key = `${item.address}::${item.rtu}`
        return sanitizedReplacementYearByRtu[key] == null
      })
    }
    if (!displayYear) return scheduledLineItems
    return scheduledLineItems.filter((item) => {
      const key = `${item.address}::${item.rtu}`
      return sanitizedReplacementYearByRtu[key] === displayYear
    })
  }, [
    scheduledLineItems,
    sanitizedReplacementYearByRtu,
    displayYear,
    isNoneYearFilter,
  ])

  const yearScopedPerBldg = useMemo(() => {
    if (!displayYear && !isNoneYearFilter) {
      return result.perBldg.map((row) => ({ ...row }))
    }
    const map = new Map<string, RcbBuildingSummary>()
    for (const item of yearScopedLineItems) {
      let row = map.get(item.address)
      if (!row) {
        row = {
          address: item.address,
          park: item.park,
          cluster: item.cluster,
          manager: item.manager,
          units: 0,
          tons: 0,
          cost: 0,
        }
        map.set(item.address, row)
      }
      row.units++
      row.tons += item.tons ?? 0
      row.cost += item.cost
    }
    for (const row of map.values()) {
      row.cost = Math.round(row.cost)
      row.tons = Math.round(row.tons * 10) / 10
    }
    return [...map.values()]
  }, [yearScopedLineItems, displayYear, isNoneYearFilter, result.perBldg])

  const sortedBuildings = useMemo(() => {
    const rows = [...yearScopedPerBldg]
    const { key, dir } = sort
    rows.sort((a, b) => {
      const x = a[key]
      const y = b[key]
      if (typeof x === 'string' && typeof y === 'string') {
        return x.localeCompare(y) * dir
      }
      return ((Number(x) || 0) - (Number(y) || 0)) * dir
    })
    return rows
  }, [yearScopedPerBldg, sort])

  const budgetYearKey = displayYear || 'all'
  const capexShareGroups = useMemo(() => buildCapexShareGroupsByBu(buildings), [buildings])

  const buildingBudgetByAddress = useMemo(() => {
    const addresses = new Set([
      ...result.perBldg.map((row) => row.address),
      ...yearScopedPerBldg.map((row) => row.address),
    ])
    const map = new Map<string, number>()
    for (const address of addresses) {
      const share = capexShareAddresses(buildings, address, capexShareGroups)
      map.set(
        address,
        isNoneYearFilter
          ? 0
          : displayYear
            ? sumSharedBuildingYearBudgets(buildingYearBudgets, share, [displayYear])
            : sumSharedBuildingYearBudgets(buildingYearBudgets, share),
      )
    }
    return map
  }, [
    result.perBldg,
    yearScopedPerBldg,
    buildingYearBudgets,
    displayYear,
    isNoneYearFilter,
    buildings,
    capexShareGroups,
  ])

  /** By-building list: buildings with RTUs assigned to the chooser year (or Budgeted only). */
  const displayedBuildings = useMemo(() => {
    if (!budgetedOnly) return sortedBuildings
    const byAddress = new Map(sortedBuildings.map((row) => [row.address, row]))
    const rows: RcbBuildingSummary[] = []
    const seen = new Set<string>()
    for (const row of result.perBldg) {
      if ((buildingBudgetByAddress.get(row.address) ?? 0) <= 0) continue
      const scoped = byAddress.get(row.address)
      rows.push(
        scoped ?? {
          address: row.address,
          park: row.park,
          cluster: row.cluster,
          manager: row.manager,
          units: 0,
          tons: 0,
          cost: 0,
        },
      )
      seen.add(row.address)
    }
    for (const row of sortedBuildings) {
      if (seen.has(row.address)) continue
      if ((buildingBudgetByAddress.get(row.address) ?? 0) > 0) rows.push(row)
    }
    const { key, dir } = sort
    rows.sort((a, b) => {
      const x = a[key]
      const y = b[key]
      if (typeof x === 'string' && typeof y === 'string') {
        return x.localeCompare(y) * dir
      }
      return ((Number(x) || 0) - (Number(y) || 0)) * dir
    })
    return rows
  }, [sortedBuildings, budgetedOnly, buildingBudgetByAddress, result.perBldg, sort])

  const isBudgetExcluded = (address: string) =>
    excludedBudgets.has(excludedBudgetKey(address, budgetYearKey))

  const toggleBudgetExcluded = (address: string) => {
    const key = excludedBudgetKey(address, budgetYearKey)
    setExcludedBudgets((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      persistExcludedBudgets(next)
      return next
    })
  }

  const displayedBuildingTotals = useMemo(() => {
    let units = 0
    let cost = 0
    let budget = 0
    const countedPots = new Set<string>()
    for (const row of displayedBuildings) {
      units += row.units
      cost += row.cost
      if (excludedBudgets.has(excludedBudgetKey(row.address, budgetYearKey))) continue
      const dedupe = capexBudgetDedupeKey(buildings, row.address, capexShareGroups)
      if (countedPots.has(dedupe)) continue
      countedPots.add(dedupe)
      budget += buildingBudgetByAddress.get(row.address) ?? 0
    }
    return {
      bldgCount: displayedBuildings.length,
      units,
      cost: Math.round(cost),
      budget: Math.round(budget),
    }
  }, [
    displayedBuildings,
    buildingBudgetByAddress,
    excludedBudgets,
    budgetYearKey,
    buildings,
    capexShareGroups,
  ])

  const selectedBuilding = useMemo(
    () =>
      result.perBldg.find((row) => row.address === selectedBuildingAddress) ??
      sortedBuildings.find((row) => row.address === selectedBuildingAddress) ??
      null,
    [result.perBldg, sortedBuildings, selectedBuildingAddress],
  )

  const buildingView = useMemo(() => {
    void pricingRevision
    if (!selectedBuilding) return null

    const base = rcbLineItemsForBuilding(result, selectedBuilding.address)
    const items = rcbLineItemsWithReplacementYears(
      base,
      result.basis,
      pricingYear,
      sanitizedReplacementYearByRtu,
      pricingTable,
    )
    const yearFilter = buildingYearFilter
    // Hide RTUs not assigned to the chosen Repl. Year. Empty = All; none = unassigned.
    const displayed = !yearFilter
      ? items
      : yearFilter === RCB_REPL_YEAR_NONE
        ? items.filter((item) => {
            const assigned = sanitizedReplacementYearByRtu[`${item.address}::${item.rtu}`]
            return assigned == null
          })
        : items.filter((item) => {
            const assigned = sanitizedReplacementYearByRtu[`${item.address}::${item.rtu}`]
            return assigned === yearFilter
          })

    const sumCost = (rows: RcbScheduledLineItem[]) =>
      rows.reduce((sum, item) => sum + item.cost, 0)
    const sumTons = (rows: RcbScheduledLineItem[]) =>
      rows.reduce((sum, item) => sum + (item.tons ?? 0), 0)

    const totalCost = sumCost(items)
    const displayedCost = sumCost(displayed)
    const displayedTons = sumTons(displayed)
    const ages = displayed.map((item) => item.age).filter((age): age is number => age != null)
    const avgAge = ages.length
      ? Math.round(ages.reduce((sum, age) => sum + age, 0) / ages.length)
      : null

    const basisLabel =
      result.basis === 'hyb' ? 'Hybrid Lennox (all-in)' : 'Standard / Xion (all-in)'

    return {
      items,
      displayed,
      totalCost,
      displayedCost,
      displayedTons,
      avgAge,
      avgUnitCost: displayed.length ? displayedCost / displayed.length : 0,
      costPerTon: displayedTons > 0 ? displayedCost / displayedTons : null,
      remainingCost: 0,
      remainingUnits: 0,
      yearLabel:
        yearFilter === RCB_REPL_YEAR_NONE ? 'None' : yearFilter || yearLabel,
      basisLabel,
    }
  }, [
    selectedBuilding,
    result,
    pricingYear,
    yearLabel,
    sanitizedReplacementYearByRtu,
    pricingTable,
    pricingRevision,
    buildingYearFilter,
  ])

  /** Exact RTUs currently shown — single source for KPIs and Excel/PDF. */
  const viewLineItems = useMemo(() => {
    if (buildingView) return buildingView.displayed
    if (rtuNameSearchItems) return rtuNameSearchItems
    const addresses = new Set(displayedBuildings.map((row) => row.address))
    return yearScopedLineItems.filter((item) => addresses.has(item.address))
  }, [buildingView, rtuNameSearchItems, displayedBuildings, yearScopedLineItems])

  /** Tonnage rollup for the on-screen RTU set (follows Repl. Year / Budgeted filters). */
  const viewTiers = useMemo(
    () => rcbTierBreakdownForItems(viewLineItems),
    [viewLineItems],
  )

  const viewTiersTotalQty = useMemo(
    () => viewTiers.reduce((sum, tier) => sum + tier.qty, 0),
    [viewTiers],
  )
  const viewTiersTotalCost = useMemo(
    () => viewTiers.reduce((sum, tier) => sum + tier.ext, 0),
    [viewTiers],
  )

  /** Multi-year pricing for the same tonnage mix currently on screen. */
  const projection = useMemo(() => {
    void pricingRevision
    return rcbProjectionFromTierQuantities(
      basis,
      viewTiers.map((tier) => ({ tierKey: tier.tier, qty: tier.qty })),
      pricingTable,
    )
  }, [basis, viewTiers, pricingTable, pricingRevision])

  /** Highlight the selected Repl. Year when set; otherwise the pricing baseline year. */
  const projectionHighlightYear = displayYear || pricingYear

  const bannerKpis = useMemo(() => {
    if (buildingView && selectedBuilding) {
      const budgetYear =
        buildingYearFilter && /^\d{4}$/.test(buildingYearFilter)
          ? buildingYearFilter
          : displayYear
      const share = capexShareAddresses(buildings, selectedBuilding.address, capexShareGroups)
      const budget =
        buildingYearFilter === RCB_REPL_YEAR_NONE
          ? 0
          : sumSharedBuildingYearBudgets(
              buildingYearBudgets,
              share,
              budgetYear ? [budgetYear] : undefined,
            )
      return {
        buildings: 1,
        units: buildingView.displayed.length,
        avg: buildingView.avgUnitCost,
        total: buildingView.displayedCost,
        budget,
        yearLabel:
          buildingYearFilter === RCB_REPL_YEAR_NONE
            ? 'None'
            : budgetYear || 'All',
        scope: `${selectedBuilding.address}${
          buildingYearFilter === RCB_REPL_YEAR_NONE
            ? ' · None'
            : buildingYearFilter
              ? ` · FY ${buildingYearFilter}`
              : ''
        }`,
      }
    }
    if (rtuNameSearchItems && rtuNameSearchQuery) {
      const total = Math.round(rtuNameSearchItems.reduce((sum, item) => sum + item.cost, 0))
      const buildingCount = new Set(rtuNameSearchItems.map((item) => item.address)).size
      return {
        buildings: buildingCount,
        units: rtuNameSearchItems.length,
        avg: rtuNameSearchItems.length ? total / rtuNameSearchItems.length : 0,
        total,
        budget: 0,
        yearLabel,
        scope: `RTU name “${rtuNameSearchQuery}” · ${rtuNameSearchItems.length} units`,
      }
    }
    const statusScope =
      statusSearchLabel != null
        ? statusSearchYear
          ? `Capex ${statusSearchLabel} · ${statusSearchYear}`
          : `Capex ${statusSearchLabel}`
        : null
    // Match header KPIs to the By Building list (All vs Budgeted Only) for this Repl. Year.
    return {
      buildings: displayedBuildingTotals.bldgCount,
      units: displayedBuildingTotals.units,
      avg: displayedBuildingTotals.units
        ? displayedBuildingTotals.cost / displayedBuildingTotals.units
        : 0,
      total: displayedBuildingTotals.cost,
      budget: displayedBuildingTotals.budget,
      yearLabel,
      scope:
        statusScope ??
        (budgetedOnly ? `${scopeLabel} · Budgeted ${yearLabel}` : scopeLabel),
    }
  }, [
    buildingView,
    buildingYearFilter,
    displayYear,
    yearLabel,
    scopeLabel,
    selectedBuilding,
    buildingYearBudgets,
    buildings,
    capexShareGroups,
    displayedBuildingTotals,
    budgetedOnly,
    statusSearchLabel,
    statusSearchYear,
    rtuNameSearchItems,
    rtuNameSearchQuery,
  ])

  /** Keep Capex pot year and building-detail year filter in lockstep. */
  const syncReplacementYear = (next: string) => {
    setYear(next)
    setBuildingYearFilter(next)
  }

  const openBuildingDetail = (address: string) => {
    setBuildingYearFilter(isNoneYearFilter ? RCB_REPL_YEAR_NONE : displayYear)
    setSelectedBuildingAddress(address)
    setPanelStage((stage) => (stage === 'minimized' ? 'half' : stage))
  }

  const closeBuildingDetail = () => {
    setSelectedBuildingAddress(null)
    setBuildingYearFilter('')
  }

  const setCostPanelStage = (next: CostPanelStage) => {
    setPanelStage(next)
    if (next === 'minimized') {
      setSelectedBuildingAddress(null)
      setBuildingYearFilter('')
    }
  }

  const handleBasisChange = (next: CostBasis) => {
    setBasis(next)
    // Keep the selected Repl. / Capex year. Hybrid vs Standard only changes unit pricing,
    // not which Capex year pot is shown — do not jump 2025 ↔ 2026 on toggle.
  }

  const handleBuildingYearFilterChange = (next: string) => {
    if (!next) {
      setYear('')
      setBuildingYearFilter('')
      return
    }
    if (next === RCB_REPL_YEAR_NONE) {
      syncReplacementYear(RCB_REPL_YEAR_NONE)
      return
    }
    if (/^\d{4}$/.test(next)) syncReplacementYear(next)
  }

  const setThresholdClamped = (value: number) => {
    setThreshold(Math.min(THR_MAX, Math.max(THR_MIN, value)))
  }

  const bumpThreshold = (delta: number) => {
    setThresholdClamped(threshold + delta)
  }

  const footnote = useMemo(() => {
    const basisLbl =
      result.basis === 'hyb'
        ? `Total Cost / Hybrid Lennox / ${result.year}`
        : 'Total Cost / Standard Efficiency / Lennox Xion / 2025'
    if (rtuNameSearchQuery && rtuNameSearchItems) {
      return `Showing every RTU whose name includes “${rtuNameSearchQuery}” (${rtuNameSearchItems.length} units) — all ages. Budgetary estimate only — not a quote. Costs use ${basisLbl} pricing for replacement year ${displayYear}.`
    }
    let foot = `Budgetary estimate only — not a quote. Pricing year ${result.year}. All-in installed cost per the RTU Pricing sheet (${basisLbl}), matched by cooling tonnage rounded up to the nearest supplied tier (2–50 ton). Includes only units ${result.threshold}+ years old on Repl. Year${displayYear ? ` ${displayYear}` : ' (today when All)'}.`
    if (result.basis === 'hyb') {
      foot += ' Hybrid Lennox figures escalate ~5%/yr (2026 base) per the pricing sheet.'
    }
    if (result.totals.excludedOld > 0) {
      foot += ` ${result.totals.excludedOld} aged unit(s) excluded for having no rated cooling tonnage (e.g. heating-only / make-up air).`
    }
    return foot
  }, [result, rtuNameSearchQuery, rtuNameSearchItems, displayYear])

  const toggleSort = (key: SortKey) => {
    setSort((prev) =>
      prev.key === key
        ? { key, dir: (prev.dir * -1) as -1 | 1 }
        : { key, dir: key === 'address' || key === 'cluster' || key === 'manager' ? 1 : -1 },
    )
  }

  const sortIndicator = (key: SortKey) =>
    sort.key === key ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''

  const exportCurrentRcbView = (format: 'excel' | 'pdf') => {
    // Export exactly what Cost Center shows: same buildings/RTUs as the header KPIs / tables.
    const viewRtuKeys = new Set(
      viewLineItems.map((item) => `${item.address}\0${item.rtu}`),
    )
    const includeScheduledUnit = (item: { address: string; rtu: string }) =>
      viewRtuKeys.has(`${item.address}\0${item.rtu}`)

    const viewAddresses = [...new Set(viewLineItems.map((item) => item.address))]
    // Include Capex share-group siblings so pots stored under a related address still resolve.
    const potLookupAddresses = new Set<string>()
    for (const address of viewAddresses) {
      for (const shared of capexShareAddresses(buildings, address, capexShareGroups)) {
        potLookupAddresses.add(shared)
      }
    }
    const budgetYearForExport = (() => {
      const candidate = buildingYearFilter || displayYear || statusSearchYear || null
      return candidate && /^\d{4}$/.test(candidate) ? candidate : null
    })()
    const scopedBuildingYearBudgets = filterBuildingYearBudgetsForView(
      buildingYearBudgets,
      potLookupAddresses,
      budgetYearForExport ? [budgetYearForExport] : null,
    )

    const managersInScope = [
      ...new Set(
        viewLineItems
          .map((item) => item.manager?.trim())
          .filter((name): name is string => Boolean(name)),
      ),
    ]

    const exportScope =
      buildingView != null
        ? bannerKpis.scope
        : rtuNameSearchQuery
          ? `RTU “${rtuNameSearchQuery}”`
          : statusSearchLabel
            ? statusSearchYear
              ? `Capex ${statusSearchLabel} · ${statusSearchYear}`
              : `Capex ${statusSearchLabel}`
            : budgetedOnly
              ? `${scopeLabel} · Budgeted ${yearLabel}`
              : scopeLabel

    const filenameYear =
      buildingYearFilter === RCB_REPL_YEAR_NONE || isNoneYearFilter
        ? 'None'
        : buildingYearFilter
          ? `FY${buildingYearFilter}`
          : statusSearchYear
            ? statusSearchYear
            : statusSearchLabel
              ? statusSearchLabel
              : rtuNameSearchQuery
                ? rtuNameSearchQuery
                : budgetedOnly && buildingView == null
                  ? `Budgeted${yearLabel}`
                  : yearLabel

    const options = {
      replacementYearByRtu: sanitizedReplacementYearByRtu,
      replacementNotesByRtu,
      pricingTable,
      rtuBudgets: budgets,
      buildingYearBudgets: scopedBuildingYearBudgets,
      buildingYearNotes,
      excludedBudgets,
      includeScheduledUnit,
      shareAddressesFor: (address: string) =>
        capexShareAddresses(buildings, address, capexShareGroups),
      budgetDedupeKeyFor: (address: string) =>
        capexBudgetDedupeKey(buildings, address, capexShareGroups),
      filenameScope: rcbExportFilenameScope({
        selectedBuildingAddress: selectedBuilding?.address,
        managerFilter: manager,
        clusterFilter: cluster,
        parkFilter: park,
        managersInScope,
        fallbackLabel: exportScope,
      }),
      filenameYear,
    }

    // Name-search lists include all ages — recompute without the age threshold for export.
    const exportResult =
      rtuNameSearchItems != null
        ? rcbCompute(buildings, {
            basis,
            year: pricingYear,
            threshold: 0,
            scope: scopeLabel,
            pricingTable,
            currentYear: ageAsOfYear,
          })
        : result

    if (format === 'excel') {
      void exportRcbExcel(exportResult, exportScope, options)
    } else {
      exportRcbPdf(exportResult, exportScope, options)
    }
  }

  const handleCostExcelImport = async (file: File) => {
    if (!canEdit) {
      showToastError('Admin access is required to import cost Excel to Supabase.')
      return
    }
    setImportBusy(true)
    try {
      const buffer = await file.arrayBuffer()
      const { message } = await importCostExcelFile(buffer, file.name, {
        buildings,
        pricingRows,
        applyRcbReportMerge,
        applyBudgetMerge,
        applyRcbReportPricingMerge,
        applyEquipmentImport,
        applyPricingImport,
        importPricingWorkbook: async (name, data) => {
          const file = new File([data], name, {
            type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          })
          return importPricingWorkbook(file)
        },
      })
      showToastSuccess(message)
    } catch (error) {
      showToastError(error instanceof Error ? error.message : 'Import failed')
    } finally {
      setImportBusy(false)
      if (importInputRef.current) importInputRef.current.value = ''
    }
  }

  return (
    <div
      id="rcb-banner"
      data-rcb-stage={effectiveStage}
      className={`${styles.banner}${
        effectiveStage === 'half' ? ` ${styles.bannerHalf}` : ''
      }${effectiveStage === 'full' ? ` ${styles.bannerFull}` : ''}${
        detailExpanded ? ` ${styles.bannerOpen}` : ''
      }`}
    >
      <div id="rcb-bar" className={styles.bar}>
        <div className={styles.rcbTitle}>
          <span className={styles.rcbTitleT1}>RTU replacement cost center</span>
          <span className={styles.rcbTitleT2} id="rcb-scope" title={bannerKpis.scope}>
            {bannerKpis.scope}
          </span>
        </div>
        <div className={styles.rcbKpis}>
          <div className={styles.rcbKpi}>
            <span className={styles.kVal} id="rcb-k-bldg">
              {bannerKpis.buildings.toLocaleString('en-CA')}
            </span>
            <span className={styles.kLab}>Buildings</span>
          </div>
          <div className={styles.rcbKpi}>
            <span className={styles.kVal} id="rcb-k-units">
              {bannerKpis.units.toLocaleString('en-CA')}
            </span>
            <span className={styles.kLab}>
              RTUs{' '}
              {buildingView ? (
                buildingYearFilter ? (
                  <span>in {buildingYearFilter}</span>
                ) : (
                  <span>scheduled</span>
                )
              ) : rtuNameSearchQuery ? (
                <span>“{rtuNameSearchQuery}”</span>
              ) : statusSearchLabel ? (
                <span>
                  {statusSearchLabel}
                  {statusSearchYear ? ` ${statusSearchYear}` : ''}
                </span>
              ) : (
                <span id="rcb-k-thr">≥{result.threshold}</span>
              )}{' '}
              {!buildingView && !statusSearchLabel && !rtuNameSearchQuery && 'yr'}
            </span>
          </div>
          <div className={styles.rcbKpi}>
            <span className={styles.kVal} id="rcb-k-avg">
              {rcbMoney(bannerKpis.avg)}
            </span>
            <span className={styles.kLab}>Avg / Unit</span>
          </div>
          <div className={`${styles.rcbKpi} ${styles.rcbKpiTotal}`}>
            <span className={styles.kVal} id="rcb-k-total">
              {rcbMoney(bannerKpis.total)}
            </span>
            <span className={styles.kLab}>
              Est. Cost · <span id="rcb-k-year">{bannerKpis.yearLabel}</span>
            </span>
          </div>
          <div className={`${styles.rcbKpi} ${styles.rcbKpiBudget}`}>
            <span
              className={styles.kValBudget}
              id="rcb-k-budget"
              title={`Capex budget allocated for ${bannerKpis.yearLabel}`}
            >
              {bannerKpis.budget > 0 ? rcbMoney(bannerKpis.budget) : '—'}
            </span>
            <span className={`${styles.kLab} ${styles.kLabBudget}`}>
              Budget {bannerKpis.yearLabel}
            </span>
          </div>
        </div>
        <div className={styles.rcbControls}>
          <label
            className={styles.rcbCtl}
            title="Show buildings with RTUs assigned to this replacement year, unassigned (None), or All"
          >
            Repl. Year
            <select
              id="rcb-year"
              className={styles.replYearSelect}
              value={isNoneYearFilter ? RCB_REPL_YEAR_NONE : displayYear}
              disabled={Boolean(statusSearchYear)}
              onChange={(e) => syncReplacementYear(e.target.value)}
            >
              <option value="">All</option>
              <option value={RCB_REPL_YEAR_NONE}>None</option>
              {replChooserOptions.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </label>
          <label
            className={styles.rcbCtl}
            title={
              displayYear
                ? `Include RTUs that will be at least this old in ${displayYear} (install → Repl. Year)`
                : 'Include RTUs at least this old today (install → current year)'
            }
          >
            <span className={styles.rcbCtlAgeLabel}>Age on Repl. Year ≥</span>
            <span className={styles.ageStepper}>
              <input
                type="number"
                id="rcb-thr"
                className={styles.ageInput}
                min={THR_MIN}
                max={THR_MAX}
                step={1}
                value={threshold}
                onChange={(e) => {
                  const next = parseInt(e.target.value, 10)
                  if (!Number.isNaN(next)) setThresholdClamped(next)
                }}
              />
              <span className={styles.ageStepperBtns} aria-hidden="true">
                <button
                  type="button"
                  className={styles.ageStepBtn}
                  onClick={() => bumpThreshold(1)}
                  disabled={threshold >= THR_MAX}
                  aria-label="Increase age on Repl. Year threshold"
                >
                  ▲
                </button>
                <button
                  type="button"
                  className={styles.ageStepBtn}
                  onClick={() => bumpThreshold(-1)}
                  disabled={threshold <= THR_MIN}
                  aria-label="Decrease age on Repl. Year threshold"
                >
                  ▼
                </button>
              </span>
            </span>{' '}
            yr
          </label>
          <label
            className={styles.rcbCtl}
            title="Hybrid vs Standard changes estimated replacement cost only. Capex budgets are the same for both."
          >
            Basis
            <select id="rcb-basis" value={basis} onChange={(e) => handleBasisChange(e.target.value as CostBasis)}>
              <option value="hyb">Hybrid Lennox</option>
              <option value="std">Standard / Xion</option>
            </select>
          </label>
          <button
            type="button"
            className={`${styles.rcbBtn} ${styles.rcbBtnXls}`}
            onClick={() => exportCurrentRcbView('excel')}
            title="Export only the buildings and RTUs showing now (same as the header counts)"
          >
            Excel
          </button>
          <button
            type="button"
            className={`${styles.rcbBtn} ${styles.rcbBtnImport}`}
            disabled={importBusy}
            onClick={() => importInputRef.current?.click()}
            title="Import RTU Replacement Cost Center Excel (headers must match the export) — years, notes, budgets, pricing — or a Capital / Cost DB pricing workbook"
          >
            {importBusy ? 'Importing…' : 'Import'}
          </button>
          <input
            ref={importInputRef}
            type="file"
            accept=".xlsx,.xls"
            className={styles.hiddenFile}
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) void handleCostExcelImport(file)
            }}
          />
          <button
            type="button"
            className={`${styles.rcbBtn} ${styles.rcbBtnPdf}`}
            onClick={() => exportCurrentRcbView('pdf')}
            title="Export only the buildings and RTUs showing now (same as the header counts)"
          >
            PDF
          </button>
          <div
            className={styles.stageSpheres}
            role="group"
            aria-label="Cost center panel size"
          >
            <button
              type="button"
              className={`${styles.stageSphere} ${styles.stageSphereMin}${
                effectiveStage === 'minimized' ? ` ${styles.stageSphereActive}` : ''
              }`}
              onClick={() => setCostPanelStage('minimized')}
              title="Minimize"
              aria-label="Minimize cost center"
              aria-pressed={effectiveStage === 'minimized'}
            />
            <button
              type="button"
              className={`${styles.stageSphere} ${styles.stageSphereHalf}${
                effectiveStage === 'half' ? ` ${styles.stageSphereActive}` : ''
              }`}
              onClick={() => setCostPanelStage('half')}
              title="Half screen"
              aria-label="Half-screen cost center"
              aria-pressed={effectiveStage === 'half'}
            />
            <button
              type="button"
              className={`${styles.stageSphere} ${styles.stageSphereFull}${
                effectiveStage === 'full' ? ` ${styles.stageSphereActive}` : ''
              }`}
              onClick={() => setCostPanelStage('full')}
              title="Full screen"
              aria-label="Full-screen cost center"
              aria-pressed={effectiveStage === 'full'}
            />
          </div>
        </div>
      </div>

      <div id="rcb-detail" className={styles.detail}>
        <div className={styles.detailBody}>
          {selectedBuilding && buildingView ? (
            <RcbBuildingDetail
              building={selectedBuilding}
              buildings={buildings}
              result={result}
              defaultReplacementYear={displayYear || pricingYear}
              replacementYearByRtu={sanitizedReplacementYearByRtu}
              replacementYearFilter={buildingYearFilter}
              onReplacementYearFilterChange={handleBuildingYearFilterChange}
              viewSummary={buildingView}
              onReplacementYearChange={handleSetRtuReplacementYear}
              onBack={closeBuildingDetail}
            />
          ) : selectedBuilding ? null : rtuNameSearchItems && rtuNameSearchQuery ? (
            <div className={styles.rcbTblwrap}>
              <h4>
                RTUs matching “{rtuNameSearchQuery}” ({rtuNameSearchItems.length})
              </h4>
              <div className={styles.rcbTblScroll}>
                <table className={styles.rcbTbl} id="rcb-tbl-rtu-name-search">
                  <thead>
                    <tr>
                      <th>Building</th>
                      <th>RTU</th>
                      <th
                        className={`num ${styles.ageHeaderTh}`}
                        title="Age today (install → current year)"
                      >
                        <span className={styles.ageHeaderLabel}>Age Today</span>
                      </th>
                      <th
                        className={`num ${styles.ageHeaderTh}`}
                        title="Age on this RTU's Repl. Year (replacement year − install year)"
                      >
                        <span className={styles.ageHeaderLabel}>Age on Repl. Year</span>
                      </th>
                      <th className="num">Tons</th>
                      <th className="num">Est. cost</th>
                      <th>Repl. Year</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rtuNameSearchItems.map((item) => (
                      <tr
                        key={`${item.address}\0${item.rtu}`}
                        className={styles.clickableRow}
                        onClick={() => openBuildingDetail(item.address)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault()
                            openBuildingDetail(item.address)
                          }
                        }}
                        tabIndex={0}
                        role="button"
                        title={`Open ${item.address}`}
                      >
                        <td>{item.address}</td>
                        <td>{item.rtu}</td>
                        <td className="num">
                          {item.year != null ? currentYear() - item.year : '—'}
                        </td>
                        <td className="num">{item.age ?? '—'}</td>
                        <td className="num">{formatRtuTons(item.tons)}</td>
                        <td className="num">{rcbMoney(item.cost)}</td>
                        <td>{item.replacementYear}</td>
                      </tr>
                    ))}
                    <tr className={styles.rcbTotal}>
                      <td>TOTAL</td>
                      <td />
                      <td />
                      <td />
                      <td className="num">
                        {formatRtuTons(
                          rtuNameSearchItems.reduce((sum, item) => sum + (item.tons ?? 0), 0),
                        )}
                      </td>
                      <td className="num">{rcbMoney(bannerKpis.total)}</td>
                      <td />
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className={styles.rcbDetailGrid}>
              <div className={styles.rcbTblwrap}>
                <div className={styles.byBuildingHead}>
                  <h4>
                    By building
                    {statusSearchLabel
                      ? ` · Capex ${statusSearchLabel}${statusSearchYear ? ` ${statusSearchYear}` : ''}`
                      : ''}
                  </h4>
                  <div className={styles.byBuildingHeadControls}>
                    <div
                      className={styles.budgetFilterToggle}
                      role="group"
                      aria-label={`Show all buildings or only those with Capex budget for ${yearLabel}`}
                    >
                      <button
                        type="button"
                        className={`${styles.budgetFilterBtn}${
                          !budgetedOnly ? ` ${styles.budgetFilterBtnActive}` : ''
                        }`}
                        onClick={() => setBudgetedOnly(false)}
                        title="Show every building with aged RTUs"
                      >
                        All
                      </button>
                      <button
                        type="button"
                        className={`${styles.budgetFilterBtn}${
                          budgetedOnly ? ` ${styles.budgetFilterBtnActive}` : ''
                        }`}
                        onClick={() => setBudgetedOnly(true)}
                        title={`Show only buildings with Capex budget in ${yearLabel}`}
                      >
                        Budgeted {yearLabel}
                      </button>
                    </div>
                  </div>
                </div>
                <div className={styles.rcbTblScroll}>
                  <table className={styles.rcbTbl} id="rcb-tbl-bldg">
                    <thead>
                      <tr>
                        <th>
                          <button
                            type="button"
                            className={styles.sortableTh}
                            onClick={() => toggleSort('address')}
                            title="Sort by address"
                          >
                            Address{sortIndicator('address')}
                          </button>
                        </th>
                        <th>
                          <button
                            type="button"
                            className={styles.sortableTh}
                            onClick={() => toggleSort('cluster')}
                            title="Sort by cluster"
                          >
                            Cluster{sortIndicator('cluster')}
                          </button>
                        </th>
                        <th>
                          <button
                            type="button"
                            className={styles.sortableTh}
                            onClick={() => toggleSort('manager')}
                            title="Sort by manager"
                          >
                            Manager{sortIndicator('manager')}
                          </button>
                        </th>
                        <th className="num">
                          <button
                            type="button"
                            className={styles.sortableTh}
                            onClick={() => toggleSort('units')}
                            title="Sort by RTU count"
                          >
                            RTUs{sortIndicator('units')}
                          </button>
                        </th>
                        <th className="num">
                          <button
                            type="button"
                            className={styles.sortableTh}
                            onClick={() => toggleSort('cost')}
                            title="Sort by estimated cost"
                          >
                            Cost{sortIndicator('cost')}
                          </button>
                        </th>
                        <th
                          className="num"
                          title={
                            displayYear
                              ? `Capex pot for replacement year ${displayYear} only`
                              : 'Capex pot total across all years'
                          }
                        >
                          Budget {yearLabel}
                        </th>
                        <th
                          title={
                            displayYear
                              ? `Capex Status for the ${displayYear} building pot (not per RTU)`
                              : 'Capex Status (pick a Repl. Year to see pot status)'
                          }
                        >
                          Status
                        </th>
                        <th
                          className={styles.removeBudgetTh}
                          title="Exclude this Capex budget from totals"
                        >
                          Remove
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {!displayedBuildings.length ? (
                        <tr>
                          <td colSpan={8}>
                            <div className={styles.rcbEmpty}>
                              {budgetedOnly
                                ? `No buildings with Capex budget for ${yearLabel} in the current selection.`
                                : statusSearchLabel
                                  ? `No buildings with Capex ${statusSearchLabel}${statusSearchYear ? ` ${statusSearchYear}` : ''} in the current selection.`
                                  : isNoneYearFilter
                                    ? 'No buildings with unassigned RTUs (Repl. Year None) in the current selection.'
                                  : displayYear
                                    ? `No buildings with RTUs assigned to ${displayYear} in the current selection.`
                                    : `No RTUs ≥ ${result.threshold} years old on Repl. Year${displayYear ? ` ${displayYear}` : ''} in the current selection.`}
                            </div>
                          </td>
                        </tr>
                      ) : (
                        <>
                          {displayedBuildings.map((r) => {
                            const budget = buildingBudgetByAddress.get(r.address) ?? 0
                            const removed = isBudgetExcluded(r.address)
                            const potStatus = displayYear
                              ? potStatuses[
                                  buildingYearBudgetKey(
                                    capexPotOwnerAddress(buildings, r.address, capexShareGroups),
                                    displayYear,
                                  )
                                ]?.trim() ||
                                potStatuses[buildingYearBudgetKey(r.address, displayYear)]?.trim() ||
                                ''
                              : ''
                            return (
                              <tr
                                key={r.address}
                                className={styles.clickableRow}
                                onClick={() => openBuildingDetail(r.address)}
                                title="View RTU breakdown for this building"
                              >
                                <td>{r.address}</td>
                                <td className={styles.clusterCell} title={r.cluster || undefined}>
                                  {r.cluster}
                                </td>
                                <td className={styles.managerCell} title={r.manager || undefined}>
                                  {r.manager}
                                </td>
                                <td className="num">{r.units}</td>
                                <td className="num">{rcbMoney(r.cost)}</td>
                                <td
                                  className={`num${removed && budget > 0 ? ` ${styles.budgetRemoved}` : ''}`}
                                >
                                  {budget > 0 ? rcbMoney(budget) : '—'}
                                </td>
                                <td>
                                  {potStatus ? (
                                    <span
                                      className={`${styles.capexSourceStatus} ${
                                        /rejected/i.test(potStatus)
                                          ? styles.capexSourceStatusRejected
                                          : /approved/i.test(potStatus)
                                            ? styles.capexSourceStatusApproved
                                            : styles.capexSourceStatusSubmitted
                                      }`}
                                    >
                                      {potStatus}
                                    </span>
                                  ) : (
                                    '—'
                                  )}
                                </td>
                                <td
                                  className={styles.removeBudgetTd}
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <input
                                    type="checkbox"
                                    className={styles.removeBudgetCheck}
                                    checked={removed}
                                    disabled={!(budget > 0)}
                                    onChange={() => toggleBudgetExcluded(r.address)}
                                    title={
                                      budget > 0
                                        ? removed
                                          ? 'Include this Capex budget in totals'
                                          : 'Exclude this Capex budget from totals'
                                        : 'No Capex budget for this year'
                                    }
                                    aria-label={`Remove ${r.address} Capex budget from totals`}
                                  />
                                </td>
                              </tr>
                            )
                          })}
                          <tr className={styles.rcbTotal}>
                            <td>
                              TOTAL — {displayedBuildingTotals.bldgCount} bldg
                              {budgetedOnly ? ` (budgeted ${yearLabel})` : ''}
                            </td>
                            <td />
                            <td />
                            <td className="num">{displayedBuildingTotals.units}</td>
                            <td className="num">{rcbMoney(displayedBuildingTotals.cost)}</td>
                            <td className="num">
                              {displayedBuildingTotals.budget > 0
                                ? rcbMoney(displayedBuildingTotals.budget)
                                : '—'}
                            </td>
                            <td />
                            <td />
                          </tr>
                        </>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className={styles.rcbTblwrap} style={{ maxWidth: 340 }}>
                <h4>
                  By tonnage tier (
                  {displayYear || (isNoneYearFilter ? 'None' : pricingYear)})
                </h4>
                <div className={styles.rcbTblScroll}>
                  <table className={styles.rcbTbl} id="rcb-tbl-tier">
                    <thead>
                      <tr>
                        <th>Tier</th>
                        <th className="num">Unit $</th>
                        <th className="num">Qty</th>
                        <th className="num">Extended</th>
                      </tr>
                    </thead>
                    <tbody>
                      {!viewTiers.length ? (
                        <tr>
                          <td colSpan={4}>
                            <div className={styles.rcbEmpty}>—</div>
                          </td>
                        </tr>
                      ) : (
                        <>
                          {viewTiers.map((t) => (
                            <tr key={t.tier}>
                              <td>{t.label}</td>
                              <td className="num">{rcbMoney(t.unit)}</td>
                              <td className="num">{t.qty}</td>
                              <td className="num">{rcbMoney(t.ext)}</td>
                            </tr>
                          ))}
                          <tr className={styles.rcbTotal}>
                            <td>TOTAL</td>
                            <td />
                            <td className="num">{viewTiersTotalQty}</td>
                            <td className="num">{rcbMoney(viewTiersTotalCost)}</td>
                          </tr>
                        </>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className={styles.rcbTblwrap} style={{ maxWidth: 300 }}>
                <h4>Projection by year</h4>
                <div className={styles.rcbTblScroll}>
                  <table className={styles.rcbTbl} id="rcb-tbl-proj">
                    <thead>
                      <tr>
                        <th>Year</th>
                        <th className="num">Total</th>
                        <th className="num">vs {projection[0]?.year ?? ''}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {!projection.length || !viewTiersTotalQty ? (
                        <tr>
                          <td colSpan={3}>
                            <div className={styles.rcbEmpty}>—</div>
                          </td>
                        </tr>
                      ) : (
                        projection.map((p) => {
                          const delta = p.total - (projection[0]?.total ?? 0)
                          const dStr =
                            delta === 0 ? '—' : `${delta > 0 ? '+' : ''}${rcbMoney(delta)}`
                          const selected = p.year === projectionHighlightYear
                          return (
                            <tr
                              key={p.year}
                              className={selected ? styles.selectedRow : undefined}
                            >
                              <td>{p.year}</td>
                              <td className="num">{rcbMoney(p.total)}</td>
                              <td className="num">{dStr}</td>
                            </tr>
                          )
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>
        <div className={styles.rcbFoot} id="rcb-foot">
          {footnote}
        </div>
      </div>
    </div>
  )
}
