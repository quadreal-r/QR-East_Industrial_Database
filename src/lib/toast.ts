/** Legacy-style toast notifications (showImportSuccess / showImportError). */

export function showToastSuccess(msg: string): void {
  const existing = document.querySelector('[data-bme-toast]')
  existing?.remove()

  const d = document.createElement('div')
  d.setAttribute('data-bme-toast', '1')
  d.setAttribute('data-transient', '1')
  d.style.cssText =
    'position:fixed;bottom:24px;right:24px;background:rgba(22,163,74,0.95);color:#fff;border-radius:6px;padding:10px 18px;z-index:24000;font:600 13px/1.4 Inter,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.3);max-width:420px;'
  d.innerHTML = msg
  document.body.appendChild(d)
  setTimeout(() => d.remove(), 5000)
}

export function showToastError(msg: string, title = 'Import Error'): void {
  const d = document.createElement('div')
  d.setAttribute('data-bme-toast', '1')
  d.setAttribute('data-transient', '1')
  d.style.cssText =
    'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:#1e1e2e;border:1px solid #ef4444;border-radius:8px;padding:24px 28px;z-index:24000;max-width:480px;color:#e8ecf4;font:14px/1.6 Inter,sans-serif;box-shadow:0 8px 32px rgba(0,0,0,.5);'
  d.innerHTML = `<div style="color:#ef4444;font-weight:700;font-size:15px;margin-bottom:10px;">⚠ ${escapeHtml(title)}</div><div style="color:#cdd2e0;white-space:pre-wrap;">${escapeHtml(msg)}</div><button style="margin-top:16px;background:#ef4444;color:#fff;border:none;border-radius:5px;padding:7px 18px;cursor:pointer;font:600 12px Inter,sans-serif;">Close</button>`
  d.querySelector('button')?.addEventListener('click', () => d.remove())
  document.body.appendChild(d)
}

/** Non-blocking amber toast for soft warnings (e.g. tour name vs gateway mismatch). */
export function showToastWarning(msg: string, title = 'Warning'): void {
  const existing = document.querySelector('[data-bme-toast="warn"]')
  existing?.remove()

  const d = document.createElement('div')
  d.setAttribute('data-bme-toast', 'warn')
  d.setAttribute('data-transient', '1')
  d.style.cssText =
    'position:fixed;bottom:24px;right:24px;background:rgba(146,104,12,0.96);color:#fff;border:1px solid #f0c14b;border-radius:8px;padding:12px 16px;z-index:24000;font:13px/1.45 Inter,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.35);max-width:440px;'
  d.innerHTML = `<div style="font-weight:700;margin-bottom:6px;">⚠ ${escapeHtml(title)}</div><div style="white-space:pre-wrap;">${escapeHtml(msg)}</div>`
  document.body.appendChild(d)
  setTimeout(() => d.remove(), 9000)
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
