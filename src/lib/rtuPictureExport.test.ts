import { describe, expect, it, vi } from 'vitest'
import { exportDatabaseExcelFilename } from '@/lib/excel'
import { buildRtuPictureExportBundle } from '@/lib/rtuPictureExport'
import type { PortfolioData } from '@/types/domain'

describe('exportDatabaseExcelFilename', () => {
  it('uses QuadReal_Industrial_DB_Export_YYYY.MM.DD format', () => {
    expect(exportDatabaseExcelFilename(new Date(2026, 5, 25))).toBe(
      'QuadReal_Industrial_DB_Export_2026.06.25.xlsx',
    )
  })
})

describe('buildRtuPictureExportBundle', () => {
  it('includes Cloudflare picture URLs from manifest', () => {
    vi.stubEnv('VITE_RTU_PICTURES_BASE_URL', 'https://cdn.example.com/rtu/')
    vi.stubEnv('VITE_JSON_DATA_BASE_URL', '')
    vi.stubEnv('BASE_URL', '/QR-East_Industrial_Database/')

    const data: PortfolioData = {
      buildings: [
        {
          park: 'Test Park',
          address: '100 Leek Crescent',
          bu: '1',
          lat: 43.6,
          lng: -79.6,
          sqft: '1000',
          cluster: 'Cluster A',
          manager: 'Manager A',
          rtus: [{ name: 'RTU- 01', description: '', lat: 43.61, lng: -79.61 }],
        },
      ],
      utilities: [],
      suiteEntrances: [],
      polygons: [],
    }

    const bundle = buildRtuPictureExportBundle(data, {
      entries: {
        '100 Leek Crescent|RTU- 01': ['100-RTU-01-1.jpg', '100-RTU-01-2.jpg'],
      },
    })

    expect(bundle.picturesBaseUrl).toBe('https://cdn.example.com/rtu/')
    expect(bundle.manifestUrl).toBe('supabase:rtu_pictures')
    expect(bundle.rows).toHaveLength(2)
    expect(bundle.rows[0]).toMatchObject({
      buildingAddress: '100 Leek Crescent',
      rtuName: 'RTU- 01',
      fileName: '100-RTU-01-1.jpg',
      storage: 'Cloudflare R2',
      pictureUrl: 'https://cdn.example.com/rtu/100-RTU-01-1.jpg',
    })

    const summary = bundle.summaryByKey.get('100 Leek Crescent|RTU- 01')
    expect(summary?.count).toBe(2)
    expect(summary?.fileNames).toContain('100-RTU-01-1.jpg')
    expect(summary?.pictureUrls).toContain('https://cdn.example.com/rtu/100-RTU-01-2.jpg')

    vi.unstubAllEnvs()
  })
})
