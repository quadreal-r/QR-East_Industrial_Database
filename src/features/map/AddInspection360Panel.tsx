import { useCallback, useEffect, useRef, useState } from 'react'
import {
  addAppMarkerListener,
  createAppMarker,
  getAppMarkerPosition,
  setAppMarkerCursor,
  setAppMarkerMap,
  setAppMarkerPosition,
  setInspection360MarkerContent,
  type AppMapMarker,
} from '@/lib/appMapMarker'
import { INSPECTION360_MARKER_PX, LAYER_COLORS } from '@/lib/constants'
import { setMapAddMarkerPickHandler } from '@/lib/mapAddMarkerPick'
import { afterMapViewChange } from '@/lib/mapRotation'
import {
  entrancesForBuilding,
  polygonsWithoutEntrance,
} from '@/lib/suiteEntrances'
import { polygonOptionKey, polygonsForBuilding, buildPolygonBuildingIndex } from '@/lib/polygonBuildings'
import { facadeEntrancePosition } from '@/lib/polygonFacade'
import { showToastSuccess } from '@/lib/toast'
import { useUiStore } from '@/stores/uiStore'
import type { PortfolioData, SuiteEntrance } from '@/types/domain'
import styles from './AddMarkerPanel.module.css'

type AddPhase = 'config' | 'placing'

function ensureDetailMarkerZoom(map: google.maps.Map): void {
  if ((map.getZoom() ?? 10) < 16) {
    map.setZoom(16)
    afterMapViewChange(map)
  }
}

export interface AddInspection360PanelProps {
  open: boolean
  onClose: () => void
  portfolio: PortfolioData
  map: google.maps.Map | null
  onAdded: (patch: PortfolioData) => void
  defaultBuildingAddress?: string
}

interface AddInspection360FormProps {
  onClose: () => void
  portfolio: PortfolioData
  map: google.maps.Map | null
  onAdded: (patch: PortfolioData) => void
  defaultBuildingAddress?: string
}

