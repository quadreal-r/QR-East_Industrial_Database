/** Canvas image editor primitives — ported from image-editor.html */

export type EditorImage = HTMLImageElement | HTMLCanvasElement

export type EditorMode = 'select' | 'text'

export interface ScreenRect {
  x: number
  y: number
  w: number
  h: number
}

export interface WorldPoint {
  x: number
  y: number
}

export interface PendingText {
  x: number
  y: number
  text: string
  family: string
  size: number
  color: string
  bold: boolean
  italic: boolean
}

export interface TextSettings {
  text: string
  family: string
  size: number
  color: string
  bold: boolean
  italic: boolean
}

export interface ExifData {
  dateTaken: string | null
  lat: number | null
  lon: number | null
}

export const MIN_ZOOM = 0.02
export const MAX_ZOOM = 64

export function normRect(a: WorldPoint, b: WorldPoint): ScreenRect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(a.x - b.x),
    h: Math.abs(a.y - b.y),
  }
}

export function insideRect(rect: ScreenRect, point: WorldPoint): boolean {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.w &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.h
  )
}

export function toWorld(
  point: WorldPoint,
  offset: WorldPoint,
  scale: number,
): WorldPoint {
  return { x: (point.x - offset.x) / scale, y: (point.y - offset.y) / scale }
}

export function fontString(px: number, text: PendingText): string {
  return `${text.italic ? 'italic ' : ''}${text.bold ? '700 ' : ''}${px}px '${text.family}', sans-serif`
}

export function makeRotated(src: EditorImage, deg: number): HTMLCanvasElement {
  const rad = (deg * Math.PI) / 180
  const w = src.width
  const h = src.height
  const cos = Math.abs(Math.cos(rad))
  const sin = Math.abs(Math.sin(rad))
  const nw = Math.max(1, Math.round(w * cos + h * sin))
  const nh = Math.max(1, Math.round(w * sin + h * cos))
  const canvas = document.createElement('canvas')
  canvas.width = nw
  canvas.height = nh
  const ctx = canvas.getContext('2d')
  if (!ctx) return canvas
  ctx.translate(nw / 2, nh / 2)
  ctx.rotate(rad)
  ctx.drawImage(src, -w / 2, -h / 2)
  return canvas
}

export function flattenImage(img: EditorImage, white: boolean): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = img.width
  canvas.height = img.height
  const ctx = canvas.getContext('2d')
  if (!ctx) return canvas
  if (white) {
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
  }
  ctx.drawImage(img, 0, 0)
  return canvas
}

