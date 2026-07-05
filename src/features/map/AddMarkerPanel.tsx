import { useCallback, useEffect, useRef, useState } from 'react'
import {
  addAppMarkerListener,
  createAppMarker,
  getAppMarkerPosition,
  setAppMarkerCursor,
  setAppMarkerIcon,
  setAppMarkerMap,
  setAppMarkerPosition,
  type AppMapMarker,
} from '@/lib/appMapMarker'
import {
  getDetailMarkerIcon,
  getMarkerScale,
  getMarkerShapeIndex,
  MARKER_SHAPES,
} from '@/lib/markerStyles'
import { LAYER_COLORS } from '@/lib/constants'
import { setMapAddMarkerPickHandler } from '@/lib/mapAddMarkerPick'
import { afterMapViewChange } from '@/lib/mapRotation'
import { findNearestBuildingByDistance } from '@/lib/polygonBuildings'
import { showToastSuccess } from '@/lib/toast'
import { useLayerStore } from '@/stores/layerStore'
import { useUiStore } from '@/stores/uiStore'
import type { LayerKey, PortfolioData, Rtu, Utility } from '@/types/domain'
import styles from './AddMarkerPanel.module.css'

type MarkerCategory = 'rtu' | 'sprinkler' | 'electrical' | 'hydrant' | 'gas'
type AddMarkerPhase = 'config' | 'awaitMapClick' | 'placing'

const CATEGORY_OPTIONS: { value: MarkerCategory; label: string }[] = [
  { value: 'rtu', label: 'RTU' },
  { value: 'sprinkler', label: 'Sprinkler Room' },
  { value: 'electrical', label: 'Electrical Room' },
  { value: 'hydrant', label: 'Fire Hydrant' },
  { value: 'gas', label: 'Gas Shut-Off' },
]

const DEFAULT_NAMES: Record<MarkerCategory, string> = {
  rtu: 'RTU-NEW',
  sprinkler: 'Sprinkler Room',
  electrical: 'Electrical Room',
  hydrant: 'Fire Hydrant',
  gas: 'Gas Meter',
}

const LAYER_TO_UTILITY: Partial<Record<LayerKey, Utility['utility_type']>> = {
  sprinkler: 'Sprinkler Rooms',
  electrical: 'Electrical Rooms',
  hydrant: 'Fire Hydrants',
  gas: 'Natural Gas Shut-Off',
}

/** RTU/utility markers only show at zoom >= 16 — bump zoom without panning. */
function ensureDetailMarkerZoom(map: google.maps.Map): void {
  if ((map.getZoom() ?? 10) < 16) {
    map.setZoom(16)
    afterMapViewChange(map)
  }
}

export interface AddMarkerPanelProps {
  open: boolean
  onClose: () => void
  portfolio: PortfolioData
  map: google.maps.Map | null
  onAdded: (patch: PortfolioData) => void
  defaultBuildingAddress?: string
}

interface AddMarkerFormProps {
  onClose: () => void
  portfolio: PortfolioData
  map: google.maps.Map | null
  onAdded: (patch: PortfolioData) => void
  defaultBuildingAddress?: string
}

