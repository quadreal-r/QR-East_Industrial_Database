/**
 * QuadReal OTP session auth for the map app (same wall style as INSP 360).
 * Cookie-based OTP pending + HMAC session — no D1 required.
 */
import { createClient } from '@supabase/supabase-js'
import {
  decideOfflineCodeRequest,
  decideOfflineVerify,
  getAccessOffline,
  isAppAdmin,
  setAccessOffline,
} from './accessOffline'
import { QR_MARK_DATA_URL } from './qrMarkDataUrl'

export const SESSION_COOKIE = 'bme_session'
export const OTP_COOKIE = 'bme_otp'
export const SESSION_TTL_SEC = 24 * 60 * 60
export const OTP_TTL_MS = 10 * 60 * 1000
export const APP_TITLE = 'QR-Industrial_East_Database'

export interface AuthEnv {
  SUPABASE_URL?: string
  SUPABASE_SERVICE_ROLE_KEY?: string
  SESSION_SECRET?: string
  RESEND_API_KEY?: string
  RESEND_FROM?: string
}

export function normalizeEmail(email: string): string {
  return String(email || '')
    .trim()
    .toLowerCase()
}

function bytesToB64url(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function b64urlToBytes(s: string): Uint8Array {
  const pad = '='.repeat((4 - (s.length % 4)) % 4)
  const b64 = (s + pad).replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(String(secret || '')),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  )
}

async function hmacSign(secret: string, message: string): Promise<string> {
  const key = await hmacKey(secret)
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message))
  return bytesToB64url(new Uint8Array(sig))
}

async function hmacVerify(secret: string, message: string, sigB64: string): Promise<boolean> {
  try {
    const key = await hmacKey(secret)
    const sig = b64urlToBytes(sigB64)
    return crypto.subtle.verify('HMAC', key, sig, new TextEncoder().encode(message))
  } catch {
    return false
  }
}

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export function parseCookies(request: Request): Record<string, string> {
  const raw = request.headers.get('Cookie') || ''
  const out: Record<string, string> = {}
  for (const part of raw.split(';')) {
    const i = part.indexOf('=')
    if (i < 1) continue
    const k = part.slice(0, i).trim()
    const v = part.slice(i + 1).trim()
    try {
      out[k] = decodeURIComponent(v)
    } catch {
      out[k] = v
    }
  }
  return out
}

function cookieHeader(name: string, value: string, maxAge: number): string {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
    `Max-Age=${maxAge}`,
  ]
  return parts.join('; ')
}

export function clearCookieHeader(name: string): string {
  return `${name}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`
}

export async function createSessionToken(email: string, env: AuthEnv): Promise<string> {
  const secret = env.SESSION_SECRET
  if (!secret) throw new Error('SESSION_SECRET not configured')
  const exp = Math.floor(Date.now() / 1000) + SESSION_TTL_SEC
  const payload = `${normalizeEmail(email)}|${exp}`
  const sig = await hmacSign(secret, payload)
  return `${bytesToB64url(new TextEncoder().encode(payload))}.${sig}`
}

export function sessionCookieHeader(token: string): string {
  return cookieHeader(SESSION_COOKIE, token, SESSION_TTL_SEC)
}

export async function verifySession(
  request: Request,
  env: AuthEnv,
): Promise<{ ok: true; email: string } | { ok: false; error: string }> {
  const secret = env.SESSION_SECRET
  if (!secret) return { ok: false, error: 'SESSION_SECRET not configured' }

  const token = parseCookies(request)[SESSION_COOKIE]
  if (!token) return { ok: false, error: 'Sign in required' }

  const parts = token.split('.')
  if (parts.length !== 2) return { ok: false, error: 'Invalid session' }

  let payload: string
  try {
    payload = new TextDecoder().decode(b64urlToBytes(parts[0]!))
  } catch {
    return { ok: false, error: 'Invalid session' }
  }

  if (!(await hmacVerify(secret, payload, parts[1]!))) {
    return { ok: false, error: 'Invalid session' }
  }

  const pipe = payload.indexOf('|')
  if (pipe < 1) return { ok: false, error: 'Invalid session' }
  const email = payload.slice(0, pipe)
  const exp = Number(payload.slice(pipe + 1))
  if (!email || !Number.isFinite(exp)) return { ok: false, error: 'Invalid session' }
  if (exp < Math.floor(Date.now() / 1000)) return { ok: false, error: 'Session expired' }

  return { ok: true, email: normalizeEmail(email) }
}

