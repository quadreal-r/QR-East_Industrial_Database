import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { unzipSync, strFromU8 } from 'fflate'
import { freezeSheetViewXml, injectFreezePanes } from '@/lib/xlsxFreeze'

describe('freezeSheetViewXml', () => {
  it('expands a self-closing sheetView and inserts a frozen pane', () => {
    const out = freezeSheetViewXml('<sheetViews><sheetView workbookViewId="0"/></sheetViews>', 1)
    expect(out).toContain('<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>')
    expect(out).toContain('</sheetView>')
  })

  it('inserts a pane into an open/close sheetView', () => {
    const out = freezeSheetViewXml(
      '<sheetViews><sheetView workbookViewId="0"><selection activeCell="A1"/></sheetView></sheetViews>',
      7,
    )
    expect(out).toContain('<pane ySplit="7" topLeftCell="A8" activePane="bottomLeft" state="frozen"/>')
    // pane must come before the existing selection
    expect(out.indexOf('<pane ')).toBeLessThan(out.indexOf('<selection '))
  })

  it('is a no-op when a pane already exists or rows < 1', () => {
    const already = '<sheetView><pane ySplit="1"/></sheetView>'
    expect(freezeSheetViewXml(already, 1)).toBe(already)
  })
})

describe('injectFreezePanes', () => {
  function sheetXml(bytes: Uint8Array, index: number): string {
    const files = unzipSync(bytes)
    return strFromU8(files[`xl/worksheets/sheet${index}.xml`]!)
  }

  it('freezes the requested rows on the correct named sheets', () => {
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['H'], ['a']]), 'Buildings')
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['H'], ['a']]), 'RTUs')
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([['t'], [], [], [], [], [], ['Header'], ['row8']]),
      'RTU Pictures',
    )

    const raw = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
    const frozen = injectFreezePanes(new Uint8Array(raw), {
      Buildings: 1,
      RTUs: 1,
      'RTU Pictures': 7,
    })

    expect(sheetXml(frozen, 1)).toContain('ySplit="1"')
    expect(sheetXml(frozen, 2)).toContain('ySplit="1"')
    expect(sheetXml(frozen, 3)).toContain('ySplit="7"')

    // data survives the round-trip
    const reparsed = XLSX.read(frozen, { type: 'array' })
    expect(reparsed.SheetNames).toEqual(['Buildings', 'RTUs', 'RTU Pictures'])
    expect(reparsed.Sheets['RTU Pictures']?.['A7']?.v).toBe('Header')
  })
})
