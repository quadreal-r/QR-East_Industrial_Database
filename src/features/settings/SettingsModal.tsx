import { useState, useCallback, useMemo } from 'react'
import { ImportExportButtons } from '@/features/import-export/ImportExportButtons'
import { RtuPictureGpsAssign } from '@/features/settings/RtuPictureGpsAssign'
import { RtuPricingSettings } from '@/features/settings/RtuPricingSettings'
import { PolygonEditorSettings } from '@/features/settings/PolygonEditorSettings'
import { Inspection360EditorSettings } from '@/features/settings/Inspection360EditorSettings'
import { SettingsAccountPage } from '@/features/settings/SettingsAccountPage'
import { RtuEditorSettings } from '@/features/settings/RtuEditorSettings'
import { SettingsSectionLabel } from '@/features/settings/SettingsSectionLabel'
import { SettingsToolButton } from '@/features/settings/SettingsToolButton'
import { Modal } from '@/components/Modal/Modal'
import { APP_THEMES } from '@/lib/themes'
import selectStyles from '@/components/Select/Select.module.css'
import {
  applyManagerSlots,
  managerSlotLabel,
  managerSlotsFromPortfolio,
  type ManagerSlot,
} from '@/lib/managerNames'
import { showToastError, showToastSuccess } from '@/lib/toast'
import { useAuth } from '@/hooks/useAuth'
import { useSelectionStore } from '@/stores/selectionStore'
import { useSettingsStore } from '@/stores/settingsStore'
import type { PortfolioData } from '@/types/domain'
import styles from './SettingsModal.module.css'

type SettingsView = 'main' | 'account'

