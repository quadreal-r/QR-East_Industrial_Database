import { useMemo, useState } from 'react'
import { Modal } from '@/components/Modal/Modal'
import { SearchInput } from '@/components/SearchInput/SearchInput'
import { confirm } from '@/stores/confirmStore'
import { matchesUtility } from '@/lib/dragSelection'
import {
  getInsp360GateHook,
  insp360ProjectDisplayName,
  resolveInsp360TourLabel,
} from '@/lib/insp360GateHooks'
import { insp360RemoveTourConfirmMessage } from '@/lib/insp360GateTours'
import { unlinkInsp360GateTour } from '@/lib/insp360GateProjectStore'
import { closeAllMapPopups } from '@/lib/mapPopups'
import { buildInspection360GateKey } from '@/lib/insp360Viewer'
import {
  buildingForEntrance,
  matchesSuiteEntrance,
  resolveSuiteEntranceEditorSelection,
  suiteEntranceEditorLabel,
  suiteEntranceMatchesSearch,
  suiteEntranceOptionKey,
} from '@/lib/suiteEntrances'
import { errorMessage } from '@/lib/errorMessage'
import { showToastError, showToastSuccess } from '@/lib/toast'
import { useSelectionStore } from '@/stores/selectionStore'
import { useUiStore } from '@/stores/uiStore'
import type { LayerKey, PortfolioData, SuiteEntrance, Utility, UtilityType } from '@/types/domain'
import selectStyles from '@/components/Select/Select.module.css'
import styles from './SettingsModal.module.css'

export interface Inspection360EditorSettingsProps {
  open: boolean
  onClose: () => void
  portfolio: PortfolioData
  onPortfolioPatch: (data: PortfolioData) => void
  onPersistPortfolio: (data: PortfolioData) => Promise<void>
  onOpenAddInspection360: () => void
}

type GateKind = 'suite' | 'electrical' | 'sprinkler'

const GATE_KIND_OPTIONS: Array<{ value: GateKind; label: string; hint: string }> = [
  {
    value: 'suite',
    label: 'Suite entrances (sky blue)',
    hint: 'Sky-blue spheres at tenant suite entrances.',
  },
  {
    value: 'electrical',
    label: 'Electrical rooms (green)',
    hint: 'Green spheres for electrical room 360° gates. Add rooms with Add marker first.',
  },
  {
    value: 'sprinkler',
    label: 'Sprinkler rooms (yellow)',
    hint: 'Yellow spheres for sprinkler room 360° gates. Add rooms with Add marker first.',
  },
]

const UTILITY_TYPE_BY_KIND: Record<'electrical' | 'sprinkler', UtilityType> = {
  electrical: 'Electrical Rooms',
  sprinkler: 'Sprinkler Rooms',
}

const LAYER_BY_KIND: Record<'electrical' | 'sprinkler', LayerKey> = {
  electrical: 'electrical',
  sprinkler: 'sprinkler',
}

function updateEntrance(
  entrances: SuiteEntrance[],
  target: SuiteEntrance,
  updates: Partial<SuiteEntrance>,
): SuiteEntrance[] {
  return entrances.map((entrance) =>
    matchesSuiteEntrance(entrance, target) ? { ...entrance, ...updates } : entrance,
  )
}

function utilityOptionKey(utility: Utility): string {
  return `${utility.utility_type}\0${utility.name}\0${utility.description}`
}

function utilityEditorLabel(utility: Utility): string {
  const note = utility.description?.trim()
  return note ? `${utility.name} — ${note}` : utility.name
}

function utilityMatchesSearch(utility: Utility, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return (
    utility.name.toLowerCase().includes(q) ||
    utility.description.toLowerCase().includes(q) ||
    (utility.inspection_url ?? '').toLowerCase().includes(q)
  )
}

interface Inspection360EditorFormProps {
  onClose: () => void
  portfolio: PortfolioData
  onPortfolioPatch: (data: PortfolioData) => void
  onPersistPortfolio: (data: PortfolioData) => Promise<void>
  onOpenAddInspection360: () => void
  initialSelectedKey: string
}

