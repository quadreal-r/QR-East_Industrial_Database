import { useMemo, useState } from 'react'
import {
  formatRtuTons,
  rcbMoney,
  rcbReplacementYearKey,
  rcbScheduleYearOptions,
  rcbTierBreakdownForItems,
  type RcbScheduledLineItem,
  type RcbBuildingSummary,
  type RcbComputeResult,
} from '@/lib/costEstimator'
import {
  remainingBuildingYearBudget,
  resolveCapexPotYears,
  sumSharedBuildingYearBudgets,
  sumSharedBuildingYearPot,
} from '@/lib/buildingYearBudget'
import {
  capexPotOwnerAddress,
  capexShareAddresses,
} from '@/lib/capexSharedBu'
import { CAPEX_HVAC_YEAR_COLUMNS } from '@/lib/capexHvacBudgetImport'
import { RCB_REPL_YEAR_NONE } from '@/lib/constants'
import { currentYear } from '@/lib/rtu'
import { sumBuildingBudget } from '@/lib/rtuBudget'
import { useAuth } from '@/hooks/useAuth'
import type { Building } from '@/types/domain'
import { useBuildingYearBudgetStore } from '@/stores/buildingYearBudgetStore'
import { useRtuBudgetStore } from '@/stores/rtuBudgetStore'
import { useRtuScheduleStore } from '@/stores/rtuScheduleStore'
import { BudgetAmountInput } from './BudgetAmountInput'
import { RtuNotesModal } from './RtuNotesModal'
import styles from './CostBanner.module.css'

export interface BuildingViewSummary {
  items: RcbScheduledLineItem[]
  displayed: RcbScheduledLineItem[]
  totalCost: number
  displayedCost: number
  displayedTons: number
  avgAge: number | null
  avgUnitCost: number
  costPerTon: number | null
  remainingCost: number
  remainingUnits: number
  yearLabel: string
  basisLabel: string
}

export interface RcbBuildingDetailProps {
  building: RcbBuildingSummary
  /** Full portfolio — used to resolve shared Capex pots by BU. */
  buildings: Building[]
  result: RcbComputeResult
  defaultReplacementYear: string
  replacementYearByRtu: Record<string, string>
  replacementYearFilter: string
  onReplacementYearFilterChange: (year: string) => void
  viewSummary: BuildingViewSummary
  onReplacementYearChange: (address: string, rtu: string, year: string) => void
  onBack: () => void
}

type RtuSortKey =
  | 'rtu'
  | 'replacementYear'
  | 'installed'
  | 'ageToday'
  | 'age'
  | 'tons'
  | 'cost'
  | 'budget'

function ageTodayFromInstall(installYear: number | null | undefined): number | null {
  if (installYear == null) return null
  return currentYear() - installYear
}

function compareRtuRows(
  a: RcbScheduledLineItem,
  b: RcbScheduledLineItem,
  key: RtuSortKey,
  budgetOf: (item: RcbScheduledLineItem) => number,
): number {
  switch (key) {
    case 'rtu':
      return a.rtu.localeCompare(b.rtu)
    case 'replacementYear':
      return Number(a.replacementYear) - Number(b.replacementYear)
    case 'installed':
      return (a.year ?? 0) - (b.year ?? 0)
    case 'ageToday':
      return (ageTodayFromInstall(a.year) ?? 0) - (ageTodayFromInstall(b.year) ?? 0)
    case 'age':
      return (a.age ?? 0) - (b.age ?? 0)
    case 'tons':
      return (a.tons ?? 0) - (b.tons ?? 0)
    case 'cost':
      return a.cost - b.cost
    case 'budget':
      return budgetOf(a) - budgetOf(b)
    default:
      return 0
  }
}

