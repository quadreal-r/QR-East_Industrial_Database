import { useState, useCallback, useMemo } from 'react'
import { ImportExportButtons } from '@/features/import-export/ImportExportButtons'
import { RtuPictureGpsAssign } from '@/features/settings/RtuPictureGpsAssign'
import { RtuPricingSettings } from '@/features/settings/RtuPricingSettings'
import { RtuEditorSettings } from '@/features/settings/RtuEditorSettings'
import { SettingsSectionLabel } from '@/features/settings/SettingsSectionLabel'
import { SettingsToolButton } from '@/features/settings/SettingsToolButton'
import { Modal } from '@/components/Modal/Modal'
import { Button } from '@/components/Button/Button'
import { APP_THEMES } from '@/lib/themes'
import selectStyles from '@/components/Select/Select.module.css'
import {
  applyManagerSlots,
  managerSlotLabel,
  managerSlotsFromPortfolio,
  type ManagerSlot,
} from '@/lib/managerNames'
import { clearLocalRtuPictureStorage } from '@/lib/rtuPictures'
import { confirm } from '@/stores/confirmStore'
import { showToastError, showToastSuccess } from '@/lib/toast'
import { useAuth } from '@/hooks/useAuth'
import { usePendingRtuPictureStore } from '@/stores/pendingRtuPictureStore'
import { useSelectionStore } from '@/stores/selectionStore'
import { useSettingsStore } from '@/stores/settingsStore'
import type { PortfolioData } from '@/types/domain'
import styles from './SettingsModal.module.css'

export interface SettingsModalProps {
  open: boolean
  onClose: () => void
  portfolio: PortfolioData
  onImport: (data: PortfolioData) => void
  onPortfolioPatch: (data: PortfolioData) => void
  onOpenPolygonDraw: () => void
  onOpenAddMarker: () => void
  onSaved?: () => void
  isAuthenticated: boolean
  onSignIn: () => void
}

function PropertyManagerNamesEditor({
  portfolio,
  onPortfolioPatch,
}: {
  portfolio: PortfolioData
  onPortfolioPatch: (data: PortfolioData) => void
}) {
  const managerRenames = useSettingsStore((s) => s.managerRenames)
  const saveSettings = useSettingsStore((s) => s.saveSettings)
  const { isAuthenticated } = useAuth()

  const [slots, setSlots] = useState<ManagerSlot[]>(() =>
    managerSlotsFromPortfolio(portfolio.buildings, managerRenames),
  )
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [draftName, setDraftName] = useState(() => slots[0]?.name ?? '')

  const commitDraft = (index: number, name: string, currentSlots: ManagerSlot[]): ManagerSlot[] => {
    if (index < 0 || index >= currentSlots.length) return currentSlots
    const next = [...currentSlots]
    next[index] = { ...next[index]!, name }
    return next
  }

  const handleSlotPickerChange = (value: string) => {
    const nextIndex = Number.parseInt(value, 10)
    if (Number.isNaN(nextIndex)) return
    const committed = commitDraft(selectedIndex, draftName, slots)
    setSlots(committed)
    setSelectedIndex(nextIndex)
    setDraftName(committed[nextIndex]?.name ?? '')
  }

  const handleApply = () => {
    if (!isAuthenticated) {
      showToastError('Sign in to save manager names.')
      return
    }
    const committed = commitDraft(selectedIndex, draftName, slots)
    const { portfolio: nextPortfolio, changed, managerRenames: nextRenames } = applyManagerSlots(
      portfolio,
      committed,
      managerRenames,
    )

    useSettingsStore.setState({ managerRenames: nextRenames })
    void saveSettings()

    if (changed) {
      onPortfolioPatch(nextPortfolio)
      const nextSlots = managerSlotsFromPortfolio(nextPortfolio.buildings, nextRenames)
      setSlots(nextSlots)
      setSelectedIndex(Math.min(selectedIndex, nextSlots.length - 1))
      setDraftName(nextSlots[Math.min(selectedIndex, nextSlots.length - 1)]?.name ?? '')
      showToastSuccess('✓ Manager names updated in Supabase.')
      return
    }

    showToastSuccess('✓ Manager names saved.')
  }

  return (
    <div className={styles.mgrEditor}>
      <label className={styles.mgrFieldLabel} htmlFor="manager-slot-picker">
        Manager slot
      </label>
      <select
        id="manager-slot-picker"
        className={selectStyles.select}
        value={String(selectedIndex)}
        onChange={(e) => handleSlotPickerChange(e.target.value)}
        aria-label="Select manager slot"
      >
        {slots.map((slot, index) => (
          <option key={slot.key} value={String(index)}>
            {managerSlotLabel(index)}
          </option>
        ))}
      </select>
      <label className={styles.mgrFieldLabel} htmlFor="manager-display-name">
        Display name
      </label>
      <input
        id="manager-display-name"
        type="text"
        className={styles.mgrInput}
        value={draftName}
        onChange={(e) => setDraftName(e.target.value)}
        placeholder={managerSlotLabel(selectedIndex)}
        aria-label={`Display name for ${managerSlotLabel(selectedIndex)}`}
      />
      <button type="button" className={styles.mgrApplyBtn} onClick={handleApply}>
        Apply manager names
      </button>
    </div>
  )
}

