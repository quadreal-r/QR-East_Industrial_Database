import { useMemo, useState } from 'react'
import { Modal } from '@/components/Modal/Modal'
import { SearchInput } from '@/components/SearchInput/SearchInput'
import { confirm } from '@/stores/confirmStore'
import {
  buildingForEntrance,
  matchesSuiteEntrance,
  resolveSuiteEntranceEditorSelection,
  suiteEntranceEditorLabel,
  suiteEntranceMatchesSearch,
  suiteEntranceOptionKey,
} from '@/lib/suiteEntrances'
import { showToastError, showToastSuccess } from '@/lib/toast'
import { useSelectionStore } from '@/stores/selectionStore'
import type { PortfolioData, SuiteEntrance } from '@/types/domain'
import selectStyles from '@/components/Select/Select.module.css'
import styles from './SettingsModal.module.css'

export interface Inspection360EditorSettingsProps {
  open: boolean
  onClose: () => void
  portfolio: PortfolioData
  onPortfolioPatch: (data: PortfolioData) => void
  onOpenAddInspection360: () => void
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

interface Inspection360EditorFormProps {
  onClose: () => void
  portfolio: PortfolioData
  onPortfolioPatch: (data: PortfolioData) => void
  onOpenAddInspection360: () => void
  initialSelectedKey: string
}

function Inspection360EditorForm({
  onClose,
  portfolio,
  onPortfolioPatch,
  onOpenAddInspection360,
  initialSelectedKey,
}: Inspection360EditorFormProps) {
  const { buildings, suiteEntrances } = portfolio
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedKey, setSelectedKey] = useState(initialSelectedKey)

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

  const visibleSelectedKey = filteredEntrances.some(
    (entrance) =>
      suiteEntranceOptionKey(entrance, buildingForEntrance(buildings, entrance)?.address ?? null) ===
      selectedKey,
  )
    ? selectedKey
    : filteredEntrances[0]
      ? suiteEntranceOptionKey(
          filteredEntrances[0],
          buildingForEntrance(buildings, filteredEntrances[0])?.address ?? null,
        )
      : selectedKey

  const selectedEntrance =
    filteredEntrances.find(
      (entrance) =>
        suiteEntranceOptionKey(entrance, buildingForEntrance(buildings, entrance)?.address ?? null) ===
        visibleSelectedKey,
    ) ??
    sortedEntrances.find(
      (entrance) =>
        suiteEntranceOptionKey(entrance, buildingForEntrance(buildings, entrance)?.address ?? null) ===
        visibleSelectedKey,
    )

  const assignedBuilding = selectedEntrance
    ? buildingForEntrance(buildings, selectedEntrance)
    : undefined

  const [draftName, setDraftName] = useState(selectedEntrance?.name ?? '')
  const [draftDescription, setDraftDescription] = useState(selectedEntrance?.description ?? '')
  const [draftInspectionUrl, setDraftInspectionUrl] = useState(selectedEntrance?.inspection_url ?? '')

  const syncDraftFromSelection = (entrance: SuiteEntrance | undefined) => {
    setDraftName(entrance?.name ?? '')
    setDraftDescription(entrance?.description ?? '')
    setDraftInspectionUrl(entrance?.inspection_url ?? '')
  }

  const showOnMap = () => {
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
  }

  const handleApplyEdits = () => {
    if (!selectedEntrance) {
      showToastError('Select a 360° gate first.')
      return
    }
    const nextEntrances = updateEntrance(suiteEntrances, selectedEntrance, {
      name: draftName.trim() || selectedEntrance.name,
      description: draftDescription.trim(),
      inspection_url: draftInspectionUrl.trim() || null,
    })
    onPortfolioPatch({ ...portfolio, suiteEntrances: nextEntrances })
    showToastSuccess('✓ 360° gate updated — save to keep changes.')
  }