function generateOtpCode(): string {
  const n = crypto.getRandomValues(new Uint32Array(1))[0]! % 1_000_000
  return String(n).padStart(6, '0')
}

async function createOtpPendingToken(email: string, code: string, env: AuthEnv): Promise<string> {
  const secret = env.SESSION_SECRET
  if (!secret) throw new Error('SESSION_SECRET not configured')
  const exp = Date.now() + OTP_TTL_MS
  const codeHash = await sha256Hex(`${normalizeEmail(email)}:${code}`)
  const payload = `${normalizeEmail(email)}|${exp}|${codeHash}`
  const sig = await hmacSign(secret, payload)
  return `${bytesToB64url(new TextEncoder().encode(payload))}.${sig}`
}

export function otpCookieHeader(token: string): string {
  return cookieHeader(OTP_COOKIE, token, Math.ceil(OTP_TTL_MS / 1000))
}

/** Allow @quadreal.com or anyone already in Manage users (app_roles). */
export async function isEmailAllowed(email: string, env: AuthEnv): Promise<boolean> {
  const normalized = normalizeEmail(email)
  if (!normalized.includes('@')) return false
  if (normalized.endsWith('@quadreal.com')) return true
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return false

  const admin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { data, error } = await admin.from('app_roles').select('email').eq('email', normalized).maybeSingle()
  if (error) {
    console.error('allowlist lookup failed', error.message)
    return false
  }
  return Boolean(data?.email)
}

function supabaseAdmin(env: AuthEnv) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return null
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

function isResendDomainRestricted(message: string): boolean {
  return /only send testing emails to your own email|verify a domain/i.test(message)
}

async function sendOtpEmail(env: AuthEnv, email: string, code: string) {
  const apiKey = env.RESEND_API_KEY
  const from = env.RESEND_FROM
  if (!apiKey || !from) {
    return { ok: false as const, error: 'Email delivery not configured', domainRestricted: false }
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [normalizeEmail(email)],
      subject: `Your ${APP_TITLE} sign-in code`,
      text: `Your ${APP_TITLE} sign-in code is ${code}. It expires in 10 minutes.\n\nIf you did not request this, you can ignore this email.`,
      html: `<p>Your <strong>${APP_TITLE}</strong> sign-in code is <strong style="font-size:20px;letter-spacing:0.12em">${code}</strong>.</p><p>It expires in 10 minutes.</p><p style="color:#666">If you did not request this, you can ignore this email.</p>`,
    }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    console.error('Resend error', res.status, body)
    let detail = 'Failed to send email'
    try {
      const parsed = JSON.parse(body) as { message?: string }
      if (parsed?.message) detail = String(parsed.message)
    } catch {
      /* ignore */
    }
    return {
      ok: false as const,
      error: detail,
      domainRestricted: isResendDomainRestricted(detail),
    }
  }
  return { ok: true as const }
}

/** Prefer Resend 6-digit codes; fall back to Supabase magic-link when Resend is test-mode only. */
export async function requestLoginCode(
  emailRaw: string,
  env: AuthEnv,
  options?: { redirectOrigin?: string },
): Promise<
  | { ok: true; email: string; mode: 'code' | 'link' | 'offline'; setCookie?: string }
  | { ok: false; error: string }
