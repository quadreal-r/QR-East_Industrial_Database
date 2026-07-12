/** Build URLs for the embedded QR-360° viewer (`public/insp360/viewer.html`). */

export type Inspection360GateKind = 'suite' | 'electrical' | 'sprinkler'

/** Stable key so the embed viewer can remember which local .insp360 belongs to this gate. */
export function buildInspection360GateKey(
  kind: Inspection360GateKind,
  entity: { id?: number; name: string; lat: number; lng: number },
  buildingId?: number | null,
): string {
  if (entity.id != null) return `${kind}:${entity.id}`
  const b = buildingId ?? 'x'
  return `${kind}:tmp:${b}:${entity.name}:${entity.lat.toFixed(6)}:${entity.lng.toFixed(6)}`
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
  if (options.gateKey) page.searchParams.set('gate', options.gateKey)
  return page.href
}

export function viewerPathForInspectionUrl(inspectionUrl: string | null | undefined): string | null {
  if (!inspectionUrl?.trim()) return null
  return resolveInspection360ProjectUrl(inspectionUrl)
}