interface SettingsFormProps extends SettingsModalProps {
  themeIndex: number
}

function SettingsForm({
  open,
  portfolio,
  themeIndex,
  onClose,
  onImport,
  onPortfolioPatch,
  onOpenPolygonDraw,
  onOpenAddMarker,
  isAuthenticated,
  onSignIn,
}: SettingsFormProps) {
  const setThemeIndex = useSettingsStore((s) => s.setThemeIndex)
  const applyTheme = useSettingsStore((s) => s.applyTheme)
  const saveSettings = useSettingsStore((s) => s.saveSettings)
  const { signOut, user } = useAuth()

  const dragMode = useSelectionStore((s) => s.dragMode)
  const dragSelectedCount = useSelectionStore((s) => s.dragSelectedKeys.length)
  const setDragMode = useSelectionStore((s) => s.setDragMode)
  const clearDragSelect = useSelectionStore((s) => s.clearDragSelect)

  const [uploadBusy, setUploadBusy] = useState(false)
  const [pricingOpen, setPricingOpen] = useState(false)
  const [rtuEditorOpen, setRtuEditorOpen] = useState(false)

  const managerEditorKey = useMemo(() => {
    if (!open) return 'closed'
    const renames = useSettingsStore.getState().managerRenames
    return managerSlotsFromPortfolio(portfolio.buildings, renames)
      .map((slot) => `${slot.key}\t${slot.name}`)
      .join('|')
  }, [open, portfolio.buildings])

  const handleClose = useCallback(() => {
    if (uploadBusy) return
    onClose()
  }, [onClose, uploadBusy])

  const handleThemeSelect = (index: number) => {
    applyTheme(index)
    setThemeIndex(index)
    if (isAuthenticated) void saveSettings()
  }

  const handleEditPositions = () => {
    if (!isAuthenticated) {
      showToastError('Sign in to edit map positions.')
      return
    }
    setDragMode(!dragMode)
    handleClose()
  }

  const handleImport = (data: PortfolioData) => {
    onImport(data)
    handleClose()
  }

  const handleClearAllLocalPictures = () => {
    void (async () => {
      if (
        !(await confirm(
          'Remove every RTU photo stored in this browser (IndexedDB)? Cloudflare R2 files are not changed.',
        ))
      ) {
        return
      }
      setUploadBusy(true)
      try {
        usePendingRtuPictureStore.getState().clear()
        const removed = await clearLocalRtuPictureStorage()
        showToastSuccess(
          removed > 0
            ? `✓ Cleared ${removed} local RTU photo(s) from this browser.`
            : '✓ No local RTU photos on this browser.',
        )
      } catch (error) {
        showToastError(error instanceof Error ? error.message : 'Could not clear local pictures')
      } finally {
        setUploadBusy(false)
      }
    })()
  }

  return (
    <Modal
      open={open}
      onClose={handleClose}
      preventClose={uploadBusy}
      title="Settings"
      width={420}
      align="right"
    >
      <div className={styles.body}>
        <section>
          <SettingsSectionLabel>Account</SettingsSectionLabel>
          {isAuthenticated ? (
            <div className={styles.tools}>
              <p className={styles.authStatus}>Signed in as {user?.email}</p>
              <Button type="button" variant="ghost" onClick={() => void signOut()}>
                Sign out
              </Button>
            </div>
          ) : (
            <div className={styles.tools}>
              <p className={styles.authStatus}>Sign in to edit map data, schedule, and pricing.</p>
              <Button type="button" onClick={onSignIn}>
                Sign in
              </Button>
            </div>
          )}
        </section>

        <section>
          <div className={styles.sectionLabel}>Colour theme</div>
          <select
            className={selectStyles.select}
            value={String(themeIndex)}
            onChange={(e) => handleThemeSelect(Number.parseInt(e.target.value, 10))}
            aria-label="Colour theme"
          >
            {APP_THEMES.map((theme, index) => (
              <option key={theme.name} value={String(index)}>
                {theme.name}
              </option>
            ))}
          </select>
        </section>

        <section>
          <SettingsSectionLabel
            help="Buildings stay on Manager 1–4. Pick a slot, edit the display name, then apply."
          >
            Property managers
          </SettingsSectionLabel>
          <PropertyManagerNamesEditor
            key={managerEditorKey}
            portfolio={portfolio}
            onPortfolioPatch={onPortfolioPatch}
          />
        </section>

        <section>
          <SettingsSectionLabel>Edits</SettingsSectionLabel>
          <div className={styles.tools}>
            <SettingsToolButton
              tooltip="Pick an RTU to show on the map, move its pin, or delete it."
              onClick={() => setRtuEditorOpen(true)}
            >
              Edit RTU
            </SettingsToolButton>
            <SettingsToolButton
              tooltip="Edit supply, install, and other per-tonnage replacement costs used by the cost estimator."
              onClick={() => setPricingOpen(true)}
            >
              Edit RTU&apos;s Pricing
            </SettingsToolButton>
            <SettingsToolButton
              tooltip="Turn on map edit mode: drag a box to select markers and polygons, then drag any selected item to move the group."
              onClick={handleEditPositions}
            >
              {dragMode
                ? `✓ Edit Multiple Positions (on${dragSelectedCount ? ` · ${dragSelectedCount} selected` : ''})`
                : 'Edit Multiple Positions'}
            </SettingsToolButton>
            {dragMode ? (
              <SettingsToolButton
                tooltip="Clear the current map selection without turning off edit mode."
                onClick={() => {
                  clearDragSelect()
                  handleClose()
                }}
                disabled={dragSelectedCount === 0}
              >
                Clear map selection
              </SettingsToolButton>
            ) : null}
            <SettingsToolButton
              tooltip="Place a new building, RTU, or utility marker on the map."
              onClick={() => {
                if (!isAuthenticated) {
                  showToastError('Sign in to add markers.')
                  return
                }
                handleClose()
                onOpenAddMarker()
              }}
            >
              Add marker
            </SettingsToolButton>
            <SettingsToolButton
              tooltip="Draw a new tenant polygon by clicking points on the map."
              onClick={() => {
                if (!isAuthenticated) {
                  showToastError('Sign in to add polygons.')
                  return
                }
                handleClose()
                onOpenPolygonDraw()
              }}
            >
              Add polygon
            </SettingsToolButton>
            <ImportExportButtons
              portfolio={portfolio}
              buildings={portfolio.buildings}
              onImport={handleImport}
              mode="import"
              isAuthenticated={isAuthenticated}
            />
            <RtuPictureGpsAssign onBusyChange={setUploadBusy} />
            <SettingsToolButton
              tooltip="Remove all RTU photos cached in this browser (IndexedDB)."
              onClick={handleClearAllLocalPictures}
              disabled={uploadBusy}
            >
              Clear all local RTU pictures
            </SettingsToolButton>
          </div>
        </section>

        <section>
          <SettingsSectionLabel>Export</SettingsSectionLabel>
          <div className={styles.tools}>
            <ImportExportButtons
              portfolio={portfolio}
              buildings={portfolio.buildings}
              onImport={handleImport}
              onExportComplete={handleClose}
              mode="export"
              isAuthenticated={isAuthenticated}
            />
          </div>
        </section>
      </div>
      <RtuPricingSettings open={pricingOpen} onClose={() => setPricingOpen(false)} />
      <RtuEditorSettings
        open={rtuEditorOpen}
        onClose={() => setRtuEditorOpen(false)}
        portfolio={portfolio}
        onPortfolioPatch={onPortfolioPatch}
      />
    </Modal>
  )
}

export function SettingsModal(props: SettingsModalProps) {
  const themeIndex = useSettingsStore((s) => s.themeIndex)
  if (!props.open) return null
  return <SettingsForm {...props} themeIndex={themeIndex} />
}
