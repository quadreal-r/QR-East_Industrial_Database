import { describe, expect, it } from 'vitest'
import {
  buildInspection360GateKey,
  buildInspection360ViewerPageUrl,
  resolveInspection360ProjectUrl,
} from '@/lib/insp360Viewer'

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
      gateKey: 'suite:42',
    })
    expect(url).toContain('insp360/viewer.html')
    expect(url).toContain('embed=1')
    expect(url).toContain(encodeURIComponent('https://cdn.example.com/tours/suite-7.insp360'))
    expect(url).toContain('photo=001-lobby.jpg')
    expect(url).toContain('title=Suite+7')
    expect(url).toContain('gate=suite%3A42')
  })

  it('builds embed viewer page even without a linked project URL', () => {
    const url = buildInspection360ViewerPageUrl({
      title: 'Suite 7',
      address: '145 Carrier Drive',
      gateKey: 'suite:tmp:1:Suite 7',
    })
    expect(url).toContain('insp360/viewer.html')
    expect(url).toContain('embed=1')
    expect(url).toContain('title=Suite+7')
    expect(url).toContain('address=145+Carrier+Drive')
    expect(url).toContain('gate=')
    expect(url).not.toContain('project=')
  })

  it('resolves app-relative tour paths under the public base', () => {
    const url = resolveInspection360ProjectUrl('insp360/projects/suite-7.insp360')
    expect(url).toMatch(/\/insp360\/projects\/suite-7\.insp360$/)
    expect(url.startsWith('http')).toBe(true)
  })

  it('builds stable gate keys from saved ids', () => {
    expect(
      buildInspection360GateKey('suite', { id: 12, name: 'Suite A', lat: 1, lng: 2 }, 9),
    ).toBe('suite:12')
    expect(
      buildInspection360GateKey('electrical', { id: 5, name: 'ER-1', lat: 1, lng: 2 }, 9),
    ).toBe('electrical:5')
  })

  it('falls back to building + name when gate has no id yet', () => {
    expect(
      buildInspection360GateKey(
        'sprinkler',
        { name: 'SR-1', lat: 43.65, lng: -79.38 },
        88,
      ),
    ).toBe('sprinkler:tmp:88:SR-1')
  })
})
