/**
 * Detailed report for manifest matching gaps.
 * Usage:
 *   node scripts/report-rtu-picture-manifest-gaps.mjs --from-folder "C:/Users/Robert/Pictures/RTU-Pictures"
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import XLSX from 'xlsx'
import {
  buildRtuCatalog,
  isImageFileName,
  matchFileToRtu,
  normalizeRtuUnitCore,
  parseBulkRtuPictureFileName,
  rtuPictureKey,
} from './lib/rtu-picture-filename.mjs'
import { shouldPreferPictureFile } from './lib/rtu-picture-match.mjs'
import { buildManifestFromFileNames } from './lib/build-manifest-from-files.mjs'
import { loadBuildingsJson } from './lib/rtu-gps-validate.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const DEFAULT_FOLDER =
  'C:/Users/Robert/OneDrive - Quadreal Property Group/#OI-Industrial East - @(RTU) Roof Top Units (All Industrial)/RTUs per Building/_RTU-Pictures-All'
const REPORT_DIR = join(ROOT, 'reports')

function parseArgs(argv) {
  let fromFolder = DEFAULT_FOLDER
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--from-folder') fromFolder = argv[++i] ?? fromFolder
    else if (!argv[i].startsWith('-')) fromFolder = argv[i]
  }
  return { fromFolder }
}

function formatBytes(bytes) {
  if (bytes == null || Number.isNaN(bytes)) return ''
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${bytes} B`
}

function collectFromFolder(folderPath) {
  /** @type {Map<string, { sizeBytes: number, filePath: string }>} */
  const byName = new Map()
  /** @type {{ fileName: string, paths: string[], sizes: number[] }[]} */
  const duplicateBasenames = []

  function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (/old/i.test(entry.name)) continue
        walk(full)
      } else if (entry.isFile() && isImageFileName(entry.name)) {
        const sizeBytes = statSync(full).size
        const existing = byName.get(entry.name)
        if (existing) {
          const prior = duplicateBasenames.find((d) => d.fileName === entry.name)
          if (prior) {
            prior.paths.push(full)
            prior.sizes.push(sizeBytes)
          } else {
            duplicateBasenames.push({
              fileName: entry.name,
              paths: [existing.filePath, full],
              sizes: [existing.sizeBytes, sizeBytes],
            })
          }
          if (sizeBytes > existing.sizeBytes) {
            byName.set(entry.name, { sizeBytes, filePath: full })
          }
        } else {
          byName.set(entry.name, { sizeBytes, filePath: full })
        }
      }
    }
  }
  walk(folderPath)
  return {
    byName,
    duplicateBasenames,
    fileNames: [...byName.keys()].sort(),
  }
}

function fileSizeInfo(byName, fileName) {
  const info = byName.get(fileName)
  if (!info) return { sizeBytes: null, filePath: '', sizeLabel: '' }
  return {
    sizeBytes: info.sizeBytes,
    filePath: info.filePath,
    sizeLabel: formatBytes(info.sizeBytes),
  }
}

function buildSameSizeGroups(byName, fileNames) {
  const bySize = new Map()
  for (const fileName of fileNames) {
    const { sizeBytes } = fileSizeInfo(byName, fileName)
    if (sizeBytes == null) continue
    const list = bySize.get(sizeBytes) ?? []
    list.push(fileName)
    bySize.set(sizeBytes, list)
  }
  return [...bySize.entries()]
    .filter(([, files]) => files.length > 1)
    .sort((a, b) => b[1].length - a[1].length || b[0] - a[0])
    .map(([sizeBytes, files]) => ({ sizeBytes, files }))
}

function pictureIndexFromFileName(fileName) {
  const stored = fileName.match(/_\((\d+)\)\./)
  if (stored) return Number(stored[1])
  const parsed = parseBulkRtuPictureFileName(fileName)
  return parsed?.pictureIndex ?? null
}

function buildingNumFromFileName(fileName) {
  const parsed = parseBulkRtuPictureFileName(fileName)
  if (parsed) return parsed.buildingNum
  const stored = fileName.match(/^(\d+)_/)
  return stored?.[1] ?? null
}

