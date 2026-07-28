import { describe, expect, it } from 'vitest'
import {
  aliasesForBuildingAddress,
  buildingAddressMatchesSearch,
} from '@/lib/buildingAddressAliases'

describe('buildingAddressAliases', () => {
  it('lists the Interchange Mobile Climate Control aka for 7540 Jane', () => {
    expect(aliasesForBuildingAddress('7540 Jane Street')).toEqual([
      '7540 Jane Street (Interchange - Mobile Climate Control)',
      'Interchange - Mobile Climate Control',
    ])
  })

  it('matches search against the known-as label', () => {
    expect(buildingAddressMatchesSearch('7540 Jane Street', 'mobile climate')).toBe(true)
    expect(buildingAddressMatchesSearch('7540 Jane Street', '7540 jane')).toBe(true)
    expect(buildingAddressMatchesSearch('7540 Jane Street', 'nope')).toBe(false)
  })
})