export interface SettingsModalProps {
  open: boolean
  onClose: () => void
  portfolio: PortfolioData
  onImport: (data: PortfolioData) => void
  onPortfolioPatch: (data: PortfolioData) => void
  /** Write pending portfolio to Supabase immediately (used by Edit 360° Gates). */
  onPersistPortfolio: (data: PortfolioData) => Promise<void>
  onOpenPolygonDraw: () => void
  onOpenAddMarker: () => void
  onOpenAddInspection360: () => void
  onSaved?: () => void
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
  const { canEdit } = useAuth()

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
    if (!canEdit) {
      showToastError('Admin access is required to save manager names.')
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
  onPersistPortfolio,
  onOpenPolygonDraw,
  onOpenAddMarker,
  onOpenAddInspection360,
}: SettingsFormProps) {
  const setThemeIndex = useSettingsStore((s) => s.setThemeIndex)
  const applyTheme = useSettingsStore((s) => s.applyTheme)
  const saveSettings = useSettingsStore((s) => s.saveSettings)
  const { isAuthenticated, canEdit, role, user } = useAuth()

  const dragMode = useSelectionStore((s) => s.dragMode)
  const dragSelectedCount = useSelectionStore((s) => s.dragSelectedKeys.length)
  const setDragMode = useSelectionStore((s) => s.setDragMode)
  const clearDragSelect = useSelectionStore((s) => s.clearDragSelect)

  const [uploadBusy, setUploadBusy] = useState(false)
  const [pricingOpen, setPricingOpen] = useState(false)
  const [rtuEditorOpen, setRtuEditorOpen] = useState(false)
  const [polygonEditorOpen, setPolygonEditorOpen] = useState(false)
  const [inspection360EditorOpen, setInspection360EditorOpen] = useState(false)
  const [settingsView, setSettingsView] = useState<SettingsView>('main')

  const managerEditorKey = useMemo(() => {
    if (!open) return 'closed'
    const renames = useSettingsStore.getState().managerRenames
    return managerSlotsFromPortfolio(portfolio.buildings, renames)
      .map((slot) => `${slot.key}\t${slot.name}`)
      .join('|')
  }, [open, portfolio.buildings])

  const handleClose = useCallback(() => {
    if (uploadBusy) return
    setSettingsView('main')
    onClose()
  }, [onClose, uploadBusy])

  const handleThemeSelect = (index: number) => {
    applyTheme(index)
    setThemeIndex(index)
    if (canEdit) void saveSettings()
  }

  const handleEditPositions = () => {
    if (!canEdit) {
      showToastError('Admin access is required to edit map positions.')
      return
    }
    setDragMode(!dragMode)
    handleClose()
  }

  const handleImport = (data: PortfolioData) => {
    onImport(data)
    handleClose()
  }

  return (
    <Modal
      open={open}
      onClose={handleClose}
      preventClose={uploadBusy}
      title={settingsView === 'account' ? 'Account' : 'Settings'}
      onBack={settingsView === 'account' ? () => setSettingsView('main') : undefined}
      backLabel="Back to settings"
      width={420}
      align="right"
    >
      {settingsView === 'account' ? (
        <SettingsAccountPage />
      ) : (
      <div className={styles.body}>
        <section>
          {isAuthenticated ? (
            <p className={styles.authStatus}>
              {user?.email} · {role === 'admin' ? 'Admin' : 'Viewer'}
            </p>
          ) : (
            <p className={styles.authStatus}>Connecting to your Access session…</p>
          )}
          <SettingsToolButton
            tooltip="View your Access identity, role, and logout."
            onClick={() => setSettingsView('account')}
          >
            Account
          </SettingsToolButton>
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

        {canEdit ? (
          <>
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
                  tooltip="Edit suite (sky blue), electrical (green), and sprinkler (yellow) 360° sphere gates — link tour URLs and rename."
                  onClick={() => setInspection360EditorOpen(true)}
                >
                  Edit 360° Gates
                </SettingsToolButton>
                <SettingsToolButton
                  tooltip="Place a new building, RTU, or utility marker on the map."
                  onClick={() => {
                    handleClose()
                    onOpenAddMarker()
                  }}
                >
                  Add marker
                </SettingsToolButton>
                <SettingsToolButton
                  tooltip="Draw a new tenant polygon by clicking points on the map."
                  onClick={() => {
                    handleClose()
                    onOpenPolygonDraw()
                  }}
                >
                  Add polygon
                </SettingsToolButton>
                <SettingsToolButton
                  tooltip="Edit vertex points, show a polygon on the map, or delete tenant polygons."
                  onClick={() => setPolygonEditorOpen(true)}
                >
                  Edit Polygons
                </SettingsToolButton>
                <RtuPictureGpsAssign onBusyChange={setUploadBusy} />
              </div>
            </section>

            <section>
              <SettingsSectionLabel>Export/Import</SettingsSectionLabel>
              <div className={styles.tools}>
                <ImportExportButtons
                  portfolio={portfolio}
                  buildings={portfolio.buildings}
                  onImport={handleImport}
                  onExportComplete={handleClose}
                  mode="both"
                  canEdit={canEdit}
                />
              </div>
            </section>
          </>
        ) : (
          <section>
            <SettingsSectionLabel>Viewer access</SettingsSectionLabel>
            <p className={styles.authLockedHint}>
              Viewers can browse, export, and edit Cost Center RTU $ Allocations and notes. Admin
              access is required for other edits or import.
            </p>
            <ImportExportButtons
              portfolio={portfolio}
              buildings={portfolio.buildings}
              onImport={handleImport}
              onExportComplete={handleClose}
              mode="export"
              canEdit={false}
            />
          </section>
        )}
      </div>
      )}
      <RtuPricingSettings open={pricingOpen} onClose={() => setPricingOpen(false)} />
      <RtuEditorSettings
        open={rtuEditorOpen}
        onClose={() => setRtuEditorOpen(false)}
        portfolio={portfolio}
        onPortfolioPatch={onPortfolioPatch}
      />
      <PolygonEditorSettings
        open={polygonEditorOpen}
        onClose={() => setPolygonEditorOpen(false)}
        portfolio={portfolio}
        onPortfolioPatch={onPortfolioPatch}
      />
      <Inspection360EditorSettings
        open={inspection360EditorOpen}
        onClose={() => setInspection360EditorOpen(false)}
        portfolio={portfolio}
        onPortfolioPatch={onPortfolioPatch}
        onPersistPortfolio={onPersistPortfolio}
        onOpenAddInspection360={() => {
          setInspection360EditorOpen(false)
          handleClose()
          onOpenAddInspection360()
        }}
      />
    </Modal>
  )
}

export function SettingsModal(props: SettingsModalProps) {
  const themeIndex = useSettingsStore((s) => s.themeIndex)
  if (!props.open) return null
  return <SettingsForm {...props} themeIndex={themeIndex} />
}
