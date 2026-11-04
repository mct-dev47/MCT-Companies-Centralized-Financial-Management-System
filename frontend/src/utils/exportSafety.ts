/**
 * Safe output for exports (security audit, 2026-10-30).
 *
 * Text that users type (tenant names, particulars, company names, an email typed on a failed
 * login) is stored in the database and shown to other users. Two places need care:
 *   1. Printable pages are built as HTML strings, so every value must be escaped.
 *   2. CSV files open in Excel, where a cell starting with = + - @ is run as a formula.
 */

/** Escape text for use inside HTML. */
export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * One CSV text cell: quoted, inner quotes doubled, and a leading = + - @ (or tab or carriage return)
 * neutralised with an apostrophe so spreadsheets show it as text instead of running it.
 */
export function csvCell(value: unknown): string {
  let text = String(value ?? '')
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`
  return `"${text.replace(/"/g, '""')}"`
}
