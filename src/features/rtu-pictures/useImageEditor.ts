import { useCallback, useEffect, useRef, useState } from 'react'
import {
  type EditorImage,
  type EditorMode,
  type ExifData,
  type PendingText,
  type ScreenRect,
  type TextSettings,
  downloadBlob,
  downloadFileNameForFormat,
  downloadUrlAsFile,
  exportCanvasBlob,
  flattenImage,
  fontString,
  formatExifDate,
  formatFileFooterLabel,
  humanFileSize,
  insideRect,
  loadEditableImageFromUrl,
  makeRotated,
  MAX_ZOOM,
  MIN_ZOOM,
  normRect,
  savePdf,
  toWorld,
} from './imageEditorCore'

export interface UseImageEditorResult {
  stageRef: React.RefObject<HTMLDivElement | null>
  canvasRef: React.RefObject<HTMLCanvasElement | null>
  mode: EditorMode
  setMode: (mode: EditorMode) => void
  loading: boolean
  loadError: boolean
  zoomPct: string
  dims: string
  fileSize: string
  sourceFileName: string | null
  taken: string
  location: string
  locationHref: string | null
  editCount: number
  pendingAngle: number
  textSettings: TextSettings
  setTextSettings: React.Dispatch<React.SetStateAction<TextSettings>>
  saveFormat: 'png' | 'jpg' | 'pdf'
  setSaveFormat: (fmt: 'png' | 'jpg' | 'pdf') => void
  quality: number
  setQuality: (q: number) => void
  cropDisabled: boolean
  undoDisabled: boolean
  resetDisabled: boolean
  applyRotDisabled: boolean
  placeTextDisabled: boolean
  loadFromUrl: (url: string, fileName?: string) => Promise<void>
  resetSession: () => void
  cropToSelection: () => void
  undo: () => void
  resetToOriginal: () => void
  save: (fileName?: string) => Promise<'downloaded' | 'opened'>
  printImage: () => void
  rotateLeft: () => void
  rotateRight: () => void
  previewRotation: (angle: number) => void
  applyRotation: () => void
  clearRotationPreview: () => void
  placeText: () => void
  toggleBold: () => void
  toggleItalic: () => void
  onStagePointerDown: (e: React.PointerEvent) => void
  onStagePointerMove: (e: React.PointerEvent) => void
  onStagePointerUp: (e: React.PointerEvent) => void
  onStageContextMenu: (e: React.MouseEvent) => void
  onKeyDown: (e: React.KeyboardEvent) => void
  getEditedDataUrl: () => string | null
  getEditedBlob: (mimeType?: 'image/jpeg' | 'image/png', jpegQuality?: number) => Promise<Blob | null>
  canSaveToMap: boolean
}

const DEFAULT_TEXT: TextSettings = {
  text: 'Label',
  family: 'Arial',
  size: 48,
  color: '#ffcc00',
  bold: false,
  italic: false,
}

