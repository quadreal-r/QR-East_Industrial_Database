import { create } from 'zustand'

export type ConfirmOptions = {
  confirmLabel?: string
  cancelLabel?: string
}

interface ConfirmRequest {
  message: string
  confirmLabel: string
  cancelLabel: string
  resolve: (value: boolean) => void
}

interface ConfirmState {
  request: ConfirmRequest | null
  _open: (message: string, options?: ConfirmOptions) => Promise<boolean>
  _resolve: (value: boolean) => void
}

export const useConfirmStore = create<ConfirmState>((set, get) => ({
  request: null,

  _open: (message: string, options?: ConfirmOptions) =>
    new Promise<boolean>((resolve) => {
      set({
        request: {
          message,
          confirmLabel: options?.confirmLabel?.trim() || 'OK',
          cancelLabel: options?.cancelLabel?.trim() || 'Cancel',
          resolve,
        },
      })
    }),

  _resolve: (value: boolean) => {
    get().request?.resolve(value)
    set({ request: null })
  },
}))

/**
 * Async replacement for `window.confirm`.
 * Works inside React components, hooks, and imperative Google Maps event handlers.
 *
 * Usage:
 *   import { confirm } from '@/stores/confirmStore'
 *   if (!(await confirm('Delete this marker?'))) return
 */
export function confirm(message: string, options?: ConfirmOptions): Promise<boolean> {
  return useConfirmStore.getState()._open(message, options)
}
