"""Generate docs/SECURITY_BRIEF.pdf from the security briefing content."""

from __future__ import annotations

from pathlib import Path

from fpdf import FPDF

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "docs" / "SECURITY_BRIEF.pdf"
OUT_FALLBACK = ROOT / "docs" / "SECURITY_BRIEF-share.pdf"


class BriefPDF(FPDF):
    def header(self) -> None:
        if self.page_no() == 1:
            return
        self.set_font("Helvetica", "I", 8)
        self.set_text_color(90, 90, 90)
        self.cell(0, 8, "QR East Industrial Database - Security Briefing", align="L")
        self.cell(0, 8, f"Page {self.page_no()}", align="R", new_x="LMARGIN", new_y="NEXT")
        self.set_draw_color(200, 200, 200)
        self.line(self.l_margin, self.get_y(), self.w - self.r_margin, self.get_y())
        self.ln(4)

    def footer(self) -> None:
        self.set_y(-12)
        self.set_font("Helvetica", "I", 7)
        self.set_text_color(120, 120, 120)
        self.cell(
            0,
            8,
            "Internal - QuadReal IT / Cybersecurity review. Architecture only; no secret values.",
            align="C",
        )


def reset_x(pdf: BriefPDF) -> None:
    pdf.set_x(pdf.l_margin)


def space_left(pdf: BriefPDF) -> float:
    return pdf.h - pdf.b_margin - pdf.get_y()


def ensure_space(pdf: BriefPDF, needed_mm: float) -> None:
    """Start a new page if the remaining space is too tight for a block."""
    if space_left(pdf) < needed_mm:
        pdf.add_page()
        reset_x(pdf)


def h1(pdf: BriefPDF, text: str) -> None:
    ensure_space(pdf, 28)
    reset_x(pdf)
    pdf.set_font("Helvetica", "B", 16)
    pdf.set_text_color(19, 32, 73)
    pdf.multi_cell(0, 8, text)
    pdf.ln(2)


def h2(pdf: BriefPDF, text: str) -> None:
    # Keep section title with the start of its content (avoid orphan headings).
    ensure_space(pdf, 42)
    pdf.ln(2)
    reset_x(pdf)
    pdf.set_font("Helvetica", "B", 12)
    pdf.set_text_color(41, 71, 163)
    pdf.multi_cell(0, 7, text)
    pdf.ln(1)


def h3(pdf: BriefPDF, text: str) -> None:
    # Keep subsection title with following paragraph/table (~title + 2 rows).
    ensure_space(pdf, 36)
    pdf.ln(1)
    reset_x(pdf)
    pdf.set_font("Helvetica", "B", 10)
    pdf.set_text_color(23, 48, 115)
    pdf.multi_cell(0, 6, text)
    pdf.ln(0.5)


def body(pdf: BriefPDF, text: str) -> None:
    ensure_space(pdf, 14)
    reset_x(pdf)
    pdf.set_font("Helvetica", "", 9)
    pdf.set_text_color(30, 30, 30)
    pdf.multi_cell(0, 5, text)
    pdf.ln(1)


def bullet(pdf: BriefPDF, text: str) -> None:
    ensure_space(pdf, 12)
    reset_x(pdf)
    pdf.set_font("Helvetica", "", 9)
    pdf.set_text_color(30, 30, 30)
    pdf.multi_cell(0, 5, f"- {text}")


def meta_line(pdf: BriefPDF, label: str, value: str) -> None:
    ensure_space(pdf, 12)
    reset_x(pdf)
    pdf.set_font("Helvetica", "B", 9)
    pdf.set_text_color(30, 30, 30)
    pdf.write(5, f"{label}: ")
    pdf.set_font("Helvetica", "", 9)
    pdf.write(5, value)
    pdf.ln(6)


