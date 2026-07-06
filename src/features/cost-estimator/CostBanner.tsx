import { useMemo, useState } from 'react'
import {
  RCB_DEFAULT_BASIS,
  RCB_DEFAULT_THRESHOLD,
  RCB_DEFAULT_YEAR,
  RCB_YEARS,
} from '@/lib/constants'
import {
  rcbCompute,
  rcbLineItemsForBuilding,
  rcbLineItemsWithReplacementYears,
  rcbMoney,
  rcbProjection,
  rcbSanitizeReplacementYearAssignments,
  rcbScheduleYearOptions,
  type RcbBuildingSummary,
  type RcbScheduledLineItem,
} from '@/lib/costEstimator'
import { exportRcbExcel } from '@/lib/excel'
import { exportRcbPdf } from '@/lib/rcbPdf'
import { formatFilterScope } from '@/lib/format'
import { useFilterStore } from '@/stores/filterStore'
import { useRtuPricingStore } from '@/stores/rtuPricingStore'
import { useRtuScheduleStore } from '@/stores/rtuScheduleStore'
import type { Building, CostBasis } from '@/types/domain'
import { RcbBuildingDetail } from './RcbBuildingDetail'
import styles from './CostBanner.module.css'

export interface CostBannerProps {
  buildings: Building[]
}

type SortKey = keyof RcbBuildingSummary

const THR_MIN = 0
const THR_MAX = 60

