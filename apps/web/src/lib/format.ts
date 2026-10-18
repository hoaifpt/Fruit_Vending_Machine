// Display and conversion helpers. API money is VND with 2 decimals; API instants are UTC ISO-8601,
// shown in Asia/Ho_Chi_Minh (UTC+7, no DST).
const TIME_ZONE = 'Asia/Ho_Chi_Minh'
const OFFSET = '+07:00'
const DAY_MS = 86_400_000

const money = new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND', maximumFractionDigits: 0 })
const dateTime = new Intl.DateTimeFormat('vi-VN', { timeZone: TIME_ZONE, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })

export function formatMoney(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? money.format(value) : '—'
}
export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : dateTime.format(date)
}

/** `YYYY-MM-DD` (Vietnam local date) → UTC instant of that day's start. */
export function localDateStartToInstant(date: string): string | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return undefined
  const instant = new Date(`${date}T00:00:00${OFFSET}`)
  return Number.isNaN(instant.getTime()) ? undefined : instant.toISOString()
}
/** Inclusive local date range → [from inclusive, to exclusive) UTC instants. */
export function dateRangeToInstants(fromDate: string, toDate: string): { from?: string; to?: string } {
  const from = localDateStartToInstant(fromDate)
  const toStart = localDateStartToInstant(toDate)
  return { from, to: toStart ? new Date(new Date(toStart).getTime() + DAY_MS).toISOString() : undefined }
}
/** `<input type="datetime-local">` value (Vietnam time) → UTC instant. */
export function localDateTimeToInstant(value: string): string | undefined {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return undefined
  const instant = new Date(`${value}:00${OFFSET}`)
  return Number.isNaN(instant.getTime()) ? undefined : instant.toISOString()
}

/** Positive amount with at most 2 decimals, as the API requires. */
export function parsePrice(raw: string): number | undefined {
  const text = raw.trim()
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return undefined
  const value = Number(text)
  return value > 0 ? value : undefined
}
export function parseInteger(raw: string): number | undefined {
  const text = raw.trim()
  return /^-?\d+$/.test(text) ? Number(text) : undefined
}
export function parseDecimal(raw: string): number | undefined {
  const text = raw.trim()
  return /^-?\d+(\.\d+)?$/.test(text) ? Number(text) : undefined
}

export type ExpiryState = 'expired' | 'soon' | 'fresh'
/** Display-only freshness hint. "Soon" means within 2 days. */
export function expiryState(expiresAt: string | null | undefined, now = Date.now()): ExpiryState | undefined {
  if (!expiresAt) return undefined
  const time = new Date(expiresAt).getTime()
  if (Number.isNaN(time)) return undefined
  return time <= now ? 'expired' : time - now <= 2 * DAY_MS ? 'soon' : 'fresh'
}
