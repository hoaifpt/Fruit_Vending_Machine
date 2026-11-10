// Rules of screen A3 "Vai trò & quyền" (issue FE 3.2), pure so they are unit-tested. API: backend #48, draft contract
// api-contract/drafts/roles-permissions.yaml. A role is a set of permission codes; PUT /roles/{id}/permissions replaces
// the whole set of ONE role, so "Lưu" sends one PUT per role that changed (only those), each with its complete new set.
import { ApiError } from '../api/client.ts'
import type { PermissionInfo, RoleWithPermissions } from '../api/resources.ts'

/** Same wording as LABELS in kit.tsx (kept here so this module stays free of React for the Node tests). */
const ROLE_LABELS: Readonly<Record<string, string>> = { ADMIN: 'Quản trị viên', STAFF: 'Nhân viên' }

/** RolePermissionService of #48: the ADMIN role must always keep these two (else 409), so nobody gets locked out. */
export const ADMIN_REQUIRED: readonly string[] = ['PERMISSION_MANAGE', 'USER_WRITE']

export interface PermissionGroupDef { key: string; label: string; codes: readonly string[]; prefixes: readonly string[] }

/**
 * Groups of docs/permission-authorization.md (#48). The API has no group field, so known codes are placed here and a
 * code added by a later migration joins the group of its prefix (PRODUCT_EXPORT → Sản phẩm) or a group of its own.
 */
export const PERMISSION_GROUPS: readonly PermissionGroupDef[] = [
  { key: 'users', label: 'Tài khoản & phân quyền', codes: ['USER_READ', 'USER_WRITE', 'PERMISSION_MANAGE'], prefixes: ['USER', 'PERMISSION', 'ROLE'] },
  { key: 'products', label: 'Sản phẩm', codes: ['PRODUCT_READ', 'PRODUCT_WRITE'], prefixes: ['PRODUCT'] },
  { key: 'machines', label: 'Máy, ngăn & khóa kiosk', codes: ['MACHINE_READ', 'MACHINE_WRITE', 'KIOSK_CREDENTIAL_MANAGE'], prefixes: ['MACHINE', 'SLOT', 'KIOSK'] },
  { key: 'batches', label: 'Lô hàng', codes: ['BATCH_READ', 'BATCH_CREATE'], prefixes: ['BATCH'] },
  { key: 'inventory', label: 'Tồn kho', codes: ['INVENTORY_READ', 'INVENTORY_WRITE'], prefixes: ['INVENTORY'] },
  { key: 'orders', label: 'Đơn hàng', codes: ['ORDER_READ'], prefixes: ['ORDER'] },
  { key: 'payments', label: 'Thanh toán', codes: ['PAYMENT_READ', 'PAYMENT_WEBHOOK_LOG_READ'], prefixes: ['PAYMENT', 'WEBHOOK'] },
]

/** Vietnamese names of the 15 codes of V13; unknown codes fall back to the backend description, then the code. */
export const PERMISSION_LABELS: Readonly<Record<string, string>> = {
  USER_READ: 'Xem tài khoản',
  USER_WRITE: 'Tạo, sửa, khóa/mở tài khoản',
  PERMISSION_MANAGE: 'Xem và đổi quyền của vai trò',
  PRODUCT_READ: 'Xem sản phẩm',
  PRODUCT_WRITE: 'Tạo, sửa, đổi trạng thái sản phẩm',
  MACHINE_READ: 'Xem máy và ngăn',
  MACHINE_WRITE: 'Tạo, sửa, đổi trạng thái máy và ngăn',
  KIOSK_CREDENTIAL_MANAGE: 'Cấp, xem, thu hồi khóa kiosk',
  BATCH_READ: 'Xem lô hàng',
  BATCH_CREATE: 'Tạo lô hàng',
  INVENTORY_READ: 'Xem tồn kho, tóm tắt và lịch sử',
  INVENTORY_WRITE: 'Nạp hộp vào ngăn, gỡ hộp',
  ORDER_READ: 'Xem đơn hàng',
  PAYMENT_READ: 'Xem thanh toán',
  PAYMENT_WEBHOOK_LOG_READ: 'Xem nhật ký webhook thanh toán',
}

export function permissionLabel(code: string, description?: string | null): string {
  return PERMISSION_LABELS[code] ?? (description?.trim() || code)
}
export function roleLabel(name: string | undefined): string {
  const plain = (name ?? '').replace(/^ROLE_/, '')
  return ROLE_LABELS[plain] ?? (plain || 'Vai trò chưa đặt tên')
}

export interface PermissionRow { code: string; label: string; description: string }
export interface PermissionGroup { key: string; label: string; permissions: PermissionRow[] }

const prefixOf = (code: string) => code.split('_')[0] ?? code