export function CostBanner({ buildings }: CostBannerProps) {
  const [threshold, setThreshold] = useState(RCB_DEFAULT_THRESHOLD)
  const [basis, setBasis] = useState<CostBasis>(RCB_DEFAULT_BASIS)
  const [year, setYear] = useState(RCB_DEFAULT_YEAR)
  const [detailOpen, setDetailOpen] = useState(false)
  const [selectedBuildingAddress, setSelectedBuildingAddress] = useState<string | null>(null)
  const [buildingYearFilter, setBuildingYearFilter] = useState('')
  const [sort, setSort] = useState<{ key: SortKey; dir: -1 | 1 }>({ key: 'cost', dir: -1 })

  const replacementYearByRtu = useRtuScheduleStore((s) => s.replacementYears)
  const setRtuReplacementYear = useRtuScheduleStore((s) => s.setReplacementYear)

  const search = useFilterStore((s) => s.search)
  const park = useFilterStore((s) => s.park)
  const cluster = useFilterStore((s) => s.cluster)
  const manager = useFilterStore((s) => s.manager)

  const scopeLabel = formatFilterScope({ search, park, cluster, manager })

  const pricingTable = useRtuPricingStore((s) => s.pricingTable)
  const pricingRevision = useRtuPricingStore((s) => s.revision)

  const result = useMemo(() => {
    void pricingRevision
    return rcbCompute(buildings, {
      basis,
      year,
      threshold,
      scope: scopeLabel,
      pricingTable,
    })
  }, [buildings, basis, year, threshold, scopeLabel, pricingTable, pricingRevision])

  const yearOptions = useMemo(
    () => rcbScheduleYearOptions(basis, year, replacementYearByRtu),
    [basis, year, replacementYearByRtu],
  )

  const sanitizedReplacementYearByRtu = useMemo(
    () => rcbSanitizeReplacementYearAssignments(replacementYearByRtu, yearOptions, year),
    [replacementYearByRtu, yearOptions, year],
  )

  const handleSetRtuReplacementYear = (address: string, rtu: string, replacementYear: string) => {
    setRtuReplacementYear(address, rtu, replacementYear, year)
  }

  const projection = useMemo(() => {
    void pricingRevision
    return rcbProjection(result, pricingTable)
  }, [result, pricingTable, pricingRevision])

  const sortedBuildings = useMemo(() => {
    const rows = [...result.perBldg]
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
  }, [result.perBldg, sort])

  const selectedBuilding = useMemo(
    () => sortedBuildings.find((row) => row.address === selectedBuildingAddress) ?? null,
    [sortedBuildings, selectedBuildingAddress],
  )

  const buildingView = useMemo(() => {
    void pricingRevision
    if (!selectedBuilding) return null

    const base = rcbLineItemsForBuilding(result, selectedBuilding.address)
    const items = rcbLineItemsWithReplacementYears(
      base,
      result.basis,
      year,
      sanitizedReplacementYearByRtu,
      pricingTable,
    )
    const displayed = buildingYearFilter
      ? items.filter((item) => item.replacementYear === buildingYearFilter)
      : items

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
      remainingCost: buildingYearFilter ? totalCost - displayedCost : 0,
      remainingUnits: buildingYearFilter ? items.length - displayed.length : 0,
      yearLabel: buildingYearFilter || 'All scheduled years',
      basisLabel,
    }
  }, [
    selectedBuilding,
    result,
    year,
    sanitizedReplacementYearByRtu,
    pricingTable,
    pricingRevision,
    buildingYearFilter,
  ])

  const bannerKpis = useMemo(() => {
    if (buildingView) {
      return {
        buildings: 1,
        units: buildingView.displayed.length,
        avg: buildingView.avgUnitCost,
        total: buildingView.displayedCost,
        yearLabel: buildingYearFilter || year,
        scope: `${selectedBuilding!.address}${buildingYearFilter ? ` · FY ${buildingYearFilter}` : ''}`,
      }
    }
    return {
      buildings: result.totals.bldgCount,
      units: result.totals.units,
      avg: result.totals.units ? result.totals.cost / result.totals.units : 0,
      total: result.totals.cost,
      yearLabel: result.year,
      scope: scopeLabel,
    }
  }, [buildingView, buildingYearFilter, year, result, scopeLabel, selectedBuilding])

  const openBuildingDetail = (address: string) => {
    setBuildingYearFilter('')
    setSelectedBuildingAddress(address)
    setDetailOpen(true)
  }

  const closeBuildingDetail = () => {
    setSelectedBuildingAddress(null)
    setBuildingYearFilter('')
  }

  const toggleDetail = () => {
    setDetailOpen((open) => {
      if (open) {
        setSelectedBuildingAddress(null)
        setBuildingYearFilter('')
      }
      return !open
    })
  }

  const handleBasisChange = (next: CostBasis) => {
    setBasis(next)
    const years = RCB_YEARS[next] ?? ['2026']
    setYear(years[0]!)
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
    let foot = `Budgetary estimate only — not a quote. Replacement year ${result.year}. All-in installed cost per the RTU Pricing sheet (${basisLbl}), matched by cooling tonnage rounded up to the nearest supplied tier (2–50 ton). Includes only units ${result.threshold}+ years old by install date.`
    if (result.basis === 'hyb') {
      foot += ' Hybrid Lennox figures escalate ~5%/yr (2026 base) per the pricing sheet.'
    }
    if (result.totals.excludedOld > 0) {
      foot += ` ${result.totals.excludedOld} aged unit(s) excluded for having no rated cooling tonnage (e.g. heating-only / make-up air).`
    }
    return foot
  }, [result])

  const toggleSort = (key: SortKey) => {
    setSort((prev) =>
      prev.key === key
        ? { key, dir: (prev.dir * -1) as -1 | 1 }
        : { key, dir: key === 'address' || key === 'cluster' || key === 'manager' ? 1 : -1 },
    )
  }

  return (
    <div
      id="rcb-banner"
      className={`${styles.banner}${detailOpen ? ` ${styles.bannerOpen}` : ''}${
        selectedBuilding ? ` ${styles.bannerBuildingDetail}` : ''
      }`}
    >
      <div id="rcb-bar" className={styles.bar}>
        <div className={styles.rcbTitle}>
          <span className={styles.rcbTitleT1}>RTU replacement cost</span>
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
              ) : (
                <span id="rcb-k-thr">≥{result.threshold}</span>
              )}{' '}
              {!buildingView && 'yr'}
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
        </div>
        <div className={styles.rcbControls}>
          <label className={styles.rcbCtl}>
            Age ≥
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
                  aria-label="Increase age threshold"
                >
                  ▲
                </button>
                <button
                  type="button"
                  className={styles.ageStepBtn}
                  onClick={() => bumpThreshold(-1)}
                  disabled={threshold <= THR_MIN}
                  aria-label="Decrease age threshold"
                >
                  ▼
                </button>
              </span>
            </span>{' '}
            yr
          </label>
          <label className={styles.rcbCtl}>
            Basis
            <select id="rcb-basis" value={basis} onChange={(e) => handleBasisChange(e.target.value as CostBasis)}>
              <option value="hyb">Hybrid Lennox</option>
              <option value="std">Standard / Xion</option>
            </select>
          </label>
          <label className={styles.rcbCtl}>
            Repl. year
            <select
              id="rcb-year"
              value={year}
              disabled={yearOptions.length <= 1}
              onChange={(e) => setYear(e.target.value)}
            >
              {yearOptions.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className={`${styles.rcbBtn} ${styles.rcbBtnXls}`}
            onClick={() =>
              exportRcbExcel(result, scopeLabel, {
                replacementYearByRtu: sanitizedReplacementYearByRtu,
                pricingTable,
              })
            }
            title="Export this estimate to Excel"
          >
            Excel
          </button>
          <button
            type="button"
            className={`${styles.rcbBtn} ${styles.rcbBtnPdf}`}
            onClick={() =>
              exportRcbPdf(result, scopeLabel, {
                replacementYearByRtu: sanitizedReplacementYearByRtu,
                pricingTable,
              })
            }
            title="Export this estimate to PDF"
          >
            PDF
          </button>
          <button
            type="button"
            className={styles.rcbBtn}
            onClick={toggleDetail}
            title="Show / hide line-item breakdown"
          >
            Detail
            <svg className={styles.rcbChev} width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
        </div>
      </div>

      <div id="rcb-detail" className={styles.detail}>
        {selectedBuilding && buildingView ? (
          <RcbBuildingDetail
            building={selectedBuilding}
            result={result}
            defaultReplacementYear={year}
            replacementYearByRtu={sanitizedReplacementYearByRtu}
            replacementYearFilter={buildingYearFilter}
            onReplacementYearFilterChange={setBuildingYearFilter}
            viewSummary={buildingView}
            onReplacementYearChange={handleSetRtuReplacementYear}
            onBack={closeBuildingDetail}
          />
        ) : selectedBuilding ? null : (
          <div className={styles.rcbDetailGrid}>
          <div className={styles.rcbTblwrap}>
            <h4>By building</h4>
            <table className={styles.rcbTbl} id="rcb-tbl-bldg">
              <thead>
                <tr>
                  <th onClick={() => toggleSort('address')}>Address</th>
                  <th onClick={() => toggleSort('cluster')}>Cluster</th>
                  <th onClick={() => toggleSort('manager')}>Manager</th>
                  <th className="num" onClick={() => toggleSort('units')}>
                    RTUs
                  </th>
                  <th className="num" onClick={() => toggleSort('cost')}>
                    Cost
                  </th>
                </tr>
              </thead>
              <tbody>
                {!sortedBuildings.length ? (
                  <tr>
                    <td colSpan={5}>
                      <div className={styles.rcbEmpty}>
                        No RTUs ≥ {result.threshold} years in the current selection.
                      </div>
                    </td>
                  </tr>
                ) : (
                  <>
                    {sortedBuildings.map((r) => (
                      <tr
                        key={r.address}
                        className={styles.clickableRow}
                        onClick={() => openBuildingDetail(r.address)}
                        title="View RTU breakdown for this building"
                      >
                        <td>{r.address}</td>
                        <td>{r.cluster}</td>
                        <td>{r.manager}</td>
                        <td className="num">{r.units}</td>
                        <td className="num">{rcbMoney(r.cost)}</td>
                      </tr>
                    ))}
                    <tr className={styles.rcbTotal}>
                      <td>TOTAL — {result.totals.bldgCount} bldg</td>
                      <td />
                      <td />
                      <td className="num">{result.totals.units}</td>
                      <td className="num">{rcbMoney(result.totals.cost)}</td>
                    </tr>
                  </>
                )}
              </tbody>
            </table>
          </div>

          <div className={styles.rcbTblwrap} style={{ maxWidth: 340 }}>
            <h4>By tonnage tier ({result.year})</h4>
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
                {!Object.keys(result.tiers).length ? (
                  <tr>
                    <td colSpan={4}>
                      <div className={styles.rcbEmpty}>—</div>
                    </td>
                  </tr>
                ) : (
                  <>
                    {Object.keys(result.tiers)
                      .map(Number)
                      .sort((a, b) => a - b)
                      .map((kk) => {
                        const t = result.tiers[String(kk)]!
                        return (
                          <tr key={kk}>
                            <td>{t.label}</td>
                            <td className="num">{rcbMoney(t.unit)}</td>
                            <td className="num">{t.qty}</td>
                            <td className="num">{rcbMoney(t.ext)}</td>
                          </tr>
                        )
                      })}
                    <tr className={styles.rcbTotal}>
                      <td>TOTAL</td>
                      <td />
                      <td className="num">{result.totals.units}</td>
                      <td className="num">{rcbMoney(result.totals.cost)}</td>
                    </tr>
                  </>
                )}
              </tbody>
            </table>
          </div>

          <div className={styles.rcbTblwrap} style={{ maxWidth: 300 }}>
            <h4>Projection by year</h4>
            <table className={styles.rcbTbl} id="rcb-tbl-proj">
              <thead>
                <tr>
                  <th>Year</th>
                  <th className="num">Total</th>
                  <th className="num">vs {projection[0]?.year ?? ''}</th>
                </tr>
              </thead>
              <tbody>
                {!projection.length || !result.totals.units ? (
                  <tr>
                    <td colSpan={3}>
                      <div className={styles.rcbEmpty}>—</div>
                    </td>
                  </tr>
                ) : (
                  projection.map((p) => {
                    const delta = p.total - (projection[0]?.total ?? 0)
                    const dStr = delta === 0 ? '—' : `${delta > 0 ? '+' : ''}${rcbMoney(delta)}`
                    const selected = p.year === result.year
                    return (
                      <tr key={p.year} className={selected ? styles.selectedRow : undefined}>
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
        )}
        <div className={styles.rcbFoot} id="rcb-foot">
          {footnote}
        </div>
      </div>
    </div>
  )
}
