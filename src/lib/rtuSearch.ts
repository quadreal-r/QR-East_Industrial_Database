import { isLegacySuiteMarkerName } from '@/lib/legacySuiteMarkers'
import type { Rtu } from '@/types/domain'

/**
 * True when an RTU matches the global search query on any equipment field
 * (name, description, serial, model, make, suite).
 */
export function rtuMatchesSearch(rtu: Rtu, search: string): boolean {
  const q = String(search || '')
    .trim()
    .toLowerCase()
  if (!q) return false
  if (isLegacySuiteMarkerName(rtu.name)) return false
  if (rtu.name.toLowerCase().includes(q)) return true
  if ((rtu.description ?? '').toLowerCase().includes(q)) return true
  if ((rtu.serial ?? '').toLowerCase().includes(q)) return true
  if ((rtu.model ?? '').toLowerCase().includes(q)) return true
  if ((rtu.make ?? '').toLowerCase().includes(q)) return true
  if ((rtu.suite ?? '').toLowerCase().includes(q)) return true
  return false
}
