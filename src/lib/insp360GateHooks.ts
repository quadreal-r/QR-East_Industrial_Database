/** Local hooks: gate key → last opened/saved .insp360 for that sphere. */

export const INSP360_GATE_PROJECTS_LS = 'insp360.gateProjects'
export const INSP360_GATE_BOUND_MSG = 'insp360:gateProjectBound'
export const INSP360_GATE_PROJECT_STORED_MSG = 'insp360:gateProjectStored'
export const INSP360_PROJECT_OPEN_MSG = 'insp360:projectOpen'
export const INSP360_OPEN_GATE_PROJECT_MSG = 'insp360:openGateProject'
export const INSP360_OPEN_GATE_HANDLE_MSG = 'insp360:openGateHandle'
export const INSP360_STALE_GATE_LINK_MSG = 'insp360:staleGateLink'
export const INSP360_REQUEST_HOST_FILE_PICK_MSG = 'insp360:requestHostFilePick'
export const INSP360_REQUEST_CHANGE_TOUR_MSG = 'insp360:requestChangeTour'
export const INSP360_PREPARE_CLOSE_MSG = 'insp360:prepareClose'
export const INSP360_READY_CLOSE_MSG = 'insp360:readyToClose'
export const INSP360_LOCAL_PREFIX = 'insp360-local:'

/** Normalize postMessage binary payloads into an ArrayBuffer copy. */
export function arrayBufferFromMessageData(value: unknown): ArrayBuffer | null {
  if (value instanceof ArrayBuffer && value.byteLength > 0) {
    return value.slice(0)
  }
  if (ArrayBuffer.isView(value) && value.byteLength > 0) {
    const view = value as ArrayBufferView
    const copy = new Uint8Array(view.byteLength)
    copy.set(new Uint8Array(view.buffer, view.byteOffset, view.byteLength))
    return copy.buffer
  }
  return null
}

/** @deprecated Kept for older viewers; host no longer queries the iframe for link status. */
export const INSP360_QUERY_GATE_LINK_MSG = 'insp360:queryGateLinkStatus'
/** @deprecated Kept for older viewers. */
export const INSP360_GATE_LINK_STATUS_MSG = 'insp360:gateLinkStatus'

export type Insp360GateLinkStatus = {
  hasProject: boolean
  linked: boolean
  name: string
}

export type Insp360ProjectOpenPayload = {
  gateKey: string
  name: string
  alreadyLinked: boolean
}

/** Confirm copy when closing an unlinked tour from a gateway. */
export function insp360LinkGateConfirmMessage(
  projectName: string | null | undefined,
  options?: { fileName?: string | null },
): string {
  const label = insp360ProjectDisplayName(projectName) || 'this tour'
  const fileLabel = insp360ProjectDisplayName(options?.fileName)
  if (fileLabel && fileLabel.toLowerCase() !== label.toLowerCase()) {
    return `Link “${label}” to this gateway so it opens automatically next time?\n\nTour file: ${fileLabel}`
  }
  return `Link “${label}” to this gateway so it opens automatically next time?`
}

/** Confirm copy when changing which tour is linked to a gateway. */
export function insp360ChangeTourConfirmMessage(projectName: string | null | undefined): string {
  const label = insp360ProjectDisplayName(projectName) || 'the current tour'
  return `Unlink “${label}” from this gateway? You can open a different .insp360 and link it instead.`
}

export type Insp360GateHook = {
  name: string
  savedAt: number
  /**
   * True only when the parent app has the .insp360 bytes in IndexedDB.
   * Legacy name-only hooks (missing hosted) are treated as not connected.
   */
  hosted?: boolean
}

