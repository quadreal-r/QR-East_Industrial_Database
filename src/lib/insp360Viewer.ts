/** Build URLs for the embedded QR-360° viewer.
 *
 * Live embed (always the latest synced build):
 *   public/insp360/viewer.html
 *
 * Versioned copies + sync from Inspections source:
 *   qr360-viewer/QR-360-Inspections_vX.Y.Z.html
 *   npm run sync:qr360-viewer
 */

export type Inspection360GateKind = 'suite' | 'electrical' | 'sprinkler'

/** Stable key so the embed viewer can remember which local .insp360 belongs to this gate. */
export function buildInspection360GateKey(
  kind: Inspection360GateKind,
  entity: { id?: number; name: string; lat: number; lng: number },
  buildingId?: number | null,
): string {
  if (entity.id != null && Number.isFinite(entity.id)) return `${kind}:${entity.id}`
  const b = buildingId ?? 'x'
  const name = String(entity.name || 'gate').trim() || 'gate'
  // Do not include lat/lng — marker nudges would orphan the saved project.
  return `${kind}:tmp:${b}:${name}`
}

function normalizeInsp360BaseUrl(url: string): string {
  return url.endsWith('/') ? url : `${url}/`
}

/** Public R2 / CDN base for online `.insp360` tour files (separate from RTU pictures). */
export function getInsp360ToursBaseUrl(): string | undefined {
  let value = import.meta.env.VITE_INSP360_BASE_URL?.trim()
  if (!value) return undefined
  const envLine = value.match(/^VITE_INSP360_BASE_URL\s*=\s*(.+)$/i)
  if (envLine) value = envLine[1]!.trim().replace(/^["']|["']$/g, '')
  return value ? normalizeInsp360BaseUrl(value) : undefined
}

/** Build a full tour file URL on the insp360 CDN (when configured). */
export function insp360TourFileUrl(objectKey: string): string {
  const key = objectKey.trim().replace(/^\/+/, '')
  const cdn = getInsp360ToursBaseUrl()
  if (!cdn) {
    const base = import.meta.env.BASE_URL.replace(/\/?$/, '/')
    return new URL(key, `${typeof window !== 'undefined' ? window.location.origin : 'http://127.0.0.1'}${base}`).href
  }
  return `${cdn}${key.split('/').map(encodeURIComponent).join('/')}`
}

export function resolveInspection360ProjectUrl(inspectionUrl: string): string {
  const trimmed = inspectionUrl.trim()
  if (!trimmed) return ''

  if (/^https?:\/\//i.test(trimmed)) return trimmed

  const cdn = getInsp360ToursBaseUrl()
  if (cdn && !trimmed.startsWith('/')) {
    return insp360TourFileUrl(trimmed)
  }

  const base = import.meta.env.BASE_URL.replace(/\/?$/, '/')
  if (trimmed.startsWith('/')) {
    return `${window.location.origin}${trimmed}`
  }

  return new URL(trimmed, `${window.location.origin}${base}`).href
}

export interface Inspection360ViewerLaunch {
  projectUrl?: string | null
  scene?: string | null
  title?: string | null
  /** Building street address — shown before the project/gate name. */
  address?: string | null
  /** Per-gate id used to reopen the last local project chosen for this sphere. */
  gateKey?: string | null
  /**
   * R2 list prefix for this gate's cloud versions (e.g. `building/tour`).
   * Used by embed Double Tour / Cloud tab — lists via the map host + Supabase.
   */
  cloudPrefix?: string | null
}

export function buildInspection360ViewerPageUrl(options: Inspection360ViewerLaunch): string {
  const base = import.meta.env.BASE_URL.replace(/\/?$/, '/')
  const page = new URL(`${base}insp360/viewer.html`, window.location.origin)
  page.searchParams.set('embed', '1')
  if (options.projectUrl) {
    page.searchParams.set('project', resolveInspection360ProjectUrl(options.projectUrl))
  }
  if (options.scene) page.searchParams.set('photo', options.scene)
  if (options.title) page.searchParams.set('title', options.title)
  if (options.address) page.searchParams.set('address', options.address)
  if (options.gateKey) page.searchParams.set('gate', options.gateKey)
  if (options.cloudPrefix?.trim()) {
    page.searchParams.set('cloudPrefix', options.cloudPrefix.trim().replace(/^\/+/, ''))
  }
  const cdn = getInsp360ToursBaseUrl()
  if (cdn) page.searchParams.set('cdnBase', cdn.replace(/\/$/, ''))
  return page.href
}

export function viewerPathForInspectionUrl(inspectionUrl: string | null | undefined): string | null {
  if (!inspectionUrl?.trim()) return null
  return resolveInspection360ProjectUrl(inspectionUrl)
}
