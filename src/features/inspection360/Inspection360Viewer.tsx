import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { buildInspection360ViewerPageUrl, insp360TourFileUrl } from '@/lib/insp360Viewer'
import {
  arrayBufferFromMessageData,
  clearInsp360GateHook,
  getInsp360GateHook,
  INSP360_GATE_BOUND_MSG,
  INSP360_GATE_PROJECT_STORED_MSG,
  INSP360_OPEN_GATE_PROJECT_MSG,
  INSP360_OPEN_GATE_HANDLE_MSG,
  INSP360_OPEN_PROGRESS_MSG,
  INSP360_PREPARE_CLOSE_MSG,
  INSP360_PREPARE_PUBLISH_MSG,
  INSP360_PROJECT_OPEN_MSG,
  INSP360_PUBLISH_READY_MSG,
  INSP360_READY_CLOSE_MSG,
  INSP360_CLOUD_LIST_MSG,
  INSP360_EMBED_DASH_MSG,
  INSP360_REQUEST_CHANGE_TOUR_MSG,
  INSP360_REQUEST_CLOUD_LIST_MSG,
  INSP360_REQUEST_HOST_FILE_PICK_MSG,
  INSP360_SET_GATE_DEFAULT_TOUR_MSG,
  INSP360_SET_PROJECT_NAME_MSG,
  INSP360_STALE_GATE_LINK_MSG,
  INSP360_UPLOAD_TOUR_JSON_MSG,
  INSP360_TOUR_JSON_UPLOAD_RESULT_MSG,
  type Insp360OpenProgressPayload,
  insp360LinkGateConfirmMessage,
  insp360ProjectDisplayName,
  insp360SameProjectFile,
  isOpenTourPermanentCloudLink,
  shouldPromptLinkGate,
  writeInsp360GateHook,
} from '@/lib/insp360GateHooks'
import { formatDownloadSpeed } from '@/lib/insp360DownloadProgress'
import { errorMessage } from '@/lib/errorMessage'
import { showToastError, showToastSuccess, showToastWarning } from '@/lib/toast'
import {
  insp360RemoveTourConfirmMessage,
  normalizeCloudTourUrlInput,
} from '@/lib/insp360GateTours'

import {
  confirmGateProjectStored,
  deleteHostGateProject,
  loadHostGateProject,
  prepareViewerGateProject,
  saveHostGateProject,
  unlinkInsp360GateTour,
  writeViewerGateFileHandle,
  writeViewerGateProject,
} from '@/lib/insp360GateProjectStore'
import {
  buildInsp360GeoIndex,
  INSP360_GEO_REQUEST,
  INSP360_GEO_RESPONSE,
} from '@/lib/insp360GeoIndex'
import { confirm } from '@/stores/confirmStore'
import { useAuth } from '@/hooks/useAuth'
import { usePortfolioStore } from '@/stores/portfolioStore'
import { recordActivityEvent } from '@/data/activityApi'
import { listInsp360CloudTours, publishInsp360TourToCloud, publishInsp360TourJsonToCloud } from '@/data/insp360PublishApi'
import { extractInsp360CoverBlob, extractInsp360TourJsonText } from '@/lib/insp360Cover'
import {
  buildInsp360PublishObjectKey,
  insp360CloudKeyMatchesGate,
  insp360GateCloudPrefix,
  insp360GateTourMismatchMessage,
  insp360SuggestedGateTourFileName,
  insp360SuggestedGateTourLabel,
  insp360TourNameMatchesGate,
} from '@/lib/insp360Publish'
import styles from './Inspection360Viewer.module.css'

export interface Inspection360ViewerProps {
  open: boolean
  /** Hidden behind the map — iframe stays loaded for instant return. */
  minimized?: boolean
  title: string
  buildingAddress: string
  suiteName: string
  projectUrl: string | null
  scene: string | null
  gateKey: string | null
  onClose: () => void
  /** Keep the tour warm and show the map (no unload). Unused — Back to map removed. */
  onMinimize?: () => void
  /** Clear permanent Tour URL in Supabase for this gate (online + persist). */
  onClearTourLink?: (gateKey: string) => Promise<void>
  /** Save a Cloudflare / R2 Tour URL on this gate and optionally reload with it. */
  onLinkOnlineTour?: (
    gateKey: string,
    tourUrl: string,
    options?: { reloadViewer?: boolean },
  ) => Promise<void>
}

function flushViewerClose(frame: Window, linkGate: boolean): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false
    const finish = (ok: boolean) => {
      if (settled) return
      settled = true
      window.clearTimeout(timer)
      window.removeEventListener('message', onMessage)
      resolve(ok)
    }
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type !== INSP360_READY_CLOSE_MSG) return
      // Older viewers omit ok; treat missing as success. Explicit false means mirror failed.
      finish(event.data?.ok !== false)
    }
    // Large .insp360 tours can take minutes to zip and copy into gate storage.
    const timeoutMs = linkGate ? 300000 : 2500
    const timer = window.setTimeout(() => finish(true), timeoutMs)
    window.addEventListener('message', onMessage)
    try {
      frame.postMessage({ type: INSP360_PREPARE_CLOSE_MSG, linkGate }, '*')
    } catch {
      finish(false)
    }
  })
}

type ViewerPublishPlan = {
  ok: boolean
  /** Viewer already uploaded (or is ready to upload) tour.json only — skip full .insp360 PUT. */
  jsonOnly: boolean
  photosDirty: boolean
  cloudKey: string | null
  tourJson: string | null
}

/** Pack the open tour into gate storage for publish (or JSON-only when pins changed). */
function flushViewerPublish(
  frame: Window,
  gateKey: string,
  cloudKeyHint?: string | null,
): Promise<ViewerPublishPlan> {
  return new Promise((resolve) => {
    let settled = false
    const finish = (plan: ViewerPublishPlan) => {
      if (settled) return
      settled = true
      window.clearTimeout(timer)
      window.removeEventListener('message', onMessage)
      resolve(plan)
    }
    const onMessage = (event: MessageEvent) => {
      const type = event.data?.type
      if (type === INSP360_PUBLISH_READY_MSG) {
        if (event.data?.gateKey && String(event.data.gateKey) !== gateKey) return
        finish({
          ok: event.data?.ok !== false,
          jsonOnly: event.data?.jsonOnly === true,
          photosDirty: event.data?.photosDirty === true,
          cloudKey:
            typeof event.data?.cloudKey === 'string' && event.data.cloudKey.trim()
              ? String(event.data.cloudKey).trim()
              : null,
          tourJson:
            typeof event.data?.tourJson === 'string' && event.data.tourJson
              ? String(event.data.tourJson)
              : null,
        })
        return
      }
      // Older viewers may still answer via readyToClose.
      if (type === INSP360_READY_CLOSE_MSG) {
        finish({
          ok: event.data?.ok !== false,
          jsonOnly: false,
          photosDirty: true,
          cloudKey: null,
          tourJson: null,
        })
      }
    }
    const timer = window.setTimeout(
      () =>
        finish({
          ok: false,
          jsonOnly: false,
          photosDirty: true,
          cloudKey: null,
          tourJson: null,
        }),
      300000,
    )
    window.addEventListener('message', onMessage)
    try {
      const hint = String(cloudKeyHint || '').trim()
      frame.postMessage(
        {
          type: INSP360_PREPARE_PUBLISH_MSG,
          gateKey,
          ...(hint ? { cloudKey: hint } : {}),
        },
        '*',
      )
    } catch {
      finish({
        ok: false,
        jsonOnly: false,
        photosDirty: true,
        cloudKey: null,
        tourJson: null,
      })
    }
  })
}

async function waitForLinkedGateProject(
  gateKey: string,
  timeoutMs = 120000,
  fallbackName?: string,
): Promise<boolean> {
  return confirmGateProjectStored(gateKey, { maxWaitMs: timeoutMs, fallbackName })
}

type OpenProgressState = {
  done: number
  total: number
  phase: string
  fileName: string | null
  fileSize: number | null
  source: string | null
  /** Average download rate while fetching a cloud tour (bytes/sec). */
  bytesPerSec?: number | null
}

function formatTourFileSize(bytes: number | null | undefined): string | null {
  const n = Number(bytes)
  if (!Number.isFinite(n) || n <= 0) return null
  if (n < 1024) return `${Math.round(n)} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`
  return `${(n / (1024 * 1024)).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`
}

/** Let React paint progress before the next heavy step. */
function yieldToUi(): Promise<void> {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => {
      window.setTimeout(resolve, 0)
    })
  })
}

function tourFileSourceLabel(source: string | null | undefined): string | null {
  const s = String(source || '').toLowerCase()
  if (s === 'disk') return 'Remembered file on disk'
  if (s === 'storage' || s === 'host') return 'Browser storage for this gateway'
  if (s === 'picker') return 'Selected tour file'
  if (s === 'cloud') return 'Online Tour URL (cloud)'
  if (s === 'cache') return 'Cached cloud tour on this PC'
  return source ? String(source) : null
}

function openProgressIsCache(source: string | null | undefined, phase: string | null | undefined): boolean {
  const s = String(source || '').toLowerCase()
  if (s === 'cache') return true
  return /cached tour/i.test(String(phase || ''))
}

