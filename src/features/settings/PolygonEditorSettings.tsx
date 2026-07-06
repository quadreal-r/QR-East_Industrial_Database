import { useMemo, useState } from 'react'
import { Modal } from '@/components/Modal/Modal'
import { SearchInput } from '@/components/SearchInput/SearchInput'
import { confirm } from '@/stores/confirmStore'
import {
  buildingForPolygon,
  polygonEditorLabel,
  polygonMatchesSearch,
  polygonOptionKey,
  resolvePolygonEditorSelection,
} from '@/lib/polygonBuildings'
import { showToastError, showToastSuccess } from '@/lib/toast'
import { useSelectionStore } from '@/stores/selectionStore'
import type { PortfolioData } from '@/types/domain'
import selectStyles from '@/components/Select/Select.module.css'
import styles from './SettingsModal.module.css'

export interface PolygonEditorSettingsProps {
  open: boolean
  onClose: () => void
  portfolio: PortfolioData
  onPortfolioPatch: (data: PortfolioData) => void
  initialSelectedKey: string
  viewingBuildingAddress: string | null
}

interface PolygonEditorFormProps {
  onClose: () => void
  portfolio: PortfolioData
  onPortfolioPatch: (data: PortfolioData) => void
  initialSelectedKey: string
  viewingBuildingAddress: string | null
}

function PolygonEditorForm({
  onClose,
  portfolio,
  onPortfolioPatch,
  initialSelectedKey,
  viewingBuildingAddress,
}: PolygonEditorFormProps) {
  const { buildings, polygons } = portfolio
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedKey, setSelectedKey] = useState(initialSelectedKey)

  const sortedPolygons = useMemo(
    () =>
      [...polygons].sort((a, b) =>
        polygonEditorLabel(a, buildingForPolygon(buildings, a)?.address ?? null).localeCompare(
          polygonEditorLabel(b, buildingForPolygon(buildings, b)?.address ?? null),
        ),
      ),
    [polygons, buildings],
  )

  const filteredPolygons = useMemo(() => {
    if (!searchQuery.trim()) return sortedPolygons
    return sortedPolygons.filter((polygon) => polygonMatchesSearch(polygon, buildings, searchQuery))
  }, [sortedPolygons, buildings, searchQuery])

  const visibleSelectedKey = filteredPolygons.some((polygon) => polygonOptionKey(polygon) === selectedKey)
    ? selectedKey
    : filteredPolygons[0]
      ? polygonOptionKey(filteredPolygons[0])
      : selectedKey

  const selectedPolygon =
    filteredPolygons.find((polygon) => polygonOptionKey(polygon) === visibleSelectedKey) ??
    sortedPolygons.find((polygon) => polygonOptionKey(polygon) === visibleSelectedKey)
  const assignedBuilding = selectedPolygon
    ? buildingForPolygon(buildings, selectedPolygon)?.address ?? null
    : null

  const showOnMap = () => {
    if (!selectedPolygon) {
      showToastError('Select a polygon first.')
      return
    }
    onClose()
    window.dispatchEvent(
      new CustomEvent('map:openPolygon', {
        detail: {
          name: selectedPolygon.name,
          description: selectedPolygon.description ?? '',
        },
      }),
    )
  }

  const editPoints = () => {
    if (!selectedPolygon) {
      showToastError('Select a polygon first.')
      return
    }
    onClose()
    window.dispatchEvent(
      new CustomEvent('map:editPolygon', {
        detail: {
          name: selectedPolygon.name,
          description: selectedPolygon.description ?? '',
        },
      }),
    )
  }

  const handleDelete = () => {
    if (!selectedPolygon) {
      showToastError('Select a polygon first.')
      return
    }
    const label = polygonEditorLabel(selectedPolygon, assignedBuilding)
    void confirm(`Delete tenant polygon "${label}"?`).then((ok) => {
      if (!ok || !selectedPolygon) return
      const key = polygonOptionKey(selectedPolygon)
      const nextPolygons = portfolio.polygons.filter((polygon) => polygonOptionKey(polygon) !== key)
      onPortfolioPatch({ ...portfolio, polygons: nextPolygons })
      const remaining = sortedPolygons.filter((polygon) => polygonOptionKey(polygon) !== key)
      setSelectedKey(
        resolvePolygonEditorSelection(remaining, buildings, {
          buildingAddress: viewingBuildingAddress,
        }),
      )
      showToastSuccess('✓ Polygon deleted — save to keep changes.')
    })
  }

  return (
    <div className={styles.body}>
      <p className={styles.mgrFieldLabel} style={{ textTransform: 'none', letterSpacing: 0, fontSize: 12 }}>
        Edit vertex points here or use Edit Multiple Positions to move polygons on the map.
      </p>

      <label className={styles.mgrFieldLabel} htmlFor="polygon-editor-search">
        Search by building address
      </label>
      <SearchInput
        id="polygon-editor-search"
        placeholder="Search address, suite, or tenant…"
        value={searchQuery}
        onValueChange={setSearchQuery}
      />

      <label className={styles.mgrFieldLabel} htmlFor="polygon-editor-select">
        Tenant polygon
      </label>
      <select
        id="polygon-editor-select"
        className={selectStyles.select}
        value={visibleSelectedKey}
        disabled={!filteredPolygons.length}
        onChange={(e) => setSelectedKey(e.target.value)}
      >
        {filteredPolygons.length ? (
          filteredPolygons.map((polygon) => {
            const key = polygonOptionKey(polygon)
            const buildingAddress = buildingForPolygon(buildings, polygon)?.address ?? null
            return (
              <option key={key} value={key}>
                {polygonEditorLabel(polygon, buildingAddress)}
              </option>
            )
          })
        ) : (
          <option value="">
            {searchQuery.trim() ? 'No polygons match your search' : 'No polygons on the map'}
          </option>
        )}
      </select>

      {viewingBuildingAddress && !searchQuery.trim() ? (
        <p className={styles.mgrFieldLabel} style={{ textTransform: 'none', letterSpacing: 0, fontSize: 11 }}>
          Viewing building: {viewingBuildingAddress}
        </p>
      ) : null}

      {selectedPolygon ? (
        <>
          {assignedBuilding ? (
            <p className={styles.mgrFieldLabel} style={{ textTransform: 'none', letterSpacing: 0, fontSize: 11 }}>
              Building: {assignedBuilding}
            </p>
          ) : null}
          {selectedPolygon.description ? (
            <p className={styles.mgrFieldLabel} style={{ textTransform: 'none', letterSpacing: 0, fontSize: 11 }}>
              {selectedPolygon.description.split('\n')[0]}
            </p>
          ) : null}
        </>
      ) : null}

      <div className={styles.tools} style={{ marginTop: 12 }}>
        <button
          type="button"
          className="btn-action"
          style={{ width: '100%', justifyContent: 'flex-start' }}
          disabled={!selectedPolygon}
          onClick={showOnMap}
        >
          Show on map
        </button>
        <button
          type="button"
          className="btn-action"
          style={{ width: '100%', justifyContent: 'flex-start' }}
          disabled={!selectedPolygon}
          onClick={editPoints}
        >
          ✏ Edit points
        </button>
        <button
          type="button"
          className="btn-action"
          style={{ width: '100%', justifyContent: 'flex-start', color: '#f87171' }}
          disabled={!selectedPolygon}
          onClick={handleDelete}
        >
          🗑 Delete polygon
        </button>
      </div>
    </div>
  )
}