function Inspection360EditorForm({
  onClose,
  portfolio,
  onPortfolioPatch,
  onPersistPortfolio,
  onOpenAddInspection360,
  initialSelectedKey,
}: Inspection360EditorFormProps) {
  const { buildings, suiteEntrances, utilities } = portfolio
  const [gateKind, setGateKind] = useState<GateKind>('suite')
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedKey, setSelectedKey] = useState(initialSelectedKey)
  const [saving, setSaving] = useState(false)

  const sortedEntrances = useMemo(
    () =>
      [...suiteEntrances].sort((a, b) =>
        suiteEntranceEditorLabel(a, buildingForEntrance(buildings, a)?.address ?? null).localeCompare(
          suiteEntranceEditorLabel(b, buildingForEntrance(buildings, b)?.address ?? null),
        ),
      ),
    [suiteEntrances, buildings],
  )

  const filteredEntrances = useMemo(() => {
    if (!searchQuery.trim()) return sortedEntrances
    return sortedEntrances.filter((entrance) =>
      suiteEntranceMatchesSearch(entrance, buildings, searchQuery),
    )
  }, [sortedEntrances, buildings, searchQuery])

  const utilityType = gateKind === 'suite' ? null : UTILITY_TYPE_BY_KIND[gateKind]

  const sortedUtilities = useMemo(() => {
    if (!utilityType) return [] as Utility[]
    return [...utilities]
      .filter((u) => u.utility_type === utilityType)
      .sort((a, b) => utilityEditorLabel(a).localeCompare(utilityEditorLabel(b)))
  }, [utilities, utilityType])

  const filteredUtilities = useMemo(() => {
    if (!searchQuery.trim()) return sortedUtilities
    return sortedUtilities.filter((u) => utilityMatchesSearch(u, searchQuery))
  }, [sortedUtilities, searchQuery])

  const selectedEntrance =
    gateKind === 'suite'
      ? (filteredEntrances.find(
          (entrance) =>
            suiteEntranceOptionKey(
              entrance,
              buildingForEntrance(buildings, entrance)?.address ?? null,
            ) === selectedKey,
        ) ??
        sortedEntrances.find(
          (entrance) =>
            suiteEntranceOptionKey(
              entrance,
              buildingForEntrance(buildings, entrance)?.address ?? null,
            ) === selectedKey,
        ) ??
        filteredEntrances[0] ??
        sortedEntrances[0])
      : undefined

  const selectedUtility =
    gateKind !== 'suite'
      ? (filteredUtilities.find((u) => utilityOptionKey(u) === selectedKey) ??
        sortedUtilities.find((u) => utilityOptionKey(u) === selectedKey) ??
        filteredUtilities[0] ??
        sortedUtilities[0])
      : undefined

  const assignedBuilding = selectedEntrance
    ? buildingForEntrance(buildings, selectedEntrance)
    : undefined

  const visibleSelectedKey =
    gateKind === 'suite'
      ? selectedEntrance
        ? suiteEntranceOptionKey(
            selectedEntrance,
            buildingForEntrance(buildings, selectedEntrance)?.address ?? null,
          )
        : ''
      : selectedUtility
        ? utilityOptionKey(selectedUtility)
        : ''

  const [draftName, setDraftName] = useState(
    selectedEntrance?.name ?? selectedUtility?.name ?? '',
  )
  const [draftDescription, setDraftDescription] = useState(
    selectedEntrance?.description ?? selectedUtility?.description ?? '',
  )
  const [draftInspectionUrl, setDraftInspectionUrl] = useState(
    selectedEntrance?.inspection_url ?? selectedUtility?.inspection_url ?? '',
  )
  const [tourLinkTick, setTourLinkTick] = useState(0)

  const selectedGateKey = useMemo(() => {
    if (gateKind === 'suite' && selectedEntrance) {
      return buildInspection360GateKey(
        'suite',
        selectedEntrance,
        selectedEntrance.building_id ?? assignedBuilding?.id,
      )
    }
    if ((gateKind === 'electrical' || gateKind === 'sprinkler') && selectedUtility) {
      return buildInspection360GateKey(gateKind, selectedUtility)
    }
    return null
  }, [assignedBuilding?.id, gateKind, selectedEntrance, selectedUtility])

  const linkedLocalTour = useMemo(() => {
    void tourLinkTick
    if (!selectedGateKey) return null
    const hook = getInsp360GateHook(selectedGateKey)
    if (hook?.hosted === true && hook.name) {
      return insp360ProjectDisplayName(hook.name) || hook.name
    }
    return null
  }, [selectedGateKey, tourLinkTick])

  const tourStatusLabel = useMemo(() => {
    void tourLinkTick
    const inspectionUrl =
      selectedEntrance?.inspection_url ?? selectedUtility?.inspection_url ?? null
    return resolveInsp360TourLabel(selectedGateKey, inspectionUrl)
  }, [selectedEntrance?.inspection_url, selectedGateKey, selectedUtility?.inspection_url, tourLinkTick])

  const syncDraftFromSuite = (entrance: SuiteEntrance | undefined) => {
    setDraftName(entrance?.name ?? '')
    setDraftDescription(entrance?.description ?? '')
    setDraftInspectionUrl(entrance?.inspection_url ?? '')
  }

  const syncDraftFromUtility = (utility: Utility | undefined) => {
    setDraftName(utility?.name ?? '')
    setDraftDescription(utility?.description ?? '')
    setDraftInspectionUrl(utility?.inspection_url ?? '')
  }

  const handleGateKindChange = (next: GateKind) => {
    setGateKind(next)
    setSearchQuery('')
    if (next === 'suite') {
      const first = sortedEntrances[0]
      const key = first
        ? suiteEntranceOptionKey(first, buildingForEntrance(buildings, first)?.address ?? null)
        : ''
      setSelectedKey(key)
      syncDraftFromSuite(first)
      return
    }
    const type = UTILITY_TYPE_BY_KIND[next]
    const first = utilities
      .filter((u) => u.utility_type === type)
      .sort((a, b) => utilityEditorLabel(a).localeCompare(utilityEditorLabel(b)))[0]
    setSelectedKey(first ? utilityOptionKey(first) : '')
    syncDraftFromUtility(first)
  }

  const kindMeta = GATE_KIND_OPTIONS.find((o) => o.value === gateKind)!

  const showOnMap = () => {
    if (gateKind === 'suite') {
      if (!selectedEntrance || !assignedBuilding) {
        showToastError('Select a 360° gate first.')
        return
      }
      onClose()
      window.dispatchEvent(
        new CustomEvent('map:openDetail', {
          detail: {
            layerKey: 'inspection360',
            name: selectedEntrance.name,
            buildingAddress: assignedBuilding.address,
          },
        }),
      )
      return
    }
    if (!selectedUtility) {
      showToastError('Select a room gate first.')
      return
    }
    onClose()
    window.dispatchEvent(
      new CustomEvent('map:openDetail', {
        detail: {
          layerKey: LAYER_BY_KIND[gateKind],
          name: selectedUtility.name,
        },
      }),
    )
  }

  const handleApplyEdits = () => {
    if (saving) return

    let next: PortfolioData
    if (gateKind === 'suite') {
      if (!selectedEntrance) {
        showToastError('Select a 360° gate first.')
        return
      }
      next = {
        ...portfolio,
        suiteEntrances: updateEntrance(suiteEntrances, selectedEntrance, {
          name: draftName.trim() || selectedEntrance.name,
          description: draftDescription.trim(),
          inspection_url: draftInspectionUrl.trim() || null,
        }),
      }
    } else {
      if (!selectedUtility) {
        showToastError('Select a room gate first.')
        return
      }
      next = {
        ...portfolio,
        utilities: utilities.map((item) =>
          matchesUtility(item, selectedUtility)
            ? {
                ...item,
                name: draftName.trim() || selectedUtility.name,
                description: draftDescription.trim(),
                inspection_url: draftInspectionUrl.trim() || null,
              }
            : item,
        ),
      }
    }

    setSaving(true)
    void onPersistPortfolio(next)
      .then(() => {
        const gateKey = selectedGateKey
        const nextUrl = draftInspectionUrl.trim() || null
        if (gateKey) {
          const viewer = useUiStore.getState().inspection360Viewer
          if (viewer?.gateKey === gateKey) {
            useUiStore.getState().updateInspection360Viewer({ projectUrl: nextUrl })
          }
        }
        closeAllMapPopups()
        onClose()
      })
      .catch((error) => {
        showToastError(errorMessage(error, 'Could not save 360° gate'))
      })
      .finally(() => {
        setSaving(false)
      })
  }

  const handleDelete = () => {
    if (gateKind === 'suite') {
      if (!selectedEntrance) {
        showToastError('Select a 360° gate first.')
        return
      }
      const label = suiteEntranceEditorLabel(selectedEntrance, assignedBuilding?.address ?? null)
      void confirm(`Delete 360° gate "${label}"?`).then((ok) => {
        if (!ok || !selectedEntrance) return
        const nextEntrances = suiteEntrances.filter(
          (entrance) => !matchesSuiteEntrance(entrance, selectedEntrance),
        )
        onPortfolioPatch({ ...portfolio, suiteEntrances: nextEntrances })
        const remaining = sortedEntrances.filter(
          (entrance) => !matchesSuiteEntrance(entrance, selectedEntrance),
        )
        const nextKey = resolveSuiteEntranceEditorSelection(remaining, buildings, {
          buildingAddress: assignedBuilding?.address ?? null,
        })
        setSelectedKey(nextKey)
        syncDraftFromSuite(
          remaining.find(
            (entrance) =>
              suiteEntranceOptionKey(
                entrance,
                buildingForEntrance(buildings, entrance)?.address ?? null,
              ) === nextKey,
          ),
        )
        showToastSuccess('✓ 360° gate deleted — save to keep changes.')
      })
      return
    }
    if (!selectedUtility) {
      showToastError('Select a room gate first.')
      return
    }
    void confirm(`Delete "${utilityEditorLabel(selectedUtility)}"?`).then((ok) => {
      if (!ok || !selectedUtility) return
      const nextUtilities = utilities.filter((item) => !matchesUtility(item, selectedUtility))
      onPortfolioPatch({ ...portfolio, utilities: nextUtilities })
      const remaining = sortedUtilities.filter((item) => !matchesUtility(item, selectedUtility))
      const next = remaining[0]
      setSelectedKey(next ? utilityOptionKey(next) : '')
      syncDraftFromUtility(next)
      showToastSuccess('✓ Room gate deleted — save to keep changes.')
    })
  }

  const handleRemoveTourLink = () => {
    if (!selectedGateKey) {
      showToastError('Select a 360° gate first.')
      return
    }
    const hasLocal = Boolean(linkedLocalTour)
    const hasOnline = Boolean(draftInspectionUrl.trim() || tourStatusLabel.connected)
    if (!hasLocal && !hasOnline) {
      showToastError('This gate has no tour link to remove.')
      return
    }
    const label =
      linkedLocalTour ||
      tourStatusLabel.label ||
      draftInspectionUrl.trim() ||
      draftName.trim() ||
      null
    void confirm(insp360RemoveTourConfirmMessage(label), {
      confirmLabel: 'Remove link',
      cancelLabel: 'Keep linked',
    }).then(async (ok) => {
      if (!ok || !selectedGateKey) return
      setSaving(true)
      try {
        await unlinkInsp360GateTour(selectedGateKey)
        setTourLinkTick((n) => n + 1)
        setDraftInspectionUrl('')
        let next: PortfolioData = { ...portfolio }
        if (gateKind === 'suite' && selectedEntrance) {
          next = {
            ...portfolio,
            suiteEntrances: updateEntrance(suiteEntrances, selectedEntrance, {
              inspection_url: null,
            }),
          }
        } else if (selectedUtility) {
          next = {
            ...portfolio,
            utilities: utilities.map((item) =>
              matchesUtility(item, selectedUtility) ? { ...item, inspection_url: null } : item,
            ),
          }
        }
        await onPersistPortfolio(next)
        const viewer = useUiStore.getState().inspection360Viewer
        if (viewer?.gateKey === selectedGateKey) {
          useUiStore.getState().updateInspection360Viewer({ projectUrl: null })
        }
        closeAllMapPopups()
        showToastSuccess('✓ Tour link removed — gate shows Not connected yet.')
      } catch (error) {
        showToastError(errorMessage(error, 'Could not remove tour link'))
      } finally {
        setSaving(false)
      }
    })
  }

  const listEmptyLabel =
    gateKind === 'suite'
      ? searchQuery.trim()
        ? 'No gates match your search'
        : 'No suite 360° gates yet'
      : searchQuery.trim()
        ? 'No rooms match your search'
        : `No ${gateKind} rooms yet — add one with Add marker`

  return (
    <div className={styles.body}>
      <p
        className={styles.mgrFieldLabel}
        style={{ textTransform: 'none', letterSpacing: 0, fontSize: 12 }}
      >
        {kindMeta.hint} Create or Open a tour on this PC to link it locally (this browser only). Paste a
        Cloudflare Tour URL here for a shared online tour. Or open the tour and use{' '}
        <strong>Publish to Cloudflare &amp; link</strong> to upload. Remove tour link clears both local and
        cloud links (gate shows “Not connected yet”).
      </p>

      <label className={styles.mgrFieldLabel} htmlFor="inspection360-gate-kind">
        Gate type
      </label>
      <select
        id="inspection360-gate-kind"
        className={selectStyles.select}
        value={gateKind}
        onChange={(e) => handleGateKindChange(e.target.value as GateKind)}
      >
        {GATE_KIND_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>

      <label className={styles.mgrFieldLabel} htmlFor="inspection360-editor-search">
        Search
      </label>
      <SearchInput
        id="inspection360-editor-search"
        placeholder={
          gateKind === 'suite'
            ? 'Search address, suite, or tenant…'
            : 'Search room name or notes…'
        }
        value={searchQuery}
        onValueChange={setSearchQuery}
      />

      <label className={styles.mgrFieldLabel} htmlFor="inspection360-editor-select">
        {gateKind === 'suite' ? '360° gate' : 'Room'}
      </label>
      <select
        id="inspection360-editor-select"
        className={selectStyles.select}
        value={visibleSelectedKey}
        disabled={gateKind === 'suite' ? !filteredEntrances.length : !filteredUtilities.length}
        onChange={(e) => {
          setSelectedKey(e.target.value)
          if (gateKind === 'suite') {
            const entrance = filteredEntrances.find(
              (item) =>
                suiteEntranceOptionKey(
                  item,
                  buildingForEntrance(buildings, item)?.address ?? null,
                ) === e.target.value,
            )
            syncDraftFromSuite(entrance)
            return
          }
          syncDraftFromUtility(
            filteredUtilities.find((item) => utilityOptionKey(item) === e.target.value),
          )
        }}
      >
        {gateKind === 'suite' ? (
          filteredEntrances.length ? (
            filteredEntrances.map((entrance) => {
              const key = suiteEntranceOptionKey(
                entrance,
                buildingForEntrance(buildings, entrance)?.address ?? null,
              )
              return (
                <option key={key} value={key}>
                  {suiteEntranceEditorLabel(
                    entrance,
                    buildingForEntrance(buildings, entrance)?.address ?? null,
                  )}
                </option>
              )
            })
          ) : (
            <option value="">{listEmptyLabel}</option>
          )
        ) : filteredUtilities.length ? (
          filteredUtilities.map((utility) => {
            const key = utilityOptionKey(utility)
            return (
              <option key={key} value={key}>
                {utilityEditorLabel(utility)}
              </option>
            )
          })
        ) : (
          <option value="">{listEmptyLabel}</option>
        )}
      </select>

      {(gateKind === 'suite' ? selectedEntrance : selectedUtility) ? (
        <>
          <label className={styles.mgrFieldLabel} htmlFor="inspection360-name">
            {gateKind === 'suite' ? 'Suite label' : 'Room name'}
          </label>
          <input
            id="inspection360-name"
            type="text"
            className={styles.mgrInput}
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
          />

          <label className={styles.mgrFieldLabel} htmlFor="inspection360-desc">
            {gateKind === 'suite' ? 'Tenant / notes' : 'Notes'}
          </label>
          <input
            id="inspection360-desc"
            type="text"
            className={styles.mgrInput}
            value={draftDescription}
            onChange={(e) => setDraftDescription(e.target.value)}
          />

          <label className={styles.mgrFieldLabel} htmlFor="inspection360-url">
            Tour URL (optional)
          </label>
          <input
            id="inspection360-url"
            type="text"
            className={styles.mgrInput}
            value={draftInspectionUrl}
            onChange={(e) => setDraftInspectionUrl(e.target.value)}
            placeholder="https://…/tour.insp360 or building/suite-7.insp360"
          />

          <p
            className={styles.mgrFieldLabel}
            style={{ textTransform: 'none', letterSpacing: 0, fontSize: 12, marginTop: 10 }}
          >
            {linkedLocalTour
              ? `Linked local tour: ${linkedLocalTour}`
              : tourStatusLabel.connected
                ? `Connected via URL: ${tourStatusLabel.label}`
                : 'No local tour linked yet'}
          </p>
        </>
      ) : null}

      <div className={styles.tools} style={{ marginTop: 12 }}>
        {gateKind === 'suite' ? (
          <button
            type="button"
            className="btn-action"
            style={{ width: '100%', justifyContent: 'flex-start' }}
            onClick={() => {
              onClose()
              onOpenAddInspection360()
            }}
          >
            + Add 360° gate
          </button>
        ) : null}
        <button
          type="button"
          className="btn-action"
          style={{ width: '100%', justifyContent: 'flex-start' }}
          disabled={!(gateKind === 'suite' ? selectedEntrance : selectedUtility)}
          onClick={showOnMap}
        >
          Show on map
        </button>
        <button
          type="button"
          className="btn-action"
          style={{
            width: '100%',
            justifyContent: 'flex-start',
            color:
              linkedLocalTour || draftInspectionUrl.trim() || tourStatusLabel.connected
                ? '#fbbf24'
                : undefined,
          }}
          disabled={
            saving ||
            !selectedGateKey ||
            !(linkedLocalTour || draftInspectionUrl.trim() || tourStatusLabel.connected)
          }
          onClick={handleRemoveTourLink}
        >
          Remove tour link
        </button>
        <button
          type="button"
          className="btn-action"
          style={{ width: '100%', justifyContent: 'flex-start' }}
          disabled={saving || !(gateKind === 'suite' ? selectedEntrance : selectedUtility)}
          onClick={handleApplyEdits}
        >
          {saving ? 'Saving…' : '✎ Save edits'}
        </button>
        <button
          type="button"
          className="btn-action"
          style={{ width: '100%', justifyContent: 'flex-start', color: '#f87171' }}
          disabled={!(gateKind === 'suite' ? selectedEntrance : selectedUtility)}
          onClick={handleDelete}
        >
          🗑 Delete {gateKind === 'suite' ? 'gate' : 'room'}
        </button>
      </div>
    </div>
  )
}

