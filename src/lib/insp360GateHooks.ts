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
/** Host → embed: pack/mirror the open tour into gate storage for Cloudflare publish. */
/** Host → viewer: pack for Cloudflare publish (or tour.json-only when pins changed). Optional cloudKey hint. */
export const INSP360_PREPARE_PUBLISH_MSG = 'insp360:preparePublish'
/** Embed → host: publish pack finished (ok true/false). */
export const INSP360_PUBLISH_READY_MSG = 'insp360:publishReady'
/** Viewer → host: progress while opening a linked/picked .insp360 from a gateway. */
export const INSP360_OPEN_PROGRESS_MSG = 'insp360:openProgress'
/** Embed → host: list gate-scoped cloud tours for Double Tour. */
export const INSP360_REQUEST_CLOUD_LIST_MSG = 'insp360:requestCloudList'
/** Host → embed: cloud list result (or error). */
export const INSP360_CLOUD_LIST_MSG = 'insp360:cloudList'
/** Embed → host: soft Dashboard (cloud picker) opened or closed. */
export const INSP360_EMBED_DASH_MSG = 'insp360:embedDash'
/** Host → embed: rename the open tour to match the gateway. */
export const INSP360_SET_PROJECT_NAME_MSG = 'insp360:setProjectName'
/** Embed → host: set (or clear) which tour is the gateway default. */
export const INSP360_SET_GATE_DEFAULT_TOUR_MSG = 'insp360:setGateDefaultTour'
export const INSP360_UPLOAD_TOUR_JSON_MSG = 'insp360:uploadTourJson'
export const INSP360_TOUR_JSON_UPLOAD_RESULT_MSG = 'insp360:tourJsonUploadResult'
export const INSP360_LOCAL_PREFIX = 'insp360-local:'

export type Insp360OpenProgressPayload = {
  gateKey: string
  done: number
  total: number
  phase: string
  fileName?: string | null
  fileSize?: number | null
  source?: 'disk' | 'storage' | 'host' | 'picker' | string | null
}

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
  options?: { fileName?: string | null; cloud?: boolean },
): string {
  const label = insp360ProjectDisplayName(projectName) || 'this tour'
  const fileLabel = insp360ProjectDisplayName(options?.fileName)
  const linkNote = options?.cloud
    ? 'This attaches the Cloudflare tour URL to this gateway so it opens automatically for everyone.'
    : 'This links the tour on this PC/browser only — it does not upload to Cloudflare. Use Publish to Cloudflare & link if others need it online.'
  if (fileLabel && fileLabel.toLowerCase() !== label.toLowerCase()) {
    return `Link “${label}” to this gateway so it opens automatically next time?\n\nTour file: ${fileLabel}\n\n${linkNote}`
  }
  return `Link “${label}” to this gateway so it opens automatically next time?\n\n${linkNote}`
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
 * True when the tour open in the viewer is this gate's permanent Cloudflare link.
 * Used to hide Publish while viewing that linked tour; show it again for a different local/cloud tour.
 */
export function isOpenTourPermanentCloudLink(options: {
  permanentUrl: string | null | undefined
  openCloudKey?: string | null
  openCloudUrl?: string | null
  /** When cloud identity is missing, match by open file name (downloaded permanent URL). */
  openProjectName?: string | null
}): boolean {
  const permanent = String(options.permanentUrl || '').trim()
  if (!permanent) return false
  const key = String(options.openCloudKey || '').trim()
  const url = String(options.openCloudUrl || '').trim()
  if (url) {
    if (url === permanent) return true
    try {
      if (decodeURIComponent(url) === decodeURIComponent(permanent)) return true
    } catch {
      /* ignore */
    }
    if (insp360SameProjectFile(url, permanent)) return true
  }
  if (key) {
    if (key === permanent || permanent.endsWith(key)) return true
    try {
      const path = decodeURIComponent(new URL(permanent).pathname).replace(/^\/+/, '')
      if (path === key || path.endsWith(`/${key}`)) return true
    } catch {
      if (permanent.includes(key)) return true
    }
    if (insp360SameProjectFile(key, permanent)) return true
  }
  // No cloud identity → only treat as the permanent tour when the open name matches that URL.
  // A differently named local file must return false so Publish can replace the link.
  const openName = String(options.openProjectName || '').trim()
  return Boolean(openName && insp360SameProjectFile(openName, permanent))
}

/**
 * Tour label for map popups.
 * Prefers a permanent remote inspection_url (matches Enter / cloud open), then a local hook.
 */
export function resolveInsp360TourLabel(
  gateKey: string | null | undefined,
  inspectionUrl: string | null | undefined,
): { connected: boolean; label: string; kind: 'local' | 'cloud' | 'none' } {
  const url = inspectionUrl?.trim()
  if (url) {
    const name = insp360ProjectDisplayName(url) || url
    return { connected: true, label: `Cloudflare: ${name}`, kind: 'cloud' }
  }
  const hook = getInsp360GateHook(gateKey)
  // Only trust hooks that were saved with real project bytes in the parent app.
  if (hook?.name && hook.hosted === true) {
    const name = insp360ProjectDisplayName(hook.name) || hook.name
    return { connected: true, label: `On this PC: ${name}`, kind: 'local' }
  }
  return { connected: false, label: 'Not connected yet', kind: 'none' }
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
  /** Permanent Supabase / R2 Tour URL — no local Link step needed. */
  hasOnlineTour?: boolean
  /**
   * Gate already has a default tour that is not this open one.
   * Do not auto-prompt to replace it — reassign only via Link / Set as default.
   */
  gateAlreadyAssigned?: boolean
}): boolean {
  if (options.hasOnlineTour) return false
  if (options.gateAlreadyAssigned) return false
  return Boolean(options.gateKey && options.projectOpen && !options.alreadyLinked)
}
