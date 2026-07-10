/** Build URLs for the embedded INSP 360 viewer (`public/insp360/viewer.html`). */

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
  return page.href
}

export function viewerPathForInspectionUrl(inspectionUrl: string | null | undefined): string | null {
  if (!inspectionUrl?.trim()) return null
  return resolveInspection360ProjectUrl(inspectionUrl)
}
