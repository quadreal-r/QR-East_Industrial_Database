import { describe, expect, it } from 'vitest'
import { rtuMatchesSearch } from '@/lib/rtuSearch'
import type { Rtu } from '@/types/domain'

function rtu(partial: Partial<Rtu> & Pick<Rtu, 'name'>): Rtu {
  return {
    description: '',
    lat: 43.66,
    lng: -79.65,
    ...partial,
  }
}

describe('rtuMatchesSearch', () => {
  it('matches name and description', () => {
    expect(rtuMatchesSearch(rtu({ name: 'RTU- 01' }), 'rtu- 01')).toBe(true)
    expect(
      rtuMatchesSearch(rtu({ name: 'RTU-1', description: 'Roof top unit hybrid' }), 'hybrid'),
    ).toBe(true)
  })

  it('matches serial, model, and make', () => {
    const unit = rtu({
      name: 'RTU-3',
      serial: 'SN-5510-ABC',
      model: 'Lennox LDT060H5-PKG',
      make: 'Lennox',
    })
    expect(rtuMatchesSearch(unit, '5510-abc')).toBe(true)
    expect(rtuMatchesSearch(unit, 'LDT060')).toBe(true)
    expect(rtuMatchesSearch(unit, 'lennox')).toBe(true)
  })

  it('matches suite label', () => {
    expect(rtuMatchesSearch(rtu({ name: 'RTU-2', suite: 'Suite 7' }), 'suite 7')).toBe(true)
  })

  it('skips legacy suite marker names', () => {
    expect(rtuMatchesSearch(rtu({ name: 'Suite # 3', serial: 'SN-1' }), 'sn-1')).toBe(false)
  })

  it('returns false for blank query', () => {
    expect(rtuMatchesSearch(rtu({ name: 'RTU-1' }), '  ')).toBe(false)
  })
})