def table(
    pdf: BriefPDF,
    headers: list[str],
    rows: list[list[str]],
    widths: list[float],
    *,
    title: str | None = None,
    title_level: int = 3,
) -> None:
    """Draw a table, optionally with a title kept on the same page as the table start."""
    line_h = 4.5

    def row_height(values: list[str]) -> float:
        tallest = line_h
        for cell, w in zip(values, widths):
            chars_per_line = max(8, int(w / 1.7))
            lines = max(1, (len(cell) + chars_per_line - 1) // chars_per_line)
            tallest = max(tallest, lines * line_h)
        return tallest + 1.5

    heights = [row_height(headers)] + [row_height(r) for r in rows]
    title_h = 0.0
    if title:
        title_h = 14.0 if title_level == 2 else 10.0
    total_h = sum(heights) + 4 + title_h

    # Prefer keeping title + whole table on one page when it fits.
    usable = pdf.h - pdf.t_margin - pdf.b_margin - 16
    if total_h <= usable:
        ensure_space(pdf, total_h)
    else:
        # At least keep title + header + first data row together.
        ensure_space(pdf, title_h + heights[0] + (heights[1] if rows else 0) + 2)

    if title:
        if title_level == 2:
            pdf.ln(2)
            reset_x(pdf)
            pdf.set_font("Helvetica", "B", 12)
            pdf.set_text_color(41, 71, 163)
            pdf.multi_cell(0, 7, title)
            pdf.ln(1)
        else:
            pdf.ln(1)
            reset_x(pdf)
            pdf.set_font("Helvetica", "B", 10)
            pdf.set_text_color(23, 48, 115)
            pdf.multi_cell(0, 6, title)
            pdf.ln(0.5)

    def draw_row(values: list[str], *, header: bool = False, shade: bool = False) -> None:
        h = row_height(values)
        if pdf.get_y() + h > pdf.h - pdf.b_margin:
            pdf.add_page()
            reset_x(pdf)
            # Repeat header after a mid-table page break.
            if not header:
                draw_row(headers, header=True)
        y0 = pdf.get_y()
        x0 = pdf.l_margin
        if header:
            pdf.set_font("Helvetica", "B", 8)
            pdf.set_fill_color(19, 32, 73)
            pdf.set_text_color(255, 255, 255)
        else:
            pdf.set_font("Helvetica", "", 8)
            pdf.set_text_color(30, 30, 30)
            pdf.set_fill_color(245, 247, 252) if shade else pdf.set_fill_color(255, 255, 255)
        for i, (cell, w) in enumerate(zip(values, widths)):
            x = x0 + sum(widths[:i])
            pdf.rect(x, y0, w, h, style="DF")
            pdf.set_xy(x + 1, y0 + 0.8)
            pdf.multi_cell(w - 2, line_h, cell)
        pdf.set_y(y0 + h)

    draw_row(headers, header=True)
    for idx, row in enumerate(rows):
        draw_row(row, shade=(idx % 2 == 1))
    pdf.ln(2)
    reset_x(pdf)


def main() -> None:
    pdf = BriefPDF(format="Letter")
    pdf.set_auto_page_break(auto=True, margin=16)
    pdf.set_margins(16, 16, 16)
    pdf.add_page()

    # Cover / title
    pdf.set_fill_color(19, 32, 73)
    pdf.rect(0, 0, pdf.w, 42, "F")
    pdf.set_y(14)
    pdf.set_font("Helvetica", "B", 18)
    pdf.set_text_color(255, 255, 255)
    pdf.cell(0, 8, "QR East Industrial Database", align="C", new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("Helvetica", "", 12)
    pdf.cell(0, 7, "Security Briefing for IT / Cybersecurity", align="C", new_x="LMARGIN", new_y="NEXT")
    pdf.ln(18)

    pdf.set_text_color(30, 30, 30)
    meta_line(pdf, "Product", "QuadReal Industrial Portfolio Map (Ontario)")
    meta_line(
        pdf,
        "Purpose",
        "Internal web app for buildings, RTUs, tenants, utilities, Capex data, RTU media, and QR-360 tours",
    )
    meta_line(pdf, "As of", "30 July 2026  |  Live build v1.15.3")
    meta_line(pdf, "Classification", "Internal operational data (confirm with business owner)")

    table(
        pdf,
        ["URL", "Role"],
        [
            ["https://qr-database.insp360.ca/", "Primary friendly URL (recommended)"],
            ["https://qr-east-industrial-database.pages.dev/", "Cloudflare Pages origin (same app)"],
            [
                "https://github.com/quadreal-r/QR-East_Industrial_Database",
                "Source / version history only (not live host)",
            ],
        ],
        [95, 95],
        title="1. Production endpoints",
        title_level=2,
    )
    body(pdf, "Developer localhost only: http://127.0.0.1:5174/")

    h2(pdf, "2. High-level architecture")
    body(
        pdf,
        "Browser -> Cloudflare edge (Pages + optional hostname proxy) -> custom email OTP login wall "
        "(Pages Functions) -> React SPA -> Supabase (Auth + Postgres + RLS + Edge Functions) -> "
        "Cloudflare R2 (pictures, documents, 360 deg tours).",
    )
    table(
        pdf,
        ["Layer", "Provider", "Account / owner"],
        [
            ["Map app hosting (Pages)", "Cloudflare", "quadreal (quadreal.rpiwin@gmail.com)"],
            ["Friendly DNS + proxy Worker", "Cloudflare", "krutki11 - zone insp360.ca"],
            ["Database + Auth", "Supabase Postgres", "Project wyiymdtlncperqpwriuk"],
            ["RTU pictures / documents (R2)", "Cloudflare R2", "quadreal"],
            ["QR-360 tours (insp360 bucket)", "Cloudflare R2", "krutki11"],
            ["OTP email delivery", "Resend", "Verified domain (e.g. insp360.ca)"],
        ],
        [55, 40, 95],
    )
    body(
        pdf,
        "Important: Two Cloudflare accounts are intentional. Map hosting and RTU media stay on "
        "quadreal; tour storage and insp360.ca DNS stay on krutki11. Credentials must not be mixed.",
    )

    h2(pdf, "3. Authentication (front door)")
    h3(pdf, "Current control: custom email OTP wall")
    bullet(pdf, "Unauthenticated HTML navigations are intercepted by Cloudflare Pages middleware.")
    bullet(pdf, "User enters work email -> 6-digit one-time code (Resend) -> verified -> session cookie.")
    bullet(
        pdf,
        "Fallback: Supabase magic link if Resend is restricted (allowlist re-checked before cookie).",
    )

    h3(pdf, "Who may sign in")
    bullet(pdf, "Emails ending in @quadreal.com, OR")
    bullet(pdf, "Emails explicitly added in Manage users (app_roles table)")
    bullet(pdf, "Non-allowed addresses do not reveal whether they are on the allowlist (anti-enumeration).")

    table(
        pdf,
        ["Cookie", "Purpose", "Properties"],
        [
            [
                "bme_otp",
                "Pending OTP (hash only)",
                "HttpOnly, Secure, SameSite=Lax, ~10 min",
            ],
            [
                "bme_session",
                "Signed gate cookie after login",
                "HttpOnly, Secure, SameSite=Lax, 24h, HMAC-SHA-256",
            ],
        ],
        [35, 55, 100],
        title="Session cookies",
    )

    h3(pdf, "After the wall")
    body(
        pdf,
        "/api/session exchanges a valid gate cookie for a Supabase Auth session (access + refresh "
        "tokens) used by the SPA for database calls.",
    )

    table(
        pdf,
        ["Role", "Capabilities"],
        [
            ["Viewer", "Sign in; browse; limited Cost Center edits (RTU $ allocations / notes)"],
            ["Admin", "Full edit: markers, polygons, settings, media, users, tour publish, etc."],
        ],
        [30, 160],
        title="Roles",
    )
    body(
        pdf,
        "UI edit buttons follow role, but Postgres RLS and Edge Functions are the authoritative enforcement.",
    )
    body(pdf, "Logout clears gate cookies and Supabase browser tokens, then returns to the OTP wall.")

    h3(pdf, "Offline kill-switch (panic)")
    bullet(
        pdf,
        "Entering pulltheplug@quadreal.com on the login wall immediately flips Offline "
        "(shared panic passphrase for anyone who can reach the wall).",
    )
    bullet(
        pdf,
        "Offline cuts app access (HTML gate + non-admin session mint). It does not wipe "
        "Postgres, R2, or app_roles accounts.",
    )
    bullet(
        pdf,
        "Reactivation: an existing Admin completes OTP on the Offline wall; successful "
        "Admin login clears the flag for everyone.",
    )
    bullet(pdf, "Flag: app_settings key access_offline (server-side service role only).")

    body(
        pdf,
        "Legacy: older Cloudflare Access / Zero Trust login may still have transitional code paths. "
        "Current design expects Access disabled on the Pages host so the OTP wall is visible.",
    )

    h2(pdf, "4. Database security (Supabase)")
    bullet(pdf, "Engine: PostgreSQL with Row Level Security (RLS) on application tables.")
    bullet(
        pdf,
        "Data: buildings/RTUs/tenants/utilities, polygons, Capex/pricing/schedule, settings, "
        "media metadata, roles, activity events.",
    )
    bullet(pdf, "Writes restricted to admins (is_app_editor / app_roles), with viewer exception for RTU notes/allocations.")
    bullet(
        pdf,
        "SUPABASE_SERVICE_ROLE_KEY is server-only (Pages Functions, Edge Functions, scripts) - never VITE_ / browser.",
    )
    bullet(
        pdf,
        "VITE_SUPABASE_ANON_KEY is public by design; protection depends on RLS + Auth, not key secrecy.",
    )

    table(
        pdf,
        ["Function", "Auth", "Notes"],
        [
            ["admin-users", "JWT + admin", "User management"],
            ["upload-insp360-cloud", "JWT + admin", "Short-lived R2 presigned PUT (~30 min)"],
            ["list-insp360-cloud", "JWT (signed-in)", "Lists tour objects for sanitized prefix"],
            ["delete-rtu-picture", "JWT + admin", "Deletes R2 object + metadata"],
        ],
        [50, 40, 100],
        title="Edge Functions",
    )
    body(pdf, "CORS on these functions is currently open (*); protection relies on bearer JWT + role checks.")

    table(
        pdf,
        ["Content", "Account", "Access model"],
        [
            ["RTU pictures", "quadreal", "Public CDN bytes; metadata in Supabase"],
            ["RTU documents", "quadreal", "Public CDN bytes; metadata in Supabase"],
            [
                "QR-360 tours",
                "krutki11 insp360",
                "Public CDN for published objects; uploads via short-lived signed URLs (admin)",
            ],
        ],
        [40, 40, 110],
        title="5. File / object storage (R2)",
        title_level=2,
    )
    body(
        pdf,
        "Implication: published media/tour URLs are world-readable if the URL is known. Upload/delete "
        "remain admin-gated. Confirm this matches data-classification policy.",
    )

    table(
        pdf,
        ["Method / path", "Purpose"],
        [
            ["POST /api/auth/request-code", "Start OTP"],
            ["POST /api/auth/verify", "Verify OTP -> set bme_session"],
            ["POST /api/auth/complete", "Magic-link completion"],
            ["GET|POST /api/auth/logout", "Clear gate cookies"],
            ["GET /api/session", "Mint Supabase session for SPA"],
        ],
        [70, 120],
        title="6. Application API surface (Pages Functions)",
        title_level=2,
    )
    body(
        pdf,
        "Friendly hostname qr-database.insp360.ca is a small Worker on krutki11 that reverse-proxies "
        "to the quadreal Pages origin (same app).",
    )

    h2(pdf, "7. Secrets classification")
    h3(pdf, "Browser-exposed (treat as public)")
    bullet(pdf, "VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY")
    bullet(pdf, "VITE_GOOGLE_MAPS_API_KEY (HTTP referrer-restricted in Google Cloud), VITE_GOOGLE_MAPS_MAP_ID")
    bullet(pdf, "VITE_RTU_PICTURES_BASE_URL, VITE_RTU_DOCUMENTS_BASE_URL, VITE_INSP360_BASE_URL")

    h3(pdf, "Server-only (never commit / never VITE_)")
    bullet(pdf, "SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL")
    bullet(pdf, "SESSION_SECRET (HMAC for gate cookies)")
    bullet(pdf, "RESEND_API_KEY, RESEND_FROM")
    bullet(pdf, "R2_* (quadreal RTU media)")
    bullet(pdf, "INSP360_R2_* (krutki11 tours - separate keys)")

    h2(pdf, "8. Data sensitivity")
    body(
        pdf,
        "Typical content: Ontario industrial addresses and portfolio structure; tenant/utility/RTU "
        "operational data; Capex/replacement-year/budget fields; operator/manager names and app user "
        "emails/roles; equipment photos/documents; 360 deg inspection tours. Treat as internal QuadReal "
        "operational data pending formal classification.",
    )

    table(
        pdf,
        ["Control", "Status"],
        [
            ["Front-door authentication", "Email OTP (+ allowlist) before application HTML"],
            ["Offline kill-switch", "Panic email flips Offline; Admin OTP restores; no data wipe"],
            ["Session cookie hardening", "HttpOnly + Secure + SameSite=Lax + HMAC"],
            ["Role-based editing", "Admin vs Viewer; RLS + Edge Function checks"],
            ["Secrets separation", "Service role / R2 / Resend not in browser bundle"],
            ["Source hosting", "Live site on Cloudflare Pages (not GitHub Pages)"],
            ["Account separation", "Map/RTU media (quadreal) vs tours/DNS (krutki11)"],
            ["Transport", "HTTPS on all production hosts"],
            ["Audit", "Activity events for auth/actions (admin-readable)"],
        ],
        [55, 135],
        title="9. Controls summary",
        title_level=2,
    )

    h2(pdf, "10. Items cybersecurity may want to probe")
    bullet(pdf, "Public CDN media/tours - readable by URL; confirm classification policy.")
    bullet(
        pdf,
        "Portfolio SELECT openness via Supabase client model - OTP wall is the intended browser gate.",
    )
    bullet(pdf, "Edge Function CORS * - acceptable only if JWT + role checks are trusted.")
    bullet(
        pdf,
        "Google Maps API key referrer allowlist should include qr-database.insp360.ca and pages.dev.",
    )
    bullet(pdf, "Cross-account proxy (insp360.ca Worker -> Pages) as an extra trust boundary.")
    bullet(pdf, "Confirm Cloudflare Access remains disabled if OTP wall is the approved model.")
    bullet(pdf, "Older docs mentioning email/password are outdated; OTP + admin/viewer is current.")

    table(
        pdf,
        ["Area", "Owner"],
        [
            ["Business owner", "(QuadReal - fill in)"],
            ["Application maintainer", "Robert Piwin / project team"],
            ["Cloudflare quadreal", "quadreal.rpiwin@gmail.com"],
            ["Cloudflare krutki11 (tours / insp360.ca)", "krutki11@gmail.com"],
            ["Supabase project", "wyiymdtlncperqpwriuk"],
        ],
        [70, 120],
        title="11. Contacts / ownership",
        title_level=2,
    )

    h2(pdf, "12. Internal technical references")
    bullet(pdf, "docs/CLOUDFLARE_ACCESS.md - login wall")
    bullet(pdf, "docs/CLOUDFLARE_ACCOUNTS.md - account split")
    bullet(pdf, "docs/DATA_ARCHITECTURE.md - data layers")
    bullet(pdf, "docs/INSP360_R2.md - tour storage")
    bullet(pdf, "supabase/README.md - database / functions")
    bullet(pdf, ".env.example - environment variable classification")
    bullet(pdf, "docs/SECURITY_BRIEF.md - markdown source of this PDF")

    pdf.ln(4)
    pdf.set_font("Helvetica", "I", 8)
    pdf.set_text_color(90, 90, 90)
    pdf.multi_cell(
        0,
        5,
        "Document generated for QuadReal IT / Cybersecurity review. Contains architecture and "
        "control descriptions only - no secret values.",
    )

    OUT.parent.mkdir(parents=True, exist_ok=True)
    try:
        pdf.output(OUT)
        print(f"Wrote {OUT}")
    except PermissionError:
        pdf.output(OUT_FALLBACK)
        print(f"Wrote {OUT_FALLBACK} (close the open PDF to overwrite SECURITY_BRIEF.pdf)")


if __name__ == "__main__":
    main()