function analyzeUnmatched(fileName, catalog) {
  const result = matchFileToRtu(catalog, fileName)
  if (result.entry) return null

  const reason = result.error ?? 'No match'
  const parsed = parseBulkRtuPictureFileName(fileName)
  const buildingNum = buildingNumFromFileName(fileName)

  let detail = { fileName, reason, buildingNum, parsed }

  if (reason === 'No RTU match in portfolio' && parsed) {
    const buildingCandidates = catalog.filter((e) => e.streetNumber === parsed.buildingNum)
    const unitCandidates = catalog.filter((e) => unitIdsLoose(parsed.unitId, e.unitId))
    detail.buildingExists = buildingCandidates.length > 0
    detail.buildingAddresses = [...new Set(buildingCandidates.map((e) => e.building.address))]
    detail.rtuNamesAtBuilding = buildingCandidates.map((e) => e.rtu.name)
    detail.similarUnitsElsewhere = unitCandidates
      .filter((e) => e.streetNumber !== parsed.buildingNum)
      .slice(0, 3)
      .map((e) => `${e.rtu.name} @ ${e.building.address}`)
  }

  if (reason.startsWith('Ambiguous')) {
    const parsed2 = parseBulkRtuPictureFileName(fileName)
    if (parsed2) {
      detail.ambiguousMatches = catalog
        .filter(
          (e) =>
            e.streetNumber === parsed2.buildingNum &&
            unitIdsLoose(parsed2.unitId, e.unitId),
        )
        .map((e) => `${e.rtu.name} @ ${e.building.address}`)
    }
  }

  return detail
}

function unitIdsLoose(fileUnitId, markerUnitId) {
  const fileCore = normalizeRtuUnitCore(fileUnitId) ?? fileUnitId
  const markerCore = normalizeRtuUnitCore(markerUnitId) ?? markerUnitId
  return fileCore === markerCore
}

function groupBy(arr, keyFn) {
  const map = new Map()
  for (const item of arr) {
    const key = keyFn(item)
    const list = map.get(key) ?? []
    list.push(item)
    map.set(key, list)
  }
  return map
}

