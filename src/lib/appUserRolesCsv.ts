import type { AppRole } from '@/lib/appRoles'
import { normalizeAppRole } from '@/lib/appRoles'

export interface AppRoleCsvRow {
  email: string
  role: AppRole
}

export interface ParseAppRolesCsvResult {
  rows: AppRoleCsvRow[]
  errors: string[]
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function roleLabel(role: AppRole): string {
  return role === 'admin' ? 'Admin' : 'Viewer'
}

/** Sheet name for user emails / access levels in the main database Excel export. */
export const USERS_SHEET = 'Users'

export const USERS_EXPORT_HEADERS = ['Email', 'Access Level'] as const

/** Rows for the Excel "Users" sheet (sorted by email; Admin / Viewer labels). */
export function buildAppUserRoleExportRows(
  rows: ReadonlyArray<Pick<AppRoleCsvRow, 'email' | 'role'>>,
): unknown[][] {
  return [...rows]
    .map((row) => ({
      email: row.email.trim().toLowerCase(),
      role: normalizeAppRole(row.role),
    }))
    .filter((row) => row.email.length > 0)
    .sort((a, b) => a.email.localeCompare(b.email))
    .map((row) => [row.email, roleLabel(row.role)])
}

/** Stable CSV for backup / Excel — email,role (header required). */
export function buildAppRolesCsv(rows: AppRoleCsvRow[]): string {
  const lines = ['email,role']
  for (const row of [...rows].sort((a, b) => a.email.localeCompare(b.email))) {
    const email = row.email.trim().toLowerCase()
    if (!email) continue
    lines.push(`${csvEscape(email)},${normalizeAppRole(row.role)}`)
  }
  return `${lines.join('\n')}\n`
}

export function appRolesExportFilename(now = new Date()): string {
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `qr-east-users-${y}-${m}-${d}.csv`
}

/**
 * Parse a user-role CSV. Accepts `email,role` or `role,email` headers,
 * or headerless rows as `email,role`.
 */
export function parseAppRolesCsv(text: string): ParseAppRolesCsvResult {
  const errors: string[] = []
  const rows: AppRoleCsvRow[] = []
  const seen = new Set<string>()

  const lines = String(text || '')
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))

  if (lines.length === 0) {
    return { rows, errors: ['File is empty.'] }
  }

  let start = 0
  let emailIdx = 0
  let roleIdx = 1
  const firstCells = splitCsvLine(lines[0]!)
  const headerish = firstCells.map((c) => c.trim().toLowerCase())
  if (headerish.includes('email') || headerish.includes('role')) {
    emailIdx = headerish.indexOf('email')
    roleIdx = headerish.indexOf('role')
    if (emailIdx < 0) {
      return { rows, errors: ['Missing an "email" column.'] }
    }
    if (roleIdx < 0) {
      return { rows, errors: ['Missing a "role" column (admin or viewer).'] }
    }
    start = 1
  }

  for (let i = start; i < lines.length; i++) {
    const lineNo = i + 1
    const cells = splitCsvLine(lines[i]!)
    const emailRaw = (cells[emailIdx] ?? '').trim().toLowerCase()
    const roleRaw = (cells[roleIdx] ?? '').trim().toLowerCase()

    if (!emailRaw && !roleRaw) continue

    if (!emailRaw || !EMAIL_RE.test(emailRaw)) {
      errors.push(`Line ${lineNo}: invalid email.`)
      continue
    }
    if (roleRaw !== 'admin' && roleRaw !== 'viewer') {
      errors.push(`Line ${lineNo}: role must be admin or viewer (got "${roleRaw || '(blank)'}").`)
      continue
    }
    if (seen.has(emailRaw)) {
      errors.push(`Line ${lineNo}: duplicate email ${emailRaw} in file.`)
      continue
    }
    seen.add(emailRaw)
    rows.push({ email: emailRaw, role: normalizeAppRole(roleRaw) })
  }

  return { rows, errors }
}

export interface AppRoleImportPlan {
  toSave: AppRoleCsvRow[]
  alreadyMatch: number
  roleChanges: number
  additions: number
}

/** Compare import rows against the current list; only schedule writes that change something. */
export function planAppRoleImport(
  existing: AppRoleCsvRow[],
  incoming: AppRoleCsvRow[],
): AppRoleImportPlan {
  const byEmail = new Map(existing.map((row) => [row.email.trim().toLowerCase(), row.role]))
  const toSave: AppRoleCsvRow[] = []
  let alreadyMatch = 0
  let roleChanges = 0
  let additions = 0

  for (const row of incoming) {
    const email = row.email.trim().toLowerCase()
    const role = normalizeAppRole(row.role)
    const current = byEmail.get(email)
    if (current == null) {
      toSave.push({ email, role })
      additions += 1
      continue
    }
    if (current === role) {
      alreadyMatch += 1
      continue
    }
    toSave.push({ email, role })
    roleChanges += 1
  }

  return { toSave, alreadyMatch, roleChanges, additions }
}

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`
  return value
}

function splitCsvLine(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"'
          i += 1
        } else {
          inQuotes = false
        }
      } else {
        cur += ch
      }
      continue
    }
    if (ch === '"') {
      inQuotes = true
      continue
    }
    if (ch === ',') {
      out.push(cur)
      cur = ''
      continue
    }
    cur += ch
  }
  out.push(cur)
  return out
}