export function downloadBlob(blob: Blob, name: string): void {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

/** Guess image MIME from a filename extension. */
export function guessImageMime(fileName?: string | null): string {
  const ext = fileName?.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase()
  if (ext === 'png') return 'image/png'
  if (ext === 'webp') return 'image/webp'
  if (ext === 'gif') return 'image/gif'
  return 'image/jpeg'
}

/**
 * Export a canvas to a Blob. Returns null when the canvas is tainted
 * (cross-origin image without CORS) or encoding fails.
 */
export function exportCanvasBlob(
  canvas: HTMLCanvasElement,
  mimeType: string,
  quality?: number,
): Promise<Blob | null> {
  return new Promise((resolve) => {
    try {
      canvas.toBlob((blob) => resolve(blob), mimeType, quality)
    } catch {
      resolve(null)
    }
  })
}

/**
 * Download bytes from a URL (works when CORS allows fetch). Falls back to
 * opening the URL in a new tab when the browser blocks cross-origin downloads.
 */
export async function downloadUrlAsFile(url: string, fileName: string): Promise<'blob' | 'opened'> {
  try {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    downloadBlob(await res.blob(), fileName)
    return 'blob'
  } catch {
    const a = document.createElement('a')
    a.href = url
    a.target = '_blank'
    a.rel = 'noopener noreferrer'
    a.download = fileName
    document.body.appendChild(a)
    a.click()
    a.remove()
    return 'opened'
  }
}

/** Build a download filename with the chosen extension. */
export function downloadFileNameForFormat(
  fileName: string,
  format: 'png' | 'jpg' | 'pdf',
): string {
  const base = fileName.replace(/\.\w+$/, '') || 'rtu-picture'
  if (format === 'png') return `${base}.png`
  if (format === 'jpg') return `${base}.jpg`
  return `${base}.pdf`
}

export function savePdf(img: EditorImage, quality: number, fileName = 'edited.pdf'): void {
  let dataUrl: string
  try {
    dataUrl = flattenImage(img, true).toDataURL('image/jpeg', quality)
  } catch {
    throw new Error('Could not export PDF from this picture')
  }
  const jpeg = atob(dataUrl.split(',')[1]!)
  const iw = img.width
  const ih = img.height
  const land = iw > ih
  const pageW = land ? 792 : 612
  const pageH = land ? 612 : 792
  const margin = 36
  const s = Math.min((pageW - 2 * margin) / iw, (pageH - 2 * margin) / ih)
  const dw = iw * s
  const dh = ih * s
  const tx = (pageW - dw) / 2
  const ty = (pageH - dh) / 2

  const content = `q\n${dw.toFixed(2)} 0 0 ${dh.toFixed(2)} ${tx.toFixed(2)} ${ty.toFixed(2)} cm\n/Im0 Do\nQ\n`
  const obj: string[] = []
  obj[1] = '<< /Type /Catalog /Pages 2 0 R >>'
  obj[2] = '<< /Type /Pages /Kids [3 0 R] /Count 1 >>'
  obj[3] =
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}] ` +
    `/Resources << /XObject << /Im0 5 0 R >> >> /Contents 4 0 R >>`
  obj[4] = `<< /Length ${content.length} >>\nstream\n${content}endstream`
  obj[5] =
    `<< /Type /XObject /Subtype /Image /Width ${iw} /Height ${ih} /ColorSpace /DeviceRGB ` +
    `/BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n${jpeg}\nendstream`

  let pdf = '%PDF-1.3\n'
  const off: number[] = []
  for (let i = 1; i <= 5; i++) {
    off[i] = pdf.length
    pdf += `${i} 0 obj\n${obj[i]}\nendobj\n`
  }
  const xref = pdf.length
  pdf += 'xref\n0 6\n0000000000 65535 f \n'
  for (let i = 1; i <= 5; i++) pdf += `${String(off[i]).padStart(10, '0')} 00000 n \n`
  pdf += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`

  const bytes = new Uint8Array(pdf.length)
  for (let i = 0; i < pdf.length; i++) bytes[i] = pdf.charCodeAt(i) & 0xff
  downloadBlob(new Blob([bytes], { type: 'application/pdf' }), fileName)
}

