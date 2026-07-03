/** Public URLs for RTU documents on Cloudflare R2 (rtu-documents bucket). */

function normalizeBaseUrl(url: string): string {
  return url.endsWith('/') ? url : `${url}/`
}

function readRtuDocumentsBaseUrlFromEnv(): string | undefined {
  let value = import.meta.env.VITE_RTU_DOCUMENTS_BASE_URL?.trim()
  if (!value) return undefined

  const envLine = value.match(/^VITE_RTU_DOCUMENTS_BASE_URL\s*=\s*(.+)$/i)
  if (envLine) value = envLine[1]!.trim().replace(/^["']|["']$/g, '')

  return value || undefined
}

export function getRtuDocumentsBaseUrl(): string {
  const fromEnv = readRtuDocumentsBaseUrlFromEnv()
  if (fromEnv) return normalizeBaseUrl(fromEnv)
  return normalizeBaseUrl(`${import.meta.env.BASE_URL}database/rtu-documents/`)
}

export function rtuDocumentFileUrl(fileName: string): string {
  return `${getRtuDocumentsBaseUrl()}${encodeURIComponent(fileName)}`
}