export function PolygonEditorSettings({
  open,
  onClose,
  portfolio,
  onPortfolioPatch,
}: Omit<PolygonEditorSettingsProps, 'initialSelectedKey' | 'viewingBuildingAddress'>) {
  const { buildings, polygons } = portfolio

  const viewedPolygon = useSelectionStore((s) => s.viewedPolygon)
  const currentBuilding = useSelectionStore((s) => s.currentBuilding)

  const editorSessionKey = useMemo(() => {
    if (!open) return 'closed'
    return [
      viewedPolygon?.name ?? '',
      viewedPolygon?.description ?? '',
      currentBuilding?.address ?? '',
      polygons.length,
    ].join('|')
  }, [open, viewedPolygon, currentBuilding?.address, polygons.length])

  const initialSelectedKey = useMemo(
    () =>
      resolvePolygonEditorSelection(polygons, buildings, {
        viewedPolygon,
        buildingAddress: currentBuilding?.address ?? null,
      }),
    [polygons, buildings, viewedPolygon, currentBuilding?.address],
  )

  const viewingBuildingAddress = currentBuilding?.address ?? null

  return (
    <Modal open={open} onClose={onClose} title="Edit Polygons" width={420} align="center">
      {open ? (
        <PolygonEditorForm
          key={editorSessionKey}
          onClose={onClose}
          portfolio={portfolio}
          onPortfolioPatch={onPortfolioPatch}
          initialSelectedKey={initialSelectedKey}
          viewingBuildingAddress={viewingBuildingAddress}
        />
      ) : null}
    </Modal>
  )
}