> {
  const email = normalizeEmail(emailRaw)
  if (!email.includes('@')) return { ok: false, error: 'Enter a valid email address.' }

  const offline = await getAccessOffline(env)
  const adminUser = offline ? await isAppAdmin(email, env) : false
  const offlineDecision = decideOfflineCodeRequest({
    email,
    offline,
    isAdmin: adminUser,
  })
  if (offlineDecision.action === 'pull_plug') {
    try {
      await setAccessOffline(env, true, { setBy: email })
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'Could not update offline status.',
      }
    }
    return { ok: true, email, mode: 'offline' }
  }
  if (offlineDecision.action === 'block_non_admin') {
    return { ok: false, error: offlineDecision.error }
  }

  if (!env.SESSION_SECRET) return { ok: false, error: 'Sign-in is not configured (SESSION_SECRET).' }

  const allowed = await isEmailAllowed(email, env)
  // Anti-enumeration: always look successful to outsiders (except while Offline — see above).
  if (!allowed) {
    return { ok: true, email, mode: 'code' }
  }

  const code = generateOtpCode()
  const sent = await sendOtpEmail(env, email, code)
  if (sent.ok) {
    const pending = await createOtpPendingToken(email, code, env)
    return { ok: true, email, mode: 'code', setCookie: otpCookieHeader(pending) }
  }

  // Only fall back to Supabase when Resend is stuck in test-mode (onboarding@).
  // Other Resend failures should surface so we can fix delivery.
  if (!sent.domainRestricted) {
    return { ok: false, error: sent.error }
  }

  const admin = supabaseAdmin(env)
  if (!admin) {
    return {
      ok: false,
      error:
        'Sign-in email is not ready for other addresses yet. Ask your admin to verify a sending domain.',
    }
  }

  console.warn('Resend test-mode only; falling back to Supabase magic link', sent.error)

  const origin = String(options?.redirectOrigin || '').replace(/\/$/, '')
  const emailRedirectTo = origin ? `${origin}/auth/callback` : undefined
  const { error } = await admin.auth.signInWithOtp({
    email,
    options: {
      shouldCreateUser: true,
      ...(emailRedirectTo ? { emailRedirectTo } : {}),
    },
  })
  if (error) {
    console.error('Supabase magic link failed', error.message)
    const rateLimited = /rate|seconds|hour|429|over_email/i.test(error.message)
    return {
      ok: false,
      error: rateLimited
        ? 'Too many sign-in emails were sent recently. Wait a few minutes and try again.'
        : 'Could not send sign-in email. Try again shortly.',
    }
  }

  return { ok: true, email, mode: 'link' }
}

export async function verifyLoginCode(
  emailRaw: string,
  codeRaw: string,
  request: Request,
  env: AuthEnv,
): Promise<
  | { ok: true; email: string; setCookies: string[] }
  | { ok: false; error: string }
> {
  const email = normalizeEmail(emailRaw)
  const code = String(codeRaw || '').trim()
  if (!/^\d{6,8}$/.test(code)) return { ok: false, error: 'Enter the code from your email.' }
  if (!env.SESSION_SECRET) return { ok: false, error: 'Sign-in is not configured.' }

  const pending = parseCookies(request)[OTP_COOKIE]
  if (!pending) return { ok: false, error: 'Code expired — request a new one.' }

  const parts = pending.split('.')
  if (parts.length !== 2) return { ok: false, error: 'Code expired — request a new one.' }

  let payload: string
  try {
    payload = new TextDecoder().decode(b64urlToBytes(parts[0]!))
  } catch {
    return { ok: false, error: 'Code expired — request a new one.' }
  }
  if (!(await hmacVerify(env.SESSION_SECRET, payload, parts[1]!))) {
    return { ok: false, error: 'Code expired — request a new one.' }
  }

  const [pendingEmail, expStr, codeHash] = payload.split('|')
  if (normalizeEmail(pendingEmail || '') !== email) {
    return { ok: false, error: 'Email does not match the code we sent.' }
  }
  if (Number(expStr) < Date.now()) return { ok: false, error: 'Code expired — request a new one.' }

  const submittedHash = await sha256Hex(`${email}:${code}`)
  if (submittedHash !== codeHash) return { ok: false, error: 'Invalid or expired code' }

  const offline = await getAccessOffline(env)
  if (offline) {
    const adminUser = await isAppAdmin(email, env)
    const decision = decideOfflineVerify({ offline: true, isAdmin: adminUser })
    if (decision.action === 'refuse') return { ok: false, error: decision.error }
    if (decision.action === 'clear_offline') {
      try {
        await setAccessOffline(env, false, { setBy: email })
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : 'Could not restore online access.',
        }
      }
    }
  }

  const session = await createSessionToken(email, env)
  return {
    ok: true,
    email,
    setCookies: [sessionCookieHeader(session), clearCookieHeader(OTP_COOKIE)],
  }
}