export function Inspection360EditorSettings({
  open,
  onClose,
  portfolio,
  onPortfolioPatch,
  onPersistPortfolio,
  onOpenAddInspection360,
}: Inspection360EditorSettingsProps) {
  const { buildings, suiteEntrances } = portfolio
  const currentBuilding = useSelectionStore((s) => s.currentBuilding)

  const editorSessionKey = useMemo(() => {
    if (!open) return 'closed'
    return [currentBuilding?.address ?? '', suiteEntrances.length, portfolio.utilities.length].join(
      '|',
    )
  }, [open, currentBuilding?.address, suiteEntrances.length, portfolio.utilities.length])

  const initialSelectedKey = useMemo(
    () =>
      resolveSuiteEntranceEditorSelection(suiteEntrances, buildings, {
        buildingAddress: currentBuilding?.address ?? null,
      }),
    [suiteEntrances, buildings, currentBuilding?.address],
  )

  return (
    <Modal open={open} onClose={onClose} title="Edit 360° Gates" width={420} align="center">
      {open ? (
        <Inspection360EditorForm
          key={editorSessionKey}
          onClose={onClose}
          portfolio={portfolio}
          onPortfolioPatch={onPortfolioPatch}
          onPersistPortfolio={onPersistPortfolio}
          onOpenAddInspection360={onOpenAddInspection360}
          initialSelectedKey={initialSelectedKey}
        />
      ) : null}
    </Modal>
  )
}
