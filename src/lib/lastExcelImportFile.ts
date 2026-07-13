import { STORAGE_KEYS } from '@/lib/storageKeys'

const STORAGE_KEY = STORAGE_KEYS.lastExcelImportFile

export function loadLastExcelImportFileName(): string | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const trimmed = raw?.trim()
    return trimmed ? trimmed : null
  } catch {
    return null
  }
}

export function saveLastExcelImportFileName(fileName: string): void {
  if (typeof window === 'undefined') return
  const trimmed = fileName.trim()
  if (!trimmed) return
  try {
    localStorage.setItem(STORAGE_KEY, trimmed)
  } catch {
    // ignore quota / private-mode failures
  }
}

/** Prefer the last Excel chosen in this browser; fall back to schedule/pricing sources. */
export function resolveLastExcelImportFileName(options: {
  persisted: string | null
  scheduleSourceFile: string | null
  pricingSourceFile: string | null
}): string | null {
  for (const candidate of [
    options.persisted,
    options.scheduleSourceFile,
    options.pricingSourceFile,
  ]) {
    const trimmed = candidate?.trim()
    if (trimmed) return trimmed
  }
  return null
}