function main() {
  const { fromFolder } = parseArgs(process.argv)
  if (!existsSync(fromFolder)) {
    console.error(`Folder not found: ${fromFolder}`)
    process.exit(1)
  }

  const { byName, duplicateBasenames, fileNames } = collectFromFolder(fromFolder)
  const buildings = loadBuildingsJson(ROOT)
  const catalog = buildRtuCatalog(buildings)
  const sameSizeGroups = buildSameSizeGroups(byName, fileNames)

  const entries = {}
  const matchedRows = []
  const unmatched = []
  const slotConflicts = []
  let matched = 0

  for (const fileName of fileNames) {
    const result = matchFileToRtu(catalog, fileName)
    if (!result.entry) {
      const detail = analyzeUnmatched(fileName, catalog)
      if (detail) {
        const size = fileSizeInfo(byName, fileName)
        unmatched.push({ ...detail, ...size })
      }
      continue
    }

    const key = rtuPictureKey(result.entry.building.address, result.entry.rtu.name)
    const list = entries[key] ?? []

    const sameIndex = list.find((existing) => {
      const existingIndex = pictureIndexFromFileName(existing)
      return (
        existingIndex != null &&
        result.pictureIndex != null &&
        existingIndex === result.pictureIndex
      )
    })

    if (sameIndex) {
      const skippedSize = fileSizeInfo(byName, fileName)
      const keptSize = fileSizeInfo(byName, sameIndex)
      slotConflicts.push({
        fileName,
        key,
        rtuName: result.entry.rtu.name,
        buildingAddress: result.entry.building.address,
        pictureIndex: result.pictureIndex,
        keptFile: sameIndex,
        skippedFile: fileName,
        skippedSizeBytes: skippedSize.sizeBytes,
        skippedSizeLabel: skippedSize.sizeLabel,
        keptSizeBytes: keptSize.sizeBytes,
        keptSizeLabel: keptSize.sizeLabel,
        sameByteSize:
          skippedSize.sizeBytes != null &&
          keptSize.sizeBytes != null &&
          skippedSize.sizeBytes === keptSize.sizeBytes,
      })
      continue
    }

    list.push(fileName)
    entries[key] = list
    matched++
    const size = fileSizeInfo(byName, fileName)
    matchedRows.push({
      fileName,
      rtuName: result.entry.rtu.name,
      buildingAddress: result.entry.building.address,
      pictureIndex: result.pictureIndex,
      rtuKey: key,
      ...size,
    })
  }

  const unmatchedByReason = Object.fromEntries(
    [...groupBy(unmatched, (u) => u.reason)].map(([reason, rows]) => [reason, rows.length]),
  )

  const noPortfolioByBuilding = groupBy(
    unmatched.filter((u) => u.reason === 'No RTU match in portfolio'),
    (u) => u.buildingNum ?? 'unknown',
  )

  const buildingNotInDb = []
  const unitNotAtBuilding = []
  for (const [buildingNum, rows] of noPortfolioByBuilding) {
    const sample = rows[0]
    if (sample?.buildingExists) {
      unitNotAtBuilding.push({
        buildingNum,
        addresses: sample.buildingAddresses,
        fileCount: rows.length,
        sampleFiles: rows.slice(0, 5).map((r) => r.fileName),
        rtuNamesInDb: [...new Set(sample.rtuNamesAtBuilding ?? [])].slice(0, 15),
        parsedUnits: [...new Set(rows.map((r) => r.parsed?.unitId).filter(Boolean))],
      })
    } else {
      buildingNotInDb.push({
        buildingNum,
        fileCount: rows.length,
        sampleFiles: rows.slice(0, 5).map((r) => r.fileName),
      })
    }
  }

  buildingNotInDb.sort((a, b) => b.fileCount - a.fileCount)
  unitNotAtBuilding.sort((a, b) => b.fileCount - a.fileCount)

  const conflictsByRtu = groupBy(slotConflicts, (c) => c.key)
  const conflictSummary = [...conflictsByRtu.entries()]
    .map(([key, rows]) => ({
      key,
      rtuName: rows[0].rtuName,
      buildingAddress: rows[0].buildingAddress,
      conflictCount: rows.length,
      byIndex: Object.fromEntries(
        [...groupBy(rows, (r) => String(r.pictureIndex))].map(([index, list]) => [
          index,
          {
            kept: list[0].keptFile,
            skipped: list.map((r) => r.skippedFile),
          },
        ]),
      ),
    }))
    .sort((a, b) => b.conflictCount - a.conflictCount)

  const report = {
    generatedAt: new Date().toISOString(),
    sourceFolder: fromFolder,
    totals: {
      imageFiles: fileNames.length,
      matched,
      unmatched: unmatched.length,
      indexConflictsSkipped: slotConflicts.length,
      rtusInManifest: Object.keys(entries).length,
    },
    unmatchedByReason,
    buildingNotInPortfolio: buildingNotInDb,
    unitNotAtBuilding,
    unrecognizedFilenames: unmatched
      .filter((u) => u.reason === 'Unrecognized filename')
      .map((u) => u.fileName),
    ambiguousFilenames: unmatched.filter((u) => u.reason.startsWith('Ambiguous')),
    indexConflicts: conflictSummary,
    allUnmatched: unmatched,
    allConflicts: slotConflicts,
    allMatched: matchedRows,
    fileSizeByName: Object.fromEntries(
      [...byName.entries()].map(([name, info]) => [name, info.sizeBytes]),
    ),
    filePathsByName: Object.fromEntries(
      [...byName.entries()].map(([name, info]) => [name, info.filePath]),
    ),
    duplicateBasenames,
    sameSizeGroups,
  }

  mkdirSync(REPORT_DIR, { recursive: true })
  const stamp = new Date().toISOString().slice(0, 10)
  const jsonPath = join(REPORT_DIR, `rtu-picture-manifest-gaps-${stamp}.json`)
  const mdPath = join(REPORT_DIR, `rtu-picture-manifest-gaps-${stamp}.md`)
  const xlsxPath = join(REPORT_DIR, `rtu-pictures-not-included-${stamp}.xlsx`)

  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  writeFileSync(mdPath, renderMarkdown(report), 'utf8')
  const manifestBuild = buildManifestFromFileNames(fileNames, ROOT)
  XLSX.writeFile(buildExcelWorkbook(report, manifestBuild), xlsxPath)

  console.log(`Report written:\n  ${xlsxPath}\n  ${mdPath}\n  ${jsonPath}`)
  console.log(renderMarkdownSummary(report))
}

