/** Public URLs for RTU pictures on Cloudflare R2. */

function normalizeBaseUrl(url: string): string {
  return url.endsWith('/') ? url : `${url}/`
}

function readRtuPicturesBaseUrlFromEnv(): string | undefined {
  let value = import.meta.env.VITE_RTU_PICTURES_BASE_URL?.trim()
  if (!value) return undefined

  const envLine = value.match(/^VITE_RTU_PICTURES_BASE_URL\s*=\s*(.+)$/i)
  if (envLine) value = envLine[1]!.trim().replace(/^["']|["']$/g, '')

  return value || undefined
}

/** CDN / R2 public base for image files. Falls back to local/public static folder in dev. */
export function getRtuPicturesBaseUrl(): string {
  const fromEnv = readRtuPicturesBaseUrlFromEnv()
  if (fromEnv) return normalizeBaseUrl(fromEnv)
  return normalizeBaseUrl(`${import.meta.env.BASE_URL}database/rtu-pictures/`)
}

export function usesRemoteRtuPicturesCdn(): boolean {
  return Boolean(readRtuPicturesBaseUrlFromEnv())
}

export function rtuPictureFileUrl(fileName: string): string {
  return `${getRtuPicturesBaseUrl()}${encodeURIComponent(fileName)}`
}