function AddInspection360Form({
  onClose,
  portfolio,
  map,
  onAdded,
  defaultBuildingAddress,
}: AddInspection360FormProps) {
  const { buildings, polygons, suiteEntrances } = portfolio
  const [buildingAddress, setBuildingAddress] = useState(
    defaultBuildingAddress ?? buildings[0]?.address ?? '',
  )
  const building = buildings.find((b) => b.address === buildingAddress)
  const availablePolygons = building ? polygonsWithoutEntrance(building, polygons, suiteEntrances) : []
  const [polygonKey, setPolygonKey] = useState(
    availablePolygons[0] ? polygonOptionKey(availablePolygons[0]) : '',
  )
  const selectedPolygon = availablePolygons.find((polygon) => polygonOptionKey(polygon) === polygonKey)
  const [customName, setCustomName] = useState(selectedPolygon?.name ?? '')
  const [description, setDescription] = useState(selectedPolygon?.description ?? '')
  const [inspectionUrl, setInspectionUrl] = useState('')
  const [phase, setPhase] = useState<AddPhase>('config')
  const previewRef = useRef<AppMapMarker | null>(null)
  const cfg = LAYER_COLORS.inspection360
  const suiteName = selectedPolygon?.name ?? customName.trim()

  const cleanupPreview = useCallback(() => {
    const marker = previewRef.current
    if (marker) {
      setAppMarkerMap(marker, null)
      previewRef.current = null
    }
    useUiStore.getState().clearAddMarkerPlacement()
  }, [])

  const handleClose = useCallback(() => {
    cleanupPreview()
    onClose()
  }, [cleanupPreview, onClose])

  const saveEntrance = (lat: number, lng: number) => {
    if (!building?.id || !suiteName) return
    const entrance: SuiteEntrance = {
      building_id: building.id,
      polygon_id: selectedPolygon?.id ?? null,
      name: suiteName,
      description: description.trim() || selectedPolygon?.description || '',
      lat,
      lng,
      inspection_url: inspectionUrl.trim() || null,
      auto_placed: false,
    }
    onAdded({
      ...portfolio,
      suiteEntrances: [...portfolio.suiteEntrances, entrance],
    })
    cleanupPreview()
    showToastSuccess('✓ 360° gate added — save to keep changes.')
    onClose()
  }

  const beginPlacement = () => {
    if (!map || !building?.id || !suiteName) return
    ensureDetailMarkerZoom(map)
    cleanupPreview()

    const startPos = selectedPolygon
      ? facadeEntrancePosition(
          selectedPolygon,
          building,
          polygonsForBuilding(buildPolygonBuildingIndex(buildings, polygons), building.address),
        )
      : { lat: building.lat, lng: building.lng }

    const marker = createAppMarker({
      map,
      position: startPos,
      title: suiteName,
      zIndex: 30,
      draggable: true,
    })
    setInspection360MarkerContent(marker, {
      fillColor: cfg.fill,
      strokeColor: cfg.stroke,
      sizePx: INSPECTION360_MARKER_PX,
      label: { text: suiteName, color: cfg.fill, fontSize: '10px', fontWeight: '700' },
    })
    previewRef.current = marker
    setPhase('placing')
    setAppMarkerCursor(marker, 'grab')

    addAppMarkerListener(marker, 'dragend', () => {
      const pos = getAppMarkerPosition(marker)
      if (!pos) return
      saveEntrance(pos.lat(), pos.lng())
    })

    setMapAddMarkerPickHandler((lat, lng) => {
      setAppMarkerPosition(marker, lat, lng)
      saveEntrance(lat, lng)
    })
    useUiStore.getState().setAddMarkerPickMode(true)
  }

  const handleBuildingChange = (address: string) => {
    setBuildingAddress(address)
    const nextBuilding = buildings.find((b) => b.address === address)
    const nextPolygons = nextBuilding
      ? polygonsWithoutEntrance(nextBuilding, polygons, suiteEntrances)
      : []
    const first = nextPolygons[0]
    setPolygonKey(first ? polygonOptionKey(first) : '')
    setCustomName(first?.name ?? '')
    setDescription(first?.description ?? '')
  }

  const handlePolygonChange = (key: string) => {
    setPolygonKey(key)
    const polygon = availablePolygons.find((item) => polygonOptionKey(item) === key)
    if (polygon) {
      setCustomName(polygon.name)
      setDescription(polygon.description ?? '')
    }
  }

  const existingGateCount = building ? entrancesForBuilding(suiteEntrances, building).length : 0

  return (
    <div className={styles.form}>
      {phase === 'config' ? (
        <>
          <label>
            Building
            <select
              id="add-360-building"
              value={buildingAddress}
              onChange={(e) => handleBuildingChange(e.target.value)}
              style={{ width: '100%', marginTop: 4 }}
            >
              {buildings.map((b) => (
                <option key={b.address} value={b.address}>
                  {b.address}
                </option>
              ))}
            </select>
          </label>

          <label>
            Suite polygon
            <select
              id="add-360-suite"
              value={polygonKey}
              disabled={!availablePolygons.length}
              onChange={(e) => handlePolygonChange(e.target.value)}
              style={{ width: '100%', marginTop: 4 }}
            >
              {availablePolygons.length ? (
                availablePolygons.map((polygon) => (
                  <option key={polygonOptionKey(polygon)} value={polygonOptionKey(polygon)}>
                    {polygon.name}
                  </option>
                ))
              ) : (
                <option value="">All suites on this building already have gates</option>
              )}
            </select>
          </label>

          {selectedPolygon?.description ? (
            <p className={styles.placingHint}>
              Tenant: {selectedPolygon.description.split('\n')[0]}
            </p>
          ) : null}

          {!selectedPolygon ? (
            <label>
              Gate label
              <input
                id="add-360-name"
                type="text"
                value={customName}
                onChange={(e) => setCustomName(e.target.value)}
                placeholder="Suite # 1"
                style={{ width: '100%', marginTop: 4 }}
              />
            </label>
          ) : null}

          <label>
            Tenant / notes
            <input
              id="add-360-desc"
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Tenant name"
              style={{ width: '100%', marginTop: 4 }}
            />
          </label>

          <label>
            Tour URL
            <span style={{ fontWeight: 400, color: 'var(--text-muted, #a8c0e8)' }}>
              {' '}
              (optional)
            </span>
            <input
              id="add-360-url"
              type="url"
              value={inspectionUrl}
              onChange={(e) => setInspectionUrl(e.target.value)}
              placeholder="QR-360°-Inspections link"
              style={{ width: '100%', marginTop: 4 }}
            />
          </label>

          <p className={styles.placingHint}>
            {building
              ? `${existingGateCount} gate${existingGateCount === 1 ? '' : 's'} already on this building.`
              : 'Pick a building first.'}
          </p>
        </>
      ) : (
        <>
          <p className={styles.placingHint}>
            Drag the sky-blue sphere to the suite entrance, or click the map. The gate saves when you
            release or click.
          </p>
        </>
      )}

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        {phase === 'placing' ? (
          <button
            type="button"
            className="btn-action"
            onClick={() => {
              cleanupPreview()
              setPhase('config')
            }}
          >
            Back
          </button>
        ) : null}
        <button type="button" className="btn-action" onClick={handleClose}>
          Cancel
        </button>
        {phase === 'config' ? (
          <button
            type="button"
            className="btn-action primary"
            disabled={!building?.id || !suiteName || !availablePolygons.length}
            onClick={beginPlacement}
          >
            Place on map
          </button>
        ) : null}
      </div>
    </div>
  )
}

export function AddInspection360Panel({
  open,
  onClose,
  portfolio,
  map,
  onAdded,
  defaultBuildingAddress,
}: AddInspection360PanelProps) {
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
      data-add-inspection360-panel=""
      role="dialog"
      aria-modal="true"
      aria-label="Add 360° gate"
    >
      <header className={styles.header}>
        <h2 className={styles.title}>Add 360° gate</h2>
        <button type="button" className={styles.close} onClick={handleClose} aria-label="Close">
          ×
        </button>
      </header>
      <AddInspection360Form
        key={`${formSession}|${defaultBuildingAddress ?? ''}`}
        onClose={handleClose}
        portfolio={portfolio}
        map={map}
        onAdded={onAdded}
        defaultBuildingAddress={defaultBuildingAddress}
      />
    </div>
  )
}
