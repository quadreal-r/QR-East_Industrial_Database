import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate'

/**
 * SheetJS community build does not emit frozen panes, so inject them into the
 * written workbook XML directly. `freezeRowsBySheetName` maps a sheet name to the
 * number of top rows to freeze (e.g. 1 = header row, 7 = RTU Pictures header row).
 */
export function injectFreezePanes(
  workbook: Uint8Array,
  freezeRowsBySheetName: Record<string, number>,
): Uint8Array {
  const files = unzipSync(workbook)
  const workbookXml = files['xl/workbook.xml']
  const relsXml = files['xl/_rels/workbook.xml.rels']
  if (!workbookXml || !relsXml) return workbook

  const sheetPathByName = mapSheetNamesToPaths(strFromU8(workbookXml), strFromU8(relsXml))

  let changed = false
  for (const [sheetName, rows] of Object.entries(freezeRowsBySheetName)) {
    if (!Number.isFinite(rows) || rows < 1) continue
    const path = sheetPathByName.get(sheetName)
    if (!path || !files[path]) continue
    files[path] = strToU8(freezeSheetViewXml(strFromU8(files[path]), rows))
    changed = true
  }

  if (!changed) return workbook
  return zipSync(files, { level: 6 })
}

/** Resolve each workbook sheet name to its `xl/worksheets/sheetN.xml` path via the rels map. */
function mapSheetNamesToPaths(workbookXml: string, relsXml: string): Map<string, string> {
  const relTargets = new Map<string, string>()
  for (const rel of relsXml.matchAll(/<Relationship\b[^>]*?\/?>/g)) {
    const id = rel[0].match(/Id="([^"]+)"/)?.[1]
    const target = rel[0].match(/Target="([^"]+)"/)?.[1]
    if (id && target) relTargets.set(id, target)
  }

  const paths = new Map<string, string>()
  for (const sheet of workbookXml.matchAll(/<sheet\b[^>]*?\/?>/g)) {
    const name = sheet[0].match(/name="([^"]*)"/)?.[1]
    const rid = sheet[0].match(/r:id="([^"]+)"/)?.[1]
    if (!name || !rid) continue
    const target = relTargets.get(rid)
    if (!target) continue
    const normalized = target.startsWith('/')
      ? target.slice(1)
      : `xl/${target.replace(/^\.\//, '')}`
    paths.set(name, normalized)
  }
  return paths
}

/** Insert a frozen `<pane>` as the first child of the sheet's `<sheetView>`. */
export function freezeSheetViewXml(sheetXml: string, rows: number): string {
  if (sheetXml.includes('<pane ')) return sheetXml // already frozen
  const topLeft = `A${rows + 1}`
  const pane = `<pane ySplit="${rows}" topLeftCell="${topLeft}" activePane="bottomLeft" state="frozen"/>`

  const selfClosing = sheetXml.match(/<sheetView\b[^>]*\/>/)
  if (selfClosing) {
    const opened = `${selfClosing[0].slice(0, -2)}>`
    return sheetXml.replace(selfClosing[0], `${opened}${pane}</sheetView>`)
  }

  const openTag = sheetXml.match(/<sheetView\b[^>]*>/)
  if (openTag) {
    return sheetXml.replace(openTag[0], `${openTag[0]}${pane}`)
  }

  return sheetXml
}
