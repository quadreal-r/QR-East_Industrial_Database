import { describe, expect, it } from 'vitest'
import { assertSheetHeaders } from '@/lib/excelHeaders'

describe('assertSheetHeaders', () => {
  it('allows exact and extra columns', () => {
    expect(() =>
      assertSheetHeaders(
        ['Building Address', 'BU #', 'Portfolio', 'Extra'],
        ['Building Address', 'BU #', 'Portfolio'],
        'Buildings',
      ),
    ).not.toThrow()
  })

  it('is case-insensitive for matching', () => {
    expect(() =>
      assertSheetHeaders(['building address', 'bu #'], ['Building Address', 'BU #'], 'Buildings'),
    ).not.toThrow()
  })

  it('throws listing missing headers', () => {
    expect(() =>
      assertSheetHeaders(['Building Address'], ['Building Address', 'BU #', 'Portfolio'], 'Buildings'),
    ).toThrow(/Missing: "BU #", "Portfolio"/)
  })
})
