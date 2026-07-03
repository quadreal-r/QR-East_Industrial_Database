import { useMemo, useState } from 'react'
import { Modal } from '@/components/Modal/Modal'
import { confirm } from '@/stores/confirmStore'
import { buildingForPolygon } from '@/lib/polygonBuildings'
import { showToastError, showToastSuccess } from '@/lib/toast'
import type { Polygon, PortfolioData } from '@/types/domain'
import selectStyles from '@/components/Select/Select.module.css'
import styles from './SettingsModal.module.css'

export interface PolygonEditorSettingsProps {
  open: boolean
  onClose: () => void
  portfolio: PortfolioData
  onPortfolioPatch: (data: PortfolioData) => void
}

function polygonOptionKey(polygon: Polygon): string {
  return `${polygon.name}\0${polygon.description ?? ''}`
}

function polygonLabel(polygon: Polygon, buildingAddress: string | null): string {
  const name = polygon.name || 'Polygon'
  if (buildingAddress) return `${name} — ${buildingAddress}`
  if (polygon.description) return `${name} (${polygon.description.split('\n')[0]})`
  return name
}

export function PolygonEditorSettings({
  open,
  onClose,
  portfolio,
  onPortfolioPatch,
}: PolygonEditorSettingsProps) {
  const { buildings, polygons } = portfolio

  const sortedPolygons = useMemo(
    () =>
      [...polygons].sort((a, b) =>
        polygonLabel(a, buildingForPolygon(buildings, a)?.address ?? null).localeCompare(
          polygonLabel(b, buildingForPolygon(buildings, b)?.address ?? null),
        ),
      ),
    [polygons, buildings],
  )

  const [selectedKey, setSelectedKey] = useState(() =>
    sortedPolygons[0] ? polygonOptionKey(sortedPolygons[0]) : '',
  )

  const selectedPolygon = sortedPolygons.find((p) => polygonOptionKey(p) === selectedKey)
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
    const label = polygonLabel(selectedPolygon, assignedBuilding)
    void confirm(`Delete tenant polygon "${label}"?`).then((ok) => {
      if (!ok || !selectedPolygon) return
      const key = polygonOptionKey(selectedPolygon)
      const nextPolygons = portfolio.polygons.filter((p) => polygonOptionKey(p) !== key)
      onPortfolioPatch({ ...portfolio, polygons: nextPolygons })
      const remaining = sortedPolygons.filter((p) => polygonOptionKey(p) !== key)
      setSelectedKey(remaining[0] ? polygonOptionKey(remaining[0]) : '')
      showToastSuccess('✓ Polygon deleted — save to keep changes.')
    })
  }

  return (
    <Modal open={open} onClose={onClose} title="Edit Polygons" width={420} align="center">
      <div className={styles.body}>
        <p className={styles.mgrFieldLabel} style={{ textTransform: 'none', letterSpacing: 0, fontSize: 12 }}>
          Edit vertex points here or use Edit Multiple Positions to move polygons on the map.
        </p>

        <label className={styles.mgrFieldLabel} htmlFor="polygon-editor-select">
          Tenant polygon
        </label>
        <select
          id="polygon-editor-select"
          className={selectStyles.select}
          value={selectedKey}
          disabled={!sortedPolygons.length}
          onChange={(e) => setSelectedKey(e.target.value)}
        >
          {sortedPolygons.length ? (
            sortedPolygons.map((polygon) => {
              const key = polygonOptionKey(polygon)
              const buildingAddress = buildingForPolygon(buildings, polygon)?.address ?? null
              return (
                <option key={key} value={key}>
                  {polygonLabel(polygon, buildingAddress)}
                </option>
              )
            })
          ) : (
            <option value="">No polygons on the map</option>
          )}
        </select>

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
    </Modal>
  )
}
