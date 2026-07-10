import { create } from 'zustand'
import {
  clearRtuPictureViewerHistoryFlag,
  pushRtuPictureViewerHistory,
  syncRtuPictureViewerHistoryOnClose,
} from '@/lib/rtuPictureViewerHistory'

export type ModalId =
  | 'addMarker'
  | 'addInspection360'
  | 'polygonDraw'
  | 'import'
  | 'notes'
  | 'costDetail'
  | 'confirmDelete'

export type AddMarkerClickHandler = (lat: number, lng: number) => void

export interface RtuPictureViewerItem {
  fileName: string
  fullUrl: string
  thumbUrl: string
  index: number
}

export interface RtuPictureViewerState {
  pictures: RtuPictureViewerItem[]
  index: number
  buildingAddress: string
  rtuName: string
}

export interface Inspection360ViewerState {
  buildingAddress: string
  suiteName: string
  title: string
  projectUrl: string | null
  scene: string | null
}

interface UiState {
  modals: Partial<Record<ModalId, boolean>>
  settingsOpen: boolean
  addMarkerPickMode: boolean
  addMarkerClickHandler: AddMarkerClickHandler | null
  polygonDrawMode: boolean
  rtuPictureViewer: RtuPictureViewerState | null
  inspection360Viewer: Inspection360ViewerState | null
  pictureCountModalOpen: boolean
  openModal: (id: ModalId) => void
  closeModal: (id: ModalId) => void
  toggleModal: (id: ModalId) => void
  isModalOpen: (id: ModalId) => boolean
  closeAllModals: () => void
  setSettingsOpen: (open: boolean) => void
  openSettings: () => void
  closeSettings: () => void
  setAddMarkerPickMode: (active: boolean) => void
  setAddMarkerClickHandler: (handler: AddMarkerClickHandler | null) => void
  setPolygonDrawMode: (active: boolean) => void
  clearAddMarkerPlacement: () => void
  openRtuPictureViewer: (state: RtuPictureViewerState) => void
  closeRtuPictureViewer: (fromPopState?: boolean) => void
  setRtuPictureViewerIndex: (index: number) => void
  updateRtuPictureViewerPictures: (pictures: RtuPictureViewerItem[], index?: number) => void
  openInspection360Viewer: (state: Inspection360ViewerState) => void
  closeInspection360Viewer: () => void
  openPictureCountModal: () => void
  closePictureCountModal: () => void
}

export const useUiStore = create<UiState>((set, get) => ({
  modals: {},
  settingsOpen: false,
  addMarkerPickMode: false,
  addMarkerClickHandler: null,
  polygonDrawMode: false,
  rtuPictureViewer: null,
  inspection360Viewer: null,
  pictureCountModalOpen: false,

  openModal: (id) =>
    set((state) => ({
      modals: { ...state.modals, [id]: true },
    })),

  closeModal: (id) =>
    set((state) => ({
      modals: { ...state.modals, [id]: false },
    })),

  toggleModal: (id) =>
    set((state) => ({
      modals: { ...state.modals, [id]: !state.modals[id] },
    })),

  isModalOpen: (id) => Boolean(get().modals[id]),

  closeAllModals: () => set({ modals: {} }),

  setSettingsOpen: (open) => set({ settingsOpen: open }),
  openSettings: () => set({ settingsOpen: true }),
  closeSettings: () => set({ settingsOpen: false }),
  setAddMarkerPickMode: (active) => set({ addMarkerPickMode: active }),
  setAddMarkerClickHandler: (handler) => set({ addMarkerClickHandler: handler }),
  setPolygonDrawMode: (active) => set({ polygonDrawMode: active }),
  clearAddMarkerPlacement: () => set({ addMarkerPickMode: false, addMarkerClickHandler: null }),
  openRtuPictureViewer: (state) => {
    const wasOpen = Boolean(get().rtuPictureViewer)
    set({ rtuPictureViewer: state })
    if (!wasOpen) {
      pushRtuPictureViewerHistory()
    }
  },
  closeRtuPictureViewer: (fromPopState = false) => {
    if (!get().rtuPictureViewer) return
    set({ rtuPictureViewer: null })
    if (fromPopState) {
      clearRtuPictureViewerHistoryFlag()
      return
    }
    syncRtuPictureViewerHistoryOnClose()
  },
  setRtuPictureViewerIndex: (index) =>
    set((state) =>
      state.rtuPictureViewer ? { rtuPictureViewer: { ...state.rtuPictureViewer, index } } : {},
    ),
  updateRtuPictureViewerPictures: (pictures, index) =>
    set((state) =>
      state.rtuPictureViewer
        ? {
            rtuPictureViewer: {
              ...state.rtuPictureViewer,
              pictures,
              index: index ?? state.rtuPictureViewer.index,
            },
          }
        : {},
    ),
  openInspection360Viewer: (state) => set({ inspection360Viewer: state }),
  closeInspection360Viewer: () => set({ inspection360Viewer: null }),
  openPictureCountModal: () => set({ pictureCountModalOpen: true }),
  closePictureCountModal: () => set({ pictureCountModalOpen: false }),
}))
