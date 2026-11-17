// How a failed form submit is shown: errors beside the fields and/or one form-level message. Pure, so it is unit-tested.
import { ApiError } from '../api/client.ts'

export { listFieldOf, normalizeFieldErrors, normalizeFieldKey } from '../api/field-errors.ts'

export const CHECK_FIELDS = 'Vui lòng kiểm tra các trường được đánh dấu.'
/**
 * Form-level line of a 400 that names no field the form shows (an unknown key, or only the backend's generic English
 * "Request validation failed"): said in Vietnamese with the next step, never the English text.
 */
export const INVALID_REQUEST = 'Dữ liệu gửi lên chưa hợp lệ. Kiểm tra lại các ô rồi gửi lại; nếu vẫn lỗi, hãy tải lại trang.'

/** Generic English messages of the backend's 400 handlers: they explain nothing on their own. */
const GENERIC_BAD_REQUEST = /^(request )?validation failed\.?$|missing or malformed|^malformed\b|^bad request\.?$|^invalid request\.?$/i
export function isGenericBadRequest(message: string): boolean {
  return GENERIC_BAD_REQUEST.test(message.trim())
}

/** Thrown by client-side validation before any request is sent. */
export class ValidationError extends Error {
  readonly fieldErrors: Record<string, string>
  constructor(fieldErrors: Record<string, string>) { super('Dữ liệu chưa hợp lệ.'); this.name = 'ValidationError'; this.fieldErrors = fieldErrors }
}

export interface FormFailure {
  /** Form-level alert. */
  message: string
  /** Per-field messages to show beside the fields, when there are any. */
  fieldErrors?: Record<string, string>
}

/**
 * 409 is a business conflict: its message says what went wrong (duplicate SKU, slot full…), so it is shown as is.
 * 400 with field errors (and client-side validation) points at the fields, with one generic line at form level.
 * When `fields` (the names the form shows) is given, only those are kept; a 400 whose field errors match none of them,
 * or a 400 with only the backend's generic English message, gets `INVALID_REQUEST`.
 * Anything else shows the client's message (already generic for 401/403/5xx).
 */
export function describeFormFailure(error: unknown, fields?: readonly string[]): FormFailure {
  if (error instanceof ValidationError) return { message: CHECK_FIELDS, fieldErrors: error.fieldErrors }
  if (error instanceof ApiError) {
    const all = Object.entries(error.fieldErrors)
    const shown = fields ? all.filter(([field]) => fields.includes(field)) : all
    const fieldErrors = shown.length ? Object.fromEntries(shown) : undefined
    if (error.status === 409) return { message: error.message, fieldErrors }
    if (fieldErrors) return { message: CHECK_FIELDS, fieldErrors }
    if (error.status === 400 && (all.length || isGenericBadRequest(error.message))) return { message: INVALID_REQUEST }
  }
  return { message: error instanceof Error ? error.message : 'Đã xảy ra lỗi. Vui lòng thử lại.' }
}

/** Code of a business 409 of the backend (`CODE: message`, e.g. STALE_VERSION), or undefined. */
export function errorCode(error: unknown): string | undefined {
  return error instanceof ApiError ? /^([A-Z][A-Z0-9_]{2,}):/.exec(error.message)?.[1] : undefined
}
