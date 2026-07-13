import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { buildInspection360ViewerPageUrl } from '@/lib/insp360Viewer'
import {
  arrayBufferFromMessageData,
  clearInsp360GateHook,
  getInsp360GateHook,
  INSP360_GATE_BOUND_MSG,
  INSP360_GATE_PROJECT_STORED_MSG,
  INSP360_OPEN_GATE_PROJECT_MSG,
  INSP360_OPEN_GATE_HANDLE_MSG,
  INSP360_PREPARE_CLOSE_MSG,
  INSP360_PROJECT_OPEN_MSG,
  INSP360_READY_CLOSE_MSG,
  INSP360_REQUEST_HOST_FILE_PICK_MSG,
  INSP360_STALE_GATE_LINK_MSG,
  insp360LinkGateConfirmMessage,
  insp360ProjectDisplayName,
  shouldPromptLinkGate,
  writeInsp360GateHook,
} from '@/lib/insp360GateHooks'
import {
  confirmGateProjectStored,
  loadHostGateProject,
  prepareViewerGateProject,
  saveHostGateProject,
  writeViewerGateFileHandle,
  writeViewerGateProject,
} from '@/lib/insp360GateProjectStore'
import {
  buildInsp360GeoIndex,
  INSP360_GEO_REQUEST,
  INSP360_GEO_RESPONSE,
} from '@/lib/insp360GeoIndex'
import { usePortfolioStore } from '@/stores/portfolioStore'
import styles from './Inspection360Viewer.module.css'

export interface Inspection360ViewerProps {
  open: boolean
  title: string
  buildingAddress: string
  suiteName: string
  projectUrl: string | null
  scene: string | null
  gateKey: string | null
  onClose: () => void
}

function flushViewerClose(frame: Window, linkGate: boolean): Promise<void> {
  return new Promise((resolve) => {
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      window.clearTimeout(timer)
      window.removeEventListener('message', onMessage)
      resolve()
    }
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === INSP360_READY_CLOSE_MSG) finish()
    }
    // Large .insp360 tours can take minutes to zip and copy into gate storage.
    const timeoutMs = linkGate ? 300000 : 2500
    const timer = window.setTimeout(() => finish(), timeoutMs)
    window.addEventListener('message', onMessage)
    try {
      frame.postMessage({ type: INSP360_PREPARE_CLOSE_MSG, linkGate }, '*')
    } catch {
      finish()
    }
  })
}

async function waitForLinkedGateProject(gateKey: string, timeoutMs = 15000): Promise<boolean> {
  return confirmGateProjectStored(gateKey, { maxWaitMs: timeoutMs })
}

