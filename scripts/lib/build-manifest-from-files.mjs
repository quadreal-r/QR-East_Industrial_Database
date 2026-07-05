import {
  buildRtuCatalog,
  isImageFileName,
  matchFileToRtu,
  rtuPictureKey,
  shouldPreferPictureFile,
} from './rtu-picture-filename.mjs'
import { loadBuildingsJson } from './rtu-gps-validate.mjs'
import { getProjectRoot } from './load-dotenv-local.mjs'

function sortPictureFiles(files) {
  return [...files].sort((a, b) => {
    const indexA = Number(a.match(/_\((\d+)\)\./)?.[1] ?? a.match(/-(\d+)\./)?.[1] ?? 0)
    const indexB = Number(b.match(/_\((\d+)\)\./)?.[1] ?? b.match(/-(\d+)\./)?.[1] ?? 0)
    if (indexA !== indexB) return indexA - indexB
    return a.localeCompare(b)
  })
}

/** Build `{ entries }` manifest from image basenames + portfolio RTU catalog. */
export function buildManifestFromFileNames(fileNames, root = getProjectRoot(), options = {}) {
  const { keepAllFiles = false } = options
  const imageFiles = fileNames.filter(isImageFileName)
  const buildings = loadBuildingsJson(root)
  const catalog = buildRtuCatalog(buildings)

  const entries = {}
  const matched = []
  const unmatched = []
  const slotConflicts = []

  for (const fileName of imageFiles) {
    const result = matchFileToRtu(catalog, fileName)
    if (!result.entry) {
      unmatched.push({ fileName, reason: result.error ?? 'No match' })
      continue
    }

    const key = rtuPictureKey(result.entry.building.address, result.entry.rtu.name)
    const list = entries[key] ?? []
    if (list.includes(fileName)) continue

    if (!keepAllFiles) {
      const sameIndex = list.find((existing) => {
        const existingIndex = Number(
          existing.match(/_\((\d+)\)\./)?.[1] ?? existing.match(/-(\d+)\./)?.[1] ?? 0,
        )
        return existingIndex === result.pictureIndex && existingIndex > 0
      })
      if (sameIndex) {
        if (shouldPreferPictureFile(fileName, sameIndex)) {
          const idx = list.indexOf(sameIndex)
          list[idx] = fileName
          entries[key] = sortPictureFiles(list)
          slotConflicts.push({ fileName: sameIndex, key, index: result.pictureIndex, existing: fileName })
          matched.push({ fileName, key, rtu: result.entry.rtu.name })
        } else {
          slotConflicts.push({ fileName, key, index: result.pictureIndex, existing: sameIndex })
        }
        continue
      }
    }

    list.push(fileName)
    entries[key] = sortPictureFiles(list)
    matched.push({ fileName, key, rtu: result.entry.rtu.name })
  }

  return {
    manifest: { entries },
    matched,
    unmatched,
    slotConflicts,
    pictureCount: matched.length,
    rtuCount: Object.keys(entries).length,
  }
}

export function collectManifestFileNames(manifest) {
  const names = new Set()
  for (const files of Object.values(manifest?.entries ?? {})) {
    for (const fileName of files) names.add(fileName)
  }
  return names
}

export function diffManifestFileNames(before, after) {
  const removed = [...before].filter((name) => !after.has(name))
  const added = [...after].filter((name) => !before.has(name))
  return { removed, added }
}
