// Rules of the Accounts screen (A2) that do not need React: URL filters, request bodies limited to the contract fields,
// client-side checks, when the lock button is refused and Vietnamese wording of the backend conflicts. Unit-tested.
// Contract: api-contract/api.yaml (listUsers, createStaff, updateUser, updateUserStatus); rules: docs/user-management.md.
import { ApiError } from '../api/client.ts'
import { ValidationError } from './form-error.ts'
import type { components } from '../api/schema'
import { oneOf } from '../lib/table-query.ts'

type S = components['schemas']
export type UserStatus = S['UserResponse']['status']
export type CreateUserBody = S['CreateUserRequest']
export type UpdateUserBody = S['UpdateUserRequest']

/** Filter vocabularies of GET /users. The endpoint has no `sort` parameter: order is always createdAt desc, id asc. */
export const USER_STATUSES = ['ACTIVE', 'INACTIVE', 'LOCKED'] as const
export const USER_ROLES = ['ADMIN', 'STAFF'] as const
export const USER_FILTER_KEYS = ['status', 'role'] as const

/** Limits of CreateUserRequest / UpdateUserRequest. */
export const LIMITS = { email: 254, fullName: 200, phone: 32, passwordBytes: 72, passwordMinDefault: 12 } as const

export interface UserFilters { status: string; role: string; page: number }

/** Reads the list filters from the URL; unknown values are dropped so hand-edited URLs never reach the API as a 400. */
export function readUserFilters(params: URLSearchParams): UserFilters {
  const rawPage = Number(params.get('page') ?? 0)
  return {
    status: oneOf(params.get('status'), USER_STATUSES),
    role: oneOf(params.get('role'), USER_ROLES),
    page: Number.isInteger(rawPage) && rawPage > 0 ? rawPage : 0,
  }
}

/** Query of GET /users: only page, size, status, role (the contract's parameters). */
export function userListQuery(filters: UserFilters, size: number) {
  return {
    page: filters.page, size,
    status: (filters.status || undefined) as UserStatus | undefined,
    role: (filters.role || undefined) as 'ADMIN' | 'STAFF' | undefined,
  }
}

/** Query that counts ACTIVE accounts holding ADMIN: one row is enough, `totalElements` is the count. */
export const ACTIVE_ADMIN_QUERY = { page: 0, size: 1, status: 'ACTIVE', role: 'ADMIN' } as const

export function hasRole(user: Pick<S['UserResponse'], 'roles'>, role: 'ADMIN' | 'STAFF'): boolean {
  return user.roles.some(name => name.replace(/^ROLE_/, '') === role)
}

/** Who is signed in, from the session (JWT `sub` is the account UUID; the email is a fallback for older tokens). */
export interface Actor { id?: string; email?: string }

export function isSelf(user: Pick<S['UserResponse'], 'id' | 'email'>, actor: Actor | null | undefined): boolean {
  if (!actor) return false
  if (actor.id && actor.id === user.id) return true
  return !!actor.email && actor.email.trim().toLowerCase() === user.email.trim().toLowerCase()
}

export type LockBlock = 'self' | 'lastAdmin'
export const LOCK_BLOCK_TEXT: Record<LockBlock, string> = {
  self: 'Không thể khóa chính bạn.',
  lastAdmin: 'Đây là Quản trị viên đang hoạt động cuối cùng.',
}

/**
 * Why "Khóa" is refused for `target` (empty: allowed). Mirrors the 409 rules of PATCH /users/{id}/status:
 * no self-disable/lock, and the last ACTIVE ADMIN cannot be disabled or locked.
 * `activeAdminCount` is the total from GET /users?status=ACTIVE&role=ADMIN; while it is unknown (loading, failed)
 * only the self rule applies and the backend's 409 remains the safety net.
 */
export function lockBlocks(target: Pick<S['UserResponse'], 'id' | 'email' | 'status' | 'roles'>, actor: Actor | null | undefined, activeAdminCount: number | undefined): LockBlock[] {
  if (target.status !== 'ACTIVE') return []
  const blocks: LockBlock[] = []
  if (isSelf(target, actor)) blocks.push('self')
  if (hasRole(target, 'ADMIN') && activeAdminCount !== undefined && activeAdminCount <= 1) blocks.push('lastAdmin')
  return blocks
}

export function lockBlockReason(blocks: readonly LockBlock[]): string {
  return blocks.map(block => LOCK_BLOCK_TEXT[block]).join(' ')
}

/** The status action offered on a row: lock an active account, or bring a locked/inactive one back. */
export type StatusAction = { kind: 'lock' } | { kind: 'activate'; label: string }
export function statusAction(status: UserStatus): StatusAction {
  if (status === 'ACTIVE') return { kind: 'lock' }
  return { kind: 'activate', label: status === 'LOCKED' ? 'Mở khóa' : 'Kích hoạt lại' }
}

