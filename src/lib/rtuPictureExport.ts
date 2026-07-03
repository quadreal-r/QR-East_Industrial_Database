import { parseRtuPictureIndex, rtuPictureKey, type RtuPictureManifest } from '@/lib/rtuPictures'
import { getRtuPicturesBaseUrl, rtuPictureFileUrl } from '@/lib/rtuPictureUrls'
import type { PortfolioData } from '@/types/domain'

export interface RtuPictureExportRow {
  buildingAddress: string
  park: string
  cluster: string
  manager: string
  rtuName: string
  manifestKey: string
  pictureIndex: number
  fileName: string
  storage: string
  pictureUrl: string
}

export interface RtuPictureSummary {
  count: number
  fileNames: string
  pictureUrls: string
}

export interface RtuPictureExportBundle {
  picturesBaseUrl: string
  manifestUrl: string
  rows: RtuPictureExportRow[]
  summaryByKey: Map<string, RtuPictureSummary>
}

export function buildRtuPictureExportBundle(
  data: PortfolioData,
  manifest: RtuPictureManifest,
): RtuPictureExportBundle {
  const picturesBaseUrl = getRtuPicturesBaseUrl()
  const manifestUrl = 'supabase:rtu_pictures'
  const rows: RtuPictureExportRow[] = []
  const summaryByKey = new Map<string, RtuPictureSummary>()

  for (const building of data.buildings) {
    for (const rtu of building.rtus ?? []) {
      const key = rtuPictureKey(building.address, rtu.name)
      const fileNames = [...(manifest.entries[key] ?? [])].sort((a, b) => {
        const indexA = parseRtuPictureIndex(a) ?? 0
        const indexB = parseRtuPictureIndex(b) ?? 0
        return indexA - indexB || a.localeCompare(b)
      })

      const urls = fileNames.map((fileName) => rtuPictureFileUrl(fileName))
      summaryByKey.set(key, {
        count: fileNames.length,
        fileNames: fileNames.join('; '),
        pictureUrls: urls.join('; '),
      })

      for (const fileName of fileNames) {
        rows.push({
          buildingAddress: building.address,
          park: building.park,
          cluster: building.cluster ?? '',
          manager: building.manager ?? '',
          rtuName: rtu.name,
          manifestKey: key,
          pictureIndex: parseRtuPictureIndex(fileName) ?? 1,
          fileName,
          storage: 'Cloudflare R2',
          pictureUrl: rtuPictureFileUrl(fileName),
        })
      }
    }
  }

  rows.sort((a, b) =>
    a.buildingAddress.localeCompare(b.buildingAddress) ||
    a.rtuName.localeCompare(b.rtuName) ||
    a.pictureIndex - b.pictureIndex,
  )

  return { picturesBaseUrl, manifestUrl, rows, summaryByKey }
}