export function readInsp360GateProjectMap(): Record<string, Insp360GateHook> {
  try {
    const raw = localStorage.getItem(INSP360_GATE_PROJECTS_LS)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') return {}
    const out: Record<string, Insp360GateHook> = {}
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!value || typeof value !== 'object') continue
      const name = String((value as { name?: unknown }).name || '').trim()
      if (!name) continue
      const savedAt = Number((value as { savedAt?: unknown }).savedAt) || Date.now()
      const hosted = (value as { hosted?: unknown }).hosted === true
      out[key] = { name, savedAt, hosted }
    }
    return out
  } catch {
    return {}
  }
}

export function writeInsp360GateHook(
  gateKey: string,
  name: string,
  options?: { hosted?: boolean },
): void {
  const cleaned = String(name || '').trim()
  if (!gateKey || !cleaned) return
  try {
    const map = readInsp360GateProjectMap()
    map[gateKey] = {
      name: cleaned,
      savedAt: Date.now(),
      hosted: options?.hosted === true,
    }
    localStorage.setItem(INSP360_GATE_PROJECTS_LS, JSON.stringify(map))
  } catch {
    /* ignore quota */
  }
}

export function clearInsp360GateHook(gateKey: string | null | undefined): void {
  if (!gateKey) return
  try {
    const map = readInsp360GateProjectMap()
    if (!(gateKey in map)) return
    delete map[gateKey]
    localStorage.setItem(INSP360_GATE_PROJECTS_LS, JSON.stringify(map))
  } catch {
    /* ignore */
  }
}

export function getInsp360GateHook(gateKey: string | null | undefined): Insp360GateHook | null {
  if (!gateKey) return null
  return readInsp360GateProjectMap()[gateKey] ?? null
}

/** Strip path to a readable project label. */
export function insp360ProjectDisplayName(nameOrUrl: string | null | undefined): string {
  const raw = String(nameOrUrl || '').trim()
  if (!raw) return ''
  let s = raw
  if (s.startsWith(INSP360_LOCAL_PREFIX)) s = s.slice(INSP360_LOCAL_PREFIX.length)
  try {
    if (/^https?:\/\//i.test(s)) s = decodeURIComponent(new URL(s).pathname.split('/').pop() || s)
    else s = decodeURIComponent(s.split(/[\\/]/).pop() || s)
  } catch {
    s = s.split(/[\\/]/).pop() || s
  }
  return s.replace(/\.(insp360|zip)$/i, '') || s
}

/** True when two labels refer to the same .insp360 project file (ignore path/extension). */
export function insp360SameProjectFile(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const left = insp360ProjectDisplayName(a).toLowerCase()
  const right = insp360ProjectDisplayName(b).toLowerCase()
  return Boolean(left && right && left === right)
}

/**
 * Tour label for map popups.
 * Prefers the local gate hook (opened/saved .insp360), then a remote inspection_url.
 */
export function resolveInsp360TourLabel(
  gateKey: string | null | undefined,
  inspectionUrl: string | null | undefined,
): { connected: boolean; label: string } {
  const hook = getInsp360GateHook(gateKey)
  // Only trust hooks that were saved with real project bytes in the parent app.
  if (hook?.name && hook.hosted === true) {
    return { connected: true, label: insp360ProjectDisplayName(hook.name) }
  }
  const url = inspectionUrl?.trim()
  if (url) {
    return { connected: true, label: insp360ProjectDisplayName(url) }
  }
  return { connected: false, label: 'Not connected yet' }
}

/** Remote/public tour URL safe to fetch in the embed iframe. Local hooks are cache-only. */
export function resolveInsp360ViewerProjectUrl(
  inspectionUrl: string | null | undefined,
): string | null {
  const t = inspectionUrl?.trim()
  if (!t) return null
  if (t.startsWith(INSP360_LOCAL_PREFIX)) return null
  return t
}

/** Whether closing should ask to link this open project to the gateway. */
export function shouldPromptLinkGate(options: {
  gateKey: string | null | undefined
  projectOpen: boolean
  alreadyLinked: boolean
}): boolean {
  return Boolean(options.gateKey && options.projectOpen && !options.alreadyLinked)
}
