import { describe, expect, it } from 'vitest'
import { buildInspection360ViewerPageUrl, resolveInspection360ProjectUrl } from '@/lib/insp360Viewer'

describe('insp360Viewer', () => {
  it('resolves absolute project URLs unchanged', () => {
    expect(resolveInspection360ProjectUrl('https://cdn.example.com/tours/suite-7.insp360')).toBe(
      'https://cdn.example.com/tours/suite-7.insp360',
    )
  })

  it('builds embed viewer page with project and scene for QR-360° gateway', () => {
    const url = buildInspection360ViewerPageUrl({
      projectUrl: 'https://cdn.example.com/tours/suite-7.insp360',
      scene: '001-lobby.jpg',
      title: 'Suite 7',
    })
    expect(url).toContain('insp360/viewer.html')
    expect(url).toContain('embed=1')
    expect(url).toContain(encodeURIComponent('https://cdn.example.com/tours/suite-7.insp360'))
    expect(url).toContain('photo=001-lobby.jpg')
    expect(url).toContain('title=Suite+7')
  })

  it('builds embed viewer page even without a linked project URL', () => {
    const url = buildInspection360ViewerPageUrl({
      title: 'Suite 7',
    })
    expect(url).toContain('insp360/viewer.html')
    expect(url).toContain('embed=1')
    expect(url).toContain('title=Suite+7')
    expect(url).not.toContain('project=')
  })

  it('resolves app-relative tour paths under the public base', () => {
    const url = resolveInspection360ProjectUrl('insp360/projects/suite-7.insp360')
    expect(url).toMatch(/\/insp360\/projects\/suite-7\.insp360$/)
    expect(url.startsWith('http')).toBe(true)
  })
})
