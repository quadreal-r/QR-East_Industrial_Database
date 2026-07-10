/** Turn unknown thrown values (including Supabase errors) into user-readable text. */
export function errorMessage(error: unknown, fallback = 'Something went wrong'): string {
  if (error instanceof Error && error.message.trim()) return error.message
  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>
    const message = typeof record.message === 'string' ? record.message.trim() : ''
    const details = typeof record.details === 'string' ? record.details.trim() : ''
    if (message && details) return `${message}\n${details}`
    if (message) return message
    if (details) return details
  }
  return fallback
}
