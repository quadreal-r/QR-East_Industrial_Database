/**
 * Friendly hostname bridge: qr-database.insp360.ca → map app on quadreal Pages.
 * Domain DNS lives on krutki11; Pages project lives on quadreal.
 */
const ORIGIN = 'https://qr-east-industrial-database.pages.dev'

export default {
  async fetch(request) {
    const incoming = new URL(request.url)
    const targetUrl = ORIGIN + incoming.pathname + incoming.search

    const headers = new Headers(request.headers)
    headers.set('X-Forwarded-Host', incoming.host)
    headers.set('X-Forwarded-Proto', 'https')

    const upstreamRequest = new Request(targetUrl, {
      method: request.method,
      headers,
      body: request.method === 'GET' || request.method === 'HEAD' ? null : request.body,
      redirect: 'manual',
    })

    const upstream = await fetch(upstreamRequest)
    const outHeaders = new Headers(upstream.headers)
    const location = outHeaders.get('Location')
    if (location && location.includes('qr-east-industrial-database.pages.dev')) {
      outHeaders.set(
        'Location',
        location.replaceAll('https://qr-east-industrial-database.pages.dev', incoming.origin),
      )
    }

    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: outHeaders,
    })
  },
}