export function useImageEditor(): UseImageEditorResult {
  const stageRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const imgRef = useRef<EditorImage | null>(null)
  const originalRef = useRef<EditorImage | null>(null)
  const historyRef = useRef<EditorImage[]>([])
  const scaleRef = useRef(1)
  const offsetRef = useRef({ x: 0, y: 0 })
  const selRef = useRef<ScreenRect | null>(null)
  const previewImgRef = useRef<EditorImage | null>(null)
  const pendingAngleRef = useRef(0)
  const pendingTextRef = useRef<PendingText | null>(null)
  const editingRef = useRef(false)
  const downRef = useRef<{ x: number; y: number } | null>(null)
  const movedRef = useRef(false)
  const panningRef = useRef(false)
  const panLastRef = useRef<{ x: number; y: number } | null>(null)
  const dragTextRef = useRef<{ dx: number; dy: number } | null>(null)
  const animRef = useRef<number | null>(null)
  const sourceUrlRef = useRef<string | null>(null)
  const objectUrlRef = useRef<string | null>(null)

  const [mode, setModeState] = useState<EditorMode>('select')
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const [zoomPct, setZoomPct] = useState('—')
  const [dims, setDims] = useState('—')
  const [fileSize, setFileSize] = useState('—')
  const [sourceFileName, setSourceFileName] = useState<string | null>(null)
  const [taken, setTaken] = useState('—')
  const [location, setLocation] = useState('—')
  const [locationHref, setLocationHref] = useState<string | null>(null)
  const [editCount, setEditCount] = useState(0)
  const [pendingAngle, setPendingAngle] = useState(0)
  const [textSettings, setTextSettings] = useState<TextSettings>(DEFAULT_TEXT)
  const [saveFormat, setSaveFormat] = useState<'png' | 'jpg' | 'pdf'>('png')
  const [quality, setQuality] = useState(0.92)
  const [cropDisabled, setCropDisabled] = useState(true)
  const [undoDisabled, setUndoDisabled] = useState(true)
  const [resetDisabled, setResetDisabled] = useState(true)
  const [applyRotDisabled, setApplyRotDisabled] = useState(true)
  const [placeTextDisabled, setPlaceTextDisabled] = useState(true)
  const [hasImage, setHasImage] = useState(false)

  const currentImage = () => previewImgRef.current || imgRef.current

  const updateUi = useCallback(() => {
    const img = imgRef.current
    const original = originalRef.current
    const sel = selRef.current
    const preview = previewImgRef.current
    const pendingText = pendingTextRef.current
    setEditCount(historyRef.current.length)
    setPendingAngle(pendingAngleRef.current)
    setHasImage(Boolean(preview || img))
    setCropDisabled(!(sel && !preview))
    setUndoDisabled(historyRef.current.length === 0)
    setResetDisabled(img === original && historyRef.current.length === 0)
    setApplyRotDisabled(!preview)
    setPlaceTextDisabled(!(pendingText && mode === 'text'))
  }, [mode])

  const draw = useCallback(() => {
    const stage = stageRef.current
    const canvas = canvasRef.current
    if (!stage || !canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const viewW = stage.clientWidth
    const viewH = stage.clientHeight
    ctx.clearRect(0, 0, viewW, viewH)

    const im = currentImage()
    if (!im) {
      setZoomPct('—')
      return
    }

    const scale = scaleRef.current
    const offset = offsetRef.current
    ctx.imageSmoothingEnabled = scale < 1
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(im, offset.x, offset.y, im.width * scale, im.height * scale)

    const sel = selRef.current
    if (sel && !previewImgRef.current) {
      ctx.save()
      ctx.fillStyle = 'rgba(10,12,14,.55)'
      ctx.beginPath()
      ctx.rect(0, 0, viewW, viewH)
      ctx.rect(sel.x, sel.y, sel.w, sel.h)
      ctx.fill('evenodd')
      ctx.strokeStyle = '#5fb0ff'
      ctx.lineWidth = 1
      ctx.setLineDash([5, 4])
      ctx.strokeRect(sel.x + 0.5, sel.y + 0.5, sel.w, sel.h)
      ctx.restore()
    }

    const pendingText = pendingTextRef.current
    if (pendingText && !previewImgRef.current) {
      ctx.save()
      ctx.font = fontString(pendingText.size * scale, pendingText)
      const w = ctx.measureText(pendingText.text || ' ').width
      const sx = offset.x + pendingText.x * scale
      const sy = offset.y + pendingText.y * scale
      const h = pendingText.size * scale
      ctx.textBaseline = 'top'
      ctx.textAlign = 'left'
      ctx.fillStyle = pendingText.color
      ctx.fillText(pendingText.text, sx, sy)
      ctx.strokeStyle = '#5fb0ff'
      ctx.setLineDash([4, 3])
      ctx.lineWidth = 1
      ctx.strokeRect(sx - 3.5, sy - 3.5, Math.max(w, 8) + 7, h + 7)
      if (editingRef.current) {
        ctx.setLineDash([])
        ctx.lineWidth = Math.max(1.5, pendingText.size * scale * 0.06)
        const cx = sx + w + 1
        ctx.beginPath()
        ctx.moveTo(cx, sy)
        ctx.lineTo(cx, sy + h)
        ctx.stroke()
      }
      ctx.restore()
    }

    setZoomPct(`${Math.round(scale * 100)}%`)
  }, [])

  const resizeCanvas = useCallback(() => {
    const stage = stageRef.current
    const canvas = canvasRef.current
    if (!stage || !canvas) return
    const rect = stage.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.round(rect.width * dpr)
    canvas.height = Math.round(rect.height * dpr)
    canvas.style.width = `${rect.width}px`
    canvas.style.height = `${rect.height}px`
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    draw()
  }, [draw])

  const applyFit = useCallback(() => {
    const stage = stageRef.current
    const im = currentImage()
    if (!stage || !im) return
    const viewW = stage.clientWidth
    const viewH = stage.clientHeight
    scaleRef.current = Math.min(viewW / im.width, viewH / im.height, 1)
    offsetRef.current = {
      x: (viewW - im.width * scaleRef.current) / 2,
      y: (viewH - im.height * scaleRef.current) / 2,
    }
    selRef.current = null
    setDims(`${im.width} × ${im.height}`)
    updateUi()
    draw()
  }, [draw, updateUi])

  const setScaleAt = useCallback(
    (nextScale: number, sx: number, sy: number) => {
      const scale = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, nextScale))
      const wx = (sx - offsetRef.current.x) / scaleRef.current
      const wy = (sy - offsetRef.current.y) / scaleRef.current
      scaleRef.current = scale
      offsetRef.current = { x: sx - wx * scale, y: sy - wy * scale }
      draw()
    },
    [draw],
  )

  const animateTo = useCallback(
    (targetScale: number, targetX: number, targetY: number) => {
      const fromScale = scaleRef.current
      const fromX = offsetRef.current.x
      const fromY = offsetRef.current.y
      const start = performance.now()
      const duration = 240
      const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2)
      if (animRef.current != null) cancelAnimationFrame(animRef.current)
      const step = (now: number) => {
        const k = ease(Math.min(1, (now - start) / duration))
        scaleRef.current = fromScale + (targetScale - fromScale) * k
        offsetRef.current = {
          x: fromX + (targetX - fromX) * k,
          y: fromY + (targetY - fromY) * k,
        }
        draw()
        if (k < 1) animRef.current = requestAnimationFrame(step)
      }
      animRef.current = requestAnimationFrame(step)
    },
    [draw],
  )

  const zoomToSelection = useCallback(
    (sel: ScreenRect) => {
      const stage = stageRef.current
      const img = imgRef.current
      if (previewImgRef.current || !img || !stage || sel.w < 3 || sel.h < 3) return
      const scale = scaleRef.current
      const offset = offsetRef.current
      const wx = (sel.x - offset.x) / scale
      const wy = (sel.y - offset.y) / scale
      const ww = sel.w / scale
      const wh = sel.h / scale
      const viewW = stage.clientWidth
      const viewH = stage.clientHeight
      const target = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.min(viewW / ww, viewH / wh)))
      animateTo(target, viewW / 2 - (wx + ww / 2) * target, viewH / 2 - (wy + wh / 2) * target)
      selRef.current = null
      updateUi()
    },
    [animateTo, updateUi],
  )

  const clearRotationPreview = useCallback(() => {
    previewImgRef.current = null
    pendingAngleRef.current = 0
    setPendingAngle(0)
    updateUi()
  }, [updateUi])

  const cropToSelection = useCallback(() => {
    const img = imgRef.current
    const sel = selRef.current
    if (previewImgRef.current || !img || !sel || sel.w < 3 || sel.h < 3) return
    const scale = scaleRef.current
    const offset = offsetRef.current
    const sx = (sel.x - offset.x) / scale
    const sy = (sel.y - offset.y) / scale
    const sw = sel.w / scale
    const sh = sel.h / scale
    const x0 = Math.max(0, sx)
    const y0 = Math.max(0, sy)
    const x1 = Math.min(img.width, sx + sw)
    const y1 = Math.min(img.height, sy + sh)
    const cw = Math.round(x1 - x0)
    const ch = Math.round(y1 - y0)
    if (cw < 1 || ch < 1) return
    const canvas = document.createElement('canvas')
    canvas.width = cw
    canvas.height = ch
    canvas.getContext('2d')?.drawImage(img, x0, y0, x1 - x0, y1 - y0, 0, 0, cw, ch)
    historyRef.current.push(img)
    imgRef.current = canvas
    selRef.current = null
    applyFit()
  }, [applyFit])

  const rotate90 = useCallback(
    (dir: number) => {
      const img = imgRef.current
      if (!img) return
      clearRotationPreview()
      historyRef.current.push(img)
      imgRef.current = makeRotated(img, dir > 0 ? 90 : -90)
      pendingTextRef.current = null
      editingRef.current = false
      applyFit()
    },
    [applyFit, clearRotationPreview],
  )

  const previewRotation = useCallback(
    (angle: number) => {
      const img = imgRef.current
      if (!img) return
      pendingAngleRef.current = angle
      setPendingAngle(angle)
      previewImgRef.current = angle ? makeRotated(img, angle) : null
      selRef.current = null
      pendingTextRef.current = null
      editingRef.current = false
      applyFit()
    },
    [applyFit],
  )

  const applyRotation = useCallback(() => {
    const preview = previewImgRef.current
    const img = imgRef.current
    if (!preview || !img) return
    historyRef.current.push(img)
    imgRef.current = preview
    clearRotationPreview()
    applyFit()
  }, [applyFit, clearRotationPreview])

  const placeText = useCallback(() => {
    const pendingText = pendingTextRef.current
    const img = imgRef.current
    if (!pendingText || !img) return
    if (!pendingText.text.trim()) {
      pendingTextRef.current = null
      editingRef.current = false
      updateUi()
      draw()
      return
    }
    const canvas = document.createElement('canvas')
    canvas.width = img.width
    canvas.height = img.height
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.drawImage(img, 0, 0)
    ctx.font = fontString(pendingText.size, pendingText)
    ctx.textBaseline = 'top'
    ctx.textAlign = 'left'
    ctx.fillStyle = pendingText.color
    ctx.fillText(pendingText.text, pendingText.x, pendingText.y)
    historyRef.current.push(img)
    imgRef.current = canvas
    pendingTextRef.current = null
    editingRef.current = false
    updateUi()
    draw()
  }, [draw, updateUi])

  const undo = useCallback(() => {
    if (!historyRef.current.length) return
    imgRef.current = historyRef.current.pop() ?? null
    clearRotationPreview()
    pendingTextRef.current = null
    editingRef.current = false
    applyFit()
  }, [applyFit, clearRotationPreview])

  const resetToOriginal = useCallback(() => {
    const original = originalRef.current
    if (!original) return
    imgRef.current = original
    historyRef.current = []
    clearRotationPreview()
    pendingTextRef.current = null
    editingRef.current = false
    applyFit()
  }, [applyFit, clearRotationPreview])

  const revokeObjectUrl = useCallback(() => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current)
      objectUrlRef.current = null
    }
  }, [])

  const resetSession = useCallback(() => {
    revokeObjectUrl()
    sourceUrlRef.current = null
    imgRef.current = null
    originalRef.current = null
    historyRef.current = []
    selRef.current = null
    previewImgRef.current = null
    pendingTextRef.current = null
    editingRef.current = false
    pendingAngleRef.current = 0
    setPendingAngle(0)
    setModeState('select')
    setLoadError(false)
    setLoading(false)
    setZoomPct('—')
    setDims('—')
    setFileSize('—')
    setSourceFileName(null)
    setTaken('—')
    setLocation('—')
    setLocationHref(null)
    setEditCount(0)
    updateUi()
    draw()
  }, [draw, revokeObjectUrl, updateUi])

  const applyExif = useCallback(async (ex: ExifData | null, byteLength?: number) => {
    setTaken(ex?.dateTaken ? formatExifDate(ex.dateTaken) : ex ? 'unknown' : 'no EXIF')
    if (byteLength != null) setFileSize(humanFileSize(byteLength))
    if (ex?.lat != null && ex.lon != null) {
      const coords = `${ex.lat.toFixed(5)}, ${ex.lon.toFixed(5)}`
      setLocation(coords)
      setLocationHref(`https://www.google.com/maps?q=${ex.lat},${ex.lon}`)
      try {
        const r = await fetch(
          `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${ex.lat}&lon=${ex.lon}`,
        )
        if (r.ok) {
          const data = (await r.json()) as { address?: Record<string, string> }
          const a = data.address ?? {}
          const road = [a.house_number, a.road].filter(Boolean).join(' ')
          const city = a.city || a.town || a.village || a.suburb || a.municipality || a.county || ''
          const addr = [road, city].filter(Boolean).join(', ')
          if (addr) setLocation(addr)
        }
      } catch {
        /* keep coordinates */
      }
    } else {
      setLocation(ex ? 'no GPS' : '—')
      setLocationHref(null)
    }
  }, [])

  const loadFromUrl = useCallback(
    async (url: string, fileName?: string) => {
      setLoading(true)
      setLoadError(false)
      try {
        revokeObjectUrl()
        sourceUrlRef.current = url
        const loaded = await loadEditableImageFromUrl(url, fileName)
        objectUrlRef.current = loaded.objectUrl
        imgRef.current = loaded.img
        originalRef.current = loaded.img
        historyRef.current = []
        clearRotationPreview()
        pendingTextRef.current = null
        editingRef.current = false
        setModeState('select')
        setSourceFileName(fileName ?? null)
        await applyExif(loaded.exif, loaded.byteLength)
        if (loaded.byteLength == null) setFileSize(formatFileFooterLabel(undefined, fileName))
        applyFit()
      } catch {
        setLoadError(true)
        imgRef.current = null
        originalRef.current = null
      } finally {
        setLoading(false)
      }
    },
    [applyExif, applyFit, clearRotationPreview, revokeObjectUrl],
  )

  const getEditedDataUrl = useCallback((): string | null => {
    const img = currentImage()
    if (!img) return null
    try {
      return flattenImage(img, false).toDataURL('image/jpeg', 0.92)
    } catch {
      return null
    }
  }, [])

  const getEditedBlob = useCallback(
    (mimeType: 'image/jpeg' | 'image/png' = 'image/jpeg', jpegQuality = 0.92): Promise<Blob | null> => {
      const img = currentImage()
      if (!img) return Promise.resolve(null)
      return exportCanvasBlob(flattenImage(img, mimeType === 'image/jpeg'), mimeType, jpegQuality)
    },
    [],
  )

  const save = useCallback(
    async (fileName = 'edited.png'): Promise<'downloaded' | 'opened'> => {
      const img = imgRef.current
      const outName = downloadFileNameForFormat(fileName, saveFormat)

      if (img) {
        try {
          if (saveFormat === 'pdf') {
            savePdf(img, quality, outName)
            return 'downloaded'
          }
          const mime = saveFormat === 'png' ? 'image/png' : 'image/jpeg'
          const blob = await exportCanvasBlob(
            flattenImage(img, saveFormat === 'jpg'),
            mime,
            saveFormat === 'jpg' ? quality : undefined,
          )
          if (blob) {
            downloadBlob(blob, outName)
            return 'downloaded'
          }
        } catch {
          /* tainted canvas or encode failure — fall through */
        }
      }

      const sourceUrl = sourceUrlRef.current
      if (!sourceUrl) throw new Error('No image to download')
      // Keep the original filename when we cannot re-encode (CORS).
      const fallback = await downloadUrlAsFile(sourceUrl, fileName)
      return fallback === 'blob' ? 'downloaded' : 'opened'
    },
    [quality, saveFormat],
  )

  const printImage = useCallback(() => {
    const img = imgRef.current
    if (!img) return
    let dataUrl: string | null = null
    try {
      dataUrl = flattenImage(img, false).toDataURL('image/png')
    } catch {
      /* tainted canvas */
    }
    if (!dataUrl) {
      if (sourceUrlRef.current) {
        window.open(sourceUrlRef.current, '_blank', 'noopener,noreferrer')
      }
      return
    }
    const win = window.open('', '_blank')
    if (!win) return
    win.document.write(
      `<html><head><title>Print</title></head><body style="margin:0;display:flex;align-items:center;justify-content:center"><img src="${dataUrl}" style="max-width:100%;max-height:100vh" onload="window.print()"/></body></html>`,
    )
    win.document.close()
  }, [])

  const setMode = useCallback(
    (next: EditorMode) => {
      setModeState(next)
      selRef.current = null
      if (next !== 'text') {
        pendingTextRef.current = null
        editingRef.current = false
      }
      updateUi()
      draw()
    },
    [draw, updateUi],
  )

  const toggleBold = useCallback(() => {
    setTextSettings((s) => {
      const next = { ...s, bold: !s.bold }
      const pending = pendingTextRef.current
      if (pending) pending.bold = next.bold
      return next
    })
    draw()
  }, [draw])

  const toggleItalic = useCallback(() => {
    setTextSettings((s) => {
      const next = { ...s, italic: !s.italic }
      const pending = pendingTextRef.current
      if (pending) pending.italic = next.italic
      return next
    })
    draw()
  }, [draw])

  useEffect(() => {
    const pending = pendingTextRef.current
    if (!pending) return
    pending.text = textSettings.text
    pending.family = textSettings.family
    pending.size = Math.max(1, textSettings.size || 1)
    pending.color = textSettings.color
    pending.bold = textSettings.bold
    pending.italic = textSettings.italic
    draw()
  }, [draw, textSettings])

  const loc = useCallback((e: React.PointerEvent | React.MouseEvent) => {
    const stage = stageRef.current
    if (!stage) return null
    const rect = stage.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }, [])

  const textBox = useCallback(() => {
    const pendingText = pendingTextRef.current
    const canvas = canvasRef.current
    if (!pendingText || !canvas) return null
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    const scale = scaleRef.current
    const offset = offsetRef.current
    ctx.save()
    ctx.font = fontString(pendingText.size * scale, pendingText)
    const w = ctx.measureText(pendingText.text || ' ').width
    ctx.restore()
    return {
      sx: offset.x + pendingText.x * scale,
      sy: offset.y + pendingText.y * scale,
      w,
      h: pendingText.size * scale,
    }
  }, [])

  const onStagePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (!imgRef.current) return
      e.currentTarget.setPointerCapture(e.pointerId)
      if (e.button === 2 || e.button === 1) {
        panningRef.current = true
        panLastRef.current = loc(e)
        stageRef.current?.classList.add('panning')
        return
      }
      if (previewImgRef.current) return
      const p = loc(e)
      if (!p) return
      if (mode === 'text') {
        const w = toWorld(p, offsetRef.current, scaleRef.current)
        const box = textBox()
        if (pendingTextRef.current && box && p.x >= box.sx && p.x <= box.sx + box.w && p.y >= box.sy && p.y <= box.sy + box.h) {
          dragTextRef.current = {
            dx: w.x - pendingTextRef.current.x,
            dy: w.y - pendingTextRef.current.y,
          }
        } else if (pendingTextRef.current) {
          pendingTextRef.current.x = w.x
          pendingTextRef.current.y = w.y
          dragTextRef.current = { dx: 0, dy: 0 }
        } else {
          pendingTextRef.current = {
            x: w.x,
            y: w.y,
            text: '',
            family: textSettings.family,
            size: textSettings.size,
            color: textSettings.color,
            bold: textSettings.bold,
            italic: textSettings.italic,
          }
          dragTextRef.current = { dx: 0, dy: 0 }
        }
        editingRef.current = true
        setTextSettings((s) => ({ ...s, text: pendingTextRef.current?.text ?? '' }))
        updateUi()
        draw()
        return
      }
      downRef.current = p
      movedRef.current = false
    },
    [draw, loc, mode, textBox, textSettings, updateUi],
  )

  const onStagePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!imgRef.current) return
      const p = loc(e)
      if (!p) return
      if (panningRef.current && panLastRef.current) {
        offsetRef.current = {
          x: offsetRef.current.x + (p.x - panLastRef.current.x),
          y: offsetRef.current.y + (p.y - panLastRef.current.y),
        }
        panLastRef.current = p
        draw()
        return
      }
      if (dragTextRef.current && pendingTextRef.current) {
        const w = toWorld(p, offsetRef.current, scaleRef.current)
        pendingTextRef.current.x = w.x - dragTextRef.current.dx
        pendingTextRef.current.y = w.y - dragTextRef.current.dy
        draw()
        return
      }
      if (downRef.current) {
        if (Math.hypot(p.x - downRef.current.x, p.y - downRef.current.y) > 4) {
          movedRef.current = true
          selRef.current = normRect(downRef.current, p)
          updateUi()
          draw()
        }
      } else if (selRef.current && mode === 'select') {
        stageRef.current?.classList.toggle('inside', insideRect(selRef.current, p))
      }
    },
    [draw, loc, mode, updateUi],
  )

  const onStagePointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (panningRef.current) {
        panningRef.current = false
        stageRef.current?.classList.remove('panning')
        return
      }
      if (dragTextRef.current) {
        dragTextRef.current = null
        return
      }
      if (!downRef.current) return
      const p = loc(e)
      if (!p) return
      if (!movedRef.current) {
        if (selRef.current && insideRect(selRef.current, p)) zoomToSelection(selRef.current)
        else {
          selRef.current = null
          updateUi()
          draw()
        }
      }
      downRef.current = null
    },
    [draw, loc, updateUi, zoomToSelection],
  )

  const onStageContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
  }, [])

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const target = e.target as HTMLElement
      const inField = /^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName)

      if (mode === 'text' && pendingTextRef.current && editingRef.current && !inField) {
        if (e.key === 'Enter') {
          placeText()
          e.preventDefault()
          return
        }
        if (e.key === 'Escape') {
          pendingTextRef.current = null
          editingRef.current = false
          updateUi()
          draw()
          e.preventDefault()
          return
        }
        if (e.key === 'Backspace') {
          const pending = pendingTextRef.current
          pending.text = pending.text.slice(0, -1)
          setTextSettings((s) => ({ ...s, text: pending.text }))
          draw()
          e.preventDefault()
          return
        }
        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
          const pending = pendingTextRef.current
          pending.text += e.key
          setTextSettings((s) => ({ ...s, text: pending.text }))
          draw()
          e.preventDefault()
          return
        }
      }

      if (e.key === 'Escape') {
        selRef.current = null
        pendingTextRef.current = null
        editingRef.current = false
        updateUi()
        draw()
        return
      }
      if (inField || !imgRef.current) return

      if (e.ctrlKey || e.metaKey) {
        const k = e.key.toLowerCase()
        if (k === 'r') {
          rotate90(+1)
          e.preventDefault()
        } else if (k === 'l') {
          rotate90(-1)
          e.preventDefault()
        } else if (k === 'z') {
          undo()
          e.preventDefault()
        }
        return
      }

      const stage = stageRef.current
      if (!stage) return
      if (e.key === 'Enter') {
        if (mode === 'text' && pendingTextRef.current) placeText()
        else if (selRef.current) cropToSelection()
        e.preventDefault()
      } else if (e.key === ']') {
        rotate90(+1)
        e.preventDefault()
      } else if (e.key === '[') {
        rotate90(-1)
        e.preventDefault()
      } else if (e.key === '*') {
        applyFit()
        e.preventDefault()
      } else if (e.key === '1') {
        setScaleAt(1, stage.clientWidth / 2, stage.clientHeight / 2)
        e.preventDefault()
      }
    },
    [applyFit, cropToSelection, draw, mode, placeText, rotate90, setScaleAt, undo, updateUi],
  )

  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    const observer = new ResizeObserver(() => resizeCanvas())
    observer.observe(stage)
    resizeCanvas()
    return () => observer.disconnect()
  }, [resizeCanvas])

  useEffect(() => {
    updateUi()
  }, [loading, loadError, updateUi])

  const canSaveToMap = !loading && !loadError && hasImage

  return {
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
    loadFromUrl,
    resetSession,
    cropToSelection,
    undo,
    resetToOriginal,
    save,
    printImage,
    rotateLeft: () => rotate90(-1),
    rotateRight: () => rotate90(+1),
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
    getEditedDataUrl,
    getEditedBlob,
    canSaveToMap,
  }
}
