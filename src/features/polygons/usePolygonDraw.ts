import { useCallback, useEffect, useRef, useState } from 'react'
import {
  createAppMarker,
  setAppMarkerIcon,
  setAppMarkerMap,
  setAppMarkerPosition,
  type AppMapMarker,
} from '@/lib/appMapMarker'
import { bindPointListDelete, bindPolygonVertexDelete } from '@/lib/polygonVertexEdit'
import { showToastError } from '@/lib/toast'
import type { LatLng } from '@/types/domain'

export interface UsePolygonDrawOptions {
  map: google.maps.Map | null
  color: string
}

function pointMarkerIcon(color: string, selected = false): google.maps.Symbol {
  return {
    path: google.maps.SymbolPath.CIRCLE,
    scale: selected ? 8 : 6,
    fillColor: selected ? '#fbbf24' : color,
    fillOpacity: 1,
    strokeColor: selected ? '#ffffff' : '#ffffff',
    strokeWeight: selected ? 3 : 2,
  }
}

function readPathsFromPolygon(poly: google.maps.Polygon): LatLng[] {
  const path = poly.getPath()
  const paths: LatLng[] = []
  for (let i = 0; i < path.getLength(); i++) {
    const pt = path.getAt(i)
    paths.push({ lat: pt.lat(), lng: pt.lng() })
  }
  return paths
}

