/**
 * Analyze RTU_GPS_Audit.xlsx vs portfolio matching and GPS distance (100 ft).
 * Usage: node scripts/analyze-rtu-gps-audit.mjs [path/to/RTU_GPS_Audit.xlsx]
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import XLSX from 'xlsx'
import {
  RTU_GPS_MATCH_FEET,
  distanceFeet,
  findRtuInPortfolio,
  loadBuildingsJson,
} from './lib/rtu-gps-validate.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const auditPath =
  process.argv[2] ?? 'C:/Users/Robert/Pictures/RTU-Pictures/RTU_GPS_Audit.xlsx'

const IMAGE_FILE_RE = /\.(jpe?g|png|webp|heif|heic|tif{1,2})$/i

function extractRtuUnitId(token) {
  const trimmed = token.trim()
  const prefixed = trimmed.match(/^(?:RTU?|RT)[-_\s]?(.+)$/i)
  const core = (prefixed?.[1] ?? trimmed).trim()
  return core.toUpperCase().replace(/\s+/g, '')
}

/** Mirrors src/lib/rtuBulkPictureImport.ts parseBulkRtuPictureFileName */
function parseBulkRtuPictureFileName(fileName) {
  const base = fileName.replace(/^.*[/\\]/, '').replace(IMAGE_FILE_RE, '')
  if (!base) return null

  const buildingMatch = base.match(/^(\d+[A-Za-z]?)[-_\s]+(.+)$/)
  if (!buildingMatch) return null

  let rest = buildingMatch[2].trim()
  let pictureIndex = 1
  let installYear

  const parenYear = rest.match(/\((\d{4})\)\s*$/)
  if (parenYear) {
    installYear = Number(parenYear[1])
    rest = rest.slice(0, parenYear.index).trim()
  }

  const parenIndex = rest.match(/\((\d+)\)\s*$/)
  if (parenIndex) {
    pictureIndex = Number(parenIndex[1])
    rest = rest.slice(0, parenIndex.index).trim()
  }

  if (!/^(?:RTU?|RT)/i.test(rest)) return null

  const parts = rest.split(/[-_\s]+/)
  if (parts.length < 2) return null

  let rtuToken
  if (parts.length === 2) {
    rtuToken = `${parts[0]}-${parts[1]}`
  } else {
    const last = parts[parts.length - 1]
    const lastNum = Number(last)
    const isYear = last.length === 4 && lastNum >= 1900 && lastNum <= 2100
    const isIndex = !isYear && /^\d+$/.test(last)

    if (isYear) {
      installYear = lastNum
      rtuToken = parts.slice(0, -1).join('-')
      pictureIndex = 1
    } else if (isIndex) {
      pictureIndex = lastNum
      rtuToken = parts.slice(0, -1).join('-')
    } else {
      rtuToken = parts.join('-')
    }
  }

  return {
    buildingNum: buildingMatch[1].toUpperCase(),
    rtuToken,
    unitId: extractRtuUnitId(rtuToken),
    pictureIndex,
    installYear,
  }
}

function buildingStreetNumber(address) {
  const match = address.match(/\d+/)
  if (!match) return 'unknown'
  if (/\bEast\b/i.test(address)) return `${match[0]}E`
  if (/\bWest\b/i.test(address)) return `${match[0]}W`
  return match[0]
}

function unitIdsMatch(fileUnitId, markerUnitId) {
  if (fileUnitId === markerUnitId) return true
  if (/^\d+$/.test(fileUnitId) && /^\d+$/.test(markerUnitId)) {
    return Number(fileUnitId) === Number(markerUnitId)
  }
  return false
}

const buildings = loadBuildingsJson(ROOT)
const catalog = []
for (const building of buildings) {
  const streetNumber = buildingStreetNumber(building.address)
  for (const rtu of building.rtus ?? []) {
    catalog.push({ building, rtu, streetNumber, unitId: extractRtuUnitId(rtu.name) })
  }
}

const rows = XLSX.utils.sheet_to_json(XLSX.readFile(auditPath).Sheets.Details)
let parseOk = 0
let parseFail = 0
let catalogHit = 0
let catalogMiss = 0
let auditNameHit = 0
let gpsWithin = 0
let gpsBeyond = 0
let gpsMissing = 0
const failSamples = []
const gpsBeyondSamples = []

for (const row of rows) {
  const fileName = row['File Name']
  const parsed = parseBulkRtuPictureFileName(fileName)
  if (!parsed) {
    parseFail++
    if (failSamples.length < 15) failSamples.push(fileName)
    continue
  }
  parseOk++

  if (row['Name Match'] === 'HIT') auditNameHit++

  const candidates = catalog.filter(
    (entry) =>
      entry.streetNumber === parsed.buildingNum &&
      unitIdsMatch(parsed.unitId, entry.unitId),
  )

  const entry = candidates.length === 1 ? candidates[0] : candidates[0] ?? null
  if (entry) catalogHit++
  else {
    catalogMiss++
    continue
  }

  const photoLat = row['Photo Lat']
  const photoLng = row['Photo Lng']
  if (typeof photoLat !== 'number' || typeof photoLng !== 'number') {
    gpsMissing++
    continue
  }

  const feet = distanceFeet(photoLat, photoLng, entry.rtu.lat, entry.rtu.lng)
  if (feet <= RTU_GPS_MATCH_FEET) gpsWithin++
  else {
    gpsBeyond++
    if (gpsBeyondSamples.length < 10) {
      gpsBeyondSamples.push({
        file: fileName,
        feet: Math.round(feet),
        rtu: entry.rtu.name,
        address: entry.building.address,
      })
    }
  }
}

console.log('RTU_GPS_Audit analysis')
console.log({
  total: rows.length,
  parseOk,
  parseFail,
  auditNameHit,
  catalogHit,
  catalogMiss,
  gpsWithin: `${gpsWithin} within ${RTU_GPS_MATCH_FEET} ft`,
  gpsBeyond: `${gpsBeyond} beyond ${RTU_GPS_MATCH_FEET} ft (would warn)`,
  gpsMissing,
})
if (failSamples.length) {
  console.log('parse fail samples:', [...new Set(failSamples)].slice(0, 15))
}
if (gpsBeyondSamples.length) {
  console.log('GPS beyond threshold samples:', gpsBeyondSamples)
}

for (const f of [
  '20-RTU-03.jpg',
  '20-RTU-01-2015.jpg',
  '20-RTU-01-1 (2015).jpg',
  '1590-RTU-04-2.jpg',
]) {
  console.log('sample', f, parseBulkRtuPictureFileName(f))
}
