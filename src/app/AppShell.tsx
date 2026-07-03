import { useCallback, useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { VersionStamp } from '@/components/VersionStamp/VersionStamp'
import { CostBanner } from '@/features/cost-estimator/CostBanner'
import { MapPanel } from '@/features/map/MapPanel'
import { RtuPictureViewer } from '@/features/rtu-pictures/RtuPictureViewer'
import { SettingsModal } from '@/features/settings/SettingsModal'
import { Sidebar } from '@/features/sidebar/Sidebar'
import { LoginModal } from '@/features/auth/LoginModal'
import { useAuth } from '@/hooks/useAuth'
import { useFilteredBuildings } from '@/hooks/useFilteredBuildings'
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts'
import { useRtuPictureViewerHistory } from '@/hooks/useRtuPictureViewerHistory'
import { usePortfolioData, useSavePortfolio, type PortfolioData } from '@/hooks/usePortfolioData'
import { clearRtuPictureManifestCache } from '@/lib/rtuPictures'
import { showToastError, showToastSuccess } from '@/lib/toast'
import { useSettingsStore } from '@/stores/settingsStore'
import { useRtuPricingStore } from '@/stores/rtuPricingStore'
import { useRtuScheduleStore } from '@/stores/rtuScheduleStore'
import { usePortfolioStore } from '@/stores/portfolioStore'
import { useUiStore } from '@/stores/uiStore'
import { ConfirmDialog } from '@/components/ConfirmDialog/ConfirmDialog'
import styles from './AppShell.module.css'

const EMPTY_PORTFOLIO: PortfolioData = { buildings: [], utilities: [], polygons: [] }

export function AppShell() {
  const queryClient = useQueryClient()
  const { data, isLoading, isError } = usePortfolioData()
  const savePortfolio = useSavePortfolio()
  const { isAuthenticated } = useAuth()
  const [portfolioOverride, setPortfolioOverride] = useState<PortfolioData | null>(null)
  const [loginOpen, setLoginOpen] = useState(false)

  const loadSettings = useSettingsStore((s) => s.loadSettings)
  const loadRtuPricing = useRtuPricingStore((s) => s.load)
  const loadRtuSchedule = useRtuScheduleStore((s) => s.load)
  const settingsOpen = useUiStore((s) => s.settingsOpen)
  const closeSettings = useUiStore((s) => s.closeSettings)
  const polygonDrawOpen = useUiStore((s) => s.isModalOpen('polygonDraw'))
  const openPolygonDraw = useUiStore((s) => s.openModal)
  const closePolygonDraw = useUiStore((s) => s.closeModal)
  const addMarkerOpen = useUiStore((s) => s.isModalOpen('addMarker'))
  const openAddMarker = useUiStore((s) => s.openModal)
  const closeAddMarker = useUiStore((s) => s.closeModal)
  const rtuPictureViewer = useUiStore((s) => s.rtuPictureViewer)
  const closeRtuPictureViewer = useUiStore((s) => s.closeRtuPictureViewer)
  const setRtuPictureViewerIndex = useUiStore((s) => s.setRtuPictureViewerIndex)
  const updateRtuPictureViewerPictures = useUiStore((s) => s.updateRtuPictureViewerPictures)

  const markSaved = usePortfolioStore((s) => s.markSaved)

  useEffect(() => {
    void loadSettings()
    void loadRtuPricing()
    void loadRtuSchedule()
  }, [loadSettings, loadRtuPricing, loadRtuSchedule])

  const portfolio = portfolioOverride ?? data ?? EMPTY_PORTFOLIO

  const { filteredBuildings, listBuildings, costScopeBuildings } = useFilteredBuildings(
    portfolio.buildings,
    portfolio.polygons,
  )

  useKeyboardShortcuts({ onSaved: markSaved })
  useRtuPictureViewerHistory()

  const persistPortfolioChange = useCallback(
    async (next: PortfolioData) => {
      if (!isAuthenticated) {
        setLoginOpen(true)
        throw new Error('Sign in to save portfolio changes.')
      }
      const saved = await savePortfolio.mutateAsync(next)
      setPortfolioOverride(null)
      queryClient.setQueryData(['portfolio'], saved)
      usePortfolioStore.getState().patchPortfolio(saved)
      clearRtuPictureManifestCache()
      showToastSuccess('✓ Saved to Supabase')
      return saved
    },
    [isAuthenticated, queryClient, savePortfolio],
  )

  const handlePortfolioChange = useCallback(
    (next: PortfolioData) => {
      setPortfolioOverride(next)
      queryClient.setQueryData(['portfolio'], next)
      usePortfolioStore.getState().patchPortfolio(next)
      void persistPortfolioChange(next).catch((error) => {
        showToastError(error instanceof Error ? error.message : 'Could not save portfolio')
      })
    },
    [persistPortfolioChange, queryClient],
  )

  const handleAddMarkerClose = useCallback(() => {
    closeAddMarker('addMarker')
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
        onNotesChange={handlePortfolioChange}
      />
      <div className={styles.mainColumn}>
        <MapPanel
          portfolio={portfolio}
          mapBuildings={filteredBuildings}
          onPortfolioImport={handlePortfolioChange}
          onPortfolioPatch={handlePortfolioChange}
          polygonDrawOpen={polygonDrawOpen}
          onPolygonDrawClose={handlePolygonDrawClose}
          addMarkerOpen={addMarkerOpen}
          onAddMarkerClose={handleAddMarkerClose}
        />
        <CostBanner buildings={costScopeBuildings} />
      </div>
      <SettingsModal
        open={settingsOpen}
        onClose={closeSettings}
        portfolio={portfolio}
        onImport={handlePortfolioChange}
        onPortfolioPatch={handlePortfolioChange}
        onOpenPolygonDraw={() => {
          closeSettings()
          openPolygonDraw('polygonDraw')
        }}
        onOpenAddMarker={() => {
          closeSettings()
          openAddMarker('addMarker')
        }}
        onSaved={markSaved}
        onSignIn={() => setLoginOpen(true)}
        isAuthenticated={isAuthenticated}
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
      <LoginModal open={loginOpen} onClose={() => setLoginOpen(false)} />
      <ConfirmDialog />
    </div>
  )
}