function unmatchedCategory(row) {
  if (row.reason === 'Unrecognized filename') return 'Unrecognized filename'
  if (row.reason.startsWith('Ambiguous')) return 'Ambiguous match'
  if (row.reason === 'No RTU match in portfolio' && !row.buildingExists) {
    return 'Building not in portfolio'
  }
  if (row.reason === 'No RTU match in portfolio') return 'RTU unit mismatch'
  return row.reason
}

function buildNotIncludedRows(report, manifestBuild) {
  const unmatchedRows = manifestBuild.unmatched.map((row) => {
    const detail = report.allUnmatched.find((u) => u.fileName === row.fileName) ?? {}
    return {
      inclusionType: 'unmatched',
      fileName: row.fileName,
      reason: row.reason ?? 'Not matched to portfolio',
      category: unmatchedCategory({ ...detail, reason: row.reason }),
      buildingNum: detail.buildingNum ?? buildingNumFromFileName(row.fileName) ?? '',
      parsedUnit: detail.parsed?.unitId ?? '',
      pictureIndex: detail.parsed?.pictureIndex ?? '',
      rtuName: '',
      buildingAddress: (detail.buildingAddresses ?? []).join('; '),
      keptFile: '',
      sizeLabel: report.fileSizeByName?.[row.fileName]
        ? formatBytes(report.fileSizeByName[row.fileName])
        : '',
      filePath: report.filePathsByName?.[row.fileName] ?? '',
      notes: detail.ambiguousMatches
        ? `Ambiguous matches: ${detail.ambiguousMatches.join('; ')}`
        : detail.buildingExists === false
          ? 'Building number not in portfolio database'
          : detail.buildingExists
            ? `Building exists; RTU names in DB: ${[...new Set(detail.rtuNamesAtBuilding ?? [])].join('; ')}`
            : '',
    }
  })

  const conflictRows = manifestBuild.slotConflicts.map((row) => {
    const keptFile = row.existing ?? ''
    const skippedFile = row.fileName
    const parsed = parseRtuPictureKeyFromManifestKey(row.key)
    const keptSize = report.fileSizeByName?.[keptFile]
    const skippedSize = report.fileSizeByName?.[skippedFile]
    const sameByteSize =
      keptSize != null && skippedSize != null && keptSize === skippedSize
    const replaced = shouldPreferPictureFile(keptFile, skippedFile)
    return {
      inclusionType: 'index_conflict',
      fileName: skippedFile,
      reason: replaced
        ? `Duplicate picture slot — replaced in manifest by "${keptFile}" (more explicit filename)`
        : `Duplicate picture slot — manifest kept "${keptFile}" for the same RTU and picture index`,
      category: replaced
        ? 'Index conflict (replaced by clearer name)'
        : 'Index conflict (duplicate slot)',
      buildingNum: parsed?.buildingAddress ? buildingStreetNumber(parsed.buildingAddress) : '',
      parsedUnit: '',
      pictureIndex: row.index ?? '',
      rtuName: parsed?.rtuName ?? '',
      buildingAddress: parsed?.buildingAddress ?? '',
      keptFile,
      sizeLabel: skippedSize != null ? formatBytes(skippedSize) : '',
      filePath: report.filePathsByName?.[skippedFile] ?? '',
      notes: sameByteSize
        ? 'Same byte size as kept file — likely duplicate copy'
        : 'Different size from kept file — may be a different photo; rename to a new index',
    }
  })

  return [...unmatchedRows, ...conflictRows].sort((a, b) =>
    a.fileName.localeCompare(b.fileName),
  )
}

function parseRtuPictureKeyFromManifestKey(key) {
  const pipe = key.indexOf('|')
  if (pipe < 0) return null
  return { buildingAddress: key.slice(0, pipe), rtuName: key.slice(pipe + 1) }
}

