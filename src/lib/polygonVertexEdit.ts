export type VertexDeleteCleanup = () => void

/** Ignore Delete/Backspace when the user is typing in a form field. */
export function shouldIgnoreVertexDeleteKeydown(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return Boolean(target.closest('input, textarea, select, [contenteditable="true"]'))
}

/** Select vertices on click, remove the selected vertex with Delete or Backspace. */
export function bindPolygonVertexDelete(
  poly: google.maps.Polygon,
  options: {
    minVertices?: number
    onVerticesChanged?: () => void
    onMinVerticesBlocked?: () => void
  } = {},
): VertexDeleteCleanup {
  const minVertices = options.minVertices ?? 3
  let selectedVertex: number | null = null

  const vertexListener = poly.addListener('mouseup', (e: google.maps.PolyMouseEvent) => {
    if (e.vertex != null) {
      selectedVertex = e.vertex
    }
  })

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Delete' && e.key !== 'Backspace') return
    if (shouldIgnoreVertexDeleteKeydown(e.target)) return
    if (selectedVertex == null) return

    e.preventDefault()
    const path = poly.getPath()
    if (path.getLength() <= minVertices) {
      options.onMinVerticesBlocked?.()
      return
    }

    path.removeAt(selectedVertex)
    selectedVertex = null
    options.onVerticesChanged?.()
  }

  window.addEventListener('keydown', onKeyDown)

  return () => {
    vertexListener.remove()
    window.removeEventListener('keydown', onKeyDown)
  }
}

/** Remove a selected point index from a list with Delete or Backspace. */
export function bindPointListDelete(options: {
  isActive: () => boolean
  getSelectedIndex: () => number | null
  clearSelectedIndex: () => void
  getPointCount: () => number
  removeSelectedPoint: () => void
  minPoints?: number
  onMinPointsBlocked?: () => void
}): VertexDeleteCleanup {
  const minPoints = options.minPoints ?? 1

  const onKeyDown = (e: KeyboardEvent) => {
    if (!options.isActive()) return
    if (e.key !== 'Delete' && e.key !== 'Backspace') return
    if (shouldIgnoreVertexDeleteKeydown(e.target)) return

    const selectedIndex = options.getSelectedIndex()
    if (selectedIndex == null) return

    e.preventDefault()
    if (options.getPointCount() <= minPoints) {
      options.onMinPointsBlocked?.()
      return
    }

    options.removeSelectedPoint()
    options.clearSelectedIndex()
  }

  window.addEventListener('keydown', onKeyDown)
  return () => window.removeEventListener('keydown', onKeyDown)
}
