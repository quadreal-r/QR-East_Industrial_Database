import { describe, expect, it } from 'vitest'
import legacyBuildings from '../../supabase/data/buildings.json'
import { collectRtuNameSearchMatches } from '@/lib/rtuNameSearch'
import { normalizeLegacyBuilding, type LegacyBuildingJson } from '@/types/domain'

const buildings = (legacyBuildings as LegacyBuildingJson[]).map(normalizeLegacyBuilding)

describe('collectRtuNameSearchMatches', () => {
  it('lists RTUs whose name includes hybrid', () => {
    const matches = collectRtuNameSearchMatches(buildings, 'hybrid')
    expect(matches).not.toBeNull()
    expect(matches!.length).toBeGreaterThan(10)
    expect(
      matches!.every(
        (row) =>
          /hybrid/i.test(row.rtu.name) ||
          /hybrid/i.test(row.rtu.description ?? '') ||
          /hybrid/i.test(row.rtu.model ?? '') ||
          /hybrid/i.test(row.rtu.make ?? '') ||
          /hybrid/i.test(row.rtu.serial ?? ''),
      ),
    ).toBe(true)
  })

  it('lists RTUs whose serial or model matches', () => {
    const withGear = [
      {
        ...buildings[0]!,
        address: 'Test Serial Building',
        bu: 'TEST-SN',
        cluster: 'Test Cluster Unique',
        manager: 'Test Manager Unique',
        rtus: [
          {
            name: 'RTU-9',
            description: '',
            lat: 43.7,
            lng: -79.7,
            serial: 'ZZ-SERIAL-9911',
            model: 'Carrier 48TM',
            make: 'Carrier',
          },
        ],
      },
    ]
    const bySerial = collectRtuNameSearchMatches(withGear, 'ZZ-SERIAL-9911')
    expect(bySerial).not.toBeNull()
    expect(bySerial!).toHaveLength(1)
    expect(bySerial![0]!.rtu.name).toBe('RTU-9')

    const byModel = collectRtuNameSearchMatches(withGear, '48TM')
    expect(byModel).not.toBeNull()
    expect(byModel![0]!.rtu.model).toContain('48TM')
  })

  it('returns null for address-style searches', () => {
    expect(collectRtuNameSearchMatches(buildings, '6975 Creditview')).toBeNull()
  })

  it('returns null for Capex status searches', () => {
    expect(collectRtuNameSearchMatches(buildings, 'Submitted')).toBeNull()
  })
})