function AddMarkerForm({
  onClose,
  portfolio,
  map,
  onAdded,
  defaultBuildingAddress,
}: AddMarkerFormProps) {
  const [category, setCategory] = useState<MarkerCategory>('rtu')
  const [buildingAddress, setBuildingAddress] = useState(
    defaultBuildingAddress ?? portfolio.buildings[0]?.address ?? '',
  )
  const [name, setName] = useState(DEFAULT_NAMES.rtu)
  const [description, setDescription] = useState('')
  const [phase, setPhase] = useState<AddMarkerPhase>('config')
  const [position, setPosition] = useState<{ lat: number; lng: number } | null>(null)
  const [shapeIdx, setShapeIdx] = useState(getMarkerShapeIndex())
  const [scale, setScale] = useState(getMarkerScale())
  const [error, setError] = useState<string | null>(null)
  const [buildingAutoNote, setBuildingAutoNote] = useState<string | null>(null)
  const previewMarkerRef = useRef<AppMapMarker | null>(null)
  const dragListenerRef = useRef<google.maps.MapsEventListener | null>(null)

  const needsBuilding = category === 'rtu'
  const layerKey: LayerKey = category === 'rtu' ? 'rtu' : category
  const layerCfg = LAYER_COLORS[layerKey]

  const removePreviewMarker = useCallback(() => {
    dragListenerRef.current?.remove()
    dragListenerRef.current = null
    if (previewMarkerRef.current) setAppMarkerMap(previewMarkerRef.current, null)
    previewMarkerRef.current = null
  }, [])

  const resetFlow = useCallback(() => {
    setPhase('config')
    setPosition(null)
    removePreviewMarker()
    useUiStore.getState().clearAddMarkerPlacement()
  }, [removePreviewMarker])

  const handleCancel = () => {
    resetFlow()
    onClose()
  }

  const assignNearestBuildingForPin = useCallback(
    (lat: number, lng: number) => {
      if (category !== 'rtu') return
      const nearest = findNearestBuildingByDistance(portfolio.buildings, lat, lng)
      if (!nearest) return
      if (nearest.building.address !== buildingAddress) {
        setBuildingAddress(nearest.building.address)
        setBuildingAutoNote(
          `Building set to ${nearest.building.address} (nearest to pin, ${Math.round(nearest.feet)} ft).`,
        )
      }
    },
    [buildingAddress, category, portfolio.buildings],
  )

  const onMapClickPlace = useCallback(
    (lat: number, lng: number) => {
      if (phase !== 'awaitMapClick') return
      setError(null)
      setBuildingAutoNote(null)
      const coords = { lat, lng }
      setPosition(coords)
      assignNearestBuildingForPin(lat, lng)
      setPhase('placing')
      if (map) {
        ensureDetailMarkerZoom(map)
      }
    },
    [assignNearestBuildingForPin, map, phase],
  )

  const registerMapClickHandler = useCallback(() => {
    setMapAddMarkerPickHandler(onMapClickPlace)
  }, [onMapClickPlace])

  useEffect(() => {
    const active = phase === 'awaitMapClick' || phase === 'placing'
    useUiStore.getState().setAddMarkerPickMode(active)
  }, [phase])

  useEffect(() => {
    if (phase !== 'awaitMapClick') {
      if (phase === 'config') {
        setMapAddMarkerPickHandler(null)
      }
      return
    }
    registerMapClickHandler()
    return () => setMapAddMarkerPickHandler(null)
  }, [phase, registerMapClickHandler])

  useEffect(() => {
    if (!map) return
    map.setOptions({ draggableCursor: phase === 'awaitMapClick' ? 'crosshair' : '' })
    return () => {
      map.setOptions({ draggableCursor: '' })
    }
  }, [map, phase])

  useEffect(() => {
    if (phase !== 'placing' || !map || !position) {
      removePreviewMarker()
      return
    }

    if (!previewMarkerRef.current) {
      previewMarkerRef.current = createAppMarker({
        map,
        position,
        draggable: true,
        zIndex: 1000,
      })
      setAppMarkerCursor(previewMarkerRef.current, 'grab')
      dragListenerRef.current = addAppMarkerListener(previewMarkerRef.current, 'dragend', () => {
        const pos = getAppMarkerPosition(previewMarkerRef.current!)
        if (!pos) return
        const lat = pos.lat()
        const lng = pos.lng()
        setPosition({ lat, lng })
        assignNearestBuildingForPin(lat, lng)
      })
    } else {
      setAppMarkerPosition(previewMarkerRef.current, position.lat, position.lng)
      setAppMarkerMap(previewMarkerRef.current, map)
    }
  }, [assignNearestBuildingForPin, map, phase, position, removePreviewMarker])

  useEffect(() => {
    if (!previewMarkerRef.current || phase !== 'placing') return
    setAppMarkerIcon(
      previewMarkerRef.current,
      getDetailMarkerIcon(layerCfg.fill, layerCfg.stroke, {
        shapeIndex: shapeIdx,
        scale,
        defaultScale: layerCfg.scale,
      }),
    )
  }, [phase, layerCfg, shapeIdx, scale])

  useEffect(
    () => () => {
      removePreviewMarker()
      useUiStore.getState().clearAddMarkerPlacement()
    },
    [removePreviewMarker],
  )

  const handleCategoryChange = (next: MarkerCategory) => {
    setCategory(next)
    setName(DEFAULT_NAMES[next])
    if (next === 'rtu' && !buildingAddress) {
      setBuildingAddress(defaultBuildingAddress ?? portfolio.buildings[0]?.address ?? '')
    }
  }

  const startPlacing = () => {
    setError(null)
    if (!name.trim()) {
      setError('Please enter a name.')
      return
    }
    if (!map) {
      setError('Map is not ready.')
      return
    }
    if (category === 'rtu') {
      const building = portfolio.buildings.find((b) => b.address === buildingAddress)
      if (!building) {
        setError('Building not found.')
        return
      }
    }

    useLayerStore.getState().setLayer(layerKey, true)
    setPhase('awaitMapClick')
    registerMapClickHandler()
  }

  const handleSave = () => {
    void (async () => {
    setError(null)
    if (!position) return
    if (!name.trim()) {
      setError('Please enter a name.')
      return
    }

    const marker = {
      name: name.trim(),
      description: description.trim(),
      lat: position.lat,
      lng: position.lng,
      marker_shape: shapeIdx,
      marker_scale: scale,
    }

    if (category === 'rtu') {
      const building = portfolio.buildings.find((b) => b.address === buildingAddress)
      if (!building) {
        setError('Building not found.')
        return
      }
      onAdded({
        ...portfolio,
        buildings: portfolio.buildings.map((b) =>
          b.address === building.address ? { ...b, rtus: [...(b.rtus ?? []), marker as Rtu] } : b,
        ),
      })
    } else {
      const utilityType = LAYER_TO_UTILITY[category]
      if (!utilityType) return
      const utility: Utility = {
        id: Date.now(),
        utility_type: utilityType,
        name: name.trim(),
        description: description.trim(),
        lat: position.lat,
        lng: position.lng,
        marker_shape: shapeIdx,
        marker_scale: scale,
      }
      onAdded({ ...portfolio, utilities: [...portfolio.utilities, utility] })
    }

    if (map) {
      ensureDetailMarkerZoom(map)
    }

    resetFlow()
    showToastSuccess('✓ Marker added — save to HTML to keep it.')
    onClose()
    })()
  }

  const handlePrimary = () => {
    if (phase === 'placing') handleSave()
    else if (phase === 'config') startPlacing()
  }

  const fieldsLocked = phase !== 'config'
  const buildingSelectDisabled = phase === 'awaitMapClick'

  return (
    <div className={styles.form}>
      <label>
        Category
        <select
          value={category}
          disabled={fieldsLocked}
          onChange={(e) => handleCategoryChange(e.target.value as MarkerCategory)}
          style={{ width: '100%', marginTop: 4 }}
        >
          {CATEGORY_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </label>
      {needsBuilding ? (
        <label>
          Building
          <select
            value={buildingAddress}
            disabled={buildingSelectDisabled}
            onChange={(e) => {
              setBuildingAddress(e.target.value)
              setBuildingAutoNote(null)
            }}
            style={{ width: '100%', marginTop: 4 }}
          >
            {portfolio.buildings.map((b) => (
              <option key={b.address} value={b.address}>{b.address}</option>
            ))}
          </select>
        </label>
      ) : null}
      <label>
        Name
        <input
          type="text"
          value={name}
          disabled={fieldsLocked}
          onChange={(e) => setName(e.target.value)}
          style={{ width: '100%', marginTop: 4 }}
        />
      </label>
      <label>
        Description
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          style={{ width: '100%', marginTop: 4, resize: 'vertical' }}
        />
      </label>

      {phase === 'awaitMapClick' ? (
        <p className={styles.placingHint}>
          Click the map to place the marker. For RTUs, the nearest building is selected automatically.
        </p>
      ) : null}
      {buildingAutoNote ? <p className={styles.placingHint}>{buildingAutoNote}</p> : null}
      {phase === 'placing' ? (
        <p className={styles.placingHint}>
          Drag the marker to fine-tune its position. Adjust shape, size, or description, then Save.
        </p>
      ) : null}

      <div>
        <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 4, textTransform: 'uppercase' }}>
          Marker shape
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
          {MARKER_SHAPES.map((s, i) => (
            <button
              key={s.label}
              type="button"
              onClick={() => setShapeIdx(i)}
              style={{
                padding: '4px 9px',
                borderRadius: 5,
                fontSize: 11,
                cursor: 'pointer',
                border: `2px solid ${i === shapeIdx ? 'var(--accent)' : 'var(--border)'}`,
                background: i === shapeIdx ? 'rgba(125,184,255,.12)' : 'var(--surface)',
                color: 'var(--text-primary)',
              }}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>
      <label>
        Size ({scale})
        <input
          type="range"
          min={4}
          max={20}
          value={scale}
          onChange={(e) => setScale(Number(e.target.value))}
          style={{ width: '100%' }}
        />
      </label>
      {error ? <p className={styles.error}>{error}</p> : null}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button type="button" className="btn-action" onClick={handleCancel}>Cancel</button>
        <button
          type="button"
          className="btn-action primary"
          onClick={handlePrimary}
          disabled={!map || phase === 'awaitMapClick'}
        >
          {phase === 'placing' ? 'Save' : 'Add marker'}
        </button>
      </div>
    </div>
  )
}

export function AddMarkerPanel({
  open,
  onClose,
  portfolio,
  map,
  onAdded,
  defaultBuildingAddress,
}: AddMarkerPanelProps) {
  const [formSession, setFormSession] = useState(0)
  const wasOpenRef = useRef(false)

  const handleClose = useCallback(() => {
    useUiStore.getState().clearAddMarkerPlacement()
    onClose()
  }, [onClose])

  useEffect(() => {
    if (open && !wasOpenRef.current) {
      setFormSession((n) => n + 1)
    }
    wasOpenRef.current = open
    if (!open) {
      useUiStore.getState().clearAddMarkerPlacement()
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') handleClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, handleClose])

  if (!open) return null

  return (
    <div
      className={styles.panel}
      data-add-marker-panel=""
      role="dialog"
      aria-modal="true"
      aria-label="Add map marker"
    >
      <header className={styles.header}>
        <h2 className={styles.title}>Add map marker</h2>
        <button type="button" className={styles.close} onClick={handleClose} aria-label="Close">
          ×
        </button>
      </header>
      <AddMarkerForm
        key={formSession}
        onClose={handleClose}
        portfolio={portfolio}
        map={map}
        onAdded={onAdded}
        defaultBuildingAddress={defaultBuildingAddress}
      />
    </div>
  )
}