/** Establish bme_session from a Supabase access token (magic-link callback). */
export async function completeMagicLinkSession(
  accessToken: string,
  env: AuthEnv,
): Promise<
  | { ok: true; email: string; setCookies: string[] }
  | { ok: false; error: string }
> {
  if (!env.SESSION_SECRET) return { ok: false, error: 'Sign-in is not configured.' }
  const admin = supabaseAdmin(env)
  if (!admin) return { ok: false, error: 'Sign-in is not configured.' }

  const token = String(accessToken || '').trim()
  if (!token) return { ok: false, error: 'Missing sign-in token.' }

  const { data, error } = await admin.auth.getUser(token)
  if (error || !data.user?.email) {
    return { ok: false, error: 'Sign-in link expired — request a new one.' }
  }

  const email = normalizeEmail(data.user.email)
  const allowed = await isEmailAllowed(email, env)
  if (!allowed) return { ok: false, error: 'This email is not allowed to access the app.' }

  const offline = await getAccessOffline(env)
  if (offline) {
    const adminUser = await isAppAdmin(email, env)
    const decision = decideOfflineVerify({ offline: true, isAdmin: adminUser })
    if (decision.action === 'refuse') return { ok: false, error: decision.error }
    if (decision.action === 'clear_offline') {
      try {
        await setAccessOffline(env, false, { setBy: email })
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : 'Could not restore online access.',
        }
      }
    }
  }

  const session = await createSessionToken(email, env)
  return {
    ok: true,
    email,
    setCookies: [sessionCookieHeader(session), clearCookieHeader(OTP_COOKIE)],
  }
}

export function wantsHtml(request: Request): boolean {
  const accept = (request.headers.get('Accept') || '').toLowerCase()
  if (accept.includes('text/html')) return true
  const path = new URL(request.url).pathname
  return path === '/' || path.endsWith('.html') || path.endsWith('/')
}

