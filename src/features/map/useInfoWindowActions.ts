import { useCallback, useRef } from 'react'
import type { MutableRefObject } from 'react'
import { confirm } from '@/stores/confirmStore'
import {
  setAppMarkerCursor,
  setAppMarkerDraggable,
  setAppMarkerVisible,
  type AppMapMarker,
} from '@/lib/appMapMarker'
import {
  buildBuildingInfoHtml,
  buildDetailEditHtml,
  buildDetailInfoHtml,
  buildRtuDocumentsPageHtml,
  copyPopupText,
} from '@/lib/mapInfoWindow'
import { buildingDragKey } from '@/lib/dragSelection'
import { suppressMapClickClearOnce } from '@/lib/mapMarqueeSelect'
import { closeAllMapPopups, ensureInfoWindowVisible, bindMapPopupWheelScroll } from '@/lib/mapPopups'
import { MAP_DETAIL_ZOOM } from '@/lib/constants'
import { afterMapViewChange, panToPreserveRotation } from '@/lib/mapRotation'
import {
  addRtuPicturesFromFiles,
  deleteRtuPicture,
  listRtuPictures,
  type RtuPicture,
} from '@/lib/rtuPictures'
import { listRtuDocuments } from '@/lib/rtuDocuments'
import {
  downloadRtuDocumentFiles,
  rtuDocumentArchiveName,
  rtuDocumentBaseName,
} from '@/lib/rtuDocumentDownload'
import {
  countPendingPicturesNearRtu,
  findNearestPendingPictureToRtu,
} from '@/lib/rtuPictureGpsAssign'
import { RTU_PICTURE_DROP_FEET } from '@/lib/geo'
import { polygonsForBuilding } from '@/lib/polygonBuildings'
import { useSettingsStore } from '@/stores/settingsStore'
import { useSelectionStore } from '@/stores/selectionStore'
import { usePendingRtuPictureStore } from '@/stores/pendingRtuPictureStore'
import { useUiStore } from '@/stores/uiStore'
import { showToastError, showToastSuccess } from '@/lib/toast'
import {
  type ActiveDetailInfo,
  type BuildingMarkerEntry,
  type DetailMarkerEntry,
  type MapMarkersCallbacks,
  type PolygonBuildingIndex,
  type SoloMoveSession,
} from '@/features/map/mapMarkersState'
import type { Building, LayerKey, Rtu, SuiteEntrance } from '@/types/domain'

