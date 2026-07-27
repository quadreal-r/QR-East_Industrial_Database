/** Cover / preview helpers for insp360 cloud tours (sidecar + zip extract). */

import { inflateSync } from 'fflate'

const EOCD_SIG = 0x06054b50
const CEN_SIG = 0x02014b50
const LOC_SIG = 0x04034b50
const MAX_PREVIEW_COMP = 8 * 1024 * 1024

/** Sidecar next to a tour: `building/tour__stamp.insp360` → `building/tour__stamp.cover.jpg` */
export function insp360CoverCompanionKey(tourKey: string): string {
  return String(tourKey || '').replace(/\.insp360$/i, '') + '.cover.jpg'
}

/** Pin/map sidecar: `building/tour__stamp.insp360` → `building/tour__stamp.tour.json` */
export function insp360TourCompanionKey(tourKey: string): string {
  return String(tourKey || '').replace(/\.(insp360|zip)$/i, '') + '.tour.json'
}

function readU16(view: DataView, offset: number): number {
  return view.getUint16(offset, true)
}

function readU32(view: DataView, offset: number): number {
  return view.getUint32(offset, true)
}

/**
 * Pull preview.jpg / cover.jpg (or first small image) from an .insp360 zip
 * without inflating every photo — only the chosen entry is decompressed.
 */
export function extractInsp360CoverBytes(
  zipBytes: ArrayBuffer,
  preferredNames: string[] = ['preview.jpg', 'cover.jpg'],
): { bytes: Uint8Array; contentType: string; name: string } | null {
  const totalSize = zipBytes.byteLength
  if (!totalSize || totalSize < 22) return null

  const tailLen = Math.min(totalSize, 65558)
  const tail = new Uint8Array(zipBytes, totalSize - tailLen, tailLen)
  const tailView = new DataView(tail.buffer, tail.byteOffset, tail.byteLength)

  let eocd = -1
  for (let i = tail.length - 22; i >= 0; i--) {
    if (readU32(tailView, i) === EOCD_SIG) {
      eocd = i
      break
    }
  }
  if (eocd < 0) return null

  const total = readU16(tailView, eocd + 10)
  const cdSize = readU32(tailView, eocd + 12)
  const cdOff = readU32(tailView, eocd + 16)
  if (!cdSize || cdOff + cdSize > totalSize) return null

  const cdBuf = new Uint8Array(zipBytes, cdOff, cdSize)
  const cd = new DataView(cdBuf.buffer, cdBuf.byteOffset, cdBuf.byteLength)
  const dec = new TextDecoder()
  const preferred = preferredNames.map((n) => n.toLowerCase())

  type Candidate = { name: string; method: number; comp: number; lho: number; score: number }
  const candidates: Candidate[] = []
  let o = 0
  for (let e = 0; e < total; e++) {
    if (o + 46 > cdBuf.length) break
    if (readU32(cd, o) !== CEN_SIG) break
    const method = readU16(cd, o + 10)
    const comp = readU32(cd, o + 20)
    const nLen = readU16(cd, o + 28)
    const xLen = readU16(cd, o + 30)
    const kLen = readU16(cd, o + 32)
    const lho = readU32(cd, o + 42)
    const name = dec.decode(cdBuf.subarray(o + 46, o + 46 + nLen))
    o += 46 + nLen + xLen + kLen
    const base = (name.split('/').pop() || '').toLowerCase()
    if (!/\.(jpe?g|png|webp)$/i.test(base)) continue
    if (comp > MAX_PREVIEW_COMP) continue
    const prefIdx = preferred.indexOf(base)
    let score = 50 + candidates.length
    if (prefIdx >= 0) score = prefIdx
    else if (base === 'preview.jpg' || base.endsWith('.cover.jpg')) score = 0
    candidates.push({ name, method, comp, lho, score })
  }
  if (!candidates.length) return null
  candidates.sort((a, b) => a.score - b.score)
  const en = candidates[0]!

  const lh = new Uint8Array(zipBytes, en.lho, Math.min(30, totalSize - en.lho))
  if (lh.length < 30) return null
  const ld = new DataView(lh.buffer, lh.byteOffset, lh.byteLength)
  if (readU32(ld, 0) !== LOC_SIG) return null
  const nLen = readU16(ld, 26)
  const xLen = readU16(ld, 28)
  const dataOff = en.lho + 30 + nLen + xLen
  if (dataOff + en.comp > totalSize) return null
  const raw = new Uint8Array(zipBytes, dataOff, en.comp)

  let bytes: Uint8Array
  if (en.method === 0) bytes = raw
  else if (en.method === 8) {
    try {
      bytes = inflateSync(raw)
    } catch {
      return null
    }
  } else return null

  const lower = en.name.toLowerCase()
  const contentType = lower.endsWith('.png')
    ? 'image/png'
    : lower.endsWith('.webp')
      ? 'image/webp'
      : 'image/jpeg'
  return { name: en.name, bytes, contentType }
}

