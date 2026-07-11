import { useCallback } from 'react'
import type { MutableRefObject } from 'react'
import {
  applySnapshotToPortfolio,
  buildGroupDragSnapshot,
} from '@/lib/dragSelection'
import { beginGroupDrag, endGroupDrag } from '@/lib/mapGroupDragSession'
import { useSelectionStore } from '@/stores/selectionStore'
import { showToastSuccess } from '@/lib/toast'
import type { Building, Polygon, SuiteEntrance, Utility } from '@/types/domain'

export function useMarkerDrag(
  portfolioRef: MutableRefObject<{
    buildings: Building[]
    utilities: Utility[]
    polygons: Polygon[]
    suiteEntrances: SuiteEntrance[]
  }>,
  onGroupMoved:
    | ((portfolio: {
        buildings: Building[]
        utilities: Utility[]
        polygons: Polygon[]
        suiteEntrances: SuiteEntrance[]
      }) => void)
    | undefined,
  setLastDragUndo: (fn: (() => void) | null) => void,
) {
  const resolveGroupKeys = useCallback((anchorKey: string) => {
    const selected = useSelectionStore.getState().dragSelectedKeys
    if (selected.length > 0 && selected.includes(anchorKey)) return selected
    return [anchorKey]
  }, [])

  const commitGroupDrag = useCallback(() => {
    const finalSnapshot = endGroupDrag()
    if (!finalSnapshot || !onGroupMoved) return
    onGroupMoved(applySnapshotToPortfolio(portfolioRef.current, finalSnapshot))
    showToastSuccess('Positions updated — save to keep changes.')
  }, [onGroupMoved, portfolioRef])

  const beginDragSession = useCallback(
    (anchorKey: string, startLat: number, startLng: number) => {
      const keys = resolveGroupKeys(anchorKey)
      const portfolio = portfolioRef.current
      const beforeSnapshot = buildGroupDragSnapshot(portfolio, keys)
      beginGroupDrag({ lat: startLat, lng: startLng }, beforeSnapshot)
      setLastDragUndo(() => {
        onGroupMoved?.(applySnapshotToPortfolio(portfolioRef.current, beforeSnapshot))
      })
    },
    [onGroupMoved, portfolioRef, resolveGroupKeys, setLastDragUndo],
  )

  return { resolveGroupKeys, commitGroupDrag, beginDragSession }
}
