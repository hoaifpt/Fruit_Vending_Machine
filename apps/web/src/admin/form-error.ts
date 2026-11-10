// How a failed form submit is shown: errors beside the fields and/or one form-level message. Pure, so it is unit-tested.
import { ApiError } from '../api/client.ts'

export const CHECK_FIELDS = 'Vui lòng kiểm tra các trường được đánh dấu.'

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
 * Anything else shows the client's message (already generic for 401/403/5xx).
 */
export function describeFormFailure(error: unknown): FormFailure {
  if (error instanceof ValidationError) return { message: CHECK_FIELDS, fieldErrors: error.fieldErrors }
  if (error instanceof ApiError) {
    const fieldErrors = Object.keys(error.fieldErrors).length ? error.fieldErrors : undefined
    if (error.status === 409) return { message: error.message, fieldErrors }
    if (fieldErrors) return { message: CHECK_FIELDS, fieldErrors }
  }
  return { message: error instanceof Error ? error.message : 'Đã xảy ra lỗi. Vui lòng thử lại.' }
}
