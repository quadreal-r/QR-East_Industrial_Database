import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { VersionStamp } from '@/components/VersionStamp/VersionStamp'
import { CostBanner } from '@/features/cost-estimator/CostBanner'
import { EditModeBar, type SaveState } from '@/features/edit-mode/EditModeBar'
import type { EditSummary } from '@/features/edit-mode/diffPortfolio'
import { diffPortfolio } from '@/features/edit-mode/diffPortfolio'
import { MapPanel } from '@/features/map/MapPanel'
import { RtuPictureViewer } from '@/features/rtu-pictures/RtuPictureViewer'
import { Inspection360Viewer } from '@/features/inspection360/Inspection360Viewer'
import { SettingsModal } from '@/features/settings/SettingsModal'
import { Sidebar } from '@/features/sidebar/Sidebar'
import { LoginModal } from '@/features/auth/LoginModal'
import { ResetPasswordModal } from '@/features/auth/ResetPasswordModal'
import { MfaChallengeModal } from '@/features/auth/MfaChallengeModal'
import { useAuth } from '@/hooks/useAuth'
import { useFilteredBuildings } from '@/hooks/useFilteredBuildings'
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts'
import { useRtuPictureViewerHistory } from '@/hooks/useRtuPictureViewerHistory'
import {
  PORTFOLIO_QUERY_KEY,
  usePortfolioData,
  useSavePendingPortfolio,
  type PortfolioData,
} from '@/hooks/usePortfolioData'
import { normalizePortfolioData } from '@/types/domain'
import { clearRtuPictureManifestCache } from '@/lib/rtuPictures'
import { showToastError, showToastSuccess } from '@/lib/toast'
import { errorMessage } from '@/lib/errorMessage'
import { confirm } from '@/stores/confirmStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useRtuPricingStore } from '@/stores/rtuPricingStore'
import { useRtuScheduleStore } from '@/stores/rtuScheduleStore'
import { usePortfolioStore } from '@/stores/portfolioStore'
import { useSelectionStore } from '@/stores/selectionStore'
import { useUiStore } from '@/stores/uiStore'
import { ConfirmDialog } from '@/components/ConfirmDialog/ConfirmDialog'
import styles from './AppShell.module.css'

const EMPTY_PORTFOLIO: PortfolioData = {
  buildings: [],
  utilities: [],
  polygons: [],
  suiteEntrances: [],
  portfolioMapViews: {},
}
const SAVE_SUCCESS_DISPLAY_MS = 1000