/** Catalog → groups in PERMISSION_GROUPS order, known codes in their listed order, then others by code. Empty groups are dropped. */
export function groupPermissions(catalog: readonly PermissionInfo[]): PermissionGroup[] {
  const groups = new Map<string, PermissionGroup & { order: (code: string) => number }>()
  for (const def of PERMISSION_GROUPS) groups.set(def.key, { key: def.key, label: def.label, permissions: [], order: code => { const index = def.codes.indexOf(code); return index < 0 ? def.codes.length : index } })
  const seen = new Set<string>()
  for (const item of catalog) {
    const code = item.code?.trim()
    if (!code || seen.has(code)) continue
    seen.add(code)
    const def = PERMISSION_GROUPS.find(group => group.codes.includes(code)) ?? PERMISSION_GROUPS.find(group => group.prefixes.includes(prefixOf(code)))
    const key = def?.key ?? `other:${prefixOf(code)}`
    if (!groups.has(key)) groups.set(key, { key, label: `Nhóm ${prefixOf(code)}`, permissions: [], order: () => 0 })
    groups.get(key)!.permissions.push({ code, label: permissionLabel(code, item.description), description: item.description ?? '' })
  }
  return [...groups.values()].filter(group => group.permissions.length).map(({ order, ...group }) => ({
    ...group,
    permissions: [...group.permissions].sort((a, b) => order(a.code) - order(b.code) || a.code.localeCompare(b.code, 'en')),
  }))
}

/** Roles in a stable order: ADMIN, STAFF, then others by name (the backend sorts by name too). */
export function sortRoles(roles: readonly RoleWithPermissions[]): RoleWithPermissions[] {
  const rank = (name = '') => (name === 'ADMIN' ? 0 : name === 'STAFF' ? 1 : 2)
  return roles.filter(role => !!role.id).sort((a, b) => rank(a.name) - rank(b.name) || (a.name ?? '').localeCompare(b.name ?? '', 'en'))
}

/** roleId → sorted codes. The draft the screen edits starts as a copy of this. */
export type Grants = Readonly<Record<string, readonly string[]>>

export function grantsOf(roles: readonly RoleWithPermissions[]): Record<string, string[]> {
  const grants: Record<string, string[]> = {}
  for (const role of roles) if (role.id) grants[role.id] = normalizeCodes(role.permissions ?? [])
  return grants
}

/** Same roles with the same codes (order-insensitive). */
export function sameGrants(a: Grants, b: Grants): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  for (const key of keys) if (normalizeCodes(a[key] ?? []).join(',') !== normalizeCodes(b[key] ?? []).join(',')) return false
  return true
}