export function humanFileSize(bytes: number): string {
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(2)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${bytes} B`
}

/** Short footer label — size when known, otherwise file extension only. */
export function formatFileFooterLabel(byteLength?: number, fileName?: string): string {
  if (byteLength != null) return humanFileSize(byteLength)
  const ext = fileName?.match(/\.([a-z0-9]+)$/i)?.[1]?.toUpperCase()
  return ext ?? '—'
}

export function formatExifDate(value: string | null): string {
  if (!value) return 'unknown'
  const match = /^(\d{4})[:-](\d{2})[:-](\d{2})[ T](\d{2}):(\d{2})/.exec(value)
  return match ? `${match[1]}-${match[2]}-${match[3]} ${match[4]}:${match[5]}` : value
}

export function parseExif(buffer: ArrayBuffer): ExifData | null {
  const dv = new DataView(buffer)
  if (dv.getUint16(0) !== 0xffd8) return null

  let off = 2
  while (off + 4 < dv.byteLength) {
    const marker = dv.getUint16(off)
    if ((marker & 0xff00) !== 0xff00) break
    const size = dv.getUint16(off + 2)
    if (marker === 0xffe1 && dv.getUint32(off + 4) === 0x45786966) {
      return readTiff(dv, off + 10)
    }
    off += 2 + size
  }
  return null
}

function readTiff(dv: DataView, tiff: number): ExifData {
  const le = dv.getUint16(tiff) === 0x4949
  const u16 = (o: number) => dv.getUint16(o, le)
  const u32 = (o: number) => dv.getUint32(o, le)
  const out: ExifData = { dateTaken: null, lat: null, lon: null }

  const entries = (ifd: number, cb: (tag: number, type: number, count: number, vo: number) => void) => {
    const n = u16(ifd)
    for (let i = 0; i < n; i++) {
      const e = ifd + 2 + i * 12
      cb(u16(e), u16(e + 2), u32(e + 4), e + 8)
    }
  }

  const ascii = (vo: number, count: number) => {
    const p = count <= 4 ? vo : tiff + u32(vo)
    let s = ''
    for (let i = 0; i < count; i++) {
      const ch = dv.getUint8(p + i)
      if (!ch) break
      s += String.fromCharCode(ch)
    }
    return s
  }

  const rats = (vo: number, count: number) => {
    const p = tiff + u32(vo)
    const outRatios: number[] = []
    for (let i = 0; i < count; i++) {
      const n = u32(p + i * 8)
      const d = u32(p + i * 8 + 4)
      outRatios.push(d ? n / d : 0)
    }
    return outRatios
  }

  let exifPtr: number | null = null
  let gpsPtr: number | null = null
  let dt: string | null = null

  entries(tiff + u32(tiff + 4), (tag, _type, count, vo) => {
    if (tag === 0x0132) dt = ascii(vo, count)
    if (tag === 0x8769) exifPtr = tiff + u32(vo)
    if (tag === 0x8825) gpsPtr = tiff + u32(vo)
  })

  let dto: string | null = null
  if (exifPtr != null) {
    entries(exifPtr, (tag, _type, count, vo) => {
      if (tag === 0x9003) dto = ascii(vo, count)
    })
  }
  out.dateTaken = dto || dt

  if (gpsPtr != null) {
    let latRef = 'N'
    let lonRef = 'E'
    let lat: number[] | null = null
    let lon: number[] | null = null
    entries(gpsPtr, (tag, _type, count, vo) => {
      if (tag === 0x0001) latRef = ascii(vo, count)
      if (tag === 0x0002) lat = rats(vo, count)
      if (tag === 0x0003) lonRef = ascii(vo, count)
      if (tag === 0x0004) lon = rats(vo, count)
    })
    if (lat && lon) {
      const dec = (d: number[]) => d[0]! + d[1]! / 60 + d[2]! / 3600
      out.lat = dec(lat) * (latRef === 'S' ? -1 : 1)
      out.lon = dec(lon) * (lonRef === 'W' ? -1 : 1)
    }
  }

  return out
}

function loadImageElement(url: string, crossOrigin: boolean): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    if (crossOrigin) img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Failed to load image'))
    img.src = url
  })
}

export interface LoadedEditableImage {
  img: HTMLImageElement
  /** Object URL to revoke when replacing/unloading this image. */
  objectUrl: string | null
  byteLength?: number
  exif: ExifData | null
}

/**
 * Load an image for canvas editing/download.
 * Prefers fetch → blob URL so Cloudflare R2 pictures stay exportable even when
 * `<img crossOrigin>` alone would leave a tainted canvas.
 */
export async function loadEditableImageFromUrl(
  url: string,
  fileName?: string,
): Promise<LoadedEditableImage> {
  if (url.startsWith('blob:')) {
    const img = await loadImageElement(url, false)
    return { img, objectUrl: null, exif: null }
  }

  try {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const buf = await res.arrayBuffer()
    let exif: ExifData | null = null
    try {
      exif = parseExif(buf)
    } catch {
      /* ignore */
    }
    const mime = res.headers.get('content-type') || guessImageMime(fileName)
    const objectUrl = URL.createObjectURL(new Blob([buf], { type: mime }))
    try {
      const img = await loadImageElement(objectUrl, false)
      return { img, objectUrl, byteLength: buf.byteLength, exif }
    } catch (error) {
      URL.revokeObjectURL(objectUrl)
      throw error
    }
  } catch {
    /* CORS or network — display-only load may taint the canvas. */
  }

  const img = await loadImageFromUrl(url)
  return { img, objectUrl: null, exif: null }
}

/** Load for canvas display. Tries CORS first (for editing), then plain load (R2 without CORS headers). */
export function loadImageFromUrl(url: string): Promise<HTMLImageElement> {
  if (url.startsWith('blob:')) return loadImageElement(url, false)
  return loadImageElement(url, true).catch(() => loadImageElement(url, false))
}