export function RcbBuildingDetail({
  building,
  buildings,
  result,
  defaultReplacementYear,
  replacementYearByRtu,
  replacementYearFilter,
  onReplacementYearFilterChange,
  viewSummary,
  onReplacementYearChange,
  onBack,
}: RcbBuildingDetailProps) {
  const { canEdit } = useAuth()
  const [notesTarget, setNotesTarget] = useState<{ address: string; rtu: string } | null>(null)
  const [sort, setSort] = useState<{ key: RtuSortKey; dir: -1 | 1 }>({
    key: 'rtu',
    dir: 1,
  })

  const notesByRtu = useRtuScheduleStore((s) => s.notes)
  const setNotes = useRtuScheduleStore((s) => s.setNotes)
  const getNotes = useRtuScheduleStore((s) => s.getNotes)

  const budgets = useRtuBudgetStore((s) => s.budgets)
  const setRtuBudget = useRtuBudgetStore((s) => s.setRtuBudget)
  const pots = useBuildingYearBudgetStore((s) => s.pots)
  const potNotes = useBuildingYearBudgetStore((s) => s.notes)
  const potStatuses = useBuildingYearBudgetStore((s) => s.statuses)
  const potJobTypes = useBuildingYearBudgetStore((s) => s.jobTypes)
  const setBuildingYearBudget = useBuildingYearBudgetStore((s) => s.setBuildingYearBudget)

  /**
   * Capex pot year follows:
   * 1) explicit Repl. Year filter when set to a calendar year
   * 2) otherwise the unique Repl. Year(s) on the visible RTU rows
   *    — one shared year → that pot; several → list related Capex years
   * 3) fallback to the estimate / pricing year when nothing is visible
   */
  const potYearResolution = useMemo(
    () =>
      resolveCapexPotYears({
        replacementYearFilter,
        visibleUnits: viewSummary.displayed,
        fallbackYear: defaultReplacementYear,
      }),
    [replacementYearFilter, viewSummary.displayed, defaultReplacementYear],
  )
  const potEditYear =
    potYearResolution.mode === 'single'
      ? potYearResolution.year
      : potYearResolution.years[0] ?? defaultReplacementYear
  const relatedPotYears = useMemo(
    () =>
      potYearResolution.mode === 'multi' ? potYearResolution.years : [potEditYear],
    [potYearResolution, potEditYear],
  )
  const yearFilterLabel =
    replacementYearFilter === RCB_REPL_YEAR_NONE
      ? 'None'
      : replacementYearFilter || ''

  const potOwnerAddress = useMemo(
    () => capexPotOwnerAddress(buildings, building.address),
    [buildings, building.address],
  )
  const shareAddresses = useMemo(
    () => capexShareAddresses(buildings, building.address),
    [buildings, building.address],
  )
  const sharedBuLabel =
    shareAddresses.length > 1
      ? `Shared Capex pot · ${shareAddresses.length} buildings`
      : null

  const buildingPotTotal = useMemo(
    () => sumSharedBuildingYearBudgets(pots, shareAddresses),
    [pots, shareAddresses],
  )

  const activeYearPot = sumSharedBuildingYearPot(pots, shareAddresses, potEditYear)
  const activeYearPotNote =
    potNotes[`${building.address}::${potEditYear}`]?.trim() ||
    potNotes[`${potOwnerAddress}::${potEditYear}`]?.trim() ||
    ''

  /** Capex pot years for this share group (owner + any legacy member rows). */
  const buildingPotNotes = useMemo(() => {
    const years = new Set<string>()
    for (const addr of shareAddresses) {
      const prefix = `${addr}::`
      for (const [key, amount] of Object.entries(pots)) {
        if (!key.startsWith(prefix) || !(amount > 0)) continue
        const year = key.slice(prefix.length)
        if (/^\d{4}$/.test(year)) years.add(year)
      }
    }
    return [...years]
      .sort((a, b) => Number(a) - Number(b))
      .map((year) => {
        const localKey = `${building.address}::${year}`
        const ownerKey = `${potOwnerAddress}::${year}`
        return {
          year,
          amount: sumSharedBuildingYearPot(pots, shareAddresses, year),
          note: potNotes[localKey]?.trim() || potNotes[ownerKey]?.trim() || '',
          status: potStatuses[localKey]?.trim() || potStatuses[ownerKey]?.trim() || '',
          jobProjectType: potJobTypes[localKey]?.trim() || potJobTypes[ownerKey]?.trim() || '',
        }
      })
  }, [building, potOwnerAddress, shareAddresses, pots, potNotes, potStatuses, potJobTypes])

  /** Capex pots tied to the Repl. Year(s) currently on screen (submitted / approved amounts). */
  const relatedCapexPots = useMemo(() => {
    const related = new Set(relatedPotYears)
    const fromNotes = buildingPotNotes.filter((row) => related.has(row.year))
    const seen = new Set(fromNotes.map((row) => row.year))
    // Include related Repl. Years even when no pot amount is stored yet.
    const missing = relatedPotYears
      .filter((year) => !seen.has(year))
      .map((year) => {
        const localKey = `${building.address}::${year}`
        const ownerKey = `${potOwnerAddress}::${year}`
        return {
          year,
          amount: 0,
          note: potNotes[localKey]?.trim() || potNotes[ownerKey]?.trim() || '',
          status: potStatuses[localKey]?.trim() || potStatuses[ownerKey]?.trim() || '',
          jobProjectType: potJobTypes[localKey]?.trim() || potJobTypes[ownerKey]?.trim() || '',
        }
      })
    return [...fromNotes, ...missing].sort((a, b) => Number(a.year) - Number(b.year))
  }, [
    relatedPotYears,
    buildingPotNotes,
    building.address,
    potOwnerAddress,
    potNotes,
    potStatuses,
    potJobTypes,
  ])

  const relatedPotsTotal = useMemo(
    () => relatedCapexPots.reduce((sum, row) => sum + (row.amount > 0 ? row.amount : 0), 0),
    [relatedCapexPots],
  )

  const yearOptions = useMemo(() => {
    const base = rcbScheduleYearOptions(
      result.basis,
      defaultReplacementYear,
      replacementYearByRtu,
    )
    // Capex years start at 2025; Hybrid pricing years start at 2026 — keep Capex years selectable.
    const potYears = buildingPotNotes.map((row) => row.year)
    return [
      ...new Set([
        ...base,
        ...CAPEX_HVAC_YEAR_COLUMNS,
        ...potYears,
        defaultReplacementYear,
        potEditYear,
      ]),
    ]
      .filter((y) => /^\d{4}$/.test(y))
      .sort((a, b) => Number(a) - Number(b))
  }, [
    result.basis,
    defaultReplacementYear,
    replacementYearByRtu,
    buildingPotNotes,
    potEditYear,
  ])

  const activeYearAllocated = useMemo(() => {
    let total = 0
    for (const addr of shareAddresses) {
      const prefix = `${addr}::`
      for (const [key, amount] of Object.entries(budgets)) {
        if (!key.startsWith(prefix) || !(typeof amount === 'number') || !(amount > 0)) continue
        const rtu = key.slice(prefix.length)
        const year = replacementYearByRtu[`${addr}::${rtu}`] ?? defaultReplacementYear
        if (String(year) === String(potEditYear)) total += amount
      }
    }
    return Math.round(total)
  }, [budgets, shareAddresses, replacementYearByRtu, defaultReplacementYear, potEditYear])

  /** Capex pot for this year minus RTU Repl. Budget Allocations for that year. */
  const activeYearRemaining = remainingBuildingYearBudget(activeYearPot, activeYearAllocated)

  const allYearsAllocated = useMemo(() => {
    let total = 0
    for (const addr of shareAddresses) {
      const prefix = `${addr}::`
      for (const [key, amount] of Object.entries(budgets)) {
        if (!key.startsWith(prefix) || !(typeof amount === 'number') || !(amount > 0)) continue
        total += amount
      }
    }
    return Math.round(total)
  }, [budgets, shareAddresses])

  const allYearsRemaining = remainingBuildingYearBudget(buildingPotTotal, allYearsAllocated)

  const handleBuildingYearPotCommit = (amount: number | null) => {
    // Shared BU pot: store on primary, clear sibling rows so the sum stays accurate.
    for (const addr of shareAddresses) {
      if (addr === potOwnerAddress) setBuildingYearBudget(addr, potEditYear, amount)
      else setBuildingYearBudget(addr, potEditYear, null)
    }
  }

  const displayedBudgetTotal = useMemo(
    () =>
      sumBuildingBudget(
        budgets,
        building.address,
        viewSummary.displayed.map((item) => item.rtu),
      ),
    [budgets, building.address, viewSummary.displayed],
  )

  const handleRtuBudgetCommit = (
    address: string,
    rtu: string,
    _replacementYear: string,
    amount: number | null,
  ) => {
    setRtuBudget(address, rtu, amount)
  }

  const budgetOf = (item: RcbScheduledLineItem) =>
    budgets[rcbReplacementYearKey(item.address, item.rtu)] ?? 0

  const displayedItems = useMemo(() => {
    const { key, dir } = sort
    return [...viewSummary.displayed].sort(
      (a, b) => compareRtuRows(a, b, key, budgetOf) * dir,
    )
    // budgetOf closes over budgets; include budgets for sort stability.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewSummary.displayed, sort, budgets])

  const tierRows = useMemo(() => rcbTierBreakdownForItems(displayedItems), [displayedItems])

  const deferredCount = useMemo(
    () =>
      viewSummary.items.filter(
        (item) => Number(item.replacementYear) > Number(defaultReplacementYear),
      ).length,
    [defaultReplacementYear, viewSummary.items],
  )

  const toggleSort = (key: RtuSortKey) => {
    setSort((prev) =>
      prev.key === key
        ? { key, dir: (prev.dir * -1) as -1 | 1 }
        : { key, dir: key === 'rtu' ? 1 : -1 },
    )
  }

  const sortIndicator = (key: RtuSortKey) => (sort.key === key ? (sort.dir === 1 ? ' ↑' : ' ↓') : '')

  const notesModalText = (() => {
    if (!notesTarget) return ''
    const saved = getNotes(notesTarget.address, notesTarget.rtu)
    if (saved.trim()) return saved
    const item = viewSummary.items.find((row) => row.rtu === notesTarget.rtu)
    if (!item) return ''
    return (
      potNotes[`${item.address}::${item.replacementYear}`]?.trim() ||
      potNotes[`${potOwnerAddress}::${item.replacementYear}`]?.trim() ||
      ''
    )
  })()

  return (
    <div className={styles.buildingDetail}>
      <div className={styles.buildingDetailHeader}>
        <button type="button" className={styles.rcbBackBtn} onClick={onBack}>
          ← Buildings
        </button>
        <div className={styles.buildingDetailTitle}>
          <h4>{building.address}</h4>
          <p>
            {building.park}
            {building.cluster ? ` · ${building.cluster}` : ''}
            {building.manager ? ` · ${building.manager}` : ''}
          </p>
          <p className={styles.buildingDetailHint}>
            Global estimate year {defaultReplacementYear}
            {deferredCount > 0
              ? ` · ${deferredCount} RTU${deferredCount === 1 ? '' : 's'} scheduled later`
              : ''}
            {yearFilterLabel
              ? ` · ${displayedItems.length} of ${viewSummary.items.length} RTUs in ${yearFilterLabel}`
              : ''}
            {sharedBuLabel ? ` · ${sharedBuLabel}` : ''}
            {' · '}
            Capex pot follows Repl. Year; RTU budgets draw down that year
          </p>
        </div>
        <div className={styles.buildingDetailKpis}>
          <span>
            <strong>{displayedItems.length}</strong> RTU{displayedItems.length === 1 ? '' : 's'}
          </span>
          <span className={styles.buildingDetailCost}>
            <span className={styles.budgetKpiLabel}>Estimate</span>
            <strong>{rcbMoney(viewSummary.displayedCost)}</strong>
          </span>
          <div className={styles.buildingBudgetKpi}>
            {potYearResolution.mode === 'multi' ? (
              <>
                <span className={styles.budgetKpiLabel}>
                  Capex pots · Repl. Years
                </span>
                <div className={styles.capexPotEdit}>
                  <span className={styles.capexPotEditLab}>Related total</span>
                  <strong
                    className={
                      relatedPotsTotal > 0
                        ? styles.capexRemainingOk
                        : styles.capexRemainingNeutral
                    }
                    title="Sum of Capex pots for the Repl. Years shown in the RTU table"
                  >
                    {rcbMoney(relatedPotsTotal)}
                  </strong>
                </div>
                <ul className={styles.capexRelatedYearList} aria-label="Capex pots by Repl. Year">
                  {relatedCapexPots.map((row) => (
                    <li key={row.year} className={styles.capexRelatedYearItem}>
                      <button
                        type="button"
                        className={styles.capexRelatedYearBtn}
                        onClick={() => onReplacementYearFilterChange(row.year)}
                        title={`Filter Repl. Year to ${row.year} to edit this Capex pot`}
                      >
                        {row.year}
                      </button>
                      <span className={styles.capexRelatedYearAmount}>
                        {row.amount > 0 ? rcbMoney(row.amount) : '—'}
                      </span>
                      {row.status ? (
                        <span
                          className={`${styles.capexRelatedYearStatus} ${
                            /rejected/i.test(row.status)
                              ? styles.capexSourceStatusRejected
                              : /approved/i.test(row.status)
                                ? styles.capexSourceStatusApproved
                                : styles.capexSourceStatusSubmitted
                          }`}
                        >
                          {row.status}
                        </span>
                      ) : (
                        <span className={styles.capexRelatedYearStatusMuted}>—</span>
                      )}
                    </li>
                  ))}
                </ul>
                <span className={styles.capexRelatedYearHint}>
                  Click a year to edit that Capex pot
                </span>
              </>
            ) : (
              <>
                <span className={styles.budgetKpiLabel}>Capex pot {potEditYear}</span>
                {/* Pot total = Capex − RTU Repl. Budget Allocations for this year (updates live). */}
                <div className={styles.capexPotEdit}>
                  <span className={styles.capexPotEditLab}>Pot total</span>
                  <strong
                    className={
                      activeYearRemaining > 0
                        ? styles.capexRemainingOk
                        : activeYearRemaining < 0
                          ? styles.capexRemainingOver
                          : styles.capexRemainingNeutral
                    }
                    title={`${rcbMoney(activeYearPot)} Capex − ${rcbMoney(activeYearAllocated)} allocated = ${rcbMoney(activeYearRemaining)} left`}
                  >
                    {rcbMoney(activeYearRemaining)}
                  </strong>
                </div>
                <label className={styles.capexPotEdit}>
                  <span className={styles.capexPotEditLab}>Capex pot</span>
                  <BudgetAmountInput
                    value={activeYearPot > 0 ? activeYearPot : null}
                    onCommit={handleBuildingYearPotCommit}
                    title={
                      canEdit
                        ? `Set Capex pot for ${potEditYear}. RTU Repl. Budget Allocations deduct from Pot total.`
                        : 'Admin access is required to change Capex pot.'
                    }
                    ariaLabel={`Capex pot ${potEditYear} for ${building.address}`}
                    className={styles.buildingBudgetInput}
                    readOnly={!canEdit}
                  />
                </label>
                {activeYearAllocated > 0 ? (
                  <span
                    className={styles.budgetVarianceNeutral}
                    title={`Sum of RTU Repl. Budget Allocations for ${potEditYear}`}
                  >
                    −{rcbMoney(activeYearAllocated)} allocated
                  </span>
                ) : null}
                {buildingPotTotal > 0 && !replacementYearFilter ? (
                  <span
                    className={
                      allYearsRemaining > 0
                        ? styles.budgetVarianceOver
                        : allYearsRemaining < 0
                          ? styles.budgetVarianceUnder
                          : styles.budgetVarianceNeutral
                    }
                    title={`${rcbMoney(buildingPotTotal)} all Capex pots − ${rcbMoney(allYearsAllocated)} allocated`}
                  >
                    All years {rcbMoney(allYearsRemaining)} left
                  </span>
                ) : null}
              </>
            )}
          </div>
        </div>
      </div>

      {buildingPotNotes.length ? (
        <div className={styles.capexSourceStrip} aria-label="Capex pot source notes">
          <div className={styles.capexSourceStripTitle}>Capex source notes</div>
          <div className={styles.capexSourceHeader} aria-hidden="true">
            <span>Year</span>
            <span>Amount</span>
            <span>Status</span>
            <span>Type</span>
            <span>Source note</span>
          </div>
          <ul className={styles.capexSourceList}>
            {buildingPotNotes.map((row) => {
              const isRelated = relatedPotYears.includes(row.year)
              return (
              <li
                key={row.year}
                className={
                  isRelated
                    ? `${styles.capexSourceItem} ${styles.capexSourceItemActive}`
                    : styles.capexSourceItem
                }
              >
                <button
                  type="button"
                  className={styles.capexSourceYearBtn}
                  onClick={() => onReplacementYearFilterChange(row.year)}
                  title={`Set Repl. Year to ${row.year}`}
                >
                  {row.year}
                </button>
                <span className={styles.capexSourceAmount}>{rcbMoney(row.amount)}</span>
                {row.status ? (
                  <span
                    className={`${styles.capexSourceStatus} ${
                      /rejected/i.test(row.status)
                        ? styles.capexSourceStatusRejected
                        : /approved/i.test(row.status)
                          ? styles.capexSourceStatusApproved
                          : styles.capexSourceStatusSubmitted
                    }`}
                    title={`Capex Status: ${row.status}`}
                  >
                    {row.status}
                  </span>
                ) : (
                  <span className={styles.capexSourceStatusEmpty}>—</span>
                )}
                <span
                  className={
                    row.jobProjectType
                      ? styles.capexSourceJobType
                      : styles.capexSourceJobTypeEmpty
                  }
                  title={
                    row.jobProjectType
                      ? `Capex Type: ${row.jobProjectType}`
                      : undefined
                  }
                >
                  {row.jobProjectType || '—'}
                </span>
                <span className={styles.capexSourceNote}>
                  {row.note ||
                    (row.year === potEditYear && activeYearPotNote
                      ? activeYearPotNote
                      : '—')}
                </span>
              </li>
              )
            })}
          </ul>
        </div>
      ) : null}

      <div className={styles.rcbDetailGrid}>
        <div className={styles.rcbTblwrap}>
          <h4>Eligible RTUs — assign replacement year &amp; draw from that year&apos;s pot</h4>
          <div className={styles.rcbTblScroll}>
          <table className={styles.rcbTbl}>
            <thead>
              <tr>
                <th>RTU</th>
                <th>Model</th>
                <th>Serial</th>
                <th>Make</th>
                <th>Suite</th>
                <th className="num">Installed</th>
                <th
                  className={`num ${styles.ageHeaderTh}`}
                  title="Age today (install → current year)"
                >
                  <button
                    type="button"
                    className={styles.sortableTh}
                    onClick={() => toggleSort('ageToday')}
                    title="Sort by age today"
                  >
                    <span className={styles.ageHeaderLabel}>
                      Age Today{sortIndicator('ageToday')}
                    </span>
                  </button>
                </th>
                <th
                  className={`num ${styles.ageHeaderTh}`}
                  title="Age on this RTU's Repl. Year (replacement year − install year)"
                >
                  <button
                    type="button"
                    className={styles.sortableTh}
                    onClick={() => toggleSort('age')}
                    title="Sort by age on Repl. Year"
                  >
                    <span className={styles.ageHeaderLabel}>
                      Age on Repl. Year{sortIndicator('age')}
                    </span>
                  </button>
                </th>
                <th className="num">Tons</th>
                <th className={styles.replYearTh}>
                  <button
                    type="button"
                    className={styles.sortableTh}
                    onClick={() => toggleSort('replacementYear')}
                    title="Sort by replacement year"
                  >
                    Repl. Year{sortIndicator('replacementYear')}
                  </button>
                  <select
                    className={styles.rcbYearFilter}
                    value={replacementYearFilter}
                    title="Show only RTUs assigned to this year, unassigned (None), or All"
                    onChange={(e) => onReplacementYearFilterChange(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <option value="">All</option>
                    <option value={RCB_REPL_YEAR_NONE}>None</option>
                    {yearOptions.map((y) => (
                      <option key={y} value={y}>
                        {y}
                      </option>
                    ))}
                  </select>
                </th>
                <th className="num">
                  <button
                    type="button"
                    className={styles.sortableTh}
                    onClick={() => toggleSort('cost')}
                    title="Sort by unit cost"
                  >
                    Unit cost{sortIndicator('cost')}
                  </button>
                </th>
                <th className={`num ${styles.rtuBudgetAllocTh}`}>
                  <button
                    type="button"
                    className={styles.sortableTh}
                    onClick={() => toggleSort('budget')}
                    title="Sort by RTU $ Allocation"
                  >
                    <span className={styles.rtuBudgetAllocLabel}>
                      RTU $ Allocation{sortIndicator('budget')}
                    </span>
                  </button>
                </th>
                <th className={styles.notesTh}>Notes</th>
              </tr>
            </thead>
            <tbody>
              {!displayedItems.length ? (
                <tr>
                  <td colSpan={13}>
                    <div className={styles.rcbEmpty}>
                      {yearFilterLabel
                        ? yearFilterLabel === 'None'
                          ? 'No unassigned RTUs in this building.'
                          : `No RTUs scheduled for ${yearFilterLabel}.`
                        : 'No eligible RTUs for this building.'}
                    </div>
                  </td>
                </tr>
              ) : (
                <>
                  {displayedItems.map((item) => {
                    const deferred =
                      Number(item.replacementYear) > Number(defaultReplacementYear)
                    const assigned =
                      replacementYearByRtu[rcbReplacementYearKey(item.address, item.rtu)] !=
                      null
                    const noteKey = rcbReplacementYearKey(item.address, item.rtu)
                    const rtuNote = notesByRtu[noteKey]?.trim() ?? ''
                    const potNoteForRtu =
                      potNotes[`${item.address}::${item.replacementYear}`]?.trim() ?? ''
                    const effectiveNote = rtuNote || potNoteForRtu
                    const hasNotes = Boolean(effectiveNote)
                    const rtuBudget = budgets[noteKey] ?? null
                    const yearPot = sumSharedBuildingYearPot(
                      pots,
                      shareAddresses,
                      item.replacementYear,
                    )
                    let yearAllocated = 0
                    for (const addr of shareAddresses) {
                      const prefix = `${addr}::`
                      for (const [key, amount] of Object.entries(budgets)) {
                        if (!key.startsWith(prefix) || !(typeof amount === 'number') || !(amount > 0)) {
                          continue
                        }
                        const rtu = key.slice(prefix.length)
                        const y = replacementYearByRtu[`${addr}::${rtu}`] ?? defaultReplacementYear
                        if (String(y) === String(item.replacementYear)) yearAllocated += amount
                      }
                    }
                    yearAllocated = Math.round(yearAllocated)
                    const yearLeft = remainingBuildingYearBudget(yearPot, yearAllocated)
                    return (
                      <tr
                        key={item.rtu}
                        className={deferred ? styles.deferredRtuRow : undefined}
                      >
                        <td>{item.rtu}</td>
                        <td>{item.model || '—'}</td>
                        <td>{item.serial || '—'}</td>
                        <td>{item.make || '—'}</td>
                        <td>{item.suite || '—'}</td>
                        <td className="num">{item.year ?? '—'}</td>
                        <td className="num">{ageTodayFromInstall(item.year) ?? '—'}</td>
                        <td className="num">{item.age ?? '—'}</td>
                        <td className="num">{formatRtuTons(item.tons)}</td>
                        <td className={styles.replYearTd}>
                          <select
                            className={`${styles.rcbYearSelect}${
                              assigned || deferred ? ` ${styles.rcbYearSelectAssigned}` : ''
                            }`}
                            value={
                              replacementYearByRtu[rcbReplacementYearKey(item.address, item.rtu)] ??
                              ''
                            }
                            disabled={!canEdit}
                            title={
                              !canEdit
                                ? 'Admin access is required to change replacement year.'
                                : assigned
                                  ? `Replacement year for ${item.rtu} — choose None to clear`
                                  : `No year assigned for ${item.rtu} — pick a year or leave None`
                            }
                            onChange={(e) =>
                              onReplacementYearChange(item.address, item.rtu, e.target.value)
                            }
                          >
                            <option value="">None</option>
                            {yearOptions.map((y) => (
                              <option key={y} value={y}>
                                {y}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="num">{rcbMoney(item.cost)}</td>
                        <td className={`num ${styles.budgetTd}`}>
                          <BudgetAmountInput
                            value={rtuBudget}
                            onCommit={(amount) =>
                              handleRtuBudgetCommit(
                                item.address,
                                item.rtu,
                                item.replacementYear,
                                amount,
                              )
                            }
                            title={
                              yearPot > 0
                                ? `Deducts from ${item.replacementYear} Capex pot (${rcbMoney(yearLeft)} left)`
                                : `RTU $ Allocation for ${item.rtu} (no Capex pot for ${item.replacementYear} yet)`
                            }
                            ariaLabel={`RTU $ Allocation for ${item.rtu}`}
                          />
                        </td>
                        <td className={styles.notesTd}>
                          <button
                            type="button"
                            className={`${styles.rtuNotesBtn}${hasNotes ? ` ${styles.rtuNotesBtnActive}` : ''}`}
                            title={
                              effectiveNote
                                ? effectiveNote
                                : hasNotes
                                  ? 'View or edit notes'
                                  : 'Add notes'
                            }
                            onClick={() =>
                              setNotesTarget({ address: item.address, rtu: item.rtu })
                            }
                          >
                            {hasNotes ? '📝 Notes' : '+ Notes'}
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                  <tr className={styles.rcbTotal}>
                    <td colSpan={10}>
                      {yearFilterLabel
                        ? `TOTAL — ${displayedItems.length} RTU (${yearFilterLabel})`
                        : `TOTAL — ${viewSummary.items.length} RTU`}
                    </td>
                    <td className="num">{rcbMoney(viewSummary.displayedCost)}</td>
                    <td className="num">
                      {displayedBudgetTotal > 0 ? rcbMoney(displayedBudgetTotal) : '—'}
                    </td>
                    <td />
                  </tr>
                </>
              )}
            </tbody>
          </table>
          </div>
        </div>

        <div className={styles.rcbTblwrap} style={{ maxWidth: 340 }}>
          <h4>By tonnage tier (scheduled)</h4>
          <div className={styles.rcbTblScroll}>
          <table className={styles.rcbTbl}>
            <thead>
              <tr>
                <th>Tier</th>
                <th className="num">Avg unit $</th>
                <th className="num">Qty</th>
                <th className="num">Extended</th>
              </tr>
            </thead>
            <tbody>
              {!tierRows.length ? (
                <tr>
                  <td colSpan={4}>
                    <div className={styles.rcbEmpty}>—</div>
                  </td>
                </tr>
              ) : (
                <>
                  {tierRows.map((tier) => (
                    <tr key={tier.tier}>
                      <td>{tier.label}</td>
                      <td className="num">{rcbMoney(tier.unit)}</td>
                      <td className="num">{tier.qty}</td>
                      <td className="num">{rcbMoney(tier.ext)}</td>
                    </tr>
                  ))}
                  <tr className={styles.rcbTotal}>
                    <td>TOTAL</td>
                    <td />
                    <td className="num">{displayedItems.length}</td>
                    <td className="num">{rcbMoney(viewSummary.displayedCost)}</td>
                  </tr>
                </>
              )}
            </tbody>
          </table>
          </div>
        </div>
      </div>

      {notesTarget ? (
        <RtuNotesModal
          open
          address={notesTarget.address}
          rtu={notesTarget.rtu}
          notes={notesModalText}
          onClose={() => setNotesTarget(null)}
          onSave={(text) => setNotes(notesTarget.address, notesTarget.rtu, text)}
        />
      ) : null}
    </div>
  )
}