/** INSP-style QuadReal wall — logo on top, app name below (Playfair). */
export function authWallResponse(
  detail = '',
  options?: { offline?: boolean },
): Response {
  const safe = String(detail || '').replace(/</g, '&lt;')
  const offline = Boolean(options?.offline)
  const mark = QR_MARK_DATA_URL
  const title = offline ? 'Off Line' : APP_TITLE
  const subtitle = offline
    ? 'Access is paused. An Admin can sign in below to restore the app.'
    : 'Sign in with your work email'
  const hint = offline
    ? 'Only an Admin listed in Manage users can reactivate. Data and accounts are unchanged.'
    : 'Access is limited to people added by an admin in Manage users (or @quadreal.com).'
  const pageTitle = offline ? `Off Line · ${APP_TITLE}` : `Sign in · ${APP_TITLE}`
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${pageTitle}</title>
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@500;600&display=swap" rel="stylesheet">
<style>
  :root{
    --qr-blue:#4974FF; --qr-midnight:#173073; --qr-blue1:#132049; --qr-blue3:#2947A3;
    --qr-light:#B7C9FF; --bg:#132049; --text:#fff; --muted:#B7C9FF; --danger:#FE727D;
    --display:"Playfair Display",Georgia,"Times New Roman",serif;
    --sans:Arial,Helvetica,sans-serif;
  }
  *{box-sizing:border-box}
  html,body{height:100%;margin:0}
  body{
    display:flex;align-items:center;justify-content:center;
    background-color:var(--bg);
    background-image:
      linear-gradient(180deg, rgba(19,32,73,.72) 0%, rgba(19,32,73,.82) 100%),
      url('/brand/60-birmingham-background.jpg');
    background-size:cover;
    background-position:center;
    background-repeat:no-repeat;
    color:var(--text);font-family:var(--sans);
  }
  .card{
    width:min(480px,92vw);padding:40px 36px 32px;
    border:1px solid var(--qr-blue3);border-radius:14px;
    background:rgba(23,48,115,.92);box-shadow:0 18px 50px rgba(0,0,0,.35);
  }
  .qr-mark{display:block;width:min(196px,72%);height:auto;margin:0 auto 22px}
  h1{
    margin:0 0 6px;font-family:var(--display);font-size:28px;font-weight:600;
    letter-spacing:-.02em;text-align:center;line-height:1.2;word-break:break-word;
  }
  h1.offline{font-size:36px;letter-spacing:.04em}
  .sub{margin:0 0 22px;color:var(--muted);font-size:14px;line-height:1.45;text-align:center}
  .msg{margin:0 0 18px;color:var(--muted);font-size:14px;line-height:1.5;text-align:center}
  .msg strong{color:var(--text);font-weight:700;word-break:break-all}
  label{display:block;font-size:12px;color:var(--muted);margin:0 0 6px;letter-spacing:.02em}
  input{
    width:100%;padding:12px 14px;border-radius:8px;border:1px solid var(--qr-blue3);
    background:rgba(19,32,73,.65);color:var(--text);font-size:16px;outline:none;
  }
  input:focus{border-color:var(--qr-blue);box-shadow:0 0 0 3px rgba(73,116,255,.25)}
  input.code{letter-spacing:.35em;font-size:22px;text-align:center;font-weight:600}
  .err{
    display:none;margin:0 0 14px;padding:8px 10px;border-radius:8px;
    background:rgba(254,114,125,.12);border:1px solid rgba(254,114,125,.35);
    color:#ffc4c9;font-size:12px;
  }
  .err.show{display:block}
  button.primary{
    width:100%;margin-top:14px;padding:12px 16px;border:none;border-radius:8px;
    background:var(--qr-blue);color:#fff;font-size:15px;font-weight:600;cursor:pointer;
  }
  button.primary:hover{filter:brightness(1.08)}
  button.primary:disabled{opacity:.55;cursor:wait}
  .links{display:flex;justify-content:center;gap:16px;margin-top:16px;flex-wrap:wrap}
  .links button{
    background:none;border:none;color:var(--muted);font-size:13px;cursor:pointer;
    text-decoration:underline;padding:0;
  }
  .links button:hover{color:var(--text)}
  .step{display:none}
  .step.active{display:block}
  .hint{margin-top:10px;font-size:11px;color:rgba(183,201,255,.65);text-align:center}
</style>
</head>
<body>
  <div class="card">
    <img class="qr-mark" src="${mark}" alt="QuadReal">
    <h1 id="appTitle" class="${offline ? 'offline' : ''}">${title}</h1>
    <p class="sub" id="appSub">${subtitle}</p>
    <div class="err" id="err">${safe && safe !== 'Sign in required' ? safe : ''}</div>

    <div class="step active" id="stepEmail">
      <form id="formEmail">
        <label for="email">Email</label>
        <input id="email" name="email" type="email" autocomplete="username" required placeholder="you@quadreal.com">
        <button class="primary" type="submit" id="btnSend">Send sign-in email</button>
      </form>
    </div>

    <div class="step" id="stepCode">
      <p class="msg">We sent a code to <strong id="destEmail"></strong></p>
      <form id="formCode">
        <label for="code">Sign-in code</label>
        <input id="code" class="code" name="code" inputmode="numeric" pattern="[0-9]{6,8}" maxlength="8" autocomplete="one-time-code" required placeholder="••••••">
        <button class="primary" type="submit" id="btnVerify">Verify</button>
      </form>
      <div class="links">
        <button type="button" id="btnResend">Resend</button>
        <button type="button" id="btnChange">Change email</button>
      </div>
    </div>

    <div class="step" id="stepLink">
      <p class="msg">We sent a sign-in link to <strong id="linkEmail"></strong>. Open that email and click the link on this device.</p>
      <div class="links">
        <button type="button" id="btnResendLink">Resend link</button>
        <button type="button" id="btnChangeLink">Change email</button>
      </div>
    </div>
    <p class="hint" id="appHint">${hint}</p>
  </div>
<script>
(function(){
  const err=document.getElementById('err');
  const stepEmail=document.getElementById('stepEmail');
  const stepCode=document.getElementById('stepCode');
  const stepLink=document.getElementById('stepLink');
  const destEmail=document.getElementById('destEmail');
  const linkEmail=document.getElementById('linkEmail');
  const emailInput=document.getElementById('email');
  const codeInput=document.getElementById('code');
  const appTitle=document.getElementById('appTitle');
  const appSub=document.getElementById('appSub');
  const appHint=document.getElementById('appHint');
  let pendingEmail='';

  function showErr(msg){
    if(!msg){ err.classList.remove('show'); err.textContent=''; return; }
    err.textContent=msg; err.classList.add('show');
  }
  if(err.textContent.trim()) err.classList.add('show');

  function showOnly(step){
    stepEmail.classList.remove('active');
    stepCode.classList.remove('active');
    stepLink.classList.remove('active');
    step.classList.add('active');
  }

  function applyOfflineChrome(){
    appTitle.textContent='Off Line';
    appTitle.classList.add('offline');
    appSub.textContent='Access is paused. An Admin can sign in below to restore the app.';
    appHint.textContent='Only an Admin listed in Manage users can reactivate. Data and accounts are unchanged.';
    document.title='Off Line · ${APP_TITLE}';
  }

  function showCodeStep(email){
    pendingEmail=email;
    destEmail.textContent=email;
    showOnly(stepCode);
    codeInput.value='';
    codeInput.focus();
    showErr('');
  }
  function showLinkStep(email){
    pendingEmail=email;
    linkEmail.textContent=email;
    showOnly(stepLink);
    showErr('');
  }
  function showEmailStep(){
    pendingEmail='';
    showOnly(stepEmail);
    emailInput.focus();
  }

  async function requestCode(email){
    const res=await fetch('/api/auth/request-code',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      credentials:'same-origin',
      body:JSON.stringify({email})
    });
    const j=await res.json().catch(()=>({}));
    if(!res.ok) throw new Error(j.error||'Could not send sign-in email');
    const mode=j.mode==='link'?'link':(j.mode==='offline'?'offline':'code');
    return { email: j.email||email, mode };
  }

  function showResult(result){
    if(result.mode==='offline'){
      applyOfflineChrome();
      emailInput.value='';
      showEmailStep();
      showErr('');
      return;
    }
    if(result.mode==='link') showLinkStep(result.email);
    else showCodeStep(result.email);
  }

  document.getElementById('formEmail').addEventListener('submit',async (e)=>{
    e.preventDefault();
    const email=String(emailInput.value||'').trim().toLowerCase();
    const btn=document.getElementById('btnSend');
    btn.disabled=true; showErr('');
    try{
      showResult(await requestCode(email));
    }catch(ex){ showErr(ex.message||'Could not send sign-in email'); }
    finally{ btn.disabled=false; }
  });

  document.getElementById('formCode').addEventListener('submit',async (e)=>{
    e.preventDefault();
    const code=String(codeInput.value||'').trim();
    const btn=document.getElementById('btnVerify');
    btn.disabled=true; showErr('');
    try{
      const res=await fetch('/api/auth/verify',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        credentials:'same-origin',
        body:JSON.stringify({email:pendingEmail, code})
      });
      const j=await res.json().catch(()=>({}));
      if(!res.ok) throw new Error(j.error||'Invalid code');
      location.href='/';
    }catch(ex){ showErr(ex.message||'Invalid code'); }
    finally{ btn.disabled=false; }
  });

  async function resend(){
    if(!pendingEmail) return;
    showErr('');
    try{
      showResult(await requestCode(pendingEmail));
    }catch(ex){ showErr(ex.message||'Could not resend'); }
  }
  document.getElementById('btnResend').addEventListener('click',()=>void resend());
  document.getElementById('btnResendLink').addEventListener('click',()=>void resend());
  document.getElementById('btnChange').addEventListener('click',()=>showEmailStep());
  document.getElementById('btnChangeLink').addEventListener('click',()=>showEmailStep());
})();
</script>
</body>
</html>`

  return new Response(html, {
    status: 401,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  })
}