export function Inspection360Viewer({
  open,
  title,
  buildingAddress,
  suiteName,
  projectUrl,
  scene,
  gateKey,
  onClose,
}: Inspection360ViewerProps) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const restoreFileInputRef = useRef<HTMLInputElement | null>(null)
  const geoIndexRef = useRef<ReturnType<typeof buildInsp360GeoIndex> | null>(null)
  const closingRef = useRef(false)
  const hostSaveChainRef = useRef(Promise.resolve())
  const initialPushDoneRef = useRef(false)
  const pushInFlightRef = useRef(false)
  const projectOpenRef = useRef(false)
  const openRequestedRef = useRef(false)
  // Freeze launch name at open — updating it mid-session changes iframe src and wipes the open tour.
  const [launchBoundName] = useState<string | null>(() => {
    if (!gateKey) return null
    const hook = getInsp360GateHook(gateKey)
    return hook?.hosted === true ? hook.name : null
  })

  const [closing, setClosing] = useState(false)
  const [closingMode, setClosingMode] = useState<'idle' | 'linking' | 'closing'>('idle')
  const [boundName, setBoundName] = useState<string | null>(launchBoundName)
  const [projectOpen, setProjectOpen] = useState(false)
  const [projectName, setProjectName] = useState<string | null>(null)
  const [alreadyLinked, setAlreadyLinked] = useState(() => Boolean(launchBoundName))
  const [linkPromptOpen, setLinkPromptOpen] = useState(false)
  const [linkError, setLinkError] = useState<string | null>(null)
  const [needsRestore, setNeedsRestore] = useState(false)
  const [restoring, setRestoring] = useState(false)
  const [awaitingLinkedOpen, setAwaitingLinkedOpen] = useState(() => Boolean(launchBoundName))
  /** When a linked tour exists, seed IndexedDB before mounting the iframe so Enter opens photos. */
  const [iframeAllowed, setIframeAllowed] = useState(() => !launchBoundName)
  const portfolio = usePortfolioStore((s) => s.portfolio)

  useEffect(() => {
    if (!open) initialPushDoneRef.current = false
  }, [open])

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- modal open/close UI sync for linked tours */
    if (!open) {
      projectOpenRef.current = false
      openRequestedRef.current = false
      pushInFlightRef.current = false
      setAwaitingLinkedOpen(false)
      setProjectOpen(false)
      setNeedsRestore(false)
      setRestoring(false)
      setIframeAllowed(!launchBoundName)
      return
    }
    if (!gateKey || !launchBoundName) {
      setIframeAllowed(true)
      return
    }
    let cancelled = false
    setAwaitingLinkedOpen(true)
    setIframeAllowed(false)
    void (async () => {
      const prepared = await prepareViewerGateProject(gateKey, launchBoundName)
      if (cancelled) return
      if (!prepared) {
        setNeedsRestore(true)
        setAwaitingLinkedOpen(false)
      }
      setIframeAllowed(true)
    })()
    return () => {
      cancelled = true
    }
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [open, gateKey, launchBoundName])

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
      return
    }
    if (!(boundName || launchBoundName)) {
      setNeedsRestore(false)
      return
    }
    // Give auto-open a short chance, then offer reconnect (broken/moved file link).
    const waitMs = awaitingLinkedOpen ? 12000 : 8000
    const timer = window.setTimeout(() => {
      setAwaitingLinkedOpen(false)
      openRequestedRef.current = false
      setNeedsRestore(true)
    }, waitMs)
    return () => window.clearTimeout(timer)
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
  ])

  useEffect(() => {
    if (!gateKey) return
    const hook = getInsp360GateHook(gateKey)
    if (hook?.name && hook.hosted !== true) clearInsp360GateHook(gateKey)
  }, [gateKey])

  useEffect(() => {
    if (!open || !gateKey) return
    void (async () => {
      const hook = getInsp360GateHook(gateKey)
      if (!hook?.hosted) return
      // Prefer reseeding from host before treating a hosted hook as stale.
      const prepared = await prepareViewerGateProject(gateKey, hook.name)
      if (prepared) return
      const stored = await confirmGateProjectStored(gateKey, { maxWaitMs: 5000, importToHost: true })
      if (!stored) clearInsp360GateHook(gateKey)
    })()
  }, [open, gateKey])

  const iframeSrc = useMemo(() => {
    if (!open || !iframeAllowed) return null
    const page = buildInspection360ViewerPageUrl({
      projectUrl,
      scene,
      title: title || suiteName,
      address: buildingAddress || null,
      gateKey,
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

  const postGeoIndex = () => {
    const frame = iframeRef.current?.contentWindow
    const payload = geoIndexRef.current
    if (!frame || !payload) return
    frame.postMessage({ type: INSP360_GEO_RESPONSE, geoIndex: payload }, '*')
  }

  const pushHostProjectToViewer = useCallback(async () => {
    if (!gateKey) return
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
      frame.postMessage(
        {
          type: INSP360_OPEN_GATE_PROJECT_MSG,
          gateKey,
          name: prepared.name,
        },
        '*',
      )
      // Also try a direct buffer open for typical tour sizes — name-only reopen was
      // notifying alreadyLinked:false and leaving the iframe on the restore dashboard.
      void (async () => {
        const stored = await loadHostGateProject(gateKey)
        if (!stored?.data?.byteLength) return
        if (stored.data.byteLength > 48 * 1024 * 1024) {
          return
        }
        try {
          frame.postMessage(
            {
              type: INSP360_OPEN_GATE_PROJECT_MSG,
              gateKey,
              name: stored.name,
              buffer: stored.data.slice(0),
            },
            '*',
          )
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
  }, [gateKey, launchBoundName])

  const restoreTourFromFile = useCallback(
    async (file: File, fileHandle?: FileSystemFileHandle | null) => {
      if (!gateKey || !file) return
      setRestoring(true)
      setLinkError(null)
      const name = String(file.name || boundName || launchBoundName || 'project.insp360').trim()
      try {

        if (fileHandle) {
          // Fast path: remember the on-disk file and open it immediately — do NOT wait
          // for a 100MB+ arrayBuffer/IDB copy (that was leaving Reconnect hanging).
          await writeViewerGateFileHandle(gateKey, fileHandle, name)
          writeInsp360GateHook(gateKey, name, { hosted: true })
          setBoundName(name)
          setProjectName(name)
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
          return
        }
        writeInsp360GateHook(gateKey, name, { hosted: true })
        setBoundName(name)
        setProjectName(name)
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
      } finally {
        setRestoring(false)
      }
    },
    [boundName, gateKey, launchBoundName],
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

  const finishClose = useCallback(
    async (linkGate: boolean) => {
      if (closingRef.current) return
      closingRef.current = true
      setLinkPromptOpen(false)
      setLinkError(null)
      setClosing(true)
      setClosingMode(linkGate ? 'linking' : 'closing')
      const frame = iframeRef.current?.contentWindow
      try {
        if (frame) await flushViewerClose(frame, linkGate)
        if (linkGate && gateKey) {
          await hostSaveChainRef.current
          const saved = await waitForLinkedGateProject(gateKey, 60000)
          if (!saved) {
            // Keep the overlay open so the user can retry — otherwise they think Link worked.
            closingRef.current = false
            setClosing(false)
            setClosingMode('idle')
            setAlreadyLinked(false)
            setLinkError(
              'Could not save this tour for the gateway. Keep the .insp360 open, use Save in the tour if needed, then choose Link again.',
            )
            setLinkPromptOpen(true)
            return
          }
          const linkedName =
            String(projectName || boundName || launchBoundName || 'project.insp360').trim() ||
            'project.insp360'
          writeInsp360GateHook(gateKey, linkedName, { hosted: true })
          // Make sure the iframe's storage has a copy so the next Enter can preload instantly.
          await prepareViewerGateProject(gateKey, linkedName)
          setBoundName(linkedName)
          setAlreadyLinked(true)
        }
        onClose()
      } catch {
        closingRef.current = false
        setClosing(false)
        setClosingMode('idle')
        onClose()
      }
    },
    [boundName, gateKey, launchBoundName, onClose, projectName],
  )

  const requestClose = useCallback(() => {
    const prompt = shouldPromptLinkGate({ gateKey, projectOpen, alreadyLinked })
    if (closingRef.current || linkPromptOpen) return
    if (prompt) {
      setLinkError(null)
      setLinkPromptOpen(true)
      return
    }
    void finishClose(alreadyLinked)
  }, [alreadyLinked, finishClose, gateKey, linkPromptOpen, projectOpen])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (linkPromptOpen) {
        e.preventDefault()
        e.stopPropagation()
        setLinkPromptOpen(false)
        void finishClose(false)
        return
      }
      void requestClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open, requestClose, linkPromptOpen, finishClose])

  useEffect(() => {
    if (!open) return
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === INSP360_GEO_REQUEST) {
        postGeoIndex()
        return
      }
      if (event.data?.type === INSP360_PROJECT_OPEN_MSG && typeof event.data.gateKey === 'string') {
        if (gateKey && event.data.gateKey !== gateKey) return
        const name = String(event.data.name || 'project.insp360')
        const linkedRaw = Boolean(event.data.alreadyLinked)
        // Hosted gate reopen: treat any successful project open as linked.
        // Viewer still sometimes notifies alreadyLinked:false after skipGateBind opens.
        const linked = linkedRaw || Boolean(launchBoundName)
        projectOpenRef.current = true
        setProjectOpen(true)
        setProjectName(name)
        setAlreadyLinked(linked)
        setAwaitingLinkedOpen(false)
        setRestoring(false)
        if (linked) {
          setBoundName(name)
          setNeedsRestore(false)
        }
        return
      }
      if (event.data?.type === INSP360_REQUEST_HOST_FILE_PICK_MSG) {
        if (gateKey && event.data.gateKey && String(event.data.gateKey) !== gateKey) return
        setNeedsRestore(true)
        openRestoreFilePicker()
        return
      }
      if (event.data?.type === INSP360_STALE_GATE_LINK_MSG) {
        if (gateKey && event.data.gateKey && String(event.data.gateKey) !== gateKey) return
        setNeedsRestore(true)
        return
      }
      if (event.data?.type === INSP360_GATE_BOUND_MSG && typeof event.data.gateKey === 'string') {
        const name = String(event.data.name || 'project.insp360')
        const gate = String(event.data.gateKey)
        // Large tours often fail if copied through postMessage; read viewer IndexedDB instead.
        const buffer = arrayBufferFromMessageData(event.data.buffer)
        const source = event.source as Window | null
        hostSaveChainRef.current = hostSaveChainRef.current.then(async () => {
          let hosted = await confirmGateProjectStored(gate, { maxWaitMs: 30000 })
          if (!hosted && buffer) {
            hosted = await saveHostGateProject(gate, name, buffer)
          }
          if (hosted) {
            writeInsp360GateHook(gate, name, { hosted: true })
            setBoundName(name)
            setProjectName(name)
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
  }, [open, gateKey, openRestoreFilePicker, launchBoundName])

  useEffect(() => {
    if (!open || !geoIndex) return
    postGeoIndex()
  }, [open, geoIndex])

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
        : restoring
          ? 'Opening tour file…'
          : needsRestore && (boundName || launchBoundName)
            ? `Reconnect “${insp360ProjectDisplayName(boundName || launchBoundName)}” — pick the .insp360 file`
            : awaitingLinkedOpen
              ? 'Opening linked tour…'
              : boundName
                ? `Linked: ${insp360ProjectDisplayName(boundName)}`
                : projectOpen
                  ? 'Tour open — you’ll be asked to link it when you close'
                  : !projectUrl
                    ? 'Open or create a .insp360 for this gateway'
                    : null

  const showReconnect =
    Boolean(boundName || launchBoundName) && !projectOpen && !closing && !restoring

  return (
    <div className={styles.inspection360Overlay} role="dialog" aria-label="QR-360 degree tour viewer">
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
          <button
            type="button"
            className={styles.closeBtn}
            onClick={() => void requestClose()}
            aria-label="Close 360 tour"
            disabled={closing || restoring}
          >
            ✕
          </button>
        </div>
      </header>

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
            ref={iframeRef}
            className={styles.frame}
            src={iframeSrc}
            title={`QR-360° tour — ${suiteName}`}
            allow="fullscreen"
            onLoad={onFrameLoad}
          />
          {(awaitingLinkedOpen || restoring) && !projectOpen && !closing && !needsRestore ? (
            <div className={styles.openingPanel} role="status" aria-live="polite">
              <div className={styles.openingPanelCard}>
                <h2 className={styles.openingPanelTitle}>
                  {restoring ? 'Opening tour file…' : 'Opening linked tour…'}
                </h2>
                <p className={styles.openingPanelMessage}>
                  {restoring
                    ? 'Loading the file you chose…'
                    : 'If this stalls, reconnect the .insp360 from its folder.'}
                </p>
                {!restoring ? (
                  <div className={styles.openingPanelActions}>
                    <button
                      type="button"
                      className={styles.restorePanelBtn}
                      onClick={() => {
                        setNeedsRestore(true)
                        setAwaitingLinkedOpen(false)
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
          <div className={styles.openingPanel} role="status" aria-live="polite">
            <div className={styles.openingPanelCard}>
              <h2 className={styles.openingPanelTitle}>
                {needsRestore ? 'Reconnect linked tour' : 'Preparing linked tour…'}
              </h2>
              <p className={styles.openingPanelMessage}>
                {needsRestore
                  ? 'Choose the .insp360 file from its current location.'
                  : 'Getting your saved tour ready…'}
              </p>
              <div className={styles.openingPanelActions}>
                <button
                  type="button"
                  className={styles.restorePanelBtn}
                  onClick={() => {
                    setNeedsRestore(true)
                    setAwaitingLinkedOpen(false)
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
        </div>
      ) : null}

      {linkPromptOpen ? (
        <div className={styles.linkPrompt} role="alertdialog" aria-labelledby="insp360-link-title">
          <div className={styles.linkPromptCard}>
            <h2 id="insp360-link-title" className={styles.linkPromptTitle}>
              Link this tour?
            </h2>
            <p className={styles.linkPromptMessage}>{insp360LinkGateConfirmMessage(projectName)}</p>
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
              <button
                type="button"
                className={styles.linkPromptConfirm}
                onClick={() => void finishClose(true)}
              >
                Link
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