function buildExcelWorkbook(report, manifestBuild) {
  const wb = XLSX.utils.book_new()
  const notIncluded = buildNotIncludedRows(report, manifestBuild)

  const summaryRows = [
    ['RTU pictures not included in manifest'],
    ['Generated', report.generatedAt],
    ['Source folder', report.sourceFolder],
    [],
    ['Metric', 'Count'],
    ['Image files scanned', report.totals.imageFiles],
    ['Included in manifest', manifestBuild.pictureCount],
    ['Not included (total)', notIncluded.length],
    ['  — Unmatched', manifestBuild.unmatched.length],
    ['  — Index conflict (skipped)', manifestBuild.slotConflicts.length],
    ['RTUs with at least one picture', manifestBuild.rtuCount],
    [],
    ['Unmatched by reason', 'Count'],
    ...Object.entries(report.unmatchedByReason),
    [],
    ['How to use this workbook'],
    ['1. Review the Unmatched and Index Conflicts sheets.'],
    ['2. Use file sizes — same byte size often means a true duplicate (especially in Index Conflicts).'],
    ['3. See "Same Size Groups" for all files sharing an exact byte size across the folder.'],
    ['4. Fill in "Your decision" (e.g. rename file, fix RTU name, drop duplicate, keep).'],
    ['5. Matched sheet lists files already linked correctly.'],
    [],
    ['Duplicate basenames in folder', report.duplicateBasenames.length],
    ['Same-size file groups (2+ files)', report.sameSizeGroups.length],
  ]
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summaryRows), 'Summary')

  const notIncludedSheet = [
    [
      'File name',
      'Reason',
      'Category',
      'Building #',
      'RTU name',
      'Building address',
      'Picture index',
      'Kept in manifest instead',
      'Size',
      'File path',
      'Notes',
    ],
    ...notIncluded.map((row) => [
      row.fileName,
      row.reason,
      row.category,
      row.buildingNum,
      row.rtuName,
      row.buildingAddress,
      row.pictureIndex,
      row.keptFile,
      row.sizeLabel,
      row.filePath,
      row.notes,
    ]),
  ]
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(notIncludedSheet), 'Not included')

  const unmatchedSheet = [
    [
      'Your decision',
      'File name',
      'Size (bytes)',
      'Size',
      'File path',
      'Category',
      'Reason',
      'Building #',
      'Parsed unit',
      'Picture index',
      'Building in DB?',
      'Address in DB',
      'RTU names at building',
      'Notes',
    ],
    ...report.allUnmatched.map((row) => [
      '',
      row.fileName,
      row.sizeBytes ?? '',
      row.sizeLabel ?? '',
      row.filePath ?? '',
      unmatchedCategory(row),
      row.reason,
      row.buildingNum ?? '',
      row.parsed?.unitId ?? '',
      row.parsed?.pictureIndex ?? '',
      row.buildingExists ? 'Yes' : row.buildingExists === false ? 'No' : '',
      (row.buildingAddresses ?? []).join('; '),
      [...new Set(row.rtuNamesAtBuilding ?? [])].join('; '),
      row.ambiguousMatches ? `Ambiguous: ${row.ambiguousMatches.join('; ')}` : '',
    ]),
  ]
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(unmatchedSheet), 'Unmatched')

  const conflictSheet = [
    [
      'Your decision',
      'Same byte size?',
      'Skipped file (not in manifest)',
      'Skipped size (bytes)',
      'Skipped size',
      'Kept file (in manifest)',
      'Kept size (bytes)',
      'Kept size',
      'Size diff (bytes)',
      'RTU name',
      'Building address',
      'Picture index',
      'Notes',
    ],
    ...report.allConflicts.map((row) => {
      const sizeDiff =
        row.skippedSizeBytes != null && row.keptSizeBytes != null
          ? Math.abs(row.skippedSizeBytes - row.keptSizeBytes)
          : ''
      return [
        '',
        row.sameByteSize ? 'YES — likely duplicate' : 'No',
        row.skippedFile,
        row.skippedSizeBytes ?? '',
        row.skippedSizeLabel ?? '',
        row.keptFile,
        row.keptSizeBytes ?? '',
        row.keptSizeLabel ?? '',
        sizeDiff,
        row.rtuName,
        row.buildingAddress,
        row.pictureIndex,
        row.sameByteSize
          ? 'Same size — safe to drop skipped copy if content is identical'
          : 'Different sizes — different photos; renumber one file',
      ]
    }),
  ]
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(conflictSheet), 'Index Conflicts')

  const buildingRows = [
    [
      'Building #',
      'Unmatched files',
      'Index conflicts',
      'Building in DB?',
      'Address',
      'Parsed units in filenames',
      'RTU names in DB',
    ],
  ]
  const buildingNums = new Set([
    ...report.buildingNotInPortfolio.map((b) => b.buildingNum),
    ...report.unitNotAtBuilding.map((b) => b.buildingNum),
  ])
  for (const buildingNum of [...buildingNums].sort((a, b) => Number(a) - Number(b))) {
    const notIn = report.buildingNotInPortfolio.find((b) => b.buildingNum === buildingNum)
    const unitMiss = report.unitNotAtBuilding.find((b) => b.buildingNum === buildingNum)
    const unmatchedCount =
      report.allUnmatched.filter((u) => u.buildingNum === buildingNum).length
    const conflictCount = report.allConflicts.filter(
      (c) => buildingStreetNumber(c.buildingAddress) === buildingNum,
    ).length
    buildingRows.push([
      buildingNum,
      unmatchedCount,
      conflictCount,
      notIn ? 'No' : 'Yes',
      unitMiss?.addresses?.join('; ') ?? notIn ? '' : '',
      (unitMiss?.parsedUnits ?? []).join('; '),
      (unitMiss?.rtuNamesInDb ?? []).join('; '),
    ])
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(buildingRows), 'By Building')

  const matchedSheet = [
    [
      'File name',
      'Size (bytes)',
      'Size',
      'RTU name',
      'Building address',
      'Picture index',
      'Manifest key',
    ],
    ...report.allMatched.map((row) => [
      row.fileName,
      row.sizeBytes ?? '',
      row.sizeLabel ?? '',
      row.rtuName,
      row.buildingAddress,
      row.pictureIndex,
      row.rtuKey,
    ]),
  ]
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(matchedSheet), 'Matched')

  const sameSizeSheet = [
    ['Size (bytes)', 'Size', 'File count', 'File names (semicolon-separated)'],
    ...report.sameSizeGroups.map((group) => [
      group.sizeBytes,
      formatBytes(group.sizeBytes),
      group.files.length,
      group.files.join('; '),
    ]),
  ]
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sameSizeSheet), 'Same Size Groups')

  if (report.duplicateBasenames.length) {
    const dupeSheet = [
      ['File name', 'Path 1', 'Size 1 (bytes)', 'Path 2', 'Size 2 (bytes)', 'Same size?'],
      ...report.duplicateBasenames.map((row) => [
        row.fileName,
        row.paths[0] ?? '',
        row.sizes[0] ?? '',
        row.paths[1] ?? '',
        row.sizes[1] ?? '',
        row.sizes[0] === row.sizes[1] ? 'Yes' : 'No',
      ]),
    ]
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(dupeSheet), 'Duplicate Basenames')
  }

  return wb
}

