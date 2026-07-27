# Auth feature (Cloudflare Access + silent Supabase)

There is no in-app login form. The cloud site is gated by **Cloudflare Access**; the browser
receives a **silent Supabase session** from `/api/session` so Postgres RLS still works. On
localhost `/api/session` is served by a Vite middleware that mints a session for
`LOCAL_DEV_EMAIL` (or `?as=admin` / `?as=viewer` after the top-bar role buttons).

- `LoginModal.module.css` is retained only for legacy shared styles until removed.
- Auth state lives in `AuthProvider` (`src/app/authContext.tsx`); consume it via `useAuth()`.
- Role is `admin` or `viewer`. Admins get `canEdit === true`; viewers can browse but never write.
- **Logout**: clears browser auth tokens, sets a logged-out latch, then on the cloud site clears the
  Access app cookie (fetch, no redirect follow) and the Zero Trust SSO session (team logout with
  `returnTo` = app root → Access login wall). Never nest a second logout URL inside `returnTo` —
  that shows Cloudflare’s “Failed to log out” page. After you pass the Access wall again, the app
  mints a silent Supabase session automatically (the latch is ignored on Access hosts). On
  localhost, Logout stays logged out until you click **Sign in as Admin** or **Sign in as Viewer**.

Edit gates in the UI use `canEdit` (Admin only). `isAuthenticated` means "has a Supabase
session"; viewers are authenticated but cannot save.