export interface CreateUserValues { email: string; password: string; fullName: string; phone: string }
export interface UpdateUserValues { fullName: string; phone: string }

const utf8Bytes = (text: string) => new TextEncoder().encode(text).length

/**
 * Checks the backend would also make, so the user sees them beside the fields without a round trip.
 * The password minimum is a server setting (PASSWORD_MIN_LENGTH, 8–72, default 12), so only "not empty" and the
 * 72-byte BCrypt limit are checked here; a shorter password comes back as a 400 under the field.
 */
export function validateCreateUser(values: CreateUserValues): Record<string, string> {
  const errors: Record<string, string> = {}
  const email = values.email.trim()
  if (!email) errors.email = 'Vui lòng nhập email.'
  else if (email.length > LIMITS.email) errors.email = `Email tối đa ${LIMITS.email} ký tự.`
  else if (!/^[^\s@]+@[^\s@]+$/.test(email)) errors.email = 'Email chưa đúng định dạng, ví dụ ten@congty.vn.'
  if (!values.password) errors.password = 'Vui lòng nhập mật khẩu.'
  else if (!values.password.trim()) errors.password = 'Mật khẩu không được chỉ gồm khoảng trắng.'
  else if (utf8Bytes(values.password) > LIMITS.passwordBytes) errors.password = `Mật khẩu quá dài (tối đa ${LIMITS.passwordBytes} byte, chữ có dấu tính 2–3 byte).`
  Object.assign(errors, validateProfile(values))
  return errors
}

export function validateUpdateUser(values: UpdateUserValues): Record<string, string> {
  return validateProfile(values)
}

function validateProfile(values: UpdateUserValues): Record<string, string> {
  const errors: Record<string, string> = {}
  const fullName = values.fullName.trim()
  if (!fullName) errors.fullName = 'Vui lòng nhập họ tên.'
  else if (fullName.length > LIMITS.fullName) errors.fullName = `Họ tên tối đa ${LIMITS.fullName} ký tự.`
  if (values.phone.trim().length > LIMITS.phone) errors.phone = `Số điện thoại tối đa ${LIMITS.phone} ký tự.`
  return errors
}

/** POST /users body: exactly email, password, fullName and (when given) phone. The password is sent unmodified. */
export function createUserBody(values: CreateUserValues): CreateUserBody {
  const body: CreateUserBody = { email: values.email.trim(), password: values.password, fullName: values.fullName.trim() }
  const phone = values.phone.trim()
  if (phone) body.phone = phone
  return body
}

/** PUT /users/{id} body: fullName and phone only. PUT replaces, so an empty phone is sent as null (clears it). */
export function updateUserBody(values: UpdateUserValues): UpdateUserBody {
  return { fullName: values.fullName.trim(), phone: values.phone.trim() || null }
}

const SELF_CONFLICT = /own account|chính mình|chính bạn/i
const LAST_ADMIN_CONFLICT = /last active admin(istrator)?|cuối cùng/i

export const STATUS_CONFLICT_TEXT = {
  self: 'Không thể khóa hoặc ngừng hoạt động tài khoản của chính bạn. Hãy nhờ một Quản trị viên khác nếu cần.',
  lastAdmin: 'Đây là Quản trị viên đang hoạt động cuối cùng. Hãy kích hoạt hoặc nhờ cấp thêm một Quản trị viên khác trước khi khóa tài khoản này.',
} as const
export const EMAIL_TAKEN = 'Email này đã được dùng cho một tài khoản khác. Hãy dùng email khác.'

/**
 * A 409 from PATCH /users/{id}/status in Vietnamese (the backend answers in English). Other errors are returned as is.
 * An unrecognised conflict keeps its own message: it still says what went wrong.
 */
export function describeStatusError(error: unknown): unknown {
  if (!(error instanceof ApiError) || error.status !== 409) return error
  if (SELF_CONFLICT.test(error.message)) return new ApiError(409, STATUS_CONFLICT_TEXT.self)
  if (LAST_ADMIN_CONFLICT.test(error.message)) return new ApiError(409, STATUS_CONFLICT_TEXT.lastAdmin)
  return error
}

/**
 * A 409 from POST /users means a taken email, reported once: in Vietnamese under the email field, with the usual
 * "check the marked fields" line at form level (as for a 400), not the same sentence twice.
 * `email` is the only unique column of `users` the form fills (V1 migration; the role link is set by the server), so
 * both the service check ("Email is already in use") and the constraint hit by two simultaneous creates ("Request
 * conflicts with existing data") mean the same thing, as for SKU (products.ts) and machine code (machines.ts).
 */
export function describeCreateError(error: unknown): unknown {
  if (!(error instanceof ApiError) || error.status !== 409) return error
  return new ValidationError({ email: EMAIL_TAKEN })
}