export function AppShell() {
  const queryClient = useQueryClient()
  const [portfolioOverride, setPortfolioOverride] = useState<PortfolioData | null>(null)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [displaySummary, setDisplaySummary] = useState<EditSummary | null>(null)
  const suppressStagingRef = useRef(false)
  const saveInFlightRef = useRef(false)
  const saveDismissTimerRef = useRef<number | null>(null)
  const { data, isLoading, isError } = usePortfolioData()
  const savePendingPortfolioMutation = useSavePendingPortfolio()
  const { isAuthenticated, needsPasswordRecovery } = useAuth()
  const [loginOpen, setLoginOpen] = useState(false)

  const persistPortfolioChange = useCallback(
    async (baselineSnapshot: PortfolioData, next: PortfolioData) => {
      if (!isAuthenticated) {
        setLoginOpen(true)
        throw new Error('Sign in to save portfolio changes.')
      }
      const saved = await savePendingPortfolioMutation.mutateAsync({
        baseline: baselineSnapshot,
        pending: next,
      })
      setPortfolioOverride(null)
      queryClient.setQueryData(PORTFOLIO_QUERY_KEY, saved)
      usePortfolioStore.getState().setPortfolio(saved, { markSaved: true })
      clearRtuPictureManifestCache()
      showToastSuccess('✓ Saved to Supabase')
      return saved
    },
    [isAuthenticated, queryClient, savePendingPortfolioMutation],
  )

  const loadSettings = useSettingsStore((s) => s.loadSettings)
  const loadRtuPricing = useRtuPricingStore((s) => s.load)
  const loadRtuSchedule = useRtuScheduleStore((s) => s.load)
  const settingsOpen = useUiStore((s) => s.settingsOpen)
  const closeSettings = useUiStore((s) => s.closeSettings)
  const polygonDrawOpen = useUiStore((s) => s.isModalOpen('polygonDraw'))
  const openPolygonDraw = useUiStore((s) => s.openModal)
  const closePolygonDraw = useUiStore((s) => s.closeModal)
  const addMarkerOpen = useUiStore((s) => s.isModalOpen('addMarker'))
  const addInspection360Open = useUiStore((s) => s.isModalOpen('addInspection360'))
  const openAddMarker = useUiStore((s) => s.openModal)
  const closeAddMarker = useUiStore((s) => s.closeModal)
  const rtuPictureViewer = useUiStore((s) => s.rtuPictureViewer)
  const inspection360Viewer = useUiStore((s) => s.inspection360Viewer)
  const closeRtuPictureViewer = useUiStore((s) => s.closeRtuPictureViewer)
  const closeInspection360Viewer = useUiStore((s) => s.closeInspection360Viewer)
  const setRtuPictureViewerIndex = useUiStore((s) => s.setRtuPictureViewerIndex)
  const updateRtuPictureViewerPictures = useUiStore((s) => s.updateRtuPictureViewerPictures)

  useEffect(() => {
    void loadSettings()
    void loadRtuPricing()
    void loadRtuSchedule()
  }, [loadSettings, loadRtuPricing, loadRtuSchedule])

  // Signed-out users must not stay in edit/add/draw modes.
  useEffect(() => {
    if (isAuthenticated) return
    useSelectionStore.getState().setDragMode(false)
    const ui = useUiStore.getState()
    ui.clearAddMarkerPlacement()
    ui.setPolygonDrawMode(false)
    closeAddMarker('addMarker')
    closeAddMarker('addInspection360')
    closePolygonDraw('polygonDraw')
  }, [isAuthenticated, closeAddMarker, closePolygonDraw])

  useEffect(() => {
    return () => {
      if (saveDismissTimerRef.current != null) {
        window.clearTimeout(saveDismissTimerRef.current)
      }
    }
  }, [])

  const clearSaveDismissTimer = useCallback(() => {
    if (saveDismissTimerRef.current != null) {
      window.clearTimeout(saveDismissTimerRef.current)
      saveDismissTimerRef.current = null
    }
  }, [])

  const finishSaveFlow = useCallback(() => {
    clearSaveDismissTimer()
    suppressStagingRef.current = false
    saveInFlightRef.current = false
    setDisplaySummary(null)
    setSaveState('idle')
  }, [clearSaveDismissTimer])

  const baseline = data ?? EMPTY_PORTFOLIO
  const portfolio = portfolioOverride ?? baseline

  const editSummary = useMemo(
    () => (portfolioOverride ? diffPortfolio(baseline, portfolioOverride) : null),
    [baseline, portfolioOverride],
  )

  const { filteredBuildings, listBuildings, costScopeBuildings } = useFilteredBuildings(
    portfolio.buildings,
    portfolio.polygons,
  )

  const stagePortfolioChange = useCallback((next: PortfolioData) => {
    if (suppressStagingRef.current) return
    const merged = normalizePortfolioData(next)
    setPortfolioOverride(merged)
    usePortfolioStore.getState().patchPortfolio(merged)
  }, [])

  const handleSave = useCallback(async () => {
    if (!portfolioOverride || saveInFlightRef.current) return

    const pending = portfolioOverride
    const baselineSnapshot = baseline
    if (editSummary) {
      setDisplaySummary(editSummary)
    }

    clearSaveDismissTimer()
    saveInFlightRef.current = true
    suppressStagingRef.current = true
    setSaveState('saving')

    try {
      await persistPortfolioChange(baselineSnapshot, pending)
      setSaveState('success')
      saveDismissTimerRef.current = window.setTimeout(() => {
        finishSaveFlow()
      }, SAVE_SUCCESS_DISPLAY_MS)
    } catch (error) {
      finishSaveFlow()
      showToastError(errorMessage(error, 'Could not save portfolio'))
    }
  }, [clearSaveDismissTimer, editSummary, finishSaveFlow, persistPortfolioChange, portfolioOverride, baseline])

  const handleDiscard = useCallback(async () => {
    if (!portfolioOverride || saveInFlightRef.current) return
    if (!(await confirm('Discard all pending changes?'))) return
    setPortfolioOverride(null)
    finishSaveFlow()
    usePortfolioStore.getState().markSaved()
    showToastSuccess('Pending changes discarded')
  }, [finishSaveFlow, portfolioOverride])

  const barSummary = editSummary ?? displaySummary
  const showEditBar = saveState !== 'idle' || portfolioOverride != null

  useKeyboardShortcuts({ onSave: handleSave })
  useRtuPictureViewerHistory()

  const handleAddMarkerClose = useCallback(() => {
    closeAddMarker('addMarker')
  }, [closeAddMarker])

  const handleAddInspection360Close = useCallback(() => {
    closeAddMarker('addInspection360')
  }, [closeAddMarker])

  const handlePolygonDrawClose = useCallback(() => {
    closePolygonDraw('polygonDraw')
  }, [closePolygonDraw])

  if (isLoading && !portfolioOverride) {
    return (
      <div className="app">
        <VersionStamp placement="fixed" />
        <div className={styles.loading}>Loading portfolio…</div>
      </div>
    )
  }

  if (isError && !portfolio.buildings.length) {
    return (
      <div className="app">
        <VersionStamp placement="fixed" />
        <div className={styles.loading}>Failed to load portfolio data from Supabase.</div>
      </div>
    )
  }

  return (
    <div className="app">
      <Sidebar
        allBuildings={portfolio.buildings}
        listBuildings={listBuildings}
        filteredBuildings={filteredBuildings}
        portfolio={portfolio}
        onNotesChange={stagePortfolioChange}
      />
      <div className={styles.mainColumn}>
        <MapPanel
          portfolio={portfolio}
          mapBuildings={filteredBuildings}
          onPortfolioImport={stagePortfolioChange}
          onPortfolioPatch={stagePortfolioChange}
          polygonDrawOpen={polygonDrawOpen}
          onPolygonDrawClose={handlePolygonDrawClose}
          addMarkerOpen={addMarkerOpen}
          onAddMarkerClose={handleAddMarkerClose}
          addInspection360Open={addInspection360Open}
          onAddInspection360Close={handleAddInspection360Close}
        />
        <CostBanner buildings={costScopeBuildings} />
        {showEditBar && barSummary ? (
          <EditModeBar
            summary={barSummary}
            onSave={() => {
              void handleSave()
            }}
            onDiscard={handleDiscard}
            saveState={saveState}
          />
        ) : null}
      </div>
      <SettingsModal
        open={settingsOpen}
        onClose={closeSettings}
        portfolio={portfolio}
        onImport={stagePortfolioChange}
        onPortfolioPatch={stagePortfolioChange}
        onOpenPolygonDraw={() => {
          closeSettings()
          openPolygonDraw('polygonDraw')
        }}
        onOpenAddMarker={() => {
          closeSettings()
          openAddMarker('addMarker')
        }}
        onOpenAddInspection360={() => {
          closeSettings()
          openAddMarker('addInspection360')
        }}
        isAuthenticated={isAuthenticated}
        onSignIn={() => setLoginOpen(true)}
      />
      {rtuPictureViewer ? (
        <RtuPictureViewer
          open
          pictures={rtuPictureViewer.pictures}
          index={rtuPictureViewer.index}
          rtuName={rtuPictureViewer.rtuName}
          buildingAddress={rtuPictureViewer.buildingAddress}
          onClose={closeRtuPictureViewer}
          onIndexChange={setRtuPictureViewerIndex}
          onPicturesUpdated={updateRtuPictureViewerPictures}
        />
      ) : null}
      {inspection360Viewer ? (
        <Inspection360Viewer
          open
          title={inspection360Viewer.title}
          buildingAddress={inspection360Viewer.buildingAddress}
          suiteName={inspection360Viewer.suiteName}
          projectUrl={inspection360Viewer.projectUrl}
          scene={inspection360Viewer.scene}
          gateKey={inspection360Viewer.gateKey}
          onClose={closeInspection360Viewer}
        />
      ) : null}
      <LoginModal open={loginOpen} onClose={() => setLoginOpen(false)} />
      <ResetPasswordModal open={needsPasswordRecovery} onClose={() => {}} />
      <MfaChallengeModal />
      <ConfirmDialog />
    </div>
  )
}
