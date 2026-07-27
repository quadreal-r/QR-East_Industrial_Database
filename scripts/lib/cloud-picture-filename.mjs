import { buildingStreetNumber } from './rtu-picture-filename.mjs'
import { parseBulkRtuPictureFileName } from './rtu-picture-match.mjs'

export function pictureFileRtuLabel(rtuName) {
  const primary = rtuName.split('/')[0]?.trim() ?? rtuName.trim()
  return primary
    .trim()
    .replace(/\s*\/\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[/\\:*?"<>|]/g, '')
}

export function rtuUnitFileSegment(rtuName) {
  const label = pictureFileRtuLabel(rtuName).replace(/\s+Hybrid\b/gi, '').trim()
  const match = label.match(/^RTU[-\s#]*(.+)$/i)
  const segment = (match?.[1] ?? label).replace(/\s+/g, '')
  const cleaned = segment.replace(/[^\w.-]/g, '')
  return cleaned || 'unknown'
}

export function buildCloudRtuPictureFileName(buildingAddress, rtuName, pictureIndex, ext) {
  const buildingNum = buildingStreetNumber(buildingAddress)
  const unit = rtuUnitFileSegment(rtuName)
  const safeExt = ext.replace(/^\./, '').toLowerCase() || 'jpg'
  return `${buildingNum}-RTU-${unit}-${pictureIndex}.${safeExt}`
}

function isCanonicalR2ManifestFileName(fileName) {
  const base = fileName.replace(/^.*[/\\]/, '')
  return /^\d+[A-Za-z]?-RTU/i.test(base)
}

export function manifestEntryToCloudFileName(fileName, buildingAddress, rtuName) {
  if (!/[\s()]/.test(fileName)) return fileName
  if (isCanonicalR2ManifestFileName(fileName) && parseBulkRtuPictureFileName(fileName)) {
    return fileName
  }
  const paren = fileName.match(/\((\d+)\)\.[^.]+$/i)
  const dash = fileName.match(/-(\d+)\.[^.]+$/i)
  const index = paren ? Number(paren[1]) : dash ? Number(dash[1]) : 1
  const ext = fileName.split('.').pop() ?? 'jpg'
  return buildCloudRtuPictureFileName(buildingAddress, rtuName, index, ext)
}

export function alternateCdnFileNames(fileName, rtuKey) {
  const pipe = rtuKey.indexOf('|')
  if (pipe < 0) return [fileName]
  const buildingAddress = rtuKey.slice(0, pipe)
  const rtuName = rtuKey.slice(pipe + 1)
  const cloud = manifestEntryToCloudFileName(fileName, buildingAddress, rtuName)
  const names = new Set([fileName, cloud])
  const paren = fileName.match(/\((\d+)\)\.[^.]+$/i)
  const dash = fileName.match(/-(\d+)\.[^.]+$/i)
  const index = paren ? Number(paren[1]) : dash ? Number(dash[1]) : null
  const ext = fileName.split('.').pop() ?? 'jpg'
  if (index != null) {
    names.add(buildCloudRtuPictureFileName(buildingAddress, rtuName, index, ext))
    names.add(`${buildingStreetNumber(buildingAddress)}-${pictureFileRtuLabel(rtuName)} (${index}).${ext}`)
  }
  return [...names]
}
