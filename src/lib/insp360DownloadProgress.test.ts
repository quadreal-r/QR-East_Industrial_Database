import { describe, expect, it } from 'vitest'
import { formatDownloadSpeed } from '@/lib/insp360DownloadProgress'

describe('formatDownloadSpeed', () => {
  it('formats cloud download rates as KB/s', () => {
    expect(formatDownloadSpeed(null)).toBeNull()
    expect(formatDownloadSpeed(0)).toBeNull()
    expect(formatDownloadSpeed(5 * 1024)).toBe('5.0 KB/s')
    expect(formatDownloadSpeed(1240 * 1024)).toBe('1,240 KB/s')
  })
})
