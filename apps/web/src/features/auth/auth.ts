import { ApiError } from '../../api/client.ts'
import { authApi } from '../../api/resources.ts'
import { safeNext, startSession } from '../../api/session.ts'
import type { Session } from '../../api/session.ts'

export type LoginField = 'email' | 'password'
export type LoginFieldErrors = Partial<Record<LoginField, string>>

/**
 * What the login form shows for a failure: a form-level message (may be empty when every problem sits on a field),
 * per-field messages, and where focus should go so keyboard and screen-reader users land on the problem.
 */
export interface LoginFailure { message: string; fieldErrors: LoginFieldErrors; focus: LoginField | 'form' }

/** Thrown by `login`; `message` stays user-readable so callers that only read `message` keep working. */
export class LoginError extends Error {
  readonly failure: LoginFailure
  constructor(failure: LoginFailure) {
    super(failure.message || Object.values(failure.fieldErrors)[0] || 'Không thể đăng nhập. Vui lòng thử lại.')
    this.name = 'LoginError'
    this.failure = failure
  }
}

/** Logs in and stores the access token (memory + sessionStorage). Throws a `LoginError` on failure. */
export async function login(email: string, password: string, signal?: AbortSignal): Promise<Session> {
  try {
    const result = await authApi.login({ email: email.trim(), password })
    if (!result?.accessToken) throw new Error('Phản hồi đăng nhập không hợp lệ. Vui lòng liên hệ quản trị viên.')
    return startSession(result.accessToken)
  } catch (error) {
    if (signal?.aborted) throw new LoginError({ message: 'Yêu cầu đã được hủy.', fieldErrors: {}, focus: 'form' })
    throw new LoginError(describeLoginError(error))
  }
}

export function loginErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    // The contract returns one generic 401 for unknown email, wrong password, INACTIVE and LOCKED accounts.
    if (error.status === 401 || error.status === 403) return 'Email hoặc mật khẩu không đúng, hoặc tài khoản không còn hoạt động.'
    if (error.status === 400) return Object.values(error.fieldErrors)[0] ?? 'Thông tin đăng nhập không hợp lệ.'
    if (error.status === 429) return 'Bạn đã thử đăng nhập quá nhiều lần. Vui lòng chờ một lúc rồi thử lại.'
    if (error.status === 0 || error.status >= 500) return error.message
    return 'Hệ thống chưa thể xử lý đăng nhập. Vui lòng thử lại sau.'
  }
  return error instanceof Error ? error.message : 'Không thể đăng nhập. Vui lòng thử lại.'
}

/** Backend field messages are English validation text; the form shows its own wording per field. */
const FIELD_MESSAGES: Record<LoginField, string> = {
  email: 'Email chưa đúng định dạng. Kiểm tra lại, ví dụ ten@congty.vn.',
  password: 'Mật khẩu quá dài hoặc không hợp lệ. Kiểm tra lại mật khẩu đã nhập.',
}

/** Maps a login failure to what the form shows. Never reveals whether the account exists. */
export function describeLoginError(error: unknown): LoginFailure {
  if (error instanceof ApiError) {
    if (error.status === 401 || error.status === 403) return { message: loginErrorMessage(error), fieldErrors: {}, focus: 'password' }
    if (error.status === 400) {
      const fieldErrors: LoginFieldErrors = {}
      for (const field of ['email', 'password'] as const) if (error.fieldErrors[field]) fieldErrors[field] = FIELD_MESSAGES[field]
      const first = (['email', 'password'] as const).find(field => fieldErrors[field])
      if (first) return { message: '', fieldErrors, focus: first }
      return { message: 'Thông tin đăng nhập không hợp lệ. Kiểm tra lại email và mật khẩu.', fieldErrors: {}, focus: 'form' }
    }
  }
  return { message: loginErrorMessage(error), fieldErrors: {}, focus: 'form' }
}

/** Password limit from the contract: at most 72 characters and 72 UTF-8 bytes. */
const MAX_PASSWORD_BYTES = 72
/** Loose shape check; the backend has the final say (it answers 400 with fieldErrors.email). */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+$/

/** Client-side checks before sending. The password is checked as typed: it is never trimmed. */
export function validateLogin(email: string, password: string): LoginFieldErrors {
  const errors: LoginFieldErrors = {}
  const trimmed = email.trim()
  if (!trimmed) errors.email = 'Vui lòng nhập email.'
  else if (!EMAIL_SHAPE.test(trimmed)) errors.email = FIELD_MESSAGES.email
  if (!password.trim()) errors.password = 'Vui lòng nhập mật khẩu.'
  else if (new TextEncoder().encode(password).length > MAX_PASSWORD_BYTES) errors.password = FIELD_MESSAGES.password
  return errors
}

/**
 * The page to return to after login when the URL carries a valid `next` (set by the 401/expiry redirect and by opening
 * an /admin page while signed out); null otherwise. Uses the same sanitising as `safeNext`, never a looser check.
 */
export function returnTarget(search: string): string | null {
  const next = new URLSearchParams(search).get('next')
  return next && safeNext(next) === next ? next : null
}
