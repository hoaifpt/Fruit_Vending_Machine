import { ApiError } from '../../api/client.ts'
import { authApi } from '../../api/resources.ts'
import { startSession } from '../../api/session.ts'
import type { Session } from '../../api/session.ts'

/** Logs in and stores the access token (memory + sessionStorage). Throws a user-readable Error on failure. */
export async function login(email: string, password: string, signal?: AbortSignal): Promise<Session> {
  try {
    const result = await authApi.login({ email: email.trim(), password })
    if (!result?.accessToken) throw new Error('Phản hồi đăng nhập không hợp lệ. Vui lòng liên hệ quản trị viên.')
    return startSession(result.accessToken)
  } catch (error) {
    if (signal?.aborted) throw new Error('Yêu cầu đã được hủy.')
    throw new Error(loginErrorMessage(error))
  }
}

export function loginErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401 || error.status === 403) return 'Email hoặc mật khẩu không đúng, hoặc tài khoản không còn hoạt động.'
    if (error.status === 400) return Object.values(error.fieldErrors)[0] ?? 'Thông tin đăng nhập không hợp lệ.'
    if (error.status === 429) return 'Bạn đã thử đăng nhập quá nhiều lần. Vui lòng chờ một lúc rồi thử lại.'
    if (error.status === 0 || error.status >= 500) return error.message
    return 'Hệ thống chưa thể xử lý đăng nhập. Vui lòng thử lại sau.'
  }
  return error instanceof Error ? error.message : 'Không thể đăng nhập. Vui lòng thử lại.'
}
