import { describe, expect, it } from 'vitest'
import {
  applyManagerSlots,
  isManagerSlotKey,
  managerSlotsFromPortfolio,
  resolveManagerDisplayName,
} from '@/lib/managerNames'
import type { Building, PortfolioData } from '@/types/domain'

const buildings: Building[] = [
  {
    park: 'Test Park',
    address: '1 Main',
    bu: '',
    lat: 0,
    lng: 0,
    sqft: '',
    cluster: '',
    manager: 'Evelyn Lu',
  },
  {
    park: 'Test Park',
    address: '2 Main',
    bu: '',
    lat: 0,
    lng: 0,
    sqft: '',
    cluster: '',
    manager: 'Josh Starkey',
  },
]

const portfolio: PortfolioData = { buildings, utilities: [], suiteEntrances: [], polygons: [] }

describe('managerNames', () => {
  it('creates four fixed slots pre-filled from portfolio managers', () => {
    const slots = managerSlotsFromPortfolio(buildings)
    expect(slots).toHaveLength(4)
    expect(slots[0]).toEqual({ key: 'Manager 1', name: 'Evelyn Lu' })
    expect(slots[1]).toEqual({ key: 'Manager 2', name: 'Josh Starkey' })
    expect(slots[2]).toEqual({ key: 'Manager 3', name: '' })
    expect(slots[3]).toEqual({ key: 'Manager 4', name: '' })
  })

  it('prefers saved display names from settings', () => {
    const slots = managerSlotsFromPortfolio(buildings, {
      'Manager 1': 'Evelyn L.',
      'Manager 3': 'Maia K.',
    })
    expect(slots[0]?.name).toBe('Evelyn L.')
    expect(slots[2]?.name).toBe('Maia K.')
  })

  it('resolves display names for slot keys and legacy values', () => {
    expect(resolveManagerDisplayName('Manager 1', { 'Manager 1': 'Evelyn Lu' })).toBe('Evelyn Lu')
    expect(resolveManagerDisplayName('Manager 2', {})).toBe('Manager 2')
    expect(resolveManagerDisplayName('Evelyn Lu', { 'Evelyn Lu': 'Evelyn L.' })).toBe('Evelyn L.')
  })

  it('detects manager slot keys', () => {
    expect(isManagerSlotKey('Manager 1')).toBe(true)
    expect(isManagerSlotKey('Manager 5')).toBe(false)
    expect(isManagerSlotKey('Evelyn Lu')).toBe(false)
  })

  it('saves display names and migrates buildings to manager slots', () => {
    const slots = managerSlotsFromPortfolio(buildings)
    slots[0] = { key: 'Manager 1', name: 'Evelyn L.' }
    const result = applyManagerSlots(portfolio, slots)
    expect(result.changed).toBe(true)
    expect(result.portfolio.buildings[0]?.manager).toBe('Manager 1')
    expect(result.portfolio.buildings[1]?.manager).toBe('Manager 2')
    expect(result.managerRenames['Manager 1']).toBe('Evelyn L.')
    expect(resolveManagerDisplayName('Manager 1', result.managerRenames)).toBe('Evelyn L.')
  })
})
