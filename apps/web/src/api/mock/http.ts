// Response shapes of the real backend: success `{ timestamp, message, data }`, error ApiErrorResponse.
export class MockHttpError extends Error {
  readonly status: number
  readonly fieldErrors?: Record<string, string>
  constructor(status: number, message: string, fieldErrors?: Record<string, string>) {
    super(message)
    this.status = status
    this.fieldErrors = fieldErrors
  }
}

export interface Reply { status: number; data: unknown }
export const ok = (data: unknown): Reply => ({ status: 200, data })
export const created = (data: unknown): Reply => ({ status: 201, data })

export const notFound = (what = 'Không tìm thấy dữ liệu.') => new MockHttpError(404, what)
export const conflict = (message: string) => new MockHttpError(409, message)

const REASONS: Record<number, string> = {
  400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found', 409: 'Conflict',
  500: 'Internal Server Error', 501: 'Not Implemented', 502: 'Bad Gateway',
}
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

export function successResponse(reply: Reply, nowMs: number): Response {
  return json(reply.status, { timestamp: new Date(nowMs).toISOString(), message: 'Request completed successfully', data: reply.data })
}

export function errorResponse(status: number, message: string, path: string, nowMs: number, fieldErrors?: Record<string, string>): Response {
  const hasFields = fieldErrors && Object.keys(fieldErrors).length > 0
  return json(status, { timestamp: new Date(nowMs).toISOString(), status, error: REASONS[status] ?? 'Error', message, path, ...(hasFields ? { fieldErrors } : {}) })
}

type Sortable = string | number | null | undefined
export interface PageRule<T> {
  sorts: Record<string, (row: T) => Sortable>
  defaultSort: string
  /** The endpoint has no sort parameter in the contract: the default order always applies. */
  fixedSort?: boolean
}

function compare(a: Sortable, b: Sortable): number {
  if (a === b) return 0
  if (a === null || a === undefined) return 1 // nulls last
  if (b === null || b === undefined) return -1
  return typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b), 'en')
}

function intParam(query: URLSearchParams, name: string, fallback: number, min: number, max: number): number {
  const raw = query.get(name)
  if (raw === null) return fallback
  const value = Number(raw)
  if (!/^-?\d+$/.test(raw) || value < min || value > max) {
    throw new MockHttpError(400, 'Tham số phân trang không hợp lệ.', { [name]: max === Infinity ? 'Phải là số nguyên không âm.' : `Phải từ ${min} đến ${max}.` })
  }
  return value
}

/** Server-side paging/sorting with Spring conventions: page 0-based, size 1..100, `field,dir`, UUID tie-break. */
export function paginate<T>(rows: T[], query: URLSearchParams, rule: PageRule<T>) {
  const page = intParam(query, 'page', 0, 0, Infinity)
  const size = intParam(query, 'size', 20, 1, 100)
  const [field, direction = 'asc', extra] = ((rule.fixedSort ? null : query.get('sort')) ?? rule.defaultSort).split(',')
  const pick = Object.hasOwn(rule.sorts, field) ? rule.sorts[field] : undefined
  if (!pick || extra !== undefined || !['asc', 'desc'].includes(direction.toLowerCase())) {
    throw new MockHttpError(400, 'Giá trị sắp xếp không hợp lệ.', { sort: 'Trường hoặc chiều sắp xếp không được hỗ trợ.' })
  }
  const sign = direction.toLowerCase() === 'desc' ? -1 : 1
  const idOf = (row: T) => String((row as { id?: unknown }).id ?? '')
  const sorted = [...rows].sort((a, b) => sign * compare(pick(a), pick(b)) || idOf(a).localeCompare(idOf(b)))
  return { content: sorted.slice(page * size, page * size + size), page, size, totalElements: sorted.length, totalPages: Math.ceil(sorted.length / size) }
}

/** Validates a JSON body the way the backend does: unknown fields rejected, per-field messages. */
export class Form {
  readonly errors: Record<string, string> = {}
  private readonly data: Record<string, unknown>

  constructor(body: unknown, allowed: readonly string[]) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new MockHttpError(400, 'Thiếu nội dung yêu cầu.')
    this.data = body as Record<string, unknown>
    for (const key of Object.keys(this.data)) if (!allowed.includes(key)) this.errors[key] = 'Trường này không được phép gửi.'
  }

  private fail<T>(field: string, message: string, fallback: T): T {
    this.errors[field] = message
    return fallback
  }

  text(field: string, max = 255): string {
    const value = this.data[field]
    if (typeof value !== 'string' || !value.trim()) return this.fail(field, 'Không được để trống.', '')
    return value.trim().length > max ? this.fail(field, `Tối đa ${max} ký tự.`, '') : value.trim()
  }

  optionalText(field: string, max = 255): string | null {
    const value = this.data[field]
    if (value === undefined || value === null) return null
    if (typeof value !== 'string') return this.fail(field, 'Giá trị không hợp lệ.', null)
    return value.length > max ? this.fail(field, `Tối đa ${max} ký tự.`, null) : value.trim() || null
  }

  email(field: string): string {
    const value = this.text(field, 254).toLowerCase()
    return value && !/^[^@\s]+@[^@\s]+$/.test(value) ? this.fail(field, 'Email không hợp lệ.', '') : value
  }

  password(field: string, min = 1): string {
    const value = this.data[field]
    if (typeof value !== 'string' || !value) return this.fail(field, 'Không được để trống.', '')
    if ([...value].length < min) return this.fail(field, `Tối thiểu ${min} ký tự.`, '')
    return value
  }

  integer(field: string, min: number, max: number): number {
    const value = this.data[field]
    if (typeof value !== 'number' || !Number.isInteger(value)) return this.fail(field, 'Phải là số nguyên.', 0)
    return value < min || value > max ? this.fail(field, `Phải từ ${min} đến ${max}.`, 0) : value
  }

  decimal(field: string, min: number, max: number): number {
    const value = this.data[field]
    if (typeof value !== 'number' || !Number.isFinite(value)) return this.fail(field, 'Phải là số.', 0)
    if (value < min || value > max) return this.fail(field, `Phải từ ${min} đến ${max}.`, 0)
    return Math.abs(Math.round(value * 100) - value * 100) > 1e-6 ? this.fail(field, 'Tối đa 2 chữ số thập phân.', 0) : value
  }

  oneOf<T extends string>(field: string, values: readonly T[]): T {
    const value = this.data[field]
    return values.includes(value as T) ? value as T : this.fail(field, `Phải là một trong: ${values.join(', ')}.`, values[0])
  }

  instant(field: string): number {
    const value = this.data[field]
    const parsed = typeof value === 'string' ? Date.parse(value) : NaN
    return Number.isFinite(parsed) ? parsed : this.fail(field, 'Thời gian không hợp lệ.', 0)
  }

  /** Records a cross-field rule failure. */
  reject(field: string, message: string) { this.errors[field] = message }

  done() {
    if (Object.keys(this.errors).length) throw new MockHttpError(400, 'Dữ liệu gửi lên chưa hợp lệ.', this.errors)
  }
}
