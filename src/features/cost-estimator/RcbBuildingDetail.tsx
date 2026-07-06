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
import { useRtuScheduleStore } from '@/stores/rtuScheduleStore'
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
  result: RcbComputeResult
  defaultReplacementYear: string
  replacementYearByRtu: Record<string, string>
  replacementYearFilter: string
  onReplacementYearFilterChange: (year: string) => void
  viewSummary: BuildingViewSummary
  onReplacementYearChange: (address: string, rtu: string, year: string) => void
  onBack: () => void
}

type RtuSortKey = 'rtu' | 'replacementYear' | 'installed' | 'age' | 'tons' | 'cost'

function compareRtuRows(a: RcbScheduledLineItem, b: RcbScheduledLineItem, key: RtuSortKey): number {
  switch (key) {
    case 'rtu':
      return a.rtu.localeCompare(b.rtu)
    case 'replacementYear':
      return Number(a.replacementYear) - Number(b.replacementYear)
    case 'installed':
      return (a.year ?? 0) - (b.year ?? 0)
    case 'age':
      return (a.age ?? 0) - (b.age ?? 0)
    case 'tons':
      return (a.tons ?? 0) - (b.tons ?? 0)
    case 'cost':
      return a.cost - b.cost
    default:
      return 0
  }
}

export function RcbBuildingDetail({
  building,
  result,
  defaultReplacementYear,
  replacementYearByRtu,
  replacementYearFilter,
  onReplacementYearFilterChange,
  viewSummary,
  onReplacementYearChange,
  onBack,
}: RcbBuildingDetailProps) {
  const [notesTarget, setNotesTarget] = useState<{ address: string; rtu: string } | null>(null)
  const [sort, setSort] = useState<{ key: RtuSortKey; dir: -1 | 1 }>({
    key: 'rtu',
    dir: 1,
  })

  const yearOptions = rcbScheduleYearOptions(
    result.basis,
    defaultReplacementYear,
    replacementYearByRtu,
  )
  const notesByRtu = useRtuScheduleStore((s) => s.notes)
  const setNotes = useRtuScheduleStore((s) => s.setNotes)
  const getNotes = useRtuScheduleStore((s) => s.getNotes)

  const displayedItems = useMemo(() => {
    const { key, dir } = sort
    return [...viewSummary.displayed].sort((a, b) => compareRtuRows(a, b, key) * dir)
  }, [viewSummary.displayed, sort])

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
            {replacementYearFilter
              ? ` · ${displayedItems.length} of ${viewSummary.items.length} RTUs in ${replacementYearFilter}`
              : ''}
          </p>
        </div>
        <div className={styles.buildingDetailKpis}>
          <span>
            <strong>{displayedItems.length}</strong> RTU{displayedItems.length === 1 ? '' : 's'}
          </span>
          <span className={styles.buildingDetailCost}>
            <strong>{rcbMoney(viewSummary.displayedCost)}</strong>
          </span>
        </div>
      </div>

      <div className={styles.rcbDetailGrid}>
        <div className={styles.rcbTblwrap}>
          <h4>Eligible RTUs — assign replacement year</h4>
          <table className={styles.rcbTbl}>
            <thead>
              <tr>
                <th>RTU</th>
                <th>Model</th>
                <th>Serial</th>
                <th>Make</th>
                <th>Suite</th>
                <th className="num">Installed</th>
                <th className="num">Age</th>
                <th className="num">Tons</th>
                <th className={styles.replYearTh}>
                  <button
                    type="button"
                    className={styles.sortableTh}
                    onClick={() => toggleSort('replacementYear')}
                    title="Sort by replacement year"
                  >
                    Repl. year{sortIndicator('replacementYear')}
                  </button>
                  <select
                    className={styles.rcbYearFilter}
                    value={replacementYearFilter}
                    title="Show RTUs scheduled for a specific replacement year"
                    onChange={(e) => onReplacementYearFilterChange(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <option value="">All years</option>
                    {yearOptions.map((y) => (
                      <option key={y} value={y}>
                        {y}
                      </option>
                    ))}
                  </select>
                </th>
                <th className="num">Unit cost</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {!displayedItems.length ? (
                <tr>
                  <td colSpan={11}>
                    <div className={styles.rcbEmpty}>
                      {replacementYearFilter
                        ? `No RTUs scheduled for ${replacementYearFilter}.`
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
                    const hasNotes = Boolean(notesByRtu[noteKey]?.trim())
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
                        <td className="num">{item.age ?? '—'}</td>
                        <td className="num">{formatRtuTons(item.tons)}</td>
                        <td className={styles.replYearTd}>
                          <select
                            className={`${styles.rcbYearSelect}${
                              assigned || deferred ? ` ${styles.rcbYearSelectAssigned}` : ''
                            }`}
                            value={item.replacementYear}
                            title={`Replacement year for ${item.rtu} (global default ${defaultReplacementYear})`}
                            onChange={(e) =>
                              onReplacementYearChange(item.address, item.rtu, e.target.value)
                            }
                          >
                            {yearOptions.map((y) => (
                              <option key={y} value={y}>
                                {y}
                                {y === defaultReplacementYear ? ' (default)' : ''}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="num">{rcbMoney(item.cost)}</td>
                        <td>
                          <button
                            type="button"
                            className={`${styles.rtuNotesBtn}${hasNotes ? ` ${styles.rtuNotesBtnActive}` : ''}`}
                            title={hasNotes ? 'View or edit notes' : 'Add notes'}
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
                    <td colSpan={9}>
                      {replacementYearFilter
                        ? `TOTAL — ${displayedItems.length} RTU (${replacementYearFilter})`
                        : `TOTAL — ${viewSummary.items.length} RTU`}
                    </td>
                    <td />
                    <td className="num">{rcbMoney(viewSummary.displayedCost)}</td>
                    <td />
                  </tr>
                </>
              )}
            </tbody>
          </table>
        </div>

        <div className={styles.rcbTblwrap} style={{ maxWidth: 340 }}>
          <h4>By tonnage tier (scheduled)</h4>
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

      {notesTarget ? (
        <RtuNotesModal
          open
          address={notesTarget.address}
          rtu={notesTarget.rtu}
          notes={getNotes(notesTarget.address, notesTarget.rtu)}
          onClose={() => setNotesTarget(null)}
          onSave={(text) => setNotes(notesTarget.address, notesTarget.rtu, text)}
        />
      ) : null}
    </div>
  )
}
