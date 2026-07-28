/**
 * Brand the Cloudflare Access login wall for the map app (quadreal account)
 * using QuadReal Visual Brand Guidelines V2.4 (Nov 2025).
 *
 * The map app keeps Cloudflare Access as the gate (unlike Inspections, which
 * uses a custom Worker OTP wall). This script updates Zero Trust `login_design`
 * (logo, colors, header/footer) only.
 *
 * Brand rules applied (guidelines Colour + Logo sections):
 *   - Background: QR Blue #4974FF (primary flat / background colour)
 *   - Text: Pure White #FFFFFF
 *   - Logo: White (reverse) primary wordmark on QR Blue
 *
 * Requires (quadreal account — NOT krutki11):
 *   CLOUDFLARE_API_TOKEN  — Access: Organizations, Identity Providers, and Groups → Edit
 * Optional:
 *   CLOUDFLARE_ACCOUNT_ID — defaults to quadreal Pages account
 *   ACCESS_LOGO_URL       — public HTTPS logo (defaults to R2 brand asset after upload)
 *
 * Uploads `public/brand/quadreal-logo-white.png` (official White Reverse RGB TM)
 * to the pictures R2 bucket so Access can load it outside the Access wall.
 *
 * Usage:
 *   $env:CLOUDFLARE_API_TOKEN="..."
 *   npm run setup:access-branding
 */
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { PutObjectCommand } from '@aws-sdk/client-s3'
import { createR2Client, getR2Bucket, getR2PublicBaseUrl, isR2Configured } from './lib/r2-client.mjs'
import { loadDotEnvLocal, ROOT } from './lib/load-dotenv-local.mjs'

loadDotEnvLocal()

const ACCOUNT_ID =
  process.env.CLOUDFLARE_ACCOUNT_ID?.trim() ||
  process.env.R2_ACCOUNT_ID?.trim() ||
  'ed62b8514615e386084ffd47455ec775'

const TOKEN = process.env.CLOUDFLARE_API_TOKEN?.trim()
const LOGO_FILE = join(ROOT, 'public', 'brand', 'access-login-mark.png')
const LOGO_FALLBACK = join(ROOT, 'public', 'brand', 'quadreal-logo-white.png')
const LOGO_KEY = 'brand/access-login-mark.png'

/** QuadReal Visual Brand Guidelines V2.4 — Colour Overview. */
export const QR_BRAND = {
  qrBlue: '#4974FF',
  qrMidnight: '#173073',
  qrTeal: '#00B6D3',
  qrMustard: '#D0AA46',
  qrYellow: '#FFDE69',
  trueBlack: '#000000',
  pureWhite: '#FFFFFF',
}

/**
 * Access login page (Brand Guidelines V2.4).
 * App name is drawn under the QuadReal logo in `access-login-mark.png`
 * so layout is: logo on top → QR-Industrial_East_Database below.
 * Keep header_text empty so Cloudflare does not put a title above the logo.
 */
const LOGIN_DESIGN = {
  background_color: QR_BRAND.qrBlue,
  text_color: QR_BRAND.pureWhite,
  header_text: '',
  footer_text:
    'Sign in with your work email. Access is limited to @quadreal.com and people added by an admin.',
}

async function uploadLogoToPublicR2() {
  const file = existsSync(LOGO_FILE) ? LOGO_FILE : LOGO_FALLBACK
  if (!existsSync(file)) {
    throw new Error(`Logo not found: ${LOGO_FILE}`)
  }
  if (!isR2Configured()) {
    throw new Error('R2 is not configured in .env.local (need R2_* / VITE_RTU_PICTURES_BASE_URL).')
  }
  const client = createR2Client()
  const bucket = getR2Bucket()
  const body = readFileSync(file)
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: LOGO_KEY,
      Body: body,
      ContentType: 'image/png',
      CacheControl: 'public, max-age=86400',
    }),
  )
  const base = getR2PublicBaseUrl().replace(/\/?$/, '/')
  const url = `${base}${LOGO_KEY}`
  console.log(`[access-branding] uploaded logo → ${url} (from ${file === LOGO_FILE ? 'access-login-mark' : 'fallback'})`)
  return url
}

async function cf(method, path, body) {
  const res = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const json = await res.json()
  if (!json.success) {
    throw new Error(`${method} ${path} failed:\n${JSON.stringify(json.errors ?? json, null, 2)}`)
  }
  return json.result
}

async function applyLoginDesign(logoUrl) {
  const org = await cf('GET', `/accounts/${ACCOUNT_ID}/access/organizations`)
  console.log(`[access-branding] Zero Trust org: ${org?.name || org?.auth_domain || 'ok'}`)

  const updated = await cf('PUT', `/accounts/${ACCOUNT_ID}/access/organizations`, {
    name: org.name || 'QR-Industrial_East_Database',
    auth_domain: org.auth_domain,
    login_design: {
      ...LOGIN_DESIGN,
      logo_path: logoUrl,
    },
  })

  console.log('[access-branding] login_design applied (Brand Guidelines V2.4):')
  console.log(JSON.stringify(updated.login_design ?? { ...LOGIN_DESIGN, logo_path: logoUrl }, null, 2))
  console.log(`[access-branding] Team host: https://${updated.auth_domain || org.auth_domain}`)
  console.log('[access-branding] Open the live site logged out to preview the Access wall.')
}

async function main() {
  console.log('[access-branding] account:', ACCOUNT_ID, '(quadreal)')
  console.log(`[access-branding] palette: QR Blue ${QR_BRAND.qrBlue} + Pure White ${QR_BRAND.pureWhite}`)

  let logoUrl = process.env.ACCESS_LOGO_URL?.trim()
  if (!logoUrl) {
    logoUrl = await uploadLogoToPublicR2()
  } else {
    console.log(`[access-branding] using ACCESS_LOGO_URL=${logoUrl}`)
  }

  // Verify logo is publicly reachable (Access wall cannot load Access-gated URLs).
  try {
    const head = await fetch(logoUrl, { method: 'GET', redirect: 'follow' })
    if (!head.ok) {
      console.warn(`[access-branding] warning: logo URL returned HTTP ${head.status}`)
    } else {
      console.log('[access-branding] logo URL is publicly reachable')
    }
  } catch (error) {
    console.warn(
      `[access-branding] warning: could not fetch logo URL (${error instanceof Error ? error.message : error})`,
    )
  }

  if (!TOKEN) {
    console.log('')
    console.log('Logo is ready. To finish branding the Access login page, set a token:')
    console.log('  1. Cloudflare dashboard → My Profile → API Tokens → Create Token')
    console.log('  2. Account = Quadreal.rpiwin@gmail.com’s Account')
    console.log('  3. Permission: Access: Organizations, Identity Providers, and Groups → Edit')
    console.log('  4. Then run:')
    console.log('       $env:CLOUDFLARE_API_TOKEN="paste-token-here"')
    console.log('       npm run setup:access-branding')
    console.log('')
    console.log('Or brand manually: Zero Trust → Custom pages → Access login page → Manage')
    console.log(`  Background (QR Blue): ${LOGIN_DESIGN.background_color}`)
    console.log(`  Text (Pure White): ${LOGIN_DESIGN.text_color}`)
    console.log(`  Header: ${LOGIN_DESIGN.header_text}`)
    console.log(`  Footer: ${LOGIN_DESIGN.footer_text}`)
    console.log(`  Logo: ${logoUrl}`)
    process.exit(0)
  }

  await applyLoginDesign(logoUrl)
}

main().catch((error) => {
  console.error('[access-branding]', error instanceof Error ? error.message : error)
  process.exit(1)
})
