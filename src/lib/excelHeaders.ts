/** Normalize a header cell for comparison (trim; keep case for export fidelity). */
export function normalizeHeaderLabel(value: unknown): string {
  return String(value ?? '').trim()
}

/**
 * Require every expected header to appear in the sheet header row.
 * Extra columns are allowed. Throws a clear error listing missing names.
 */
export function assertSheetHeaders(
  actual: unknown[],
  expected: readonly string[],
  sheetName: string,
): void {
  const present = new Set(
    actual.map(normalizeHeaderLabel).filter((h) => h.length > 0).map((h) => h.toLowerCase()),
  )
  const missing = expected.filter((h) => !present.has(h.toLowerCase()))
  if (missing.length === 0) return

  const missingList = missing.map((h) => `"${h}"`).join(', ')
  throw new Error(
    `Import blocked: “${sheetName}” sheet headers do not match the expected export format. Missing: ${missingList}. Re-export from the app and try again.`,
  )
}

/** Read the first non-empty row of a matrix as headers (or null). */
export function firstHeaderRow(matrix: unknown[][]): unknown[] | null {
  for (const row of matrix) {
    if (!row?.length) continue
    if (row.some((cell) => normalizeHeaderLabel(cell) !== '')) return row
  }
  return null
}