export function Inspection360Viewer({
  open,
  minimized = false,
  title,
  buildingAddress,
  suiteName,
  projectUrl,
  scene,
  gateKey,
  onClose,
  onClearTourLink,
  onLinkOnlineTour,
}: Inspection360ViewerProps) {
  const { isAuthenticated, canEdit } = useAuth()
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const restoreFileInputRef = useRef<HTMLInputElement | null>(null)
  const geoIndexRef = useRef<ReturnType<typeof buildInsp360GeoIndex> | null>(null)
  const closingRef = useRef(false)
  const hostSaveChainRef = useRef(Promise.resolve())
  const initialPushDoneRef = useRef(false)
  const pushInFlightRef = useRef(false)
  const projectOpenRef = useRef(false)
  const openRequestedRef = useRef(false)
  const tourOpenStartedAtRef = useRef<number | null>(null)
  const tourOpenLoggedRef = useRef(false)
  // Online Tour URL (Supabase / R2) is the permanent link — skip local IndexedDB hooks.
  const [launchBoundName, setLaunchBoundName] = useState<string | null>(() => {
    if (projectUrl?.trim()) return null
    if (!gateKey) return null
    const hook = getInsp360GateHook(gateKey)
    return hook?.hosted === true ? hook.name : null
  })
  const [viewerEpoch, setViewerEpoch] = useState(0)

  const [closing, setClosing] = useState(false)
  const [closingMode, setClosingMode] = useState<'idle' | 'linking' | 'closing'>('idle')
  const [boundName, setBoundName] = useState<string | null>(launchBoundName)
  const [projectOpen, setProjectOpen] = useState(false)
  const [projectName, setProjectName] = useState<string | null>(null)
  const [projectDisplayName, setProjectDisplayName] = useState<string | null>(null)
  const [alreadyLinked, setAlreadyLinked] = useState(
    () => Boolean(launchBoundName) || Boolean(projectUrl?.trim()),
  )
  const [linkPromptOpen, setLinkPromptOpen] = useState(false)
  const [linkError, setLinkError] = useState<string | null>(null)
  /** Ask to rename when the open tour name does not match this gateway. */
  const [linkNamePromptOpen, setLinkNamePromptOpen] = useState(false)
  /** Soft warning when the open tour file does not look like this gateway. */
  const [gateTourMismatch, setGateTourMismatch] = useState<string | null>(null)
  const [linkingTour, setLinkingTour] = useState(false)
  /** Cloud tour opened from Dashboard (not yet saved as the gate's permanent URL). */
  const [openCloudKey, setOpenCloudKey] = useState<string | null>(null)
  const [openCloudUrl, setOpenCloudUrl] = useState<string | null>(null)
  /** Linked via Cloudflare URL this session without remounting the iframe. */
  const [sessionLinkedOnline, setSessionLinkedOnline] = useState(false)
  const [needsRestore, setNeedsRestore] = useState(false)
  const [restoring, setRestoring] = useState(false)
  const [changingTour, setChangingTour] = useState(false)
  const [cloudTourUrl, setCloudTourUrl] = useState('')
  const [cloudLinkBusy, setCloudLinkBusy] = useState(false)
  const [cloudLinkError, setCloudLinkError] = useState<string | null>(null)
  const [cloudLinkFormOpen, setCloudLinkFormOpen] = useState(false)
  const [publishingCloud, setPublishingCloud] = useState(false)
  const publishingCloudRef = useRef(false)
  const [publishProgress, setPublishProgress] = useState<{
    done: number
    total: number
    phase: string
  } | null>(null)
  /** Soft Dashboard (cloud / Double Tour picker) open inside the iframe. */
  const [embedDashOpen, setEmbedDashOpen] = useState(false)
  const cloudLinkInputRef = useRef<HTMLInputElement | null>(null)
  const [awaitingLinkedOpen, setAwaitingLinkedOpen] = useState(
    () => Boolean(launchBoundName) || Boolean(projectUrl?.trim()),
  )
  const [openProgress, setOpenProgress] = useState<OpenProgressState | null>(null)
  const openProgressAtRef = useRef(0)
  const downloadSpeedRef = useRef<{ startedAt: number; lastBytes: number } | null>(null)
  /** When a linked tour exists, seed IndexedDB before mounting the iframe so Enter opens photos. */
  const [iframeAllowed, setIframeAllowed] = useState(() => !launchBoundName)
  const portfolio = usePortfolioStore((s) => s.portfolio)
  const hasOnlineTour = Boolean(projectUrl?.trim()) || sessionLinkedOnline

  useEffect(() => {
    if (!open) initialPushDoneRef.current = false
  }, [open])

  // When AppShell syncs projectUrl after link/clear, reset mount-time local state so the
  // chrome matches cloud vs local without requiring a hard refresh.
  const syncedProjectUrlRef = useRef(projectUrl)
  useEffect(() => {
    const prev = String(syncedProjectUrlRef.current || '').trim()
    const next = String(projectUrl || '').trim()
    syncedProjectUrlRef.current = projectUrl
    if (!open || prev === next) return
    /* eslint-disable react-hooks/set-state-in-effect -- prop-driven link sync */
    setLaunchBoundName(null)
    setBoundName(null)
    setNeedsRestore(false)
    if (next) {
      setSessionLinkedOnline(true)
      setAlreadyLinked(true)
      setIframeAllowed(true)
    } else {
      setSessionLinkedOnline(false)
      setAlreadyLinked(false)
    }
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [open, projectUrl])

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- modal open/close UI sync for linked tours */
    if (!open) {
      projectOpenRef.current = false
      openRequestedRef.current = false
      pushInFlightRef.current = false
      openProgressAtRef.current = 0
      downloadSpeedRef.current = null
      setAwaitingLinkedOpen(false)
      setProjectOpen(false)
      setNeedsRestore(false)
      setRestoring(false)
      setOpenProgress(null)
      setCloudTourUrl('')
      setCloudLinkError(null)
      setCloudLinkBusy(false)
      setCloudLinkFormOpen(false)
      publishingCloudRef.current = false
      setPublishingCloud(false)
      setPublishProgress(null)
      setEmbedDashOpen(false)
      setOpenCloudKey(null)
      setOpenCloudUrl(null)
      setSessionLinkedOnline(false)
      setLinkNamePromptOpen(false)
      setLinkingTour(false)
      setGateTourMismatch(null)
      setIframeAllowed(!launchBoundName)
      return
    }
    // Online Tour URL: iframe opens from cache when warm, otherwise downloads.
    if (hasOnlineTour && !launchBoundName) {
      setAwaitingLinkedOpen(true)
      setIframeAllowed(true)
      openProgressAtRef.current = Date.now()
      setOpenProgress({
        done: 0,
        total: 1,
        phase: 'Opening online tour…',
        fileName: insp360ProjectDisplayName(projectUrl) || 'tour.insp360',
        fileSize: null,
        source: 'cloud',
      })
      return
    }
    if (!gateKey || !launchBoundName) {
      setIframeAllowed(true)
      return
    }
    let cancelled = false
    setAwaitingLinkedOpen(true)
    setIframeAllowed(false)
    openProgressAtRef.current = Date.now()
    setOpenProgress({
      done: 0,
      total: 5,
      phase: 'Preparing linked tour…',
      fileName: launchBoundName,
      fileSize: null,
      source: 'storage',
    })
    void (async () => {
      const prepared = await prepareViewerGateProject(gateKey, launchBoundName)
      if (cancelled) return
      if (!prepared) {
        setNeedsRestore(true)
        setAwaitingLinkedOpen(false)
        setOpenProgress(null)
      } else {
        const hosted = await loadHostGateProject(gateKey)
        if (cancelled) return
        openProgressAtRef.current = Date.now()
        setOpenProgress({
          done: 0,
          total: 5,
          phase: 'Handing tour to viewer…',
          fileName: prepared.name || launchBoundName,
          fileSize: hosted?.data?.byteLength ?? null,
          source: 'storage',
        })
      }
      setIframeAllowed(true)
    })()
    return () => {
      cancelled = true
    }
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [open, gateKey, launchBoundName, hasOnlineTour, projectUrl])

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- restore timer / linked-open UI */
    if (!open || closing) {
      setNeedsRestore(false)
      if (!open) setAwaitingLinkedOpen(false)
      return
    }
    if (projectOpen) {
      setNeedsRestore(false)
      setAwaitingLinkedOpen(false)
      setOpenProgress(null)
      return
    }
    // Online tours download in the iframe — do not show the reconnect dialog.
    if (hasOnlineTour) return
    if (!(boundName || launchBoundName)) {
      setNeedsRestore(false)
      return
    }
    // Give auto-open a short chance, then offer reconnect (broken/moved file link).
    // While the viewer is reporting open progress, keep waiting — large tours take longer.
    let cancelled = false
    let timer = 0
    const schedule = (ms: number) => {
      timer = window.setTimeout(() => {
        if (cancelled) return
        const recentProgress = Date.now() - openProgressAtRef.current < 20000
        if (recentProgress || openRequestedRef.current) {
          schedule(4000)
          return
        }
        setAwaitingLinkedOpen(false)
        openRequestedRef.current = false
        setNeedsRestore(true)
      }, ms)
    }
    schedule(awaitingLinkedOpen ? 12000 : 8000)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [
    open,
    projectOpen,
    closing,
    boundName,
    launchBoundName,
    alreadyLinked,
    gateKey,
    awaitingLinkedOpen,
    hasOnlineTour,
  ])

  useEffect(() => {
    if (!gateKey || hasOnlineTour) return
    const hook = getInsp360GateHook(gateKey)
    if (hook?.name && hook.hosted !== true) clearInsp360GateHook(gateKey)
  }, [gateKey, hasOnlineTour])

  useEffect(() => {
    if (!open || !gateKey || hasOnlineTour) return
    void (async () => {
      const hook = getInsp360GateHook(gateKey)
      if (!hook?.hosted) return
      // Prefer reseeding from host before treating a hosted hook as stale.
      const prepared = await prepareViewerGateProject(gateKey, hook.name)
      if (prepared) return
      const stored = await confirmGateProjectStored(gateKey, { maxWaitMs: 5000, importToHost: true })
      if (!stored) clearInsp360GateHook(gateKey)
    })()
  }, [open, gateKey, hasOnlineTour])

  /** Building folder on R2; suite/room filter is applied after list. */
  const gateCloudPrefix = useMemo(
    () =>
      insp360GateCloudPrefix({
        buildingAddress,
        suiteName: suiteName || title,
      }),
    [buildingAddress, suiteName, title],
  )

  useEffect(() => {
    if (!open) {
      tourOpenStartedAtRef.current = null
      tourOpenLoggedRef.current = false
      return
    }
    if (iframeAllowed && tourOpenStartedAtRef.current == null) {
      tourOpenStartedAtRef.current = Date.now()
      tourOpenLoggedRef.current = false
    }
  }, [open, iframeAllowed])

  const iframeSrc = useMemo(() => {
    if (!open || !iframeAllowed) return null
    const page = buildInspection360ViewerPageUrl({
      projectUrl,
      scene,
      title: title || suiteName,
      address: buildingAddress || null,
      gateKey,
      cloudPrefix: gateCloudPrefix,
    })
    try {
      const u = new URL(page)
      // Pass bound tour name so the embed can skip Create/Open and wait for the linked project.
      if (launchBoundName) u.searchParams.set('boundName', launchBoundName)
      return u.href
    } catch {
      return page
    }
  }, [
    open,
    iframeAllowed,
    projectUrl,
    scene,
    title,
    suiteName,
    buildingAddress,
    gateKey,
    launchBoundName,
    gateCloudPrefix,
  ])

  const headerTitle = [buildingAddress?.trim(), (title || suiteName || '').trim()]
    .filter(Boolean)
    .join(' — ') || '360° tour'

  const geoIndex = useMemo(
    () => (portfolio ? buildInsp360GeoIndex(portfolio) : null),
    [portfolio],
  )

  useEffect(() => {
    geoIndexRef.current = geoIndex
  }, [geoIndex])

  const postGeoIndex = useCallback(() => {
    const frame = iframeRef.current?.contentWindow
    const payload = geoIndexRef.current
    if (!frame || !payload) return
    frame.postMessage({ type: INSP360_GEO_RESPONSE, geoIndex: payload }, '*')
  }, [])

  // Keep the embedded viewer on the live main-program portfolio whenever it changes.
  useEffect(() => {
    if (!open || !geoIndex) return
    postGeoIndex()
    // Re-push shortly after open in case the iframe booted after the first message.
    const t = window.setTimeout(() => postGeoIndex(), 400)
    return () => window.clearTimeout(t)
  }, [open, geoIndex, postGeoIndex])

  const pushHostProjectToViewer = useCallback(async () => {
    if (!gateKey) return
    // Permanent Cloudflare Tour URL — do not seed/reopen a leftover local copy.
    if (hasOnlineTour) return
    if (projectOpenRef.current || closingRef.current || openRequestedRef.current) return
    if (pushInFlightRef.current) return
    pushInFlightRef.current = true
    const frame = iframeRef.current?.contentWindow
    if (!frame) {
      pushInFlightRef.current = false
      return
    }
    let prepared: Awaited<ReturnType<typeof prepareViewerGateProject>>
    try {
      prepared = await prepareViewerGateProject(gateKey, launchBoundName || undefined)
    } catch {
      pushInFlightRef.current = false
      return
    }
    if (projectOpenRef.current) {
      pushInFlightRef.current = false
      return
    }
    // Seed viewer IndexedDB from host, then name-only ping — large buffer postMessage often fails.
    if (prepared) {
      openRequestedRef.current = true
      pushInFlightRef.current = false
      setAlreadyLinked(true)
      setBoundName(prepared.name)
      setAwaitingLinkedOpen(true)
      setNeedsRestore(false)
      openProgressAtRef.current = Date.now()
      setOpenProgress((prev) => ({
        done: prev?.done ?? 0,
        total: Math.max(prev?.total ?? 5, 5),
        phase: 'Opening linked tour…',
        fileName: prepared.name,
        fileSize: prev?.fileSize ?? null,
        source: prev?.source || 'storage',
      }))
      // Send exactly one open message. Dual name+buffer opens raced and left blank library thumbs.
      void (async () => {
        const stored = await loadHostGateProject(gateKey)
        const canBuffer =
          !!stored?.data?.byteLength && stored.data.byteLength <= 48 * 1024 * 1024
        try {
          if (canBuffer && stored) {
            frame.postMessage(
              {
                type: INSP360_OPEN_GATE_PROJECT_MSG,
                gateKey,
                name: stored.name || prepared.name,
                buffer: stored.data.slice(0),
              },
              '*',
            )
          } else {
            frame.postMessage(
              {
                type: INSP360_OPEN_GATE_PROJECT_MSG,
                gateKey,
                name: prepared.name,
              },
              '*',
            )
          }
        } catch {
          /* ignore */
        }
      })()
      return
    }
    pushInFlightRef.current = false
    const staleName = getInsp360GateHook(gateKey)?.name || launchBoundName
    if (staleName) {
      setNeedsRestore(true)
      frame.postMessage(
        {
          type: INSP360_STALE_GATE_LINK_MSG,
          gateKey,
          name: staleName,
        },
        '*',
      )
    }
  }, [gateKey, launchBoundName, hasOnlineTour])

  useEffect(() => {
    if (!open || !gateKey || !hasOnlineTour) return
    // Permanent cloud URL wins — clear only a leftover local gate hook so it cannot
    // beat the online tour. Keep cloud tour cache bytes for fast reopen.
    const hook = getInsp360GateHook(gateKey)
    if (hook) clearInsp360GateHook(gateKey)
  }, [open, gateKey, hasOnlineTour])

  const restoreTourFromFile = useCallback(
    async (file: File, fileHandle?: FileSystemFileHandle | null) => {
      if (!gateKey || !file) return
      const name = String(file.name || boundName || launchBoundName || 'project.insp360').trim()
      const mismatch = insp360GateTourMismatchMessage({
        tourName: name,
        buildingAddress,
        suiteName: suiteName || title,
        title,
      })
      if (mismatch) {
        const proceed = await confirm(
          `${mismatch}\n\nOpen and link this file to this gateway anyway?`,
          {
            confirmLabel: 'Open anyway',
            cancelLabel: 'Cancel',
          },
        )
        if (!proceed) return
      }
      setRestoring(true)
      setLinkError(null)
      openProgressAtRef.current = Date.now()
      setOpenProgress({
        done: 0,
        total: 5,
        phase: 'Opening tour file…',
        fileName: name,
        fileSize: Number(file.size) || null,
        source: fileHandle ? 'disk' : 'picker',
      })
      try {

        if (fileHandle) {
          // Fast path: remember the on-disk file and open it immediately — do NOT wait
          // for a 100MB+ arrayBuffer/IDB copy (that was leaving Reconnect hanging).
          await writeViewerGateFileHandle(gateKey, fileHandle, name)
          writeInsp360GateHook(gateKey, name, { hosted: true })
          setBoundName(name)
          setProjectName(name)
          setProjectDisplayName(insp360ProjectDisplayName(name) || name)
          setAlreadyLinked(true)
          setAwaitingLinkedOpen(true)
          setNeedsRestore(false)
          const frame = iframeRef.current?.contentWindow
          if (frame) {
            // Pass the live handle + File into the iframe (structured clone). IDB round-trip
            // was receiving the message but never completing openProject.
            frame.postMessage(
              {
                type: INSP360_OPEN_GATE_HANDLE_MSG,
                gateKey,
                name,
                handle: fileHandle,
                file,
              },
              '*',
            )
          }
          // Background cache for next time — never blocks opening.
          void (async () => {
            try {
              const data = await file.arrayBuffer()
              if (!data.byteLength) return
              await saveHostGateProject(gateKey, name, data)
              await writeViewerGateProject(gateKey, name, data)
            } catch {
              /* ignore background seed failure */
            }
          })()
          return
        }

        // Classic file picker (no persistent handle): open the live File first;
        // do not block on a 100MB+ arrayBuffer/IDB copy.
        if (!file.size) {
          setLinkError('That file was empty. Pick the .insp360 tour file and try again.')
          setNeedsRestore(true)
          setOpenProgress(null)
          return
        }
        writeInsp360GateHook(gateKey, name, { hosted: true })
        setBoundName(name)
        setProjectName(name)
        setProjectDisplayName(insp360ProjectDisplayName(name) || name)
        setAlreadyLinked(true)
        setAwaitingLinkedOpen(true)
        setNeedsRestore(false)
        const frame = iframeRef.current?.contentWindow
        if (frame) {
          frame.postMessage(
            {
              type: INSP360_OPEN_GATE_HANDLE_MSG,
              gateKey,
              name,
              file,
            },
            '*',
          )
        }
        void (async () => {
          try {
            const data = await file.arrayBuffer()
            if (!data.byteLength) return
            await saveHostGateProject(gateKey, name, data)
            await writeViewerGateProject(gateKey, name, data)
          } catch {
            /* ignore background seed failure */
          }
        })()
      } catch {
        setLinkError('Could not open that file. Use Reconnect tour file… and pick it again.')
        setNeedsRestore(true)
        setAwaitingLinkedOpen(false)
        setOpenProgress(null)
      } finally {
        setRestoring(false)
      }
    },
    [boundName, buildingAddress, gateKey, launchBoundName, suiteName, title],
  )

  const openRestoreFilePicker = useCallback(() => {
    // Prefer File System Access picker so we can remember the on-disk .insp360 location.
    const showOpenFilePicker = (
      window as Window & {
        showOpenFilePicker?: (options: {
          multiple?: boolean
          types?: Array<{ description: string; accept: Record<string, string[]> }>
        }) => Promise<FileSystemFileHandle[]>
      }
    ).showOpenFilePicker
    if (typeof showOpenFilePicker === 'function') {
      void (async () => {
        try {
          const handles = await showOpenFilePicker({
            multiple: false,
            types: [
              {
                description: 'INSP360 project',
                accept: { 'application/zip': ['.insp360', '.zip'] },
              },
            ],
          })
          const handle = handles[0]
          if (!handle) return
          const file = await handle.getFile()
          void restoreTourFromFile(file, handle)
        } catch (err) {
          if (err && typeof err === 'object' && 'name' in err && err.name === 'AbortError') return
          const input = restoreFileInputRef.current
          if (!input) return
          input.value = ''
          input.click()
        }
      })()
      return
    }
    const input = restoreFileInputRef.current
    if (!input) return
    input.value = ''
    input.click()
  }, [restoreTourFromFile])

  const requestChangeTour = useCallback(async () => {
    if (!gateKey || closingRef.current || changingTour) return
    const currentName =
      projectDisplayName || projectName || boundName || launchBoundName || projectUrl || null
    const hasLink = Boolean(currentName) || hasOnlineTour || alreadyLinked
    if (!hasLink) {
      await confirm('This gateway has no tour link to remove.', {
        confirmLabel: 'OK',
        cancelLabel: 'Close',
      })
      return
    }
    const ok = await confirm(insp360RemoveTourConfirmMessage(currentName), {
      confirmLabel: 'Remove link',
      cancelLabel: 'Keep linked',
    })
    if (!ok) return
    setChangingTour(true)
    setLinkPromptOpen(false)
    setLinkError(null)
    try {
      await unlinkInsp360GateTour(gateKey)
      if (onClearTourLink) {
        await onClearTourLink(gateKey)
      }
      projectOpenRef.current = false
      openRequestedRef.current = false
      pushInFlightRef.current = false
      setLaunchBoundName(null)
      setBoundName(null)
      setProjectName(null)
      setProjectDisplayName(null)
      setProjectOpen(false)
      setAlreadyLinked(false)
      setNeedsRestore(false)
      setAwaitingLinkedOpen(false)
      setIframeAllowed(true)
      setViewerEpoch((n) => n + 1)
      onClose()
    } finally {
      setChangingTour(false)
    }
  }, [
    alreadyLinked,
    boundName,
    changingTour,
    gateKey,
    hasOnlineTour,
    launchBoundName,
    onClearTourLink,
    onClose,
    projectDisplayName,
    projectName,
    projectUrl,
  ])

  const handleLinkCloudTour = useCallback(async () => {
    if (!gateKey || !onLinkOnlineTour || cloudLinkBusy || closingRef.current) return
    const url = normalizeCloudTourUrlInput(cloudTourUrl)
    if (!url) {
      setCloudLinkError('Paste a Cloudflare tour URL (or file key) first.')
      return
    }
    setCloudLinkBusy(true)
    setCloudLinkError(null)
    try {
      await onLinkOnlineTour(gateKey, url)
      setLaunchBoundName(null)
      setBoundName(null)
      setProjectName(null)
      setProjectDisplayName(null)
      setProjectOpen(false)
      projectOpenRef.current = false
      openRequestedRef.current = false
      setAlreadyLinked(true)
      setSessionLinkedOnline(true)
      setNeedsRestore(false)
      setAwaitingLinkedOpen(true)
      setIframeAllowed(true)
      setCloudTourUrl('')
      setViewerEpoch((n) => n + 1)
      showToastSuccess('✓ Tour linked to this gateway')
    } catch (error) {
      setCloudLinkError(errorMessage(error, 'Could not link Cloudflare tour'))
      showToastError(errorMessage(error, 'Could not link Cloudflare tour'))
    } finally {
      setCloudLinkBusy(false)
    }
  }, [cloudLinkBusy, cloudTourUrl, gateKey, onLinkOnlineTour])

  const renameOpenTourInViewer = useCallback(
    async (nextName: string): Promise<boolean> => {
      const frame = iframeRef.current?.contentWindow
      if (!frame || !gateKey) return false
      const cleaned = String(nextName || '').trim()
      if (!cleaned) return false
      return new Promise((resolve) => {
        let settled = false
        const finish = (ok: boolean) => {
          if (settled) return
          settled = true
          window.clearTimeout(timer)
          window.removeEventListener('message', onMessage)
          resolve(ok)
        }
        const onMessage = (event: MessageEvent) => {
          if (event.data?.type !== 'insp360:projectNameSet') return
          if (event.data.gateKey && String(event.data.gateKey) !== gateKey) return
          finish(event.data.ok !== false)
        }
        const timer = window.setTimeout(() => finish(true), 2500)
        window.addEventListener('message', onMessage)
        try {
          frame.postMessage(
            { type: INSP360_SET_PROJECT_NAME_MSG, gateKey, name: cleaned },
            '*',
          )
        } catch {
          finish(false)
        }
      })
    },
    [gateKey],
  )

  const openTourLooksLikeGate = useCallback(() => {
    const tourRef = openCloudKey || projectName || projectDisplayName
    return insp360TourNameMatchesGate(tourRef, {
      buildingAddress,
      suiteName: suiteName || title,
      projectName: projectDisplayName || projectName,
    })
  }, [
    buildingAddress,
    openCloudKey,
    projectDisplayName,
    projectName,
    suiteName,
    title,
  ])

  /** Link the currently open tour (cloud URL or local copy) to this gateway — keep viewer open. */
  const linkOpenTourToGate = useCallback(
    async (options?: { renameToMatch?: boolean; closeAfter?: boolean }) => {
      if (!gateKey || linkingTour || closingRef.current) return
      const renameToMatch = options?.renameToMatch === true
      const closeAfter = options?.closeAfter === true
      setLinkingTour(true)
      setLinkError(null)
      setLinkPromptOpen(false)
      setLinkNamePromptOpen(false)
      try {
        let linkedName = (() => {
          const openFile = String(projectName || '').trim()
          const openDisplay = String(projectDisplayName || '').trim()
          if (openFile) return openFile
          if (openDisplay) {
            return /\.(insp360|zip)$/i.test(openDisplay) ? openDisplay : `${openDisplay}.insp360`
          }
          return 'project.insp360'
        })()

        if (renameToMatch) {
          const suggested = insp360SuggestedGateTourFileName({
            buildingAddress,
            suiteName: suiteName || title,
            title,
          })
          const renamed = await renameOpenTourInViewer(suggested)
          if (renamed) {
            linkedName = suggested
            setProjectName(suggested)
            setProjectDisplayName(insp360ProjectDisplayName(suggested) || suggested)
          }
        }

        const cloudTarget = String(openCloudUrl || openCloudKey || '').trim()
        if (cloudTarget && onLinkOnlineTour) {
          if (closeAfter) {
            closingRef.current = true
            setClosing(true)
            setClosingMode('linking')
          }
          await onLinkOnlineTour(gateKey, cloudTarget, { reloadViewer: false })
          setAlreadyLinked(true)
          setSessionLinkedOnline(true)
          setBoundName(null)
          setLaunchBoundName(null)
          showToastSuccess('✓ Tour linked to this gateway')
          if (closeAfter) onClose()
          return
        }

        if (closeAfter) {
          closingRef.current = true
          setClosing(true)
          setClosingMode('linking')
        }
        const frame = iframeRef.current?.contentWindow
        let mirrorOk = true
        if (frame) mirrorOk = await flushViewerClose(frame, true)
        if (!mirrorOk) {
          closingRef.current = false
          setClosing(false)
          setClosingMode('idle')
          setAlreadyLinked(false)
          setLinkError(
            'Could not store this tour for the gateway. Keep the tour open and try Link this Tour again, or use Pick .insp360 to link…',
          )
          setLinkPromptOpen(true)
          return
        }
        await hostSaveChainRef.current
        const saved = await waitForLinkedGateProject(gateKey, 180000, linkedName)
        if (!saved) {
          closingRef.current = false
          setClosing(false)
          setClosingMode('idle')
          setAlreadyLinked(false)
          setLinkError(
            'Could not save this tour for the gateway. Keep the .insp360 open, then choose Link this Tour again.',
          )
          setLinkPromptOpen(true)
          return
        }
        writeInsp360GateHook(gateKey, linkedName, { hosted: true })
        await prepareViewerGateProject(gateKey, linkedName)
        setBoundName(linkedName)
        setAlreadyLinked(true)
        showToastSuccess('✓ Tour linked to this gateway on this PC')
        if (closeAfter) onClose()
      } catch (error) {
        closingRef.current = false
        setClosing(false)
        setClosingMode('idle')
        setLinkError(errorMessage(error, 'Could not link this tour'))
        setLinkPromptOpen(true)
        showToastError(errorMessage(error, 'Could not link this tour'))
      } finally {
        setLinkingTour(false)
      }
    },
    [
      buildingAddress,
      gateKey,
      linkingTour,
      onClose,
      onLinkOnlineTour,
      openCloudKey,
      openCloudUrl,
      projectDisplayName,
      projectName,
      renameOpenTourInViewer,
      suiteName,
      title,
    ],
  )

  const requestLinkThisTour = useCallback(() => {
    if (!gateKey || !projectOpen || alreadyLinked || linkingTour) return
    setLinkError(null)
    if (!openTourLooksLikeGate()) {
      setLinkNamePromptOpen(true)
      setLinkPromptOpen(false)
      return
    }
    void linkOpenTourToGate({ closeAfter: false })
  }, [
    alreadyLinked,
    gateKey,
    linkOpenTourToGate,
    linkingTour,
    openTourLooksLikeGate,
    projectOpen,
  ])

  useEffect(() => {
    // #region agent log
    fetch('http://127.0.0.1:7574/ingest/5d9a1b8d-28ec-4647-bad2-07deacdce245',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'f50159'},body:JSON.stringify({sessionId:'f50159',runId:'pre-fix',hypothesisId:'H',location:'Inspection360Viewer.tsx:mount',message:'map host viewer mounted',data:{gateKey:gateKey||null,projectOpen,canEdit,href:typeof location!=='undefined'?location.href:null},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
  }, [canEdit, gateKey, projectOpen])

  const handlePublishCloudTour = useCallback(async () => {
    if (
      !gateKey ||
      !onLinkOnlineTour ||
      publishingCloud ||
      closingRef.current ||
      !projectOpen
    ) {
      // #region agent log
      fetch('http://127.0.0.1:7574/ingest/5d9a1b8d-28ec-4647-bad2-07deacdce245',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'f50159'},body:JSON.stringify({sessionId:'f50159',runId:'pre-fix',hypothesisId:'E',location:'Inspection360Viewer.tsx:earlyReturn',message:'publish blocked before start',data:{hasGateKey:!!gateKey,hasLinkFn:!!onLinkOnlineTour,publishingCloud,closing:closingRef.current,projectOpen,canEdit},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      return
    }
    if (!canEdit) {
      showToastError('Admin access is required to publish tours to Cloudflare.')
      return
    }

    // #region agent log
    fetch('http://127.0.0.1:7574/ingest/5d9a1b8d-28ec-4647-bad2-07deacdce245',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'f50159'},body:JSON.stringify({sessionId:'f50159',runId:'pre-fix',hypothesisId:'A',location:'Inspection360Viewer.tsx:publishStart',message:'publish started',data:{gateKey,canEdit,projectOpen},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    setPublishingCloud(true)
    publishingCloudRef.current = true
    const publishStartedAt = Date.now()
    setPublishProgress({ done: 1, total: 100, phase: 'Preparing tour file…' })
    const heartbeat = window.setInterval(() => {
      if (!publishingCloudRef.current) return
      const sec = Math.max(1, Math.round((Date.now() - publishStartedAt) / 1000))
      setPublishProgress((prev) => {
        if (!prev) return prev
        // Keep upload % once the PUT has started (>= 20).
        if (prev.done >= 20) return prev
        const base = prev.phase.replace(/\s*\(\d+s\)\s*$/, '').trim() || 'Preparing tour file…'
        return {
          ...prev,
          done: Math.max(prev.done, 1),
          phase: `${base} (${sec}s)`,
        }
      })
    }, 1000)
    await yieldToUi()
    try {
      const frame = iframeRef.current?.contentWindow

      // Full .insp360 publish: use already-packed gate bytes when present.
      // Do NOT remirror every time — that left the bar stuck at 3% on large tours.
      // (Pin/map-only cloud updates use Save in the viewer, not this Publish button.)
      let hosted = await loadHostGateProject(gateKey)
      // #region agent log
      fetch('http://127.0.0.1:7574/ingest/5d9a1b8d-28ec-4647-bad2-07deacdce245',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'f50159'},body:JSON.stringify({sessionId:'f50159',runId:'publish-unstick',hypothesisId:'B',location:'Inspection360Viewer.tsx:afterLoadHost',message:'initial host gate project load',data:{hasBytes:!!hosted?.data?.byteLength,bytes:hosted?.data?.byteLength||0,name:hosted?.name||null,elapsedMs:Date.now()-publishStartedAt},timestamp:Date.now()})}).catch(()=>{});
      // #endregion

      if (!hosted?.data?.byteLength) {
        if (frame) {
          setPublishProgress({
            done: 3,
            total: 100,
            phase: 'Packing photos in the viewer…',
          })
          await yieldToUi()
          const packed = await flushViewerPublish(frame, gateKey, null)
          // #region agent log
          fetch('http://127.0.0.1:7574/ingest/5d9a1b8d-28ec-4647-bad2-07deacdce245',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'f50159'},body:JSON.stringify({sessionId:'f50159',runId:'publish-unstick',hypothesisId:'A',location:'Inspection360Viewer.tsx:afterFlushPublish',message:'viewer preparePublish finished',data:{ok:packed.ok,jsonOnly:packed.jsonOnly,photosDirty:packed.photosDirty,elapsedMs:Date.now()-publishStartedAt},timestamp:Date.now()})}).catch(()=>{});
          // #endregion
          if (!packed.ok) {
            // Fallback for older viewers / failed mirror.
            await flushViewerClose(frame, true)
          }
        }
        setPublishProgress({
          done: 15,
          total: 100,
          phase: 'Collecting tour file for upload…',
        })
        await yieldToUi()
        await waitForLinkedGateProject(
          gateKey,
          120000,
          projectName || projectDisplayName || undefined,
        )
        hosted = await loadHostGateProject(gateKey)
        // #region agent log
        fetch('http://127.0.0.1:7574/ingest/5d9a1b8d-28ec-4647-bad2-07deacdce245',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'f50159'},body:JSON.stringify({sessionId:'f50159',runId:'publish-unstick',hypothesisId:'B',location:'Inspection360Viewer.tsx:afterWaitHost',message:'host project after pack/wait',data:{hasBytes:!!hosted?.data?.byteLength,bytes:hosted?.data?.byteLength||0,name:hosted?.name||null,elapsedMs:Date.now()-publishStartedAt},timestamp:Date.now()})}).catch(()=>{});
        // #endregion
      }

      if (!hosted?.data?.byteLength) {
        throw new Error(
          'Could not pack the tour file for upload. Save the project in the tour first, then try Publish again.',
        )
      }

      const fileBytes = hosted.data.byteLength
      const sizeLabel = formatTourFileSize(fileBytes) || 'tour'
      setPublishProgress({
        done: 18,
        total: 100,
        phase: `Starting Cloudflare upload (${sizeLabel})…`,
      })
      await yieldToUi()

      setPublishProgress({
        done: 19,
        total: 100,
        phase: 'Preparing cover & map sidecar…',
      })
      await yieldToUi()
      const coverBlob = extractInsp360CoverBlob(hosted.data)
      const tourJson = extractInsp360TourJsonText(hosted.data)

      // Each publish gets a dated key so Double Tour can compare versions of the same gate tour.
      const objectKey = buildInsp360PublishObjectKey({
        buildingAddress,
        suiteName: suiteName || title,
        projectName: hosted.name || projectName || projectDisplayName,
        versioned: true,
      })

      // #region agent log
      fetch('http://127.0.0.1:7574/ingest/5d9a1b8d-28ec-4647-bad2-07deacdce245',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'f50159'},body:JSON.stringify({sessionId:'f50159',runId:'pre-fix',hypothesisId:'C',location:'Inspection360Viewer.tsx:beforeCloudPublish',message:'about to call publishInsp360TourToCloud',data:{objectKey,fileBytes,hasCover:!!coverBlob?.size,hasTourJson:!!tourJson,elapsedMs:Date.now()-publishStartedAt},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      const published = await publishInsp360TourToCloud({
        objectKey,
        data: hosted.data,
        fileName: hosted.name,
        overwrite: true,
        coverBlob,
        tourJson,
        onProgress: (done, total) => {
          const safeTotal = Math.max(1, total)
          // Reserve 20–92% of the bar for the main .insp360 PUT.
          const pct = 20 + Math.round((Math.min(done, safeTotal) / safeTotal) * 72)
          const uploaded = formatTourFileSize(done)
          const ofTotal = formatTourFileSize(safeTotal)
          setPublishProgress({
            done: pct,
            total: 100,
            phase:
              uploaded && ofTotal
                ? `Uploading ${uploaded} / ${ofTotal}…`
                : 'Uploading tour to Cloudflare…',
          })
        },
      })

      // #region agent log
      fetch('http://127.0.0.1:7574/ingest/5d9a1b8d-28ec-4647-bad2-07deacdce245',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'f50159'},body:JSON.stringify({sessionId:'f50159',runId:'pre-fix',hypothesisId:'D',location:'Inspection360Viewer.tsx:afterCloudPublish',message:'cloud publish succeeded',data:{tourUrl:published.tourUrl,objectKey:published.objectKey,elapsedMs:Date.now()-publishStartedAt},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      setPublishProgress({ done: 96, total: 100, phase: 'Linking tour to this gateway…' })
      await yieldToUi()
      // Persist latest cloud URL without remounting/re-downloading the tour we just uploaded.
      await onLinkOnlineTour(gateKey, published.tourUrl, { reloadViewer: false })
      setPublishProgress({ done: 100, total: 100, phase: 'Publish complete' })
      setAlreadyLinked(true)
      setSessionLinkedOnline(true)
      setLaunchBoundName(null)
      setBoundName(null)
      setCloudLinkFormOpen(false)
      void recordActivityEvent({
        eventType: 'tour_publish',
        resourceKey: gateKey || published.objectKey,
        durationMs: Date.now() - publishStartedAt,
        meta: { tourUrl: published.tourUrl, objectKey: published.objectKey },
      })
      showToastSuccess('✓ Published to Cloudflare and linked to this gateway')
    } catch (error) {
      // #region agent log
      fetch('http://127.0.0.1:7574/ingest/5d9a1b8d-28ec-4647-bad2-07deacdce245',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'f50159'},body:JSON.stringify({sessionId:'f50159',runId:'pre-fix',hypothesisId:'C',location:'Inspection360Viewer.tsx:publishCatch',message:'publish threw',data:{error:error instanceof Error?error.message:String(error),elapsedMs:Date.now()-publishStartedAt},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      showToastError(errorMessage(error, 'Could not publish tour to Cloudflare'))
    } finally {
      window.clearInterval(heartbeat)
      publishingCloudRef.current = false
      setPublishingCloud(false)
      setPublishProgress(null)
    }
  }, [
    buildingAddress,
    gateKey,
    canEdit,
    onLinkOnlineTour,
    projectDisplayName,
    projectName,
    projectOpen,
    publishingCloud,
    suiteName,
    title,
  ])

  useEffect(() => {
    if (!cloudLinkFormOpen) return
    const id = window.setTimeout(() => cloudLinkInputRef.current?.focus(), 0)
    return () => window.clearTimeout(id)
  }, [cloudLinkFormOpen])

  const finishClose = useCallback(
    async (linkGate: boolean) => {
      if (closingRef.current) return
      if (linkGate && gateKey && projectOpen && !alreadyLinked) {
        if (!openTourLooksLikeGate()) {
          setLinkPromptOpen(false)
          setLinkNamePromptOpen(true)
          return
        }
        await linkOpenTourToGate({ closeAfter: true })
        return
      }
      closingRef.current = true
      setLinkPromptOpen(false)
      setLinkNamePromptOpen(false)
      setLinkError(null)
      setClosing(true)
      setClosingMode('closing')
      const frame = iframeRef.current?.contentWindow
      // Already-linked local gates: remirror so map/pin edits land in the reopen cache.
      const shouldSyncGate =
        alreadyLinked && Boolean(gateKey) && projectOpen && !hasOnlineTour
      try {
        if (frame) await flushViewerClose(frame, shouldSyncGate)
        onClose()
      } catch {
        closingRef.current = false
        setClosing(false)
        setClosingMode('idle')
        onClose()
      }
    },
    [
      alreadyLinked,
      gateKey,
      hasOnlineTour,
      linkOpenTourToGate,
      onClose,
      openTourLooksLikeGate,
      projectOpen,
    ],
  )

  const requestClose = useCallback(() => {
    if (closingRef.current || linkPromptOpen || linkNamePromptOpen || linkingTour) return
    // Permanent online Tour URL — close without local Link / IndexedDB copy.
    if (hasOnlineTour) {
      void finishClose(false)
      return
    }
    const gateAlreadyAssigned = Boolean(
      (boundName || launchBoundName) && !alreadyLinked,
    )
    const prompt = shouldPromptLinkGate({
      gateKey,
      projectOpen,
      alreadyLinked,
      hasOnlineTour,
      gateAlreadyAssigned,
    })
    if (prompt) {
      setLinkError(null)
      setLinkPromptOpen(true)
      return
    }
    void finishClose(alreadyLinked)
  }, [
    alreadyLinked,
    boundName,
    finishClose,
    gateKey,
    hasOnlineTour,
    launchBoundName,
    linkNamePromptOpen,
    linkPromptOpen,
    linkingTour,
    projectOpen,
  ])

  useEffect(() => {
    if (!open || minimized) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (linkPromptOpen) {
        e.preventDefault()
        e.stopPropagation()
        setLinkPromptOpen(false)
        void finishClose(false)
        return
      }
      if (linkNamePromptOpen) {
        e.preventDefault()
        e.stopPropagation()
        setLinkNamePromptOpen(false)
        return
      }
      e.preventDefault()
      e.stopPropagation()
      requestClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open, minimized, requestClose, linkPromptOpen, linkNamePromptOpen, finishClose])

  useEffect(() => {
    if (!open) return
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === INSP360_GEO_REQUEST) {
        postGeoIndex()
        return
      }
      if (event.data?.type === INSP360_UPLOAD_TOUR_JSON_MSG) {
        const reqId = String(event.data.reqId || '')
        const tourObjectKey = String(event.data.tourObjectKey || openCloudKey || '').trim()
        const tourJson = event.data.tourJson
        const source = event.source as Window | null
        void (async () => {
          let ok = false
          try {
            if (!tourObjectKey || tourJson == null || tourJson === '') {
              throw new Error('Missing tour key or JSON')
            }
            await publishInsp360TourJsonToCloud({
              tourObjectKey,
              tourJson: typeof tourJson === 'string' ? tourJson : String(tourJson),
            })
            ok = true
          } catch (error) {
            console.warn('insp360 tour.json upload failed', error)
          }
          try {
            source?.postMessage(
              { type: INSP360_TOUR_JSON_UPLOAD_RESULT_MSG, reqId, ok },
              '*',
            )
          } catch {
            /* ignore */
          }
        })()
        return
      }
      if (event.data?.type === INSP360_PROJECT_OPEN_MSG && typeof event.data.gateKey === 'string') {
        if (gateKey && event.data.gateKey !== gateKey) return
        const name = String(event.data.name || 'project.insp360')
        const displayName =
          String(event.data.displayName || '').trim() || insp360ProjectDisplayName(name) || name
        const linkedRaw = Boolean(event.data.alreadyLinked)
        const sameAsLaunch = insp360SameProjectFile(name, launchBoundName)
        const cloudKey =
          typeof event.data.cloudKey === 'string' ? String(event.data.cloudKey).trim() : ''
        const publicUrl =
          typeof event.data.publicUrl === 'string' ? String(event.data.publicUrl).trim() : ''
        const storage = String(event.data.storage || '').toLowerCase()
        // Open tour is "linked" only when it matches this gate's assignment — not merely
        // because the gate already has some other default (local or online).
        const sameAsPermanent = isOpenTourPermanentCloudLink({
          permanentUrl: projectUrl,
          openCloudKey: cloudKey || null,
          openCloudUrl: publicUrl || null,
          openProjectName: name,
        })
        const effectiveLinked = linkedRaw || sameAsLaunch || sameAsPermanent
        projectOpenRef.current = true
        setProjectOpen(true)
        setProjectName(name)
        setProjectDisplayName(displayName)
        setAlreadyLinked(effectiveLinked)
        setAwaitingLinkedOpen(false)
        setRestoring(false)
        setOpenProgress(null)
        if (storage === 'cloud' || cloudKey || publicUrl) {
          setOpenCloudKey(cloudKey || null)
          setOpenCloudUrl(publicUrl || (cloudKey ? insp360TourFileUrl(cloudKey) : null))
        } else {
          setOpenCloudKey(null)
          setOpenCloudUrl(null)
        }
        if (effectiveLinked) {
          // Local default name tracks the open file; online defaults stay on projectUrl.
          if (!hasOnlineTour) setBoundName(name)
          setNeedsRestore(false)
        }
        // else: keep launchBoundName / boundName — creating or opening a different tour
        // must not clear or replace the gate's existing assignment.
        const mismatch = insp360GateTourMismatchMessage({
          tourName: displayName || name,
          buildingAddress,
          suiteName: suiteName || title,
          title,
        })
        setGateTourMismatch(mismatch)
        // Warn when the user opens a tour that does not look like this gateway
        // (skip auto-open of an already-linked tour — that path is intentional).
        if (mismatch && !effectiveLinked) {
          showToastWarning(mismatch, 'Tour may not match this gateway')
        }
        if (!tourOpenLoggedRef.current) {
          tourOpenLoggedRef.current = true
          const started = tourOpenStartedAtRef.current
          void recordActivityEvent({
            eventType: 'tour_open_ok',
            resourceKey: gateKey || name,
            durationMs: started != null ? Date.now() - started : null,
            meta: {
              name: displayName || name,
              storage: storage || null,
              buildingAddress: buildingAddress || null,
            },
          })
        }
        return
      }
      if (event.data?.type === INSP360_OPEN_PROGRESS_MSG && typeof event.data.gateKey === 'string') {
        if (gateKey && event.data.gateKey !== gateKey) return
        const payload = event.data as Insp360OpenProgressPayload
        const done = Math.max(0, Number(payload.done) || 0)
        const total = Math.max(1, Number(payload.total) || 1)
        const source = payload.source ? String(payload.source) : null
        const phase = String(payload.phase || 'Opening…')
        // Publish path: viewer packing progress drives the host publish panel (not the open panel).
        if (publishingCloudRef.current) {
          const pct = Math.min(17, Math.round((done / total) * 17))
          setPublishProgress({
            done: Math.max(1, pct),
            total: 100,
            phase: phase || 'Preparing tour…',
          })
          return
        }
        const now = Date.now()
        openProgressAtRef.current = now
        let bytesPerSec: number | null = null
        if (source === 'cloud' && done > 0) {
          const prev = downloadSpeedRef.current
          if (!prev || done < prev.lastBytes) {
            downloadSpeedRef.current = { startedAt: now, lastBytes: done }
          } else {
            downloadSpeedRef.current = { startedAt: prev.startedAt, lastBytes: done }
            const elapsedSec = (now - prev.startedAt) / 1000
            if (elapsedSec >= 0.2) bytesPerSec = done / elapsedSec
          }
        } else if (source !== 'cloud') {
          downloadSpeedRef.current = null
        }
        setAwaitingLinkedOpen(true)
        setNeedsRestore(false)
        setOpenProgress({
          done,
          total,
          phase,
          fileName: String(payload.fileName || '').trim() || null,
          fileSize: Number(payload.fileSize) > 0 ? Number(payload.fileSize) : null,
          source,
          bytesPerSec,
        })
        return
      }
      if (event.data?.type === INSP360_REQUEST_HOST_FILE_PICK_MSG) {
        if (gateKey && event.data.gateKey && String(event.data.gateKey) !== gateKey) return
        setNeedsRestore(true)
        openRestoreFilePicker()
        return
      }
      if (event.data?.type === INSP360_REQUEST_CHANGE_TOUR_MSG) {
        if (gateKey && event.data.gateKey && String(event.data.gateKey) !== gateKey) return
        void requestChangeTour()
        return
      }
      if (event.data?.type === INSP360_SET_GATE_DEFAULT_TOUR_MSG) {
        if (gateKey && event.data.gateKey && String(event.data.gateKey) !== gateKey) return
        void (async () => {
          const storage = String(event.data.storage || '').toLowerCase()
          const clear = event.data.clear === true
          const name = String(event.data.name || '').trim()
          if (storage === 'cloud') {
            if (!gateKey || !onLinkOnlineTour) return
            const url = String(event.data.publicUrl || event.data.cloudKey || '').trim()
            if (!url) {
              showToastError('Missing cloud tour URL for default.')
              return
            }
            try {
              await onLinkOnlineTour(gateKey, url, { reloadViewer: false })
              setSessionLinkedOnline(true)
              setAlreadyLinked(true)
              setBoundName(null)
              setLaunchBoundName(null)
              setNeedsRestore(false)
              const cloudKey = String(event.data.cloudKey || '').trim()
              const publicUrl = String(event.data.publicUrl || '').trim()
              setOpenCloudKey(cloudKey || null)
              setOpenCloudUrl(publicUrl || (cloudKey ? insp360TourFileUrl(cloudKey) : null))
              showToastSuccess('✓ Default tour set for this gateway')
            } catch (error) {
              showToastError(errorMessage(error, 'Could not set default tour'))
            }
            return
          }
          // Local default (or clear)
          if (!gateKey) return
          try {
            if (clear || !name) {
              clearInsp360GateHook(gateKey)
              setBoundName(null)
              setLaunchBoundName(null)
              setAlreadyLinked(false)
              return
            }
            if (hasOnlineTour && onClearTourLink) {
              await onClearTourLink(gateKey)
              setSessionLinkedOnline(false)
            }
            setBoundName(name)
            setLaunchBoundName(name)
            setAlreadyLinked(true)
            setNeedsRestore(false)
            // Drop a previous default's host bytes immediately so reopen does not
            // treat the old tour as the linked one (or wipe the new viewer copy).
            const existing = await loadHostGateProject(gateKey)
            if (existing && !insp360SameProjectFile(existing.name, name)) {
              await deleteHostGateProject(gateKey)
            }
            writeInsp360GateHook(gateKey, name, { hosted: false })
            showToastSuccess('✓ Default tour set for this gateway')
            // Viewer bind posts gateProjectBound async — mark hosted once bytes land.
            void (async () => {
              const ok = await confirmGateProjectStored(gateKey, {
                maxWaitMs: 20000,
                importToHost: true,
                fallbackName: name,
              })
              if (!ok) return
              const stored = await loadHostGateProject(gateKey)
              if (stored && !insp360SameProjectFile(stored.name, name)) return
              writeInsp360GateHook(gateKey, name, { hosted: true })
            })()
          } catch (error) {
            showToastError(errorMessage(error, 'Could not set default tour'))
          }
        })()
        return
      }
      if (event.data?.type === INSP360_EMBED_DASH_MSG) {
        setEmbedDashOpen(Boolean(event.data.open))
        return
      }
      if (event.data?.type === INSP360_REQUEST_CLOUD_LIST_MSG) {
        if (gateKey && event.data.gateKey && String(event.data.gateKey) !== gateKey) return
        const source = event.source as Window | null
        const prefix = String(event.data.prefix || gateCloudPrefix || '').trim()
        void (async () => {
          try {
            if (!isAuthenticated) {
              throw new Error('Sign in to list Cloudflare tours for this gate.')
            }
            if (!prefix) throw new Error('Missing cloud prefix for this gate.')
            const tours = await listInsp360CloudTours(prefix)
            const gateMatch = {
              buildingAddress,
              suiteName: suiteName || title,
              projectName: projectName || projectDisplayName,
            }
            const permanent = String(projectUrl || '').trim()
            const withUrls = tours
              .filter((t) => insp360CloudKeyMatchesGate(t.key, gateMatch))
              .map((t) => {
                const publicUrl = t.publicUrl || insp360TourFileUrl(t.key)
                return {
                  ...t,
                  publicUrl,
                  isDefault: isOpenTourPermanentCloudLink({
                    permanentUrl: permanent,
                    openCloudKey: t.key,
                    openCloudUrl: publicUrl,
                  }),
                }
              })
            source?.postMessage(
              {
                type: INSP360_CLOUD_LIST_MSG,
                gateKey: gateKey || null,
                prefix,
                permanentUrl: permanent || null,
                tours: withUrls,
              },
              '*',
            )
          } catch (error) {
            source?.postMessage(
              {
                type: INSP360_CLOUD_LIST_MSG,
                gateKey: gateKey || null,
                prefix,
                tours: [],
                error: errorMessage(error, 'Could not list cloud tours'),
              },
              '*',
            )
          }
        })()
        return
      }
      if (event.data?.type === INSP360_STALE_GATE_LINK_MSG) {
        if (gateKey && event.data.gateKey && String(event.data.gateKey) !== gateKey) return
        setNeedsRestore(true)
        if (!tourOpenLoggedRef.current) {
          tourOpenLoggedRef.current = true
          const started = tourOpenStartedAtRef.current
          void recordActivityEvent({
            eventType: 'tour_open_fail',
            resourceKey: gateKey || null,
            durationMs: started != null ? Date.now() - started : null,
            meta: { reason: 'stale_gate_link', buildingAddress: buildingAddress || null },
          })
        }
        return
      }
      if (event.data?.type === INSP360_GATE_BOUND_MSG && typeof event.data.gateKey === 'string') {
        const name = String(event.data.name || 'project.insp360')
        const gate = String(event.data.gateKey)
        const source = event.source as Window | null
        // Online Tour URL is the permanent link — never re-host a local PC copy for this gate.
        if (hasOnlineTour) {
          try {
            source?.postMessage(
              {
                type: INSP360_GATE_PROJECT_STORED_MSG,
                gateKey: gate,
                ok: true,
                name,
              },
              '*',
            )
          } catch {
            /* ignore */
          }
          return
        }
        // Gate already has a different local default — ignore auto-bind from Save of another tour.
        // Manual Link / Set as default still updates via those flows (force bind + replace:true).
        const assignedName =
          getInsp360GateHook(gate)?.name || boundName || launchBoundName || null
        const allowReplace = event.data?.replace === true
        if (assignedName && !insp360SameProjectFile(assignedName, name) && !allowReplace) {
          try {
            source?.postMessage(
              {
                type: INSP360_GATE_PROJECT_STORED_MSG,
                gateKey: gate,
                ok: true,
                name: assignedName,
                skipped: true,
              },
              '*',
            )
          } catch {
            /* ignore */
          }
          return
        }
        // Large tours often fail if copied through postMessage; read viewer IndexedDB instead.
        const buffer = arrayBufferFromMessageData(event.data.buffer)
        hostSaveChainRef.current = hostSaveChainRef.current.then(async () => {
          let hosted = await confirmGateProjectStored(gate, {
            maxWaitMs: 120000,
            fallbackName: name,
          })
          if (!hosted && buffer) {
            hosted = await saveHostGateProject(gate, name, buffer)
          }
          if (hosted) {
            writeInsp360GateHook(gate, name, { hosted: true })
            setBoundName(name)
            setProjectName(name)
            setProjectDisplayName((prev) => prev || insp360ProjectDisplayName(name) || name)
            setProjectOpen(true)
            setAlreadyLinked(true)
            setLinkError(null)
          } else {
            clearInsp360GateHook(gate)
          }
          try {
            source?.postMessage(
              {
                type: INSP360_GATE_PROJECT_STORED_MSG,
                gateKey: gate,
                ok: hosted,
                name,
              },
              '*',
            )
          } catch {
            /* ignore */
          }
        })
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [
    open,
    gateKey,
    gateCloudPrefix,
    buildingAddress,
    suiteName,
    title,
    projectName,
    projectDisplayName,
    projectUrl,
    isAuthenticated,
    openRestoreFilePicker,
    launchBoundName,
    boundName,
    requestChangeTour,
    hasOnlineTour,
    openCloudKey,
    onLinkOnlineTour,
    onClearTourLink,
    postGeoIndex,
  ])

  const onFrameLoad = () => {
    postGeoIndex()
    // Seed once on load, then one delayed retry if the first raced ahead of viewer boot.
    // Multiple parallel pushes were re-opening the same 122MB tour several times.
    initialPushDoneRef.current = true
    projectOpenRef.current = false
    openRequestedRef.current = false
    void pushHostProjectToViewer()
    window.setTimeout(() => {
      if (!projectOpenRef.current && !openRequestedRef.current) void pushHostProjectToViewer()
    }, 2500)
  }

  if (!open) return null

  const subtitle =
    closingMode === 'linking'
      ? 'Saving tour and linking to this gate — large projects may take a minute…'
      : closingMode === 'closing'
        ? 'Closing…'
        : changingTour
          ? 'Removing tour link…'
          : publishingCloud
            ? publishProgress?.phase
              ? `Publishing to Cloudflare… ${Math.min(100, Math.round((publishProgress.done / Math.max(1, publishProgress.total)) * 100))}%`
              : 'Publishing to Cloudflare…'
            : restoring
            ? openProgress?.phase || 'Opening tour file…'
            : needsRestore && (boundName || launchBoundName)
              ? `Reconnect “${insp360ProjectDisplayName(boundName || launchBoundName)}” — pick the .insp360 file`
              : awaitingLinkedOpen
                ? openProgress?.phase || 'Opening linked tour…'
                : boundName && !hasOnlineTour
                  ? `On this PC: ${insp360ProjectDisplayName(boundName)} · Publish to share online`
                  : hasOnlineTour && (projectOpen || projectUrl)
                    ? `Cloudflare Link: ${
                        [buildingAddress?.trim(), (suiteName || title || '').trim()]
                          .filter(Boolean)
                          .join(' — ') ||
                        insp360ProjectDisplayName(projectDisplayName || projectName || projectUrl) ||
                        'tour'
                      }`
                    : projectOpen
                      ? `Open: ${insp360ProjectDisplayName(projectDisplayName || projectName) || 'tour'} — link on close keeps it on this PC only`
                      : !projectUrl
                        ? 'Create/Open = this PC only · Link Cloudflare Tour = shared online'
                        : null

  const showReconnect =
    Boolean(boundName || launchBoundName) &&
    !hasOnlineTour &&
    !projectOpen &&
    !closing &&
    !restoring &&
    !changingTour

  /** Empty gate (Create / Open) — paste a Cloudflare tour URL and attach it to this sphere. */
  const showCloudLinkPanel =
    Boolean(gateKey) &&
    Boolean(onLinkOnlineTour) &&
    !hasOnlineTour &&
    !projectOpen &&
    !awaitingLinkedOpen &&
    !needsRestore &&
    !restoring &&
    !closing &&
    !linkPromptOpen &&
    !linkNamePromptOpen &&
    !changingTour

  /** Gate has no link yet, or a different tour is open — offer Link / Set as default manually. */
  const showLinkThisTour =
    Boolean(gateKey) &&
    projectOpen &&
    !alreadyLinked &&
    !hasOnlineTour &&
    !embedDashOpen &&
    !closing &&
    !restoring &&
    !changingTour &&
    !linkingTour

  /** Hide Publish while viewing the permanent cloud tour; show it again for a different open tour. */
  const viewingLinkedCloudTour = isOpenTourPermanentCloudLink({
    permanentUrl: projectUrl,
    openCloudKey,
    openCloudUrl,
    openProjectName: projectName || projectDisplayName,
  })
  const showPublishCloud =
    projectOpen && Boolean(onLinkOnlineTour) && !embedDashOpen && !viewingLinkedCloudTour

  const suggestedGateTourLabel = insp360SuggestedGateTourLabel({
    buildingAddress,
    suiteName: suiteName || title,
    title,
  })
  const openTourLabel =
    insp360ProjectDisplayName(projectDisplayName || projectName || openCloudKey) || 'this tour'

  const progressPct = openProgress
    ? Math.min(100, Math.round((openProgress.done / Math.max(1, openProgress.total)) * 100))
    : 0
  const progressFileLabel =
    insp360ProjectDisplayName(openProgress?.fileName || boundName || launchBoundName || projectName) ||
    openProgress?.fileName ||
    null
  const progressSizeLabel = formatTourFileSize(openProgress?.fileSize)
  const progressSourceLabel = tourFileSourceLabel(openProgress?.source)
  const progressFromCache = openProgressIsCache(openProgress?.source, openProgress?.phase)
  const progressSpeedLabel =
    openProgress?.source === 'cloud' && !progressFromCache
      ? formatDownloadSpeed(openProgress.bytesPerSec)
      : null
  const progressLocationLine = [buildingAddress?.trim(), (suiteName || title || '').trim()]
    .filter(Boolean)
    .join(' · ')

  const renderOpeningPanel = (opts?: { reconnectActions?: boolean; preparingOnly?: boolean }) => (
    <div className={styles.openingPanel} role="status" aria-live="polite">
      <div className={styles.openingPanelCard}>
        <h2 className={styles.openingPanelTitle}>
          {opts?.preparingOnly
            ? needsRestore
              ? 'Reconnect linked tour'
              : 'Preparing linked tour…'
            : restoring
              ? 'Opening tour file…'
              : hasOnlineTour
                ? 'Opening online tour…'
                : 'Opening linked tour…'}
        </h2>
        {progressLocationLine ? (
          <p className={styles.openingPanelLocation}>{progressLocationLine}</p>
        ) : null}
        <div className={styles.openingPanelMeta}>
          {progressFileLabel ? (
            <div className={styles.openingPanelMetaRow}>
              <span className={styles.openingPanelMetaLabel}>File</span>
              <span
                className={styles.openingPanelMetaValue}
                title={openProgress?.fileName || progressFileLabel}
              >
                {openProgress?.fileName || progressFileLabel}
              </span>
            </div>
          ) : null}
          {progressSizeLabel ? (
            <div className={styles.openingPanelMetaRow}>
              <span className={styles.openingPanelMetaLabel}>Size</span>
              <span className={styles.openingPanelMetaValue}>{progressSizeLabel}</span>
            </div>
          ) : null}
          {progressSpeedLabel ? (
            <div className={styles.openingPanelMetaRow}>
              <span className={styles.openingPanelMetaLabel}>Speed</span>
              <span className={styles.openingPanelMetaValue}>{progressSpeedLabel}</span>
            </div>
          ) : null}
          {progressSourceLabel ? (
            <div className={styles.openingPanelMetaRow}>
              <span className={styles.openingPanelMetaLabel}>Source</span>
              <span className={styles.openingPanelMetaValue}>{progressSourceLabel}</span>
            </div>
          ) : null}
        </div>
        {openProgress || !needsRestore ? (
          <div
            className={styles.openingProgressTrack}
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progressPct}
            aria-label={openProgress?.phase || 'Opening tour'}
          >
            <div className={styles.openingProgressFill} style={{ width: `${progressPct}%` }} />
          </div>
        ) : null}
        <p className={styles.openingPanelMessage}>
          {openProgress?.phase ||
            (opts?.preparingOnly
              ? needsRestore
                ? 'Choose the .insp360 file from its current location.'
                : 'Getting your saved tour ready…'
              : restoring
                ? 'Loading the file you chose…'
                : hasOnlineTour
                  ? 'Opening this tour from Cloudflare (uses a local cache when available).'
                  : 'If this stalls, reconnect the .insp360 from its folder.')}
          {openProgress ? ` · ${progressPct}%` : ''}
          {progressSpeedLabel ? ` · ${progressSpeedLabel}` : ''}
        </p>
        {opts?.reconnectActions !== false && !restoring ? (
          <div className={styles.openingPanelActions}>
            <button
              type="button"
              className={styles.restorePanelBtn}
              onClick={() => {
                setNeedsRestore(true)
                setAwaitingLinkedOpen(false)
                setOpenProgress(null)
                openRestoreFilePicker()
              }}
            >
              Reconnect tour file…
            </button>
            <label htmlFor="insp360-gate-restore-file" className={styles.restoreBtn}>
              Or browse with classic file picker
            </label>
          </div>
        ) : null}
      </div>
    </div>
  )

  return (
    <div
      className={[
        styles.inspection360Overlay,
        minimized ? styles.inspection360OverlayMinimized : '',
      ]
        .filter(Boolean)
        .join(' ')}
      role="dialog"
      aria-label="QR-360 degree tour viewer"
      aria-hidden={minimized}
      inert={minimized ? true : undefined}
    >
      <header className={styles.header}>
        <div className={styles.headerText}>
          <div className={styles.title}>{headerTitle}</div>
          {subtitle ? <div className={styles.subtitle}>{subtitle}</div> : null}
        </div>
        <div className={styles.headerActions}>
          {showReconnect ? (
            <button
              type="button"
              className={styles.restoreBtn}
              onClick={() => {
                openRestoreFilePicker()
              }}
            >
              Reconnect tour file…
            </button>
          ) : null}
          {showLinkThisTour ? (
            <button
              type="button"
              className={styles.linkThisTourBtn}
              onClick={() => requestLinkThisTour()}
              disabled={closing || restoring || changingTour || linkingTour || publishingCloud}
              title="Link the tour currently open in the viewer to this gateway"
            >
              {linkingTour
                ? 'Linking…'
                : boundName || launchBoundName
                  ? 'Set as default tour'
                  : 'Link this Tour'}
            </button>
          ) : null}
          {showCloudLinkPanel ? (
            <button
              type="button"
              className={styles.cloudLinkHeaderBtn}
              aria-expanded={cloudLinkFormOpen}
              disabled={closing || restoring || changingTour || cloudLinkBusy || publishingCloud}
              onClick={() => {
                setCloudLinkFormOpen((openForm) => {
                  const next = !openForm
                  if (!next) {
                    setCloudTourUrl('')
                    setCloudLinkError(null)
                  }
                  return next
                })
                setCloudLinkError(null)
              }}
              title="Paste a Cloudflare tour URL and attach it to this gateway"
            >
              Link Cloudflare Tour
            </button>
          ) : null}
          {showPublishCloud ? (
            <button
              type="button"
              className={styles.publishCloudBtn}
              onClick={() => {
                void handlePublishCloudTour()
              }}
              disabled={
                closing ||
                restoring ||
                changingTour ||
                cloudLinkBusy ||
                publishingCloud ||
                !canEdit
              }
              title={
                canEdit
                  ? hasOnlineTour
                    ? 'Upload this open tour to Cloudflare and replace the gateway’s shared link'
                    : 'Upload this tour to Cloudflare and attach that shared URL to this gateway'
                  : 'Admin access is required to publish tours'
              }
            >
              {publishingCloud
                ? publishProgress
                  ? `Publishing… ${Math.min(100, Math.round((publishProgress.done / Math.max(1, publishProgress.total)) * 100))}%`
                  : 'Publishing…'
                : hasOnlineTour
                  ? 'Publish to Cloudflare & replace link'
                  : 'Publish to Cloudflare & link'}
            </button>
          ) : null}
          <button
            type="button"
            className={styles.closeBtn}
            onClick={() => void requestClose()}
            aria-label="Close 360 tour"
            title="Close and unload this tour"
            disabled={closing || restoring || changingTour || publishingCloud || linkingTour}
          >
            ✕
          </button>
        </div>
      </header>

      {gateTourMismatch && projectOpen ? (
        <div className={styles.mismatchBanner} role="status">
          <div className={styles.mismatchBannerText}>
            <strong>Tour may not match this gateway.</strong> {gateTourMismatch}
          </div>
          <button
            type="button"
            className={styles.mismatchBannerDismiss}
            onClick={() => setGateTourMismatch(null)}
            aria-label="Dismiss mismatch warning"
          >
            Dismiss
          </button>
        </div>
      ) : null}

      <input
        ref={restoreFileInputRef}
        id="insp360-gate-restore-file"
        type="file"
        accept=".insp360,.zip,application/zip"
        className={styles.hiddenFileInput}
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) void restoreTourFromFile(file)
        }}
      />

      {iframeSrc ? (
        <div className={styles.frameWrap}>
          <iframe
            key={viewerEpoch}
            ref={iframeRef}
            className={styles.frame}
            src={iframeSrc}
            title={`QR-360° tour — ${suiteName}`}
            allow="fullscreen"
            onLoad={onFrameLoad}
          />
          {(awaitingLinkedOpen || restoring) && !projectOpen && !closing && !needsRestore ? (
            renderOpeningPanel({
              reconnectActions: !restoring && !hasOnlineTour,
            })
          ) : null}
          {publishingCloud ? (
            <div className={styles.openingPanel} role="status" aria-live="polite">
              <div className={styles.openingPanelCard}>
                <h2 className={styles.openingPanelTitle}>Publishing to Cloudflare…</h2>
                {progressLocationLine ? (
                  <p className={styles.openingPanelLocation}>{progressLocationLine}</p>
                ) : null}
                <div
                  className={styles.openingProgressTrack}
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={
                    publishProgress
                      ? Math.min(
                          100,
                          Math.round(
                            (publishProgress.done / Math.max(1, publishProgress.total)) * 100,
                          ),
                        )
                      : 0
                  }
                  aria-label={publishProgress?.phase || 'Publishing tour'}
                >
                  <div
                    className={styles.openingProgressFill}
                    style={{
                      width: `${
                        publishProgress
                          ? Math.min(
                              100,
                              Math.round(
                                (publishProgress.done / Math.max(1, publishProgress.total)) * 100,
                              ),
                            )
                          : 0
                      }%`,
                    }}
                  />
                </div>
                <p className={styles.openingPanelMessage}>
                  {publishProgress?.phase || 'Preparing…'}
                  {publishProgress
                    ? ` · ${Math.min(
                        100,
                        Math.round(
                          (publishProgress.done / Math.max(1, publishProgress.total)) * 100,
                        ),
                      )}%`
                    : ''}
                </p>
              </div>
            </div>
          ) : null}
          {needsRestore && !closing && !projectOpen && !restoring ? (
            <div className={styles.restorePanel} role="dialog" aria-label="Reconnect linked tour">
              <div className={styles.restorePanelCard}>
                <h2 className={styles.restorePanelTitle}>
                  Reconnect “{insp360ProjectDisplayName(boundName || launchBoundName) || 'linked tour'}”
                </h2>
                <p className={styles.restorePanelMessage}>
                  The saved file link is missing or moved. Choose the .insp360 tour from its current
                  folder to reconnect this gate.
                </p>
                <div className={styles.openingPanelActions}>
                  <button
                    type="button"
                    className={styles.restorePanelBtn}
                    onClick={() => {
                      openRestoreFilePicker()
                    }}
                  >
                    Reconnect tour file…
                  </button>
                  <label htmlFor="insp360-gate-restore-file" className={styles.restoreBtn}>
                    Or browse with classic file picker
                  </label>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      ) : open && (awaitingLinkedOpen || Boolean(launchBoundName) || needsRestore) && !closing ? (
        <div className={styles.frameWrap}>
          {renderOpeningPanel({
            preparingOnly: true,
            reconnectActions: !hasOnlineTour,
          })}
        </div>
      ) : null}

      {linkPromptOpen ? (
        <div className={styles.linkPrompt} role="alertdialog" aria-labelledby="insp360-link-title">
          <div className={styles.linkPromptCard}>
            <h2 id="insp360-link-title" className={styles.linkPromptTitle}>
              Link this tour?
            </h2>
            <p className={styles.linkPromptMessage}>
              {insp360LinkGateConfirmMessage(projectDisplayName || projectName, {
                fileName: projectName || projectDisplayName,
                cloud: Boolean(openCloudKey || openCloudUrl),
              })}
            </p>
            {linkError ? <p className={styles.linkPromptError}>{linkError}</p> : null}
            <div className={styles.linkPromptActions}>
              <button
                type="button"
                className={styles.linkPromptCancel}
                onClick={() => void finishClose(false)}
                autoFocus
              >
                Not now
              </button>
              {linkError ? (
                <button
                  type="button"
                  className={styles.linkPromptConfirm}
                  onClick={() => {
                    setLinkPromptOpen(false)
                    setLinkError(null)
                    openRestoreFilePicker()
                  }}
                >
                  Pick .insp360 to link…
                </button>
              ) : null}
              <button
                type="button"
                className={styles.linkPromptConfirm}
                disabled={linkingTour}
                onClick={() => {
                  if (!openTourLooksLikeGate()) {
                    setLinkPromptOpen(false)
                    setLinkNamePromptOpen(true)
                    return
                  }
                  void linkOpenTourToGate({ closeAfter: true })
                }}
              >
                {linkingTour ? 'Linking…' : 'Link'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {linkNamePromptOpen ? (
        <div className={styles.linkPrompt} role="alertdialog" aria-labelledby="insp360-link-name-title">
          <div className={styles.linkPromptCard}>
            <h2 id="insp360-link-name-title" className={styles.linkPromptTitle}>
              Tour name doesn’t match
            </h2>
            <p className={styles.linkPromptMessage}>
              Open tour: {openTourLabel}
              {'\n\n'}
              This gateway: {suggestedGateTourLabel || 'this gate'}
              {'\n\n'}
              Update the tour name to match this gateway before linking, or link with the current
              name.
            </p>
            <div className={styles.linkPromptActions}>
              <button
                type="button"
                className={styles.linkPromptCancel}
                onClick={() => setLinkNamePromptOpen(false)}
                autoFocus
              >
                Cancel
              </button>
              <button
                type="button"
                className={styles.linkPromptConfirm}
                disabled={linkingTour}
                onClick={() => void linkOpenTourToGate({ renameToMatch: false, closeAfter: false })}
              >
                Link with current name
              </button>
              <button
                type="button"
                className={styles.linkPromptConfirm}
                disabled={linkingTour}
                onClick={() => void linkOpenTourToGate({ renameToMatch: true, closeAfter: false })}
              >
                Update name &amp; link
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {showCloudLinkPanel && cloudLinkFormOpen ? (
        <div className={styles.cloudLinkPanel} role="region" aria-label="Link Cloudflare tour">
          <p className={styles.cloudLinkTitle}>Link a Cloudflare tour</p>
          <p className={styles.cloudLinkHint}>
            Paste an existing cloud Tour URL (or R2 file key) that is already uploaded. To upload a
            local tour from here, open it first, then use <strong>Publish to Cloudflare &amp; link</strong>{' '}
            in the top bar.
          </p>
          <input
            ref={cloudLinkInputRef}
            type="url"
            className={styles.cloudLinkInput}
            value={cloudTourUrl}
            onChange={(e) => {
              setCloudTourUrl(e.target.value)
              if (cloudLinkError) setCloudLinkError(null)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                void handleLinkCloudTour()
              }
            }}
            placeholder="https://…/tour.insp360 or building/tour.insp360"
            disabled={cloudLinkBusy}
            autoComplete="off"
            spellCheck={false}
          />
          <div className={styles.cloudLinkActions}>
            <button
              type="button"
              className={styles.cloudLinkCancel}
              disabled={cloudLinkBusy}
              onClick={() => {
                setCloudLinkFormOpen(false)
                setCloudTourUrl('')
                setCloudLinkError(null)
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              className={styles.cloudLinkBtn}
              disabled={cloudLinkBusy || !cloudTourUrl.trim()}
              onClick={() => void handleLinkCloudTour()}
            >
              {cloudLinkBusy ? 'Linking…' : 'Link to this gateway & open'}
            </button>
          </div>
          {cloudLinkError ? <p className={styles.cloudLinkError}>{cloudLinkError}</p> : null}
        </div>
      ) : null}
    </div>
  )
}
