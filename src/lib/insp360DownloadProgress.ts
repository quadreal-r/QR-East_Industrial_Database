/** Cloud download rate for the opening panel (always KB/s). */
export function formatDownloadSpeed(bytesPerSec: number | null | undefined): string | null {
  const n = Number(bytesPerSec)
  if (!Number.isFinite(n) || n <= 0) return null
  const kb = n / 1024
  if (kb < 10) return `${kb.toFixed(1)} KB/s`
  return `${Math.round(kb).toLocaleString('en-US')} KB/s`
}
