import { useCallback, useEffect, useState } from 'react'
import { confirm } from '@/stores/confirmStore'
import { deleteRtuPicture, listRtuPictures, saveRtuPictureEdit } from '@/lib/rtuPictures'
import { showToastError, showToastSuccess } from '@/lib/toast'
import type { RtuPictureViewerItem } from '@/stores/uiStore'
import { useImageEditor } from './useImageEditor'
import styles from './RtuPictureViewer.module.css'

export type { RtuPictureViewerItem }

export interface RtuPictureViewerProps {
  open: boolean
  pictures: RtuPictureViewerItem[]
  index: number
  rtuName: string
  buildingAddress: string
  onClose: () => void
  onIndexChange: (index: number) => void
  onPicturesUpdated: (pictures: RtuPictureViewerItem[], index?: number) => void
}

const FONT_OPTIONS = [
  'Arial',
  'Helvetica',
  'Verdana',
  'Trebuchet MS',
  'Georgia',
  'Times New Roman',
  'Courier New',
  'Impact',
  'Comic Sans MS',
]

export function RtuPictureViewer({
  open,
  pictures,
  index,
  rtuName,
  buildingAddress,
  onClose,
  onIndexChange,
  onPicturesUpdated,
}: RtuPictureViewerProps) {
  const current = pictures[index]
  const total = pictures.length
  const {
    stageRef,
    canvasRef,
    mode,
    setMode,
    loading,
    loadError,
    zoomPct,
    dims,
    fileSize,
    sourceFileName,
    taken,
    location,
    locationHref,
    editCount,
    pendingAngle,
    textSettings,
    setTextSettings,
    saveFormat,
    setSaveFormat,
    quality,
    setQuality,
    cropDisabled,
    undoDisabled,
    resetDisabled,
    applyRotDisabled,
    placeTextDisabled,
    canSaveToMap,
    loadFromUrl,
    resetSession,
    cropToSelection,
    undo,
    resetToOriginal,
    save,
    printImage,
    rotateLeft,
    rotateRight,
    previewRotation,
    applyRotation,
    clearRotationPreview,
    placeText,
    toggleBold,
    toggleItalic,
    onStagePointerDown,
    onStagePointerMove,
    onStagePointerUp,
    onStageContextMenu,
    onKeyDown,
    getEditedBlob,
  } = useImageEditor()
  const [savingToMap, setSavingToMap] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const revokeBlobUrls = useCallback((items: RtuPictureViewerItem[]) => {
    for (const pic of items) {
      if (pic.fullUrl.startsWith('blob:')) URL.revokeObjectURL(pic.fullUrl)
      if (pic.thumbUrl.startsWith('blob:') && pic.thumbUrl !== pic.fullUrl) {
        URL.revokeObjectURL(pic.thumbUrl)
      }
    }
  }, [])

  const handleSaveToMap = useCallback(async () => {
    if (!current || savingToMap || !canSaveToMap) return
    setSavingToMap(true)
    try {
      const blob = await getEditedBlob('image/jpeg', quality)
      if (!blob) throw new Error('No image to save')
      await saveRtuPictureEdit(buildingAddress, rtuName, current.index, blob, current.fileName)
      revokeBlobUrls(pictures)
      const nextPictures = await listRtuPictures(buildingAddress, rtuName)
      const items = nextPictures.map((p) => ({
        fileName: p.fileName,
        fullUrl: p.fullUrl,
        thumbUrl: p.thumbUrl,
        index: p.index,
      }))
      const nextIndex = items.findIndex((p) => p.index === current.index)
      onPicturesUpdated(items, nextIndex >= 0 ? nextIndex : index)
      showToastSuccess(
        '✓ Saved to map — use Settings → Sync to Cloudflare & GitHub to publish to R2.',
      )
    } catch (error) {
      showToastError(error instanceof Error ? error.message : 'Failed to save picture to map')
    } finally {
      setSavingToMap(false)
    }
  }, [
    buildingAddress,
    canSaveToMap,
    current,
    getEditedBlob,
    index,
    onPicturesUpdated,
    pictures,
    quality,
    revokeBlobUrls,
    rtuName,
    savingToMap,
  ])

  const handleDelete = useCallback(async () => {
    if (!current || deleting) return
    const message = `Delete "${current.fileName}" from Cloudflare and the map? This cannot be undone.`
    if (!(await confirm(message))) return

    setDeleting(true)
    try {
      const result = await deleteRtuPicture(buildingAddress, rtuName, current.fileName)
      if (result === 'not-found') {
        showToastError('Picture not found')
        return
      }

      revokeBlobUrls(pictures)
      const nextPictures = await listRtuPictures(buildingAddress, rtuName)
      const items = nextPictures.map((p) => ({
        fileName: p.fileName,
        fullUrl: p.fullUrl,
        thumbUrl: p.thumbUrl,
        index: p.index,
      }))

      if (!items.length) {
        showToastSuccess('Picture deleted')
        onClose()
        return
      }

      const nextIndex = Math.min(index, items.length - 1)
      onPicturesUpdated(items, nextIndex)
      showToastSuccess('Picture deleted from Cloudflare and the map')
    } catch (error) {
      showToastError(error instanceof Error ? error.message : 'Failed to delete picture')
    } finally {
      setDeleting(false)
    }
  }, [
    buildingAddress,
    current,
    deleting,
    index,
    onClose,
    onPicturesUpdated,
    pictures,
    revokeBlobUrls,
    rtuName,
  ])

  useEffect(() => {
    if (!open || !current) {
      resetSession()
      return
    }
    void loadFromUrl(current.fullUrl, current.fileName)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload when picture changes
  }, [open, current?.fullUrl, current?.fileName])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      onKeyDown(e as unknown as React.KeyboardEvent<HTMLDivElement>)
      const inField = /^(INPUT|SELECT|TEXTAREA)$/.test((e.target as HTMLElement).tagName)
      if (inField) return
      if (e.key === 'ArrowLeft' && index > 0) {
        e.preventDefault()
        onIndexChange(index - 1)
      }
      if (e.key === 'ArrowRight' && index < total - 1) {
        e.preventDefault()
        onIndexChange(index + 1)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- editor handlers are stable enough per session
  }, [open, index, total, onIndexChange])

  if (!open || !current) return null

  return (
    <div
      className={styles.overlay}
      role="dialog"
      aria-modal="true"
      aria-label="RTU picture viewer"
    >
      <header className={styles.header}>
        <div className={styles.headerText}>
          <div className={styles.title}>{rtuName}</div>
          <div className={styles.subtitle}>
            {buildingAddress} · {current.fileName} · {index + 1} / {total}
          </div>
        </div>
        <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="Close viewer">
          ×
        </button>
      </header>

      <div className={styles.bar}>
        <button
          type="button"
          className={`${styles.toolBtn}${mode === 'select' ? ` ${styles.toolBtnActive}` : ''}`}
          onClick={() => setMode('select')}
        >
          Select
        </button>
        <button
          type="button"
          className={`${styles.toolBtn}${mode === 'text' ? ` ${styles.toolBtnActive}` : ''}`}
          onClick={() => setMode('text')}
        >
          Text
        </button>
        <span className={styles.sep} />
        <button
          type="button"
          className={styles.toolBtnPrimary}
          disabled={cropDisabled}
          onClick={cropToSelection}
        >
          Crop ⤵
        </button>
        <button type="button" className={styles.toolBtn} disabled={undoDisabled} onClick={undo}>
          Undo
        </button>
        <button
          type="button"
          className={styles.toolBtn}
          disabled={resetDisabled}
          onClick={resetToOriginal}
        >
          Reset
        </button>
        {buildingAddress ? (
          <button
            type="button"
            className={styles.saveBtn}
            disabled={!canSaveToMap || savingToMap || deleting}
            onClick={() => void handleSaveToMap()}
          >
            {savingToMap ? 'Saving…' : 'Save to map'}
          </button>
        ) : null}
        {buildingAddress ? (
          <button
            type="button"
            className={styles.deleteBtn}
            disabled={deleting || savingToMap}
            onClick={() => void handleDelete()}
            title="Delete from Cloudflare and the map"
          >
            {deleting ? 'Deleting…' : 'Delete'}
          </button>
        ) : null}
        <span className={styles.sep} />
        <select
          className={`${styles.select} ${styles.formatSelect}`}
          value={saveFormat}
          onChange={(e) => setSaveFormat(e.target.value as 'png' | 'jpg' | 'pdf')}
          aria-label="Download format"
          title="Download format"
        >
          <option value="png">PNG</option>
          <option value="jpg">JPG</option>
          <option value="pdf">PDF</option>
        </select>
        {saveFormat !== 'png' ? (
          <label className={styles.label}>
            Quality
            <input
              type="range"
              className={styles.range}
              min={0.4}
              max={1}
              step={0.05}
              value={quality}
              onChange={(e) => setQuality(Number.parseFloat(e.target.value))}
            />
          </label>
        ) : null}
        <button type="button" className={styles.toolBtn} onClick={() => save(current.fileName)}>
          Download
        </button>
        <button type="button" className={styles.toolBtn} onClick={printImage}>
          Print
        </button>
        <span className={styles.sep} />
        <button type="button" className={styles.toolBtn} onClick={rotateLeft}>
          ⟲ Left
        </button>
        <button type="button" className={styles.toolBtn} onClick={rotateRight}>
          Right ⟳
        </button>
        <label className={styles.label}>
          Fine
          <input
            type="range"
            className={styles.range}
            min={-45}
            max={45}
            step={0.5}
            value={pendingAngle}
            onChange={(e) => previewRotation(Number.parseFloat(e.target.value))}
          />
        </label>
        <span className={styles.angleLbl}>{pendingAngle}°</span>
        <button
          type="button"
          className={styles.toolBtn}
          disabled={applyRotDisabled}
          onClick={applyRotation}
        >
          Apply
        </button>
        <button type="button" className={styles.toolBtn} onClick={clearRotationPreview}>
          ↺
        </button>
        <span className={styles.spacer} />
        <span className={styles.hint}>
          Edits: <b>{editCount}</b>
        </span>
      </div>

      {mode === 'text' ? (
        <div className={styles.textBar}>
          <input
            type="text"
            className={styles.textInput}
            value={textSettings.text}
            placeholder="Text…"
            onChange={(e) => setTextSettings((s) => ({ ...s, text: e.target.value }))}
          />
          <select
            className={styles.select}
            value={textSettings.family}
            onChange={(e) => setTextSettings((s) => ({ ...s, family: e.target.value }))}
          >
            {FONT_OPTIONS.map((font) => (
              <option key={font} value={font}>
                {font}
              </option>
            ))}
          </select>
          <label className={styles.label}>
            Size
            <input
              type="number"
              className={styles.numberInput}
              min={4}
              max={600}
              value={textSettings.size}
              onChange={(e) =>
                setTextSettings((s) => ({ ...s, size: Number.parseInt(e.target.value, 10) || 48 }))
              }
            />
          </label>
          <input
            type="color"
            className={styles.colorInput}
            value={textSettings.color}
            onChange={(e) => setTextSettings((s) => ({ ...s, color: e.target.value }))}
          />
          <button
            type="button"
            className={`${styles.toolBtn}${textSettings.bold ? ` ${styles.toolBtnActive}` : ''}`}
            onClick={toggleBold}
          >
            <b>B</b>
          </button>
          <button
            type="button"
            className={`${styles.toolBtn}${textSettings.italic ? ` ${styles.toolBtnActive}` : ''}`}
            onClick={toggleItalic}
          >
            <i>I</i>
          </button>
          <button
            type="button"
            className={styles.toolBtnPrimary}
            disabled={placeTextDisabled}
            onClick={placeText}
          >
            Place text
          </button>
          <span className={styles.hint}>
            click the image and type · drag to move · Enter places · Esc cancels
          </span>
        </div>
      ) : null}

      <div
        ref={stageRef}
        className={`${styles.stage}${mode === 'text' ? ` ${styles.stageText}` : ''}`}
        onPointerDown={onStagePointerDown}
        onPointerMove={onStagePointerMove}
        onPointerUp={onStagePointerUp}
        onContextMenu={onStageContextMenu}
      >
        {total > 1 ? (
          <>
            <button
              type="button"
              className={`${styles.stageNav} ${styles.stageNavPrev}`}
              disabled={index <= 0}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation()
                onIndexChange(index - 1)
              }}
              aria-label="Previous picture"
              title="Previous picture (←)"
            >
              ‹
            </button>
            <button
              type="button"
              className={`${styles.stageNav} ${styles.stageNavNext}`}
              disabled={index >= total - 1}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation()
                onIndexChange(index + 1)
              }}
              aria-label="Next picture"
              title="Next picture (→)"
            >
              ›
            </button>
          </>
        ) : null}
        <canvas ref={canvasRef} className={styles.canvas} />
        {loading ? <p className={styles.stageMessage}>Loading…</p> : null}
        {loadError ? (
          <p className={styles.stageMessage}>
            Could not load this picture from Cloudflare. The file may be missing on the CDN — use Add
            pictures to upload a replacement, or sync from Settings.
          </p>
        ) : null}
      </div>

      <footer className={styles.footer}>
        <span>
          Zoom: <b>{zoomPct}</b>
        </span>
        <span>
          Size: <b>{dims}</b>
        </span>
        <span title={sourceFileName ?? undefined}>
          File: <b>{fileSize}</b>
        </span>
        <span>
          Taken: <b>{taken}</b>
        </span>
        <span>
          Location:{' '}
          <b>
            {locationHref ? (
              <a href={locationHref} target="_blank" rel="noopener noreferrer" className={styles.link}>
                {location}
              </a>
            ) : (
              location
            )}
          </b>
        </span>
        <span className={styles.spacer} />
        <button
          type="button"
          className={styles.toolBtn}
          disabled={index <= 0}
          onClick={() => onIndexChange(index - 1)}
        >
          ← Previous
        </button>
        <button
          type="button"
          className={styles.toolBtn}
          disabled={index >= total - 1}
          onClick={() => onIndexChange(index + 1)}
        >
          Next →
        </button>
        <span className={styles.hint}>drag box · click inside zooms · right-drag pans</span>
      </footer>
    </div>
  )
}
