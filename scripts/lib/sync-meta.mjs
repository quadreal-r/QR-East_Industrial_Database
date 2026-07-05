/**
 * sync-meta.json ΓÇö lets browsers detect Settings sync from another computer.
 * sync-history.json ΓÇö append-only log of each sync with summary deltas.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildPortfolioSummary } from './portfolio-stats.mjs'

export const SYNC_META_VERSION = 1
export const SYNC_META_FILE = 'sync-meta.json'
export const SYNC_HISTORY_FILE = 'sync-history.json'

const SUMMARY_DELTA_FIELDS = [
  { key: 'buildingCount', label: 'Buildings' },
  { key: 'rtuCount', label: 'RTU markers' },
  { key: 'utilityCount', label: 'Utility markers' },
  { key: 'polygonCount', label: 'Polygons' },
  { key: 'manifestPictureCount', label: 'RTU pictures (manifest)' },
  { key: 'scheduleYearCount', label: 'Schedule replacement years' },
  { key: 'scheduleNoteCount', label: 'Schedule notes' },
  { key: 'pricingRowCount', label: 'Pricing rows' },
]

export function buildSummaryDeltas(before, after) {
  return SUMMARY_DELTA_FIELDS.map(({ key, label }) => {
    const b = before?.[key] ?? 0
    const a = after?.[key] ?? 0
    return { label, before: b, after: a, delta: a - b }
  }).filter((line) => line.delta !== 0)
}

export function buildSyncHistoryChanges(before, after, picturesUploaded = 0) {
  const changes = before ? buildSummaryDeltas(before, after) : []
  if (picturesUploaded > 0) {
    changes.push({
      label: 'Pictures uploaded (this sync)',
      before: 0,
      after: picturesUploaded,
      delta: picturesUploaded,
    })
  }
  const chunkCount = after?.pictureChunkCount ?? 0
  if (chunkCount > 0) {
    changes.push({
      label: 'Picture upload batches',
      before: before?.pictureChunkCount ?? 0,
      after: chunkCount,
      delta: chunkCount - (before?.pictureChunkCount ?? 0),
    })
  }
  const picturesAdded = after?.picturesAdded ?? 0
  if (picturesAdded > 0) {
    changes.push({
      label: 'Pictures added (manifest)',
      before: (after?.manifestPictureCount ?? 0) - picturesAdded,
      after: after?.manifestPictureCount ?? 0,
      delta: picturesAdded,
    })
  }
  const picturesRemoved = after?.picturesRemoved ?? 0
  if (picturesRemoved > 0) {
    changes.push({
      label: 'Pictures removed (manifest)',
      before: (after?.manifestPictureCount ?? 0) + picturesRemoved,
      after: after?.manifestPictureCount ?? 0,
      delta: -picturesRemoved,
    })
  }
  const picturesHidden = after?.picturesHidden ?? 0
  if (picturesHidden > 0) {
    changes.push({
      label: 'Pictures hidden (this sync)',
      before: 0,
      after: picturesHidden,
      delta: picturesHidden,
    })
  }
  return changes
}

export function readSyncHistoryFile(path) {
  if (!existsSync(path)) return { version: 1, entries: [] }
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'))
    return {
      version: parsed.version ?? 1,
      entries: Array.isArray(parsed.entries) ? parsed.entries : [],
    }
  } catch {
    return { version: 1, entries: [] }
  }
}

export function writeSyncHistoryFile(path, history) {
  writeFileSync(path, `${JSON.stringify(history, null, 2)}\n`, 'utf8')
}

/** Append one row set to sync-history.json when sync-meta is written. */
export function appendSyncHistoryEntry(dataDir, meta) {
  const historyPath = join(dataDir, SYNC_HISTORY_FILE)
  const history = readSyncHistoryFile(historyPath)
  const last = history.entries[history.entries.length - 1]
  if (last?.exportedAt === meta.exportedAt && last?.syncedAt === meta.syncedAt) {
    return history
  }
  const picturesUploaded = meta.summary?.picturesUploaded ?? 0
  const changes = buildSyncHistoryChanges(last?.summary, meta.summary, picturesUploaded)
  history.entries.push({
    syncedAt: meta.syncedAt,
    exportedAt: meta.exportedAt,
    source: meta.source,
    summary: meta.summary,
    changes,
  })
  writeSyncHistoryFile(historyPath, history)
  return history
}

export function buildSyncMetaFromBundle(bundle, options = {}) {
  const syncedAt = options.syncedAt ?? new Date().toISOString()
  const manifest = options.manifest ?? { entries: {} }
  const repoBuild = options.buildVersionLabel ?? null
  const clientBuild = bundle.clientBuildVersionLabel ?? options.clientBuildVersionLabel ?? null
  return {
    version: SYNC_META_VERSION,
    exportedAt: bundle.exportedAt,
    syncedAt,
    source: options.source ?? 'settings-sync',
    summary: buildPortfolioSummary(
      bundle.portfolio,
      bundle.schedule,
      bundle.pricing,
      manifest,
      options.picturesUploaded ?? bundle.pictures?.length ?? 0,
      options.pictureChunkCount ?? bundle.pictureChunkCount ?? 0,
      {
        ...(options.picturesAdded != null ? { picturesAdded: options.picturesAdded } : {}),
        ...(options.picturesRemoved != null ? { picturesRemoved: options.picturesRemoved } : {}),
        ...(options.picturesHidden != null ? { picturesHidden: options.picturesHidden } : {}),
        ...(repoBuild ? { buildVersionLabel: repoBuild } : {}),
        ...(clientBuild ? { clientBuildVersionLabel: clientBuild } : {}),
      },
    ),
  }
}

export function buildSyncMetaFromDataDir(dataDir, picsDir, options = {}) {
  const syncedAt = options.syncedAt ?? new Date().toISOString()
  const readJson = (path) => {
    if (!existsSync(path)) return null
    return JSON.parse(readFileSync(path, 'utf8'))
  }

  const buildings = readJson(join(dataDir, 'buildings.json')) ?? []
  const utilities = readJson(join(dataDir, 'utilities.json')) ?? []
  const polygons = readJson(join(dataDir, 'polygons.json')) ?? []
  const schedule = readJson(join(dataDir, 'rtu-schedule.json')) ?? {}
  const pricing = readJson(join(dataDir, 'rtu-pricing-rows.json')) ?? { rows: [] }
  const manifest = readJson(join(picsDir, 'manifest.json')) ?? { entries: {} }

  const portfolio = { buildings, utilities, polygons }
  const existing = options.preserveExportedAt
    ? readJson(join(dataDir, SYNC_META_FILE))
    : null

  return {
    version: SYNC_META_VERSION,
    exportedAt: existing?.exportedAt ?? options.exportedAt ?? syncedAt,
    syncedAt,
    source: options.source ?? existing?.source ?? 'git-push',
    summary: buildPortfolioSummary(portfolio, schedule, pricing, manifest, 0),
  }
}

export function writeSyncMetaFile(path, meta) {
  writeFileSync(path, `${JSON.stringify(meta, null, 2)}\n`, 'utf8')
}