/** Read embedded `tour.json` text from an .insp360 zip (for uploading the sidecar). */
export function extractInsp360TourJsonText(zipBytes: ArrayBuffer): string | null {
  const totalSize = zipBytes.byteLength
  if (!totalSize || totalSize < 22) return null

  const tailLen = Math.min(totalSize, 65558)
  const tail = new Uint8Array(zipBytes, totalSize - tailLen, tailLen)
  const tailView = new DataView(tail.buffer, tail.byteOffset, tail.byteLength)

  let eocd = -1
  for (let i = tail.length - 22; i >= 0; i--) {
    if (readU32(tailView, i) === EOCD_SIG) {
      eocd = i
      break
    }
  }
  if (eocd < 0) return null

  const total = readU16(tailView, eocd + 10)
  const cdSize = readU32(tailView, eocd + 12)
  const cdOff = readU32(tailView, eocd + 16)
  if (!total || !cdSize || cdOff + cdSize > totalSize) return null

  const cd = new Uint8Array(zipBytes, cdOff, cdSize)
  const cdView = new DataView(cd.buffer, cd.byteOffset, cd.byteLength)
  const dec = new TextDecoder()
  let o = 0
  for (let e = 0; e < total; e++) {
    if (readU32(cdView, o) !== CEN_SIG) break
    const method = readU16(cdView, o + 10)
    const comp = readU32(cdView, o + 20)
    const nLen = readU16(cdView, o + 28)
    const xLen = readU16(cdView, o + 30)
    const kLen = readU16(cdView, o + 32)
    const lho = readU32(cdView, o + 42)
    const name = dec.decode(cd.subarray(o + 46, o + 46 + nLen))
    o += 46 + nLen + xLen + kLen
    if (name.toLowerCase() !== 'tour.json') continue
    if (method !== 0 || !comp || comp > MAX_PREVIEW_COMP) return null
    const lh = new Uint8Array(zipBytes, lho, 30)
    const ld = new DataView(lh.buffer, lh.byteOffset, lh.byteLength)
    if (readU32(ld, 0) !== LOC_SIG) return null
    const ln = readU16(ld, 26)
    const lx = readU16(ld, 28)
    const ds = lho + 30 + ln + lx
    if (ds + comp > totalSize) return null
    const bytes = new Uint8Array(zipBytes, ds, comp)
    return dec.decode(bytes)
  }
  return null
}

/** JPEG (or PNG/WebP) Blob suitable for uploading as `.cover.jpg` sidecar. */
export function extractInsp360CoverBlob(zipBytes: ArrayBuffer): Blob | null {
  const extracted = extractInsp360CoverBytes(zipBytes)
  if (!extracted) return null
  // Sidecar is always stored as .cover.jpg; convert non-JPEG by keeping original type in Blob
  // (R2 accepts image/*). Prefer re-wrapping as image/jpeg when source is already JPEG.
  return new Blob([new Uint8Array(extracted.bytes)], {
    type: extracted.contentType || 'image/jpeg',
  })
}
