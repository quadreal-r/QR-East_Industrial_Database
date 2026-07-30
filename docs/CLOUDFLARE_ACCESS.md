# Cloudflare Access / QuadReal login wall (map app — quadreal)

Live app: https://qr-database.insp360.ca/  
Also: https://qr-east-industrial-database.pages.dev/

## Login wall (current)

The map app uses a **custom QuadReal OTP wall** (same style as INSP 360 on krutki11):

1. QuadReal logo on top  
2. **QR-Industrial_East_Database** (Playfair) underneath  
3. Email → **Send code** → 6-digit code  

**Cloudflare Access must be disabled** on this Pages hostname so the custom wall is visible. If Access is still on, you will see Cloudflare’s white login card instead.

| Item | Value |
|------|--------|
| Account | **quadreal** (`ed62b8514615e386084ffd47455ec775`) |
| Cookie | `bme_session` (HMAC, 24h) |
| Allowlist | `@quadreal.com` **or** email already in Manage users (`app_roles`) |
| Email | Resend 6-digit codes when a verified sending domain is configured; otherwise Supabase magic-link fallback |
| Session mint | `/api/session` (after OTP cookie / magic-link cookie) → Supabase |

### Pages secrets (quadreal)

```powershell
npx wrangler pages secret put SESSION_SECRET --project-name=qr-east-industrial-database
npx wrangler pages secret put RESEND_API_KEY --project-name=qr-east-industrial-database
npx wrangler pages secret put RESEND_FROM --project-name=qr-east-industrial-database
# also keep:
# SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
```

`RESEND_FROM` must use the verified Resend domain, for example:

`QR-Industrial East <noreply@insp360.ca>`

Do **not** use `onboarding@resend.dev` in production — that only delivers to the Resend account owner.
### Disable Access (required for the QuadReal wall)

Zero Trust → Access → Applications → delete/disable the app for  
`qr-east-industrial-database.pages.dev` (and `*.qr-east-industrial-database.pages.dev`).

## Legacy: Access login_design branding

`npm run setup:access-branding` still updates Zero Trust `login_design` (QR Blue + logo). That only matters if Access is left on. Prefer the custom OTP wall above.

## Related code

| File | Role |
|------|------|
| `functions/_middleware.ts` | Serves OTP wall when logged out |
| `functions/lib/bmeAuth.ts` | Wall HTML + OTP + session cookie |
| `functions/api/auth/*` | request-code / verify / logout |
| `functions/api/session.ts` | Mints Supabase session from `bme_session` (or Access JWT) |
| `src/lib/cloudflareAccess.ts` | Logout → clear cookie → wall |

See [CLOUDFLARE_ACCOUNTS.md](CLOUDFLARE_ACCOUNTS.md).