/** Sorted, unique, trimmed, no blanks: the backend rejects duplicates (400) and returns codes sorted. */
export function normalizeCodes(codes: readonly string[]): string[] {
  return [...new Set(codes.map(code => code.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'en'))
}

export function hasGrant(grants: Grants, roleId: string, code: string): boolean {
  return grants[roleId]?.includes(code) ?? false
}

/** New draft with one cell changed; the other roles keep their arrays (cheap re-render checks). */
export function toggleGrant(grants: Grants, roleId: string, code: string, on: boolean): Record<string, string[]> {
  const current = grants[roleId] ?? []
  const next = on ? normalizeCodes([...current, code]) : current.filter(item => item !== code)
  return { ...grants, [roleId]: next } as Record<string, string[]>
}

/**
 * Why a cell cannot be unticked, or undefined. Only the #48 lockout guard: ADMIN keeps USER_WRITE and PERMISSION_MANAGE.
 * A required code ADMIN does not hold (should not happen) stays tickable so the user can repair it.
 */
export function lockReason(roleName: string | undefined, code: string, granted: boolean): string | undefined {
  if (roleName !== 'ADMIN' || !granted || !ADMIN_REQUIRED.includes(code)) return undefined
  return 'Quản trị viên luôn giữ quyền này để không ai mất quyền quản trị.'
}

export interface RoleChange { roleId: string; roleName: string; added: string[]; removed: string[] }

/** Per role, what the draft adds and removes compared with the saved state. Unchanged roles are left out. */
export function diffGrants(roles: readonly RoleWithPermissions[], saved: Grants, draft: Grants): RoleChange[] {
  const changes: RoleChange[] = []
  for (const role of roles) {
    if (!role.id) continue
    const before = new Set(saved[role.id] ?? []), after = new Set(draft[role.id] ?? [])
    const added = [...after].filter(code => !before.has(code)).sort()
    const removed = [...before].filter(code => !after.has(code)).sort()
    if (added.length || removed.length) changes.push({ roleId: role.id, roleName: role.name ?? '', added, removed })
  }
  return changes
}

export function changeCount(changes: readonly RoleChange[]): number {
  return changes.reduce((total, change) => total + change.added.length + change.removed.length, 0)
}

/** 'added' | 'removed' when the cell differs from the saved state. */
export function cellChange(saved: Grants, draft: Grants, roleId: string, code: string): 'added' | 'removed' | undefined {
  const was = hasGrant(saved, roleId, code), is = hasGrant(draft, roleId, code)
  return was === is ? undefined : is ? 'added' : 'removed'
}

/** Body of PUT /roles/{id}/permissions: the role's complete new set and nothing else (the backend rejects other fields). */
export function replaceBody(codes: readonly string[]): { permissions: string[] } {
  return { permissions: normalizeCodes(codes) }
}

/** Roles whose server set no longer matches what the screen loaded (someone else saved meanwhile): saving would overwrite it. */
export function staleRoles(changes: readonly RoleChange[], saved: Grants, server: readonly RoleWithPermissions[]): RoleChange[] {
  return changes.filter(change => {
    const current = server.find(role => role.id === change.roleId)
    if (!current) return true
    return normalizeCodes(current.permissions ?? []).join(',') !== normalizeCodes(saved[change.roleId] ?? []).join(',')
  })
}

/** One readable line per role: "Nhân viên: thêm Xem thanh toán; bỏ Xem đơn hàng." */
export function describeChange(change: RoleChange, labelOf: (code: string) => string = code => permissionLabel(code)): string {
  const parts: string[] = []
  if (change.added.length) parts.push(`thêm ${change.added.map(labelOf).join(', ')}`)
  if (change.removed.length) parts.push(`bỏ ${change.removed.map(labelOf).join(', ')}`)
  return `${roleLabel(change.roleName)}: ${parts.join('; ') || 'không đổi'}.`
}

export function describeChanges(changes: readonly RoleChange[], labelOf?: (code: string) => string): string {
  return changes.length ? changes.map(change => describeChange(change, labelOf)).join(' ') : 'Không có quyền nào thay đổi.'
}

/** Permission codes named in a 400 fieldErrors.permissions ("Unknown codes: A, B"). */
export function codesInFieldError(text: string | undefined): string[] {
  return [...new Set((text ?? '').match(/\b[A-Z][A-Z0-9_]{2,63}\b/g) ?? [])]
}

export const ROLE_SAVE_TEXT = {
  adminRequired: 'Vai trò Quản trị viên phải luôn giữ quyền “Tạo, sửa, khóa/mở tài khoản” và “Xem và đổi quyền của vai trò”. Hãy chọn lại hai quyền này rồi lưu.',
  unknown: (codes: string[]) => `Máy chủ không còn nhận quyền ${codes.join(', ') || 'đã chọn'}: danh mục quyền vừa thay đổi. Hãy tải lại dữ liệu rồi chọn lại.`,
  duplicate: 'Danh sách quyền gửi lên bị trùng. Hãy tải lại trang rồi thử lại.',
  invalid: 'Dữ liệu gửi lên chưa hợp lệ. Hãy tải lại dữ liệu rồi thử lại.',
  notFound: 'Vai trò này không còn trên máy chủ. Hãy tải lại dữ liệu.',
  conflict: 'Máy chủ từ chối vì quyền của vai trò này xung đột với dữ liệu hiện tại. Hãy tải lại dữ liệu rồi thử lại.',
  stale: 'Quyền của vai trò này vừa được thay đổi ở nơi khác sau khi bạn mở trang. Hãy tải lại dữ liệu để xem bản mới nhất rồi chọn lại; thay đổi của bạn chưa được lưu.',
} as const

/** Message for a failed PUT of one role (401/403/5xx keep the client's generic message). */
export function describeSaveError(error: unknown, roleName: string): string {
  const role = roleLabel(roleName)
  if (error instanceof ApiError) {
    // #48 only sends 409 for the ADMIN guard; any other conflict gets a generic Vietnamese line (backend text is English).
    if (error.status === 409) return roleName === 'ADMIN' ? ROLE_SAVE_TEXT.adminRequired : `${role}: ${ROLE_SAVE_TEXT.conflict}`
    if (error.status === 404) return `${role}: ${ROLE_SAVE_TEXT.notFound}`
    if (error.status === 400) {
      const field = error.fieldErrors.permissions
      if (field?.startsWith('Unknown')) return `${role}: ${ROLE_SAVE_TEXT.unknown(codesInFieldError(field))}`
      if (field?.startsWith('Duplicate')) return `${role}: ${ROLE_SAVE_TEXT.duplicate}`
      return `${role}: ${ROLE_SAVE_TEXT.invalid}`
    }
    return error.message
  }
  return error instanceof Error ? error.message : 'Đã xảy ra lỗi. Vui lòng thử lại.'
}
