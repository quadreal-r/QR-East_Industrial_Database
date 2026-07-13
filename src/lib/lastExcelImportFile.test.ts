import { afterEach, describe, expect, it } from 'vitest'
import {
  loadLastExcelImportFileName,
  resolveLastExcelImportFileName,
  saveLastExcelImportFileName,
} from '@/lib/lastExcelImportFile'
import { STORAGE_KEYS } from '@/lib/storageKeys'

const STORAGE_KEY = STORAGE_KEYS.lastExcelImportFile

describe('lastExcelImportFile', () => {
  afterEach(() => {
    localStorage.removeItem(STORAGE_KEY)
  })

  it('persists and loads the last file name', () => {
    saveLastExcelImportFileName('  Portfolio_Export.xlsx  ')
    expect(loadLastExcelImportFileName()).toBe('Portfolio_Export.xlsx')
  })

  it('ignores blank names when saving', () => {
    saveLastExcelImportFileName('   ')
    expect(loadLastExcelImportFileName()).toBeNull()
  })

  it('prefers persisted over schedule and pricing sources', () => {
    expect(
      resolveLastExcelImportFileName({
        persisted: 'latest.xlsx',
        scheduleSourceFile: 'schedule.xlsx',
        pricingSourceFile: 'pricing.xlsx',
      }),
    ).toBe('latest.xlsx')
  })

  it('falls back through schedule then pricing', () => {
    expect(
      resolveLastExcelImportFileName({
        persisted: null,
        scheduleSourceFile: 'schedule.xlsx',
        pricingSourceFile: 'pricing.xlsx',
      }),
    ).toBe('schedule.xlsx')

    expect(
      resolveLastExcelImportFileName({
        persisted: '  ',
        scheduleSourceFile: null,
        pricingSourceFile: 'pricing.xlsx',
      }),
    ).toBe('pricing.xlsx')
  })
})