export function useInfoWindowActions(
  map: google.maps.Map | null,
  detailMarkersRef: MutableRefObject<DetailMarkerEntry[]>,
  buildingMarkersRef: MutableRefObject<BuildingMarkerEntry[]>,
  infoWindowRef: MutableRefObject<google.maps.InfoWindow | null>,
  activeInfoMarkerRef: MutableRefObject<AppMapMarker | null>,
  activeDetailInfoRef: MutableRefObject<ActiveDetailInfo | null>,
  activeRtuPicturesRef: MutableRefObject<RtuPicture[]>,
  soloMoveRef: MutableRefObject<SoloMoveSession | null>,
  soloMoveListenerRef: MutableRefObject<google.maps.MapsEventListener | null>,
  soloMoveDragStartListenerRef: MutableRefObject<google.maps.MapsEventListener | null>,
  callbacksRef: MutableRefObject<MapMarkersCallbacks>,
  polygonIndexRef: MutableRefObject<PolygonBuildingIndex>,
  clearActiveRtuPictures: () => void,
  refreshRtuPicturesView: () => Promise<void>,
) {
  /** Drop prior InfoWindow DOM listeners so repeated opens do not stack handlers. */
  const infoWindowActionsAbortRef = useRef<AbortController | null>(null)

  const stopSoloMove = useCallback(() => {
    const solo = soloMoveRef.current
    if (!solo) return
    solo.cleanupPointerUp?.()
    if (soloMoveListenerRef.current) {
      google.maps.event.removeListener(soloMoveListenerRef.current)
      soloMoveListenerRef.current = null
    }
    if (soloMoveDragStartListenerRef.current) {
      google.maps.event.removeListener(soloMoveDragStartListenerRef.current)
      soloMoveDragStartListenerRef.current = null
    }
    soloMoveRef.current = null
  }, [soloMoveRef, soloMoveListenerRef, soloMoveDragStartListenerRef])

  /** Popup Move: reuse Edit Positions (multi-drag) path — that path already stages Save. */
  const startPopupMove = useCallback(
    (marker: AppMapMarker, dragKey: string, label: string) => {
      stopSoloMove()
      infoWindowRef.current?.close()
      activeInfoMarkerRef.current = null
      activeDetailInfoRef.current = null

      const store = useSelectionStore.getState()
      store.setDragMode(true)
      store.setDragSelect([dragKey])
      setAppMarkerDraggable(marker, true)
      setAppMarkerCursor(marker, 'grab')
      showToastSuccess(`${label} highlighted — drag it now. Save appears when you release.`)
    },
    [infoWindowRef, activeInfoMarkerRef, activeDetailInfoRef, stopSoloMove],
  )

  const startSoloMove = useCallback(
    (entry: DetailMarkerEntry) => {
      startPopupMove(entry.marker, entry.dragKey, entry.type === 'inspection360' ? 'Gate' : 'Marker')
    },
    [startPopupMove],
  )

  const startBuildingMove = useCallback(
    (entry: BuildingMarkerEntry) => {
      startPopupMove(entry.marker, buildingDragKey(entry.building.address), 'Building')
    },
    [startPopupMove],
  )

  const commitSoloMove = useCallback(() => false, [])

  const openBuildingInfo = useCallback(
    (building: Building, marker: AppMapMarker) => {
      if (!map || !infoWindowRef.current) return
      if (activeInfoMarkerRef.current === marker) {
        closeAllMapPopups()
        return
      }
      closeAllMapPopups()
      activeDetailInfoRef.current = null
      clearActiveRtuPictures()
      if ((map.getZoom() ?? 0) < MAP_DETAIL_ZOOM) {
        panToPreserveRotation(
          map,
          { lat: building.lat, lng: building.lng },
          MAP_DETAIL_ZOOM,
          { onlyZoomIn: true },
        )
      }
      const tenantPolygons = polygonsForBuilding(polygonIndexRef.current, building.address)
      const managerRenames = useSettingsStore.getState().managerRenames
      infoWindowRef.current.setContent(
        buildBuildingInfoHtml(building, tenantPolygons, managerRenames),
      )
      infoWindowRef.current.open({ map, anchor: marker })
      ensureInfoWindowVisible(map, infoWindowRef.current)
      activeInfoMarkerRef.current = marker
      afterMapViewChange(map)
    },
    [map, infoWindowRef, activeInfoMarkerRef, activeDetailInfoRef, polygonIndexRef, clearActiveRtuPictures],
  )

  const detailHtmlOptions = useCallback(
    (entry: DetailMarkerEntry, pendingPictureAssignCount = 0) => ({
      buildingAddress: entry.building?.address,
      pendingPictureAssignCount,
    }),
    [],
  )

  const refreshRtuDocumentsView = useCallback(async () => {
    const ctx = activeDetailInfoRef.current
    const iw = infoWindowRef.current
    if (!ctx || !iw || ctx.entry.type !== 'rtu' || ctx.view !== 'documents') return

    const buildingAddress = ctx.entry.building?.address ?? ''
    const rtu = ctx.entry.data as Rtu
    if (!buildingAddress) return

    iw.setContent(buildRtuDocumentsPageHtml(rtu, buildingAddress, 'loading'))

    try {
      const documents = await listRtuDocuments(buildingAddress, rtu.name ?? '')
      const stillOpen = activeDetailInfoRef.current
      if (
        !stillOpen ||
        stillOpen.view !== 'documents' ||
        stillOpen.entry.type !== 'rtu' ||
        stillOpen.entry.data.name !== rtu.name
      ) {
        return
      }
      iw.setContent(buildRtuDocumentsPageHtml(rtu, buildingAddress, documents))
    } catch {
      const stillOpen = activeDetailInfoRef.current
      if (
        !stillOpen ||
        stillOpen.view !== 'documents' ||
        stillOpen.entry.type !== 'rtu' ||
        stillOpen.entry.data.name !== rtu.name
      ) {
        return
      }
      iw.setContent(buildRtuDocumentsPageHtml(rtu, buildingAddress, []))
    }
  }, [activeDetailInfoRef, infoWindowRef])

  const openDetailInfo = useCallback(
    (entry: DetailMarkerEntry) => {
      if (!map || !infoWindowRef.current) return
      const { type, data, marker } = entry
      if (activeInfoMarkerRef.current === marker) {
        closeAllMapPopups()
        return
      }
      closeAllMapPopups()
      clearActiveRtuPictures()
      activeDetailInfoRef.current = { entry, view: 'info', pictureIndex: 0 }
      const rtu = entry.type === 'rtu' ? (entry.data as Rtu) : null
      const pendingItems = usePendingRtuPictureStore.getState().items
      const pendingPictureAssignCount =
        rtu != null
          ? countPendingPicturesNearRtu(pendingItems, rtu.lat, rtu.lng)
          : 0
      infoWindowRef.current.setContent(
        buildDetailInfoHtml(type, data, detailHtmlOptions(entry, pendingPictureAssignCount)),
      )
      infoWindowRef.current.open({ map, anchor: marker })
      ensureInfoWindowVisible(map, infoWindowRef.current)
      activeInfoMarkerRef.current = marker
      setAppMarkerVisible(marker, true)
      afterMapViewChange(map)
    },
    [map, infoWindowRef, activeInfoMarkerRef, activeDetailInfoRef, clearActiveRtuPictures, detailHtmlOptions],
  )

  const attachInfoWindowActions = useCallback(() => {
    const iw = infoWindowRef.current
    if (!iw) return
    google.maps.event.addListenerOnce(iw, 'domready', () => {
      infoWindowActionsAbortRef.current?.abort()
      const abortController = new AbortController()
      infoWindowActionsAbortRef.current = abortController
      const { signal } = abortController

      const container =
        map?.getDiv().querySelector('.gm-style-iw-d') ??
        document.querySelector('.gm-style-iw-d')
      if (!container) return

      const keepPopupOpenOnMapClick = (e: Event) => {
        suppressMapClickClearOnce()
        e.stopPropagation()
      }
      container.addEventListener('click', keepPopupOpenOnMapClick, { signal })
      container.addEventListener('mousedown', keepPopupOpenOnMapClick, { signal })

      const iwShell = container.closest('.gm-style-iw-c') ?? container
      bindMapPopupWheelScroll(iwShell, { signal })

      container.querySelector('[data-iw-action="close"]')?.addEventListener(
        'click',
        () => {
          iw.close()
          activeInfoMarkerRef.current = null
          activeDetailInfoRef.current = null
          clearActiveRtuPictures()
        },
        { signal },
      )

      container.querySelector('[data-iw-action="copy-all"]')?.addEventListener(
        'click',
        () => {
          const source = container.querySelector('.iw-copy-source') as HTMLTextAreaElement | null
          if (source?.value) copyPopupText(source.value)
        },
        { signal },
      )

      container.querySelector('[data-iw-action="move"]')?.addEventListener(
        'click',
        (e) => {
          e.preventDefault()
          e.stopPropagation()
          suppressMapClickClearOnce()
          const btn = e.currentTarget as HTMLElement
          const kind = btn.getAttribute('data-iw-kind')

          if (kind === 'building') {
            const buildingAddr = btn.getAttribute('data-iw-building') ?? ''
            const entry = buildingMarkersRef.current.find(
              (bm) => bm.building.address === buildingAddr,
            )
            if (!entry) {
              showToastError('Could not find that building to move.')
              return
            }
            startBuildingMove(entry)
            return
          }

          const fromPopup = activeDetailInfoRef.current?.entry
          if (fromPopup) {
            startSoloMove(fromPopup)
            return
          }
          if (kind !== 'detail') return
          const layerKey = btn.getAttribute('data-iw-layer') as LayerKey
          const name = btn.getAttribute('data-iw-name') ?? ''
          const buildingAddr = btn.getAttribute('data-iw-building') ?? ''
          const entry = detailMarkersRef.current.find(
            (dm) =>
              dm.type === layerKey &&
              dm.data.name === name &&
              (buildingAddr ? dm.building?.address === buildingAddr : !dm.building),
          )
          if (!entry) {
            showToastError('Could not find that marker to move.')
            return
          }
          startSoloMove(entry)
        },
        { signal },
      )

      const delBtn = container.querySelector('[data-iw-action="delete"]')
      if (delBtn) {
        delBtn.addEventListener(
          'click',
          () => {
            void (async () => {
              const layerKey = delBtn.getAttribute('data-iw-layer') as LayerKey
              const name = delBtn.getAttribute('data-iw-name') ?? ''
              const buildingAddr = delBtn.getAttribute('data-iw-building') ?? ''
              const entry = detailMarkersRef.current.find(
                (dm) =>
                  dm.type === layerKey &&
                  dm.data.name === name &&
                  (buildingAddr ? dm.building?.address === buildingAddr : !dm.building),
              )
              if (!entry) return
              if (!(await confirm(`Delete marker "${name}"?`))) return
              iw.close()
              activeInfoMarkerRef.current = null
              callbacksRef.current.onDeleteDetail?.(entry.type, entry.data, entry.building)
            })()
          },
          { signal },
        )
      }

      container.querySelector('[data-iw-action="edit-text"]')?.addEventListener(
        'click',
        () => {
          const ctx = activeDetailInfoRef.current
          if (!ctx || ctx.entry.type !== 'rtu') return
          ctx.view = 'edit'
          iw.setContent(
            buildDetailEditHtml(ctx.entry.data as Rtu, {
              buildingAddress: ctx.entry.building?.address,
            }),
          )
        },
        { signal },
      )

      container.querySelector('[data-iw-action="edit-cancel"]')?.addEventListener(
        'click',
        () => {
          const ctx = activeDetailInfoRef.current
          if (!ctx || ctx.view !== 'edit') return
          ctx.view = 'info'
          const { type, data } = ctx.entry
          const pendingPictureAssignCount =
            type === 'rtu'
              ? countPendingPicturesNearRtu(
                  usePendingRtuPictureStore.getState().items,
                  (data as Rtu).lat,
                  (data as Rtu).lng,
                )
              : 0
          iw.setContent(
            buildDetailInfoHtml(type, data, detailHtmlOptions(ctx.entry, pendingPictureAssignCount)),
          )
        },
        { signal },
      )

      container.querySelector('[data-iw-action="edit-save"]')?.addEventListener(
        'click',
        () => {
          void (async () => {
            const ctx = activeDetailInfoRef.current
            if (!ctx || ctx.entry.type !== 'rtu' || ctx.view !== 'edit' || !ctx.entry.building) return
            const nameInput = container.querySelector('[data-iw-field="name"]') as HTMLInputElement | null
            const descInput = container.querySelector(
              '[data-iw-field="description"]',
            ) as HTMLTextAreaElement | null
            if (!nameInput || !descInput) return
            const oldName =
              container.querySelector('.iw-edit')?.getAttribute('data-iw-rtu-name') ??
              ctx.entry.data.name ??
              ''
            try {
              await callbacksRef.current.onEditDetail?.(
                'rtu',
                ctx.entry.building,
                oldName,
                { name: nameInput.value, description: descInput.value },
              )
            } catch {
              return
            }
            iw.close()
            activeInfoMarkerRef.current = null
            activeDetailInfoRef.current = null
          })()
        },
        { signal },
      )

      container.querySelector('[data-iw-action="pictures"]')?.addEventListener(
        'click',
        () => {
          const ctx = activeDetailInfoRef.current
          if (!ctx || ctx.entry.type !== 'rtu') return
          ctx.view = 'pictures'
          ctx.pictureIndex = 0
          void refreshRtuPicturesView()
        },
        { signal },
      )

      container.querySelector('[data-iw-action="inspection360-open"]')?.addEventListener(
        'click',
        () => {
          const ctx = activeDetailInfoRef.current
          if (!ctx || ctx.entry.type !== 'inspection360') return
          const entrance = ctx.entry.data as SuiteEntrance
          const buildingAddress = ctx.entry.building?.address ?? ''
          useUiStore.getState().openInspection360Viewer({
            buildingAddress,
            suiteName: entrance.name,
            title: entrance.name,
            projectUrl: entrance.inspection_url?.trim() || null,
            scene: null,
          })
          iw.close()
          activeInfoMarkerRef.current = null
          activeDetailInfoRef.current = null
        },
        { signal },
      )

      container.querySelector('[data-iw-action="documents"]')?.addEventListener(
        'click',
        () => {
          const ctx = activeDetailInfoRef.current
          if (!ctx || ctx.entry.type !== 'rtu') return
          ctx.view = 'documents'
          void refreshRtuDocumentsView()
        },
        { signal },
      )

      container
        .querySelector('[data-iw-action="picture-assign-pending"]')
        ?.addEventListener(
          'click',
          () => {
            const ctx = activeDetailInfoRef.current
            if (!ctx || ctx.entry.type !== 'rtu' || !ctx.entry.building) return
            const rtu = ctx.entry.data as Rtu
            const building = ctx.entry.building
            const items = usePendingRtuPictureStore.getState().items
            const nearest = findNearestPendingPictureToRtu(items, rtu.lat, rtu.lng)
            if (!nearest) {
              showToastError(
                `No pending photos within ${RTU_PICTURE_DROP_FEET} ft of ${rtu.name}. Drag photo markers closer first.`,
              )
              return
            }
            void usePendingRtuPictureStore
              .getState()
              .assignToRtu(nearest.item.id, building, rtu)
              .then((result) => {
                showToastSuccess(
                  `- Assigned ${nearest.item.originalName} - ${result.fileName} (${rtu.name})`,
                )
                const remaining = countPendingPicturesNearRtu(
                  usePendingRtuPictureStore.getState().items,
                  rtu.lat,
                  rtu.lng,
                )
                if (ctx.view === 'info') {
                  infoWindowRef.current?.setContent(
                    buildDetailInfoHtml('rtu', rtu, detailHtmlOptions(ctx.entry, remaining)),
                  )
                }
              })
              .catch((error) => {
                showToastError(error instanceof Error ? error.message : 'Failed to assign picture')
              })
          },
          { signal },
        )

      container
        .querySelector('[data-iw-action="pictures-back"]')
        ?.addEventListener(
          'click',
          () => {
            const ctx = activeDetailInfoRef.current
            if (!ctx) return
            clearActiveRtuPictures()
            ctx.view = 'info'
            ctx.pictureIndex = 0
            const { type, data } = ctx.entry
            iw.setContent(buildDetailInfoHtml(type, data, detailHtmlOptions(ctx.entry)))
          },
          { signal },
        )

      container
        .querySelector('[data-iw-action="documents-back"]')
        ?.addEventListener(
          'click',
          () => {
            const ctx = activeDetailInfoRef.current
            if (!ctx) return
            ctx.view = 'info'
            const { type, data } = ctx.entry
            iw.setContent(buildDetailInfoHtml(type, data, detailHtmlOptions(ctx.entry)))
          },
          { signal },
        )

      container.querySelector('[data-iw-action="documents-select-all"]')?.addEventListener(
        'change',
        (e) => {
          const checked = (e.currentTarget as HTMLInputElement).checked
          container.querySelectorAll<HTMLInputElement>('.iw-documents-check').forEach((input) => {
            input.checked = checked
          })
        },
        { signal },
      )

      container.querySelector('[data-iw-action="documents-download"]')?.addEventListener(
        'click',
        () => {
          void (async () => {
            const ctx = activeDetailInfoRef.current
            if (!ctx || ctx.entry.type !== 'rtu' || ctx.view !== 'documents') return

            const root = container.querySelector('[data-iw-documents-root]')
            const downloadBtn = container.querySelector(
              '[data-iw-action="documents-download"]',
            ) as HTMLButtonElement | null
            if (!root || !downloadBtn) return

            if (!root.classList.contains('iw-documents--select-mode')) {
              root.classList.add('iw-documents--select-mode')
              downloadBtn.textContent = '⬇ Download selected'
              downloadBtn.title = 'Download checked documents'
              return
            }

            const selected = [...container.querySelectorAll<HTMLInputElement>('.iw-documents-check:checked')]
              .map((input) => ({
                url: input.getAttribute('data-iw-document-url') ?? '',
                fileName: input.getAttribute('data-iw-document-file') ?? '',
              }))
              .filter((file) => file.url && file.fileName)

            if (!selected.length) {
              showToastError('Select at least one document to download.')
              return
            }

            downloadBtn.disabled = true
            try {
              const rtuName = ctx.entry.data.name ?? 'RTU-documents'
              const result = await downloadRtuDocumentFiles(selected, { archiveBaseName: rtuName })
              if (result.count === 0) return
              showToastSuccess(
                result.zipped
                  ? `⬇ Downloaded ${result.count} documents as ${rtuDocumentArchiveName(rtuName)}`
                  : `⬇ Downloaded ${rtuDocumentBaseName(selected[0]!.fileName)}`,
              )
            } catch (error) {
              showToastError(
                error instanceof Error ? error.message : 'Failed to download documents',
              )
            } finally {
              downloadBtn.disabled = false
            }
          })()
        },
        { signal },
      )

      const stepPicture = (delta: number) => {
        const ctx = activeDetailInfoRef.current
        const total = activeRtuPicturesRef.current.length
        if (!ctx || ctx.view !== 'pictures' || total <= 1) return
        ctx.pictureIndex = (ctx.pictureIndex + delta + total) % total
        void refreshRtuPicturesView()
      }

      container
        .querySelector('[data-iw-action="picture-prev"]')
        ?.addEventListener('click', () => stepPicture(-1), { signal })
      container
        .querySelector('[data-iw-action="picture-next"]')
        ?.addEventListener('click', () => stepPicture(1), { signal })

      container
        .querySelector('[data-iw-action="picture-open-viewer"]')
        ?.addEventListener(
          'click',
          () => {
            const ctx = activeDetailInfoRef.current
            if (!ctx || ctx.entry.type !== 'rtu' || ctx.view !== 'pictures') return
            const buildingAddress = ctx.entry.building?.address
            if (!buildingAddress) return
            void listRtuPictures(buildingAddress, ctx.entry.data.name).then((pictures) => {
              if (!pictures.length) return
              activeRtuPicturesRef.current = pictures
              const pictureIndex = Math.min(ctx.pictureIndex, pictures.length - 1)
              useUiStore.getState().openRtuPictureViewer({
                pictures: pictures.map((p) => ({
                  fileName: p.fileName,
                  fullUrl: p.fullUrl,
                  thumbUrl: p.thumbUrl,
                  index: p.index,
                })),
                index: pictureIndex,
                buildingAddress,
                rtuName: ctx.entry.data.name,
              })
            })
          },
          { signal },
        )

      container
        .querySelector('[data-iw-action="picture-add"]')
        ?.addEventListener(
          'click',
          () => {
            const input = container.querySelector(
              '[data-iw-picture-input]',
            ) as HTMLInputElement | null
            input?.click()
          },
          { signal },
        )

      const fileInput = container.querySelector(
        '[data-iw-picture-input]',
      ) as HTMLInputElement | null
      fileInput?.addEventListener(
        'change',
        () => {
          void (async () => {
            const ctx = activeDetailInfoRef.current
            if (!ctx || ctx.entry.type !== 'rtu' || ctx.view !== 'pictures') return
            const buildingAddress = ctx.entry.building?.address
            if (!buildingAddress || !fileInput.files?.length) return
            const added = await addRtuPicturesFromFiles(
              buildingAddress,
              ctx.entry.data.name,
              [...fileInput.files],
            )
            fileInput.value = ''
            if (added.length) {
              ctx.pictureIndex = added.length - 1
              showToastSuccess(`- ${added.length} picture${added.length === 1 ? '' : 's'} added`)
            }
            await refreshRtuPicturesView()
          })()
        },
        { signal },
      )

      container
        .querySelector('[data-iw-action="picture-delete"]')
        ?.addEventListener(
          'click',
          () => {
            void (async () => {
              const ctx = activeDetailInfoRef.current
              const btn = container.querySelector(
                '[data-iw-action="picture-delete"]',
              ) as HTMLElement | null
              if (!ctx || ctx.entry.type !== 'rtu' || ctx.view !== 'pictures' || !btn) return

              const fileName = btn.getAttribute('data-iw-picture-file') ?? ''
              const buildingAddress = ctx.entry.building?.address
              if (!buildingAddress || !fileName) return

              if (!(await confirm(`Delete picture "${fileName}" from Cloudflare and the map?`))) return

              try {
                const result = await deleteRtuPicture(
                  buildingAddress,
                  ctx.entry.data.name,
                  fileName,
                )
                if (result === 'deleted') {
                  showToastSuccess('Picture deleted from Cloudflare and the map')
                  await refreshRtuPicturesView()
                }
              } catch (error) {
                showToastError(
                  error instanceof Error ? error.message : 'Failed to delete picture',
                )
              }
            })()
          },
          { signal },
        )
    })
  }, [
    map,
    infoWindowRef,
    activeInfoMarkerRef,
    activeDetailInfoRef,
    activeRtuPicturesRef,
    detailMarkersRef,
    buildingMarkersRef,
    callbacksRef,
    startSoloMove,
    startBuildingMove,
    clearActiveRtuPictures,
    refreshRtuPicturesView,
    refreshRtuDocumentsView,
    detailHtmlOptions,
  ])

  return {
    stopSoloMove,
    commitSoloMove,
    startSoloMove,
    openBuildingInfo,
    openDetailInfo,
    attachInfoWindowActions,
  }
}
