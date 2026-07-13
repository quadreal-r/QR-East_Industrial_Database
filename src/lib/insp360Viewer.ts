/** Build URLs for the embedded QR-360° viewer.
 *
 * Live embed (always the latest synced build):
 *   public/insp360/viewer.html
 *
 * Versioned copies + sync from Inspections source:
 *   qr360-viewer/QR-360°_viewer_vX.Y.Z.html
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

export function resolveInspection360ProjectUrl(inspectionUrl: string): string {
  const trimmed = inspectionUrl.trim()
  if (!trimmed) return ''

  if (/^https?:\/\//i.test(trimmed)) return trimmed

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
  return page.href
}

export function viewerPathForInspectionUrl(inspectionUrl: string | null | undefined): string | null {
  if (!inspectionUrl?.trim()) return null
  return resolveInspection360ProjectUrl(inspectionUrl)
}
