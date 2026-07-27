function isUselessMessage(value: string): boolean {
  const text = value.trim()
  return !text || text === '[object Object]' || text === 'Error' || text === '[object Error]'
}

/** Turn unknown thrown values (including Supabase errors) into user-readable text. */
export function errorMessage(error: unknown, fallback = 'Something went wrong'): string {
  if (typeof error === 'string') {
    const text = error.trim()
    return isUselessMessage(text) ? fallback : text
  }
  if (error instanceof Error) {
    const text = error.message.trim()
    if (!isUselessMessage(text)) return text
  }
  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>
    const nestedError = record.error
    const message = typeof record.message === 'string' ? record.message.trim() : ''
    const details =
      typeof record.details === 'string'
        ? record.details.trim()
        : typeof record.detail === 'string'
          ? record.detail.trim()
          : ''
    if (message && details && !isUselessMessage(message)) {
      return isUselessMessage(details) ? message : `${message}\n${details}`
    }
    if (message && !isUselessMessage(message)) return message
    if (details && !isUselessMessage(details)) return details
    if (typeof nestedError === 'string' && !isUselessMessage(nestedError)) return nestedError.trim()
    if (nestedError && typeof nestedError === 'object') {
      const nested = errorMessage(nestedError, '')
      if (nested) return nested
    }
    try {
      const encoded = JSON.stringify(error)
      if (encoded && encoded !== '{}' && encoded !== 'null' && !encoded.includes('[object Object]')) {
        return encoded.slice(0, 200)
      }
    } catch {
      /* ignore */
    }
  }
  return fallback
}