export function usePolygonDraw({ map, color }: UsePolygonDrawOptions) {
  const [points, setPoints] = useState<LatLng[]>([])
  const [isDrawing, setIsDrawing] = useState(false)
  const [shapeEditActive, setShapeEditActive] = useState(false)
  const [selectedPointIndex, setSelectedPointIndex] = useState<number | null>(null)
  const polylineRef = useRef<google.maps.Polyline | null>(null)
  const shapePolyRef = useRef<google.maps.Polygon | null>(null)
  const shapeListenersRef = useRef<google.maps.MapsEventListener[]>([])
  const pointMarkersRef = useRef<AppMapMarker[]>([])
  const pointMarkerListenersRef = useRef<google.maps.MapsEventListener[]>([])
  const clickListenerRef = useRef<google.maps.MapsEventListener | null>(null)
  const vertexDeleteCleanupRef = useRef<(() => void) | null>(null)
  const pointDeleteCleanupRef = useRef<(() => void) | null>(null)
  const selectedPointIndexRef = useRef<number | null>(null)

  const clearPointMarkerListeners = useCallback(() => {
    for (const listener of pointMarkerListenersRef.current) {
      listener.remove()
    }
    pointMarkerListenersRef.current = []
  }, [])

  const clearVertexDeleteBinding = useCallback(() => {
    vertexDeleteCleanupRef.current?.()
    vertexDeleteCleanupRef.current = null
  }, [])

  const clearPointDeleteBinding = useCallback(() => {
    pointDeleteCleanupRef.current?.()
    pointDeleteCleanupRef.current = null
  }, [])

  const clearPreviewLines = useCallback(() => {
    polylineRef.current?.setMap(null)
    polylineRef.current = null
  }, [])

  const clearPointMarkers = useCallback(() => {
    clearPointMarkerListeners()
    for (const marker of pointMarkersRef.current) {
      setAppMarkerMap(marker, null)
    }
    pointMarkersRef.current = []
  }, [clearPointMarkerListeners])

  const stopListeners = useCallback(() => {
    setIsDrawing(false)
    clickListenerRef.current?.remove()
    clickListenerRef.current = null
  }, [])

  const clearShapePolygon = useCallback(() => {
    clearVertexDeleteBinding()
    for (const listener of shapeListenersRef.current) {
      listener.remove()
    }
    shapeListenersRef.current = []
    if (shapePolyRef.current) {
      shapePolyRef.current.setEditable(false)
      shapePolyRef.current.setDraggable(false)
      shapePolyRef.current.setMap(null)
      shapePolyRef.current = null
    }
    setShapeEditActive(false)
  }, [clearVertexDeleteBinding])

  useEffect(() => {
    selectedPointIndexRef.current = selectedPointIndex
  }, [selectedPointIndex])

  const syncPointMarkers = useCallback(
    (nextPoints: LatLng[], selectedIndex: number | null) => {
      if (!map) return
      clearPointMarkerListeners()
      while (pointMarkersRef.current.length > nextPoints.length) {
        const removed = pointMarkersRef.current.pop()
        if (removed) setAppMarkerMap(removed, null)
      }
      nextPoints.forEach((point, index) => {
        let marker = pointMarkersRef.current[index]
        if (!marker) {
          marker = createAppMarker({
            map,
            position: point,
            zIndex: 55,
            clickable: true,
            icon: pointMarkerIcon(color, index === selectedIndex),
          })
          pointMarkersRef.current[index] = marker
        } else {
          setAppMarkerPosition(marker, point.lat, point.lng)
          setAppMarkerIcon(marker, pointMarkerIcon(color, index === selectedIndex))
          setAppMarkerMap(marker, map)
        }

        pointMarkerListenersRef.current.push(
          marker.addListener('click', (e: google.maps.MapMouseEvent) => {
            e.stop?.()
            setSelectedPointIndex(index)
          }),
        )
      })
    },
    [clearPointMarkerListeners, color, map],
  )

  const syncPointsFromShape = useCallback(() => {
    if (!shapePolyRef.current) return
    setPoints(readPathsFromPolygon(shapePolyRef.current))
  }, [])

  const attachShapeListeners = useCallback(
    (poly: google.maps.Polygon) => {
      for (const listener of shapeListenersRef.current) {
        listener.remove()
      }
      const path = poly.getPath()
      shapeListenersRef.current = [
        path.addListener('set_at', syncPointsFromShape),
        path.addListener('insert_at', syncPointsFromShape),
        path.addListener('remove_at', syncPointsFromShape),
        poly.addListener('drag', syncPointsFromShape),
        poly.addListener('dragend', syncPointsFromShape),
      ]
    },
    [syncPointsFromShape],
  )

  const mountShapePolygon = useCallback(
    (nextPoints: LatLng[], options?: { keepClickListener?: boolean }) => {
      if (!map || nextPoints.length < 3) return

      if (!options?.keepClickListener) {
        stopListeners()
      }
      clearPreviewLines()
      clearPointMarkers()

      let poly = shapePolyRef.current
      if (!poly) {
        poly = new google.maps.Polygon({
          paths: nextPoints,
          strokeColor: color,
          strokeOpacity: 0.9,
          strokeWeight: 2,
          fillColor: color,
          fillOpacity: 0.15,
          map,
          zIndex: 50,
          draggable: true,
          editable: true,
        })
        shapePolyRef.current = poly
        attachShapeListeners(poly)
      } else {
        poly.setPath(nextPoints)
        poly.setMap(map)
        poly.setDraggable(true)
        poly.setEditable(true)
      }

      setShapeEditActive(true)
      setPoints(nextPoints)
      setSelectedPointIndex(null)

      clearVertexDeleteBinding()
      vertexDeleteCleanupRef.current = bindPolygonVertexDelete(poly, {
        onVerticesChanged: syncPointsFromShape,
        onMinVerticesBlocked: () => {
          showToastError('Polygon needs at least 3 points.')
        },
      })
    },
    [attachShapeListeners, clearPointMarkers, clearPreviewLines, clearVertexDeleteBinding, color, map, stopListeners, syncPointsFromShape],
  )

  const updatePreview = useCallback(
    (nextPoints: LatLng[]) => {
      if (!map) return

      if (nextPoints.length >= 3) {
        mountShapePolygon(nextPoints, { keepClickListener: true })
        return
      }

      clearShapePolygon()
      syncPointMarkers(nextPoints, selectedPointIndexRef.current)
      clearPreviewLines()
      if (nextPoints.length > 1) {
        polylineRef.current = new google.maps.Polyline({
          path: nextPoints,
          strokeColor: color,
          strokeOpacity: 0.9,
          strokeWeight: 2,
          map,
          zIndex: 50,
        })
      }
    },
    [clearPreviewLines, clearShapePolygon, color, map, mountShapePolygon, syncPointMarkers],
  )

  const reset = useCallback(() => {
    stopListeners()
    clearPointDeleteBinding()
    clearVertexDeleteBinding()
    clearShapePolygon()
    setPoints([])
    setSelectedPointIndex(null)
    clearPreviewLines()
    clearPointMarkers()
  }, [
    clearPointDeleteBinding,
    clearPointMarkers,
    clearPreviewLines,
    clearShapePolygon,
    clearVertexDeleteBinding,
    stopListeners,
  ])

  const startDrawing = useCallback(() => {
    if (!map) return
    reset()
    setIsDrawing(true)
    clickListenerRef.current = map.addListener('click', (e: google.maps.MapMouseEvent) => {
      const latLng = e.latLng
      if (!latLng) return
      const next = { lat: latLng.lat(), lng: latLng.lng() }
      setPoints((prev) => {
        const updated = [...prev, next]
        updatePreview(updated)
        return updated
      })
    })
  }, [map, reset, updatePreview])

  const getCurrentPoints = useCallback((): LatLng[] => {
    if (shapePolyRef.current) {
      return readPathsFromPolygon(shapePolyRef.current)
    }
    return points
  }, [points])

  useEffect(() => {
    if (shapeEditActive && shapePolyRef.current) {
      shapePolyRef.current.setOptions({
        strokeColor: color,
        fillColor: color,
      })
      return
    }
    if (points.length > 0 && points.length < 3) {
      syncPointMarkers(points, selectedPointIndex)
      polylineRef.current?.setOptions({ strokeColor: color })
    }
  }, [color, points, selectedPointIndex, shapeEditActive, syncPointMarkers])

  useEffect(() => {
    clearPointDeleteBinding()
    if (!isDrawing || shapeEditActive || points.length === 0) return

    pointDeleteCleanupRef.current = bindPointListDelete({
      isActive: () => isDrawing && !shapeEditActive,
      getSelectedIndex: () => selectedPointIndexRef.current,
      clearSelectedIndex: () => setSelectedPointIndex(null),
      getPointCount: () => points.length,
      removeSelectedPoint: () => {
        const index = selectedPointIndexRef.current
        if (index == null) return
        setPoints((prev) => {
          const updated = prev.filter((_, pointIndex) => pointIndex !== index)
          updatePreview(updated)
          return updated
        })
      },
      minPoints: 1,
    })

    return clearPointDeleteBinding
  }, [clearPointDeleteBinding, isDrawing, points.length, shapeEditActive, updatePreview])

  useEffect(() => () => reset(), [reset])

  const applyPoints = useCallback(
    (nextPoints: LatLng[]) => {
      mountShapePolygon(nextPoints)
    },
    [mountShapePolygon],
  )

  return {
    points,
    isDrawing,
    shapeEditActive,
    /** @deprecated use shapeEditActive */
    vertexEditActive: shapeEditActive,
    startDrawing,
    stopDrawing: stopListeners,
    reset,
    setPoints,
    applyPoints,
    getCurrentPoints,
  }
}
