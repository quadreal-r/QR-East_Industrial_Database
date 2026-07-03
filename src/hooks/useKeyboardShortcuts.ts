import { useEffect } from 'react'
import { showToastSuccess } from '@/lib/toast'
import { useSelectionStore } from '@/stores/selectionStore'

export interface UseKeyboardShortcutsOptions {
  onSave?: () => void
}

export function useKeyboardShortcuts({ onSave }: UseKeyboardShortcutsOptions = {}) {
  const runDragUndo = useSelectionStore((s) => s.runDragUndo)

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) {
        return
      }

      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        if (runDragUndo()) {
          e.preventDefault()
          showToastSuccess('↩ Drag undone')
        }
        return
      }

      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        if (e.repeat) return
        e.preventDefault()
        onSave?.()
        return
      }

      const items = Array.from(document.querySelectorAll('.building-item'))
      if (!items.length) return
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Enter') return

      const activeIdx = items.findIndex((el) => el.classList.contains('active'))
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        const next = activeIdx < items.length - 1 ? activeIdx + 1 : 0
        ;(items[next] as HTMLElement).click()
        items[next]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        const prev = activeIdx > 0 ? activeIdx - 1 : items.length - 1
        ;(items[prev] as HTMLElement).click()
        items[prev]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
      } else if (e.key === 'Enter' && activeIdx >= 0) {
        ;(items[activeIdx] as HTMLElement).click()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onSave, runDragUndo])
}