function buildingStreetNumber(address) {
  const match = address.match(/\d+/)
  if (!match) return ''
  if (/\bEast\b/i.test(address)) return `${match[0]}E`
  if (/\bWest\b/i.test(address)) return `${match[0]}W`
  return match[0]
}

function renderMarkdownSummary(report) {
  const u = report.unmatchedByReason
  const lines = [
    '',
    '=== SUMMARY ===',
    `Matched: ${report.totals.matched}`,
    `Unmatched: ${report.totals.unmatched}`,
    `Index conflicts skipped: ${report.totals.indexConflictsSkipped}`,
    '',
    'Unmatched breakdown:',
    ...Object.entries(u).map(([reason, count]) => `  ${count} — ${reason}`),
    '',
    `Buildings not in portfolio: ${report.buildingNotInPortfolio.length} building #s (${report.buildingNotInPortfolio.reduce((s, b) => s + b.fileCount, 0)} files)`,
    `Building exists but RTU unit mismatch: ${report.unitNotAtBuilding.length} building #s (${report.unitNotAtBuilding.reduce((s, b) => s + b.fileCount, 0)} files)`,
    `RTUs with duplicate picture index: ${report.indexConflicts.length}`,
  ]
  return lines.join('\n')
}

function renderMarkdown(report) {
  const lines = [
    '# RTU picture manifest gap report',
    '',
    `Generated: ${report.generatedAt}`,
    `Source: ${report.sourceFolder}`,
    '',
    '## Totals',
    '',
    `| Metric | Count |`,
    `|--------|------:|`,
    `| Image files scanned | ${report.totals.imageFiles} |`,
    `| Matched to manifest | ${report.totals.matched} |`,
    `| Unmatched | ${report.totals.unmatched} |`,
    `| Skipped (index conflict) | ${report.totals.indexConflictsSkipped} |`,
    `| RTUs with ≥1 picture | ${report.totals.rtusInManifest} |`,
    '',
    '## Why 290 unmatched?',
    '',
    '| Reason | Count | What it means |',
    '|--------|------:|---------------|',
  ]

  const reasonHelp = {
    'No RTU match in portfolio':
      'Filename parsed OK, but no RTU in `buildings.json` has that building # + unit id.',
    'Unrecognized filename':
      'Filename does not match expected patterns like `1590-RTU-04-2.jpg` or `1590_RTU-04_(1).jpg`.',
    'Ambiguous bulk name (2 RTUs)':
      'Multiple RTU markers match the same building # and unit id.',
    'Ambiguous stored name (2 RTUs)':
      'Multiple RTU markers match the stored filename token.',
  }

  for (const [reason, count] of Object.entries(report.unmatchedByReason)) {
    lines.push(`| ${reason} | ${count} | ${reasonHelp[reason] ?? ''} |`)
  }

  lines.push('', '### Building # not in portfolio', '')
  if (!report.buildingNotInPortfolio.length) {
    lines.push('_None_')
  } else {
    lines.push('| Building # | Files | Sample filenames |')
    lines.push('|------------|------:|------------------|')
    for (const row of report.buildingNotInPortfolio.slice(0, 25)) {
      lines.push(
        `| ${row.buildingNum} | ${row.fileCount} | ${row.sampleFiles.map((f) => `\`${f}\``).join(', ')} |`,
      )
    }
    if (report.buildingNotInPortfolio.length > 25) {
      lines.push(`| … | … | _${report.buildingNotInPortfolio.length - 25} more building numbers_ |`)
    }
  }

  lines.push('', '### Building in DB but RTU unit not found', '')
  if (!report.unitNotAtBuilding.length) {
    lines.push('_None_')
  } else {
    for (const row of report.unitNotAtBuilding.slice(0, 20)) {
      lines.push(`#### Building #${row.buildingNum} (${row.fileCount} files)`)
      lines.push(`- Address(es) in DB: ${row.addresses.map((a) => `\`${a}\``).join(', ')}`)
      lines.push(`- Units in filenames: ${row.parsedUnits.map((u) => `\`${u}\``).join(', ')}`)
      lines.push(`- RTU names in DB: ${row.rtuNamesInDb.map((n) => `\`${n}\``).join(', ')}`)
      lines.push(`- Samples: ${row.sampleFiles.map((f) => `\`${f}\``).join(', ')}`)
      lines.push('')
    }
  }

  if (report.unrecognizedFilenames.length) {
    lines.push('', '### Unrecognized filenames', '')
    for (const name of report.unrecognizedFilenames) {
      lines.push(`- \`${name}\``)
    }
  }

  lines.push('', '## Why 109 skipped (index conflicts)?', '')
  lines.push(
    'Two or more files map to the **same RTU** and the **same picture index** (e.g. both are "photo #1"). The manifest keeps the first file alphabetically and skips the rest.',
    '',
  )

  if (!report.indexConflicts.length) {
    lines.push('_None_')
  } else {
    lines.push('| RTU | Building | Conflicts | Indexes |')
    lines.push('|-----|----------|----------:|---------|')
    for (const row of report.indexConflicts.slice(0, 30)) {
      const indexes = Object.keys(row.byIndex).join(', ')
      lines.push(
        `| ${row.rtuName} | ${row.buildingAddress} | ${row.conflictCount} | ${indexes} |`,
      )
    }
    if (report.indexConflicts.length > 30) {
      lines.push(`| … | … | … | _${report.indexConflicts.length - 30} more RTUs_ |`)
    }
  }

  return `${lines.join('\n')}\n`
}

main()
