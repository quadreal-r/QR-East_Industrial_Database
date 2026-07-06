import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { showToastSuccess } from '@/lib/toast'
import {
  DEFAULT_POLYGON_COLOR,
  polygonColorLabel,
  polygonColorOptions,
} from '@/lib/constants'
import { usePolygonDraw } from '@/features/polygons/usePolygonDraw'
import { usePolygonBuildingSnap } from '@/features/polygons/usePolygonBuildingSnap'
import { useUiStore } from '@/stores/uiStore'
import type { Polygon } from '@/types/domain'
import styles from './PolygonDrawPanel.module.css'

export interface PolygonDrawPanelProps {
  open: boolean
  onClose: () => void
  map: google.maps.Map | null
  polygons?: Polygon[]
  onSaved: (polygon: Polygon) => void
}

type DrawPhase = 'config' | 'drawing'
type DrawMode = 'manual' | 'snap'

export function PolygonDrawPanel({ open, onClose, map, polygons = [], onSaved }: PolygonDrawPanelProps) {
  const [phase, setPhase] = useState<DrawPhase>('config')
  const [drawMode, setDrawMode] = useState<DrawMode>('manual')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [color, setColor] = useState(DEFAULT_POLYGON_COLOR)
  const [status, setStatus] = useState('')
  const [snapLoading, setSnapLoading] = useState(false)
  const wasOpenRef = useRef(false)

  const colorOptions = useMemo(() => polygonColorOptions(polygons), [polygons])

  const { points, startDrawing, stopDrawing, reset, applyPoints, getCurrentPoints, shapeEditActive } =
    usePolygonDraw({
      map,
      color,
    })

  const resetPanel = useCallback(() => {
    setPhase('config')
    setDrawMode('manual')
    setStatus('')
    setSnapLoading(false)
    reset()
    useUiStore.getState().setPolygonDrawMode(false)
  }, [reset])

  const handleClose = useCallback(() => {
    resetPanel()
    onClose()
  }, [onClose, resetPanel])

  useEffect(() => {
    if (open && !wasOpenRef.current) {
      setName('')
      setDescription('')
      setColor(DEFAULT_POLYGON_COLOR)
      setDrawMode('manual')
      setPhase('config')
      setStatus('')
      setSnapLoading(false)
      reset()
    }
    wasOpenRef.current = open
    if (!open) {
      useUiStore.getState().setPolygonDrawMode(false)
    }
  }, [open, reset])

  useEffect(() => {
    useUiStore.getState().setPolygonDrawMode(phase === 'drawing')
  }, [phase])

  useEffect(() => {
    if (!map) return
    const cursor = phase === 'drawing' && !shapeEditActive ? 'crosshair' : ''
    map.setOptions({ draggableCursor: cursor })
    return () => {
      map.setOptions({ draggableCursor: '' })
    }
  }, [map, phase, shapeEditActive])

  useEffect(
    () => () => {
      reset()
      useUiStore.getState().setPolygonDrawMode(false)
    },
    [reset],
  )

  usePolygonBuildingSnap({
    map,
    active: open && phase === 'drawing' && drawMode === 'snap' && !shapeEditActive && points.length < 3,
    onFootprint: applyPoints,
    onStatus: setStatus,
    onLoadingChange: setSnapLoading,
  })

  if (!open) return null

  const handleSave = () => {
    const currentPoints = getCurrentPoints()
    if (currentPoints.length < 3) {
      setStatus('Add at least 3 points on the map.')
      return
    }
    const polygon: Polygon = {
      name: name.trim() || 'Polygon',
      description: description.trim(),
      color,
      paths: currentPoints,
    }
    onSaved(polygon)
    showToastSuccess('✓ Polygon added — save to HTML to keep it.')
    resetPanel()
    onClose()
  }

  const handlePrimary = () => {
    if (phase === 'config') {
      if (!map) {
        setStatus('Map is not ready.')
        return
      }
      if (drawMode === 'manual') {
        setStatus('Click the map to place each corner point.')
        startDrawing()
      } else {
        stopDrawing()
        setStatus('Drag a box around the building on the map.')
      }
      setPhase('drawing')
      return
    }
    handleSave()
  }

  const statusText =
    status ||
    (phase === 'drawing'
      ? drawMode === 'snap'
        ? points.length >= 3
          ? shapeEditActive
            ? 'Drag the shape to move it, or drag corner dots to adjust. Click a corner, then press Delete to remove it.'
            : `${points.length} corners snapped — click Save when ready.`
          : 'Drag a box around the building footprint.'
        : points.length === 0
          ? 'Click the map to place the first point.'
          : points.length < 3
            ? `${points.length} point${points.length === 1 ? '' : 's'} — click a point to select it, Delete to remove. Need ${3 - points.length} more.`
            : 'Drag the shape to move it, or drag corner dots to adjust. Click a corner, then press Delete to remove it.'
      : '')

  const primaryLabel =
    phase === 'drawing'
      ? 'Save'
      : drawMode === 'snap'
        ? 'Drag around building'
        : 'Click map to add points'

  return (
    <div className={styles.panel} data-polygon-draw-panel="">
      <div className={styles.title}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <polygon points="3,18 9,4 15,14 20,8 21,18" />
        </svg>
        Add New Polygon
      </div>

      <div className={styles.fields}>
        <input
          type="text"
          placeholder="Polygon name (e.g. Lot A)"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <textarea
          rows={2}
          placeholder="Description (optional)"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <div className={styles.colorRow}>
          <label>Colour</label>
          <div className={styles.colorSwatches} role="group" aria-label="Polygon colour">
            {colorOptions.map((option) => {
              const selected = option.toLowerCase() === color.toLowerCase()
              return (
                <button
                  key={option}
                  type="button"
                  className={selected ? styles.colorSwatchActive : styles.colorSwatch}
                  style={{ backgroundColor: option }}
                  title={polygonColorLabel(option)}
                  aria-label={polygonColorLabel(option)}
                  aria-pressed={selected}
                  onClick={() => setColor(option)}
                />
              )
            })}
          </div>
        </div>
        {phase === 'config' ? (
          <div className={styles.modeRow}>
            <span className={styles.modeLabel}>Draw method</span>
            <div className={styles.modeToggle} role="group" aria-label="Polygon draw method">
              <button
                type="button"
                className={drawMode === 'manual' ? styles.modeActive : undefined}
                onClick={() => setDrawMode('manual')}
              >
                Click points
              </button>
              <button
                type="button"
                className={drawMode === 'snap' ? styles.modeActive : undefined}
                onClick={() => setDrawMode('snap')}
              >
                Snap to building
              </button>
            </div>
            <p className={styles.modeHint}>
              {drawMode === 'snap'
                ? 'Drag a box around a building and the outline is filled in automatically.'
                : 'Click each corner of the area you want to outline.'}
            </p>
          </div>
        ) : null}
      </div>

      {statusText ? <div className={styles.status}>{statusText}</div> : null}

      <div className={styles.actions}>
        <button type="button" className="btn-action" onClick={handleClose} disabled={snapLoading}>
          Cancel
        </button>
        <button
          type="button"
          className={`btn-action ${phase === 'drawing' ? styles.saveBtn : styles.drawBtn}`}
          onClick={handlePrimary}
          disabled={!map || snapLoading || (phase === 'drawing' && points.length < 3)}
        >
          {primaryLabel}
        </button>
      </div>
    </div>
  )
}
