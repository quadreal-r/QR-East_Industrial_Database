import { describe, expect, it } from 'vitest'
import {
  MAP_PULSE_SEARCH_HIGHLIGHTS_EVENT,
  pulseSearchHitCirclesForBuilding,
  requestBuildingMapFocus,
} from '@/lib/searchHits'

describe('pulseSearchHitCirclesForBuilding', () => {
  it('dispatches a pulse event with the building address', () => {
    const seen: string[] = []
    const handler = (e: Event) => {
      seen.push(String((e as CustomEvent<{ address?: string }>).detail?.address || ''))
    }
    window.addEventListener(MAP_PULSE_SEARCH_HIGHLIGHTS_EVENT, handler)
    pulseSearchHitCirclesForBuilding('  1495 Bonhill Road  ')
    window.removeEventListener(MAP_PULSE_SEARCH_HIGHLIGHTS_EVENT, handler)
    expect(seen).toEqual(['1495 Bonhill Road'])
  })

  it('skips blank addresses', () => {
    let count = 0
    const handler = () => {
      count += 1
    }
    window.addEventListener(MAP_PULSE_SEARCH_HIGHLIGHTS_EVENT, handler)
    pulseSearchHitCirclesForBuilding('   ')
    window.removeEventListener(MAP_PULSE_SEARCH_HIGHLIGHTS_EVENT, handler)
    expect(count).toBe(0)
  })
})

describe('requestBuildingMapFocus', () => {
  it('also pulses search circles for that building', () => {
    const pulsed: string[] = []
    const handler = (e: Event) => {
      pulsed.push(String((e as CustomEvent<{ address?: string }>).detail?.address || ''))
    }
    window.addEventListener(MAP_PULSE_SEARCH_HIGHLIGHTS_EVENT, handler)
    requestBuildingMapFocus('60 Birmingham St (Blg 1)')
    window.removeEventListener(MAP_PULSE_SEARCH_HIGHLIGHTS_EVENT, handler)
    expect(pulsed).toEqual(['60 Birmingham St (Blg 1)'])
  })
})