  const handleDelete = () => {
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
      setSelectedKey(
        resolveSuiteEntranceEditorSelection(remaining, buildings, {
          buildingAddress: assignedBuilding?.address ?? null,
        }),
      )
      syncDraftFromSelection(
        remaining.find(
          (entrance) =>
            suiteEntranceOptionKey(
              entrance,
              buildingForEntrance(buildings, entrance)?.address ?? null,
            ) ===
            resolveSuiteEntranceEditorSelection(remaining, buildings, {
              buildingAddress: assignedBuilding?.address ?? null,
            }),
        ),
      )
      showToastSuccess('✓ 360° gate deleted — save to keep changes.')
    })
  }

  return (
    <div className={styles.body}>
      <p
        className={styles.mgrFieldLabel}
        style={{ textTransform: 'none', letterSpacing: 0, fontSize: 12 }}
      >
        Sky-blue sphere markers at suite entrances. Use Show on map, then Move in the popup to
        reposition. Paste a Tour URL to open that suite’s QR-360° project from the map popup.
      </p>

      <label className={styles.mgrFieldLabel} htmlFor="inspection360-editor-search">
        Search
      </label>
      <SearchInput
        id="inspection360-editor-search"
        placeholder="Search address, suite, or tenant…"
        value={searchQuery}
        onValueChange={setSearchQuery}
      />

      <label className={styles.mgrFieldLabel} htmlFor="inspection360-editor-select">
        360° gate
      </label>
      <select
        id="inspection360-editor-select"
        className={selectStyles.select}
        value={visibleSelectedKey}
        disabled={!filteredEntrances.length}
        onChange={(e) => {
          setSelectedKey(e.target.value)
          const entrance = filteredEntrances.find(
            (item) =>
              suiteEntranceOptionKey(
                item,
                buildingForEntrance(buildings, item)?.address ?? null,
              ) === e.target.value,
          )
          syncDraftFromSelection(entrance)
        }}
      >
        {filteredEntrances.length ? (
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
          <option value="">
            {searchQuery.trim() ? 'No gates match your search' : 'No 360° gates yet'}
          </option>
        )}
      </select>

      {selectedEntrance ? (
        <>
          <label className={styles.mgrFieldLabel} htmlFor="inspection360-name">
            Suite label
          </label>
          <input
            id="inspection360-name"
            type="text"
            className={styles.mgrInput}
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
          />

          <label className={styles.mgrFieldLabel} htmlFor="inspection360-desc">
            Tenant / notes
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
            placeholder="https://…/project.insp360 or insp360/projects/suite-7.insp360"
          />
        </>
      ) : null}

      <div className={styles.tools} style={{ marginTop: 12 }}>
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
        <button
          type="button"
          className="btn-action"
          style={{ width: '100%', justifyContent: 'flex-start' }}
          disabled={!selectedEntrance}
          onClick={showOnMap}
        >
          Show on map
        </button>
        <button
          type="button"
          className="btn-action"
          style={{ width: '100%', justifyContent: 'flex-start' }}
          disabled={!selectedEntrance}
          onClick={handleApplyEdits}
        >
          ✎ Save edits
        </button>
        <button
          type="button"
          className="btn-action"
          style={{ width: '100%', justifyContent: 'flex-start', color: '#f87171' }}
          disabled={!selectedEntrance}
          onClick={handleDelete}
        >
          🗑 Delete gate
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
  onOpenAddInspection360,
}: Inspection360EditorSettingsProps) {
  const { buildings, suiteEntrances } = portfolio
  const currentBuilding = useSelectionStore((s) => s.currentBuilding)

  const editorSessionKey = useMemo(() => {
    if (!open) return 'closed'
    return [currentBuilding?.address ?? '', suiteEntrances.length].join('|')
  }, [open, currentBuilding?.address, suiteEntrances.length])

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
          onOpenAddInspection360={onOpenAddInspection360}
          initialSelectedKey={initialSelectedKey}
        />
      ) : null}
    </Modal>
  )
}
