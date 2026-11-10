// Management web routes. Each route and nav item names the permission it needs; who holds which permission is
// decided only in permissions.ts. Pure data so it can be unit-tested; the backend still enforces every call.
import type { Role } from '../api/session.ts'
import { can, rolesWith } from './permissions.ts'
import type { Permission, Subject } from './permissions.ts'

export type PageKey =
  | 'users' | 'products' | 'machines' | 'machine-detail' | 'batches' | 'inventory' | 'inventory-history'
  | 'orders' | 'order-detail' | 'payments' | 'payment-detail' | 'webhook-logs' | 'webhook-log-detail'

/** `roles` lists the roles that hold `permission` today (derived, for display and older callers). */
export interface RouteMatch { page: PageKey; id?: string; permission: Permission; roles: readonly Role[] }

const ROUTES: { pattern: RegExp; page: PageKey; permission: Permission }[] = [
  { pattern: /^\/admin\/users$/, page: 'users', permission: 'users:manage' },
  { pattern: /^\/admin\/products$/, page: 'products', permission: 'products:read' },
  { pattern: /^\/admin\/machines$/, page: 'machines', permission: 'machines:read' },
  { pattern: /^\/admin\/machines\/([^/]+)$/, page: 'machine-detail', permission: 'machines:read' },
  { pattern: /^\/admin\/batches$/, page: 'batches', permission: 'batches:write' },
  { pattern: /^\/admin\/inventory$/, page: 'inventory', permission: 'inventory:write' },
  { pattern: /^\/admin\/inventory\/history$/, page: 'inventory-history', permission: 'inventory:write' },
  { pattern: /^\/admin\/orders$/, page: 'orders', permission: 'orders:read' },
  { pattern: /^\/admin\/orders\/([^/]+)$/, page: 'order-detail', permission: 'orders:read' },
  { pattern: /^\/admin\/payments$/, page: 'payments', permission: 'payments:read' },
  { pattern: /^\/admin\/payments\/([^/]+)$/, page: 'payment-detail', permission: 'payments:read' },
  { pattern: /^\/admin\/webhook-logs$/, page: 'webhook-logs', permission: 'webhook-logs:read' },
  { pattern: /^\/admin\/webhook-logs\/([^/]+)$/, page: 'webhook-log-detail', permission: 'webhook-logs:read' },
]

export function matchRoute(pathname: string): RouteMatch | undefined {
  const path = pathname.replace(/\/+$/, '') || '/'
  for (const route of ROUTES) {
    const match = route.pattern.exec(path)
    if (match) return { page: route.page, id: match[1] ? decodeURIComponent(match[1]) : undefined, permission: route.permission, roles: rolesWith(route.permission) }
  }
  return undefined
}

export type NavGroup = 'Vận hành' | 'Giao dịch' | 'Hệ thống'
export interface NavItem { to: string; label: string; group: NavGroup; permission: Permission; match: PageKey[] }

export const NAV: NavItem[] = [
  { to: '/admin/machines', label: 'Máy bán hàng', group: 'Vận hành', permission: 'machines:read', match: ['machines', 'machine-detail'] },
  { to: '/admin/products', label: 'Sản phẩm', group: 'Vận hành', permission: 'products:read', match: ['products'] },
  { to: '/admin/batches', label: 'Lô hàng', group: 'Vận hành', permission: 'batches:write', match: ['batches'] },
  { to: '/admin/inventory', label: 'Tồn kho', group: 'Vận hành', permission: 'inventory:write', match: ['inventory', 'inventory-history'] },
  { to: '/admin/orders', label: 'Đơn hàng', group: 'Giao dịch', permission: 'orders:read', match: ['orders', 'order-detail'] },
  { to: '/admin/payments', label: 'Thanh toán', group: 'Giao dịch', permission: 'payments:read', match: ['payments', 'payment-detail'] },
  { to: '/admin/webhook-logs', label: 'Webhook thanh toán', group: 'Giao dịch', permission: 'webhook-logs:read', match: ['webhook-logs', 'webhook-log-detail'] },
  { to: '/admin/users', label: 'Tài khoản', group: 'Hệ thống', permission: 'users:manage', match: ['users'] },
]

/** Breadcrumb trail for a route: group, section (linked) and, on detail screens, the record level. */
export function breadcrumbFor(route: RouteMatch | undefined): { label: string; to?: string }[] {
  if (!route) return []
  const item = NAV.find(entry => entry.match.includes(route.page))
  if (!item) return []
  const detail = route.page === 'inventory-history' ? 'Lịch sử' : route.id ? 'Chi tiết' : undefined
  return [{ label: item.group }, { label: item.label, to: detail ? item.to : undefined }, ...(detail ? [{ label: detail }] : [])]
}

/** Whether the user's roles include one of `required` (kept for older callers; prefer `canOpen`). */
export function canAccess(userRoles: readonly Role[], required: readonly Role[]): boolean {
  return required.some(role => userRoles.includes(role))
}
/** Route guard: decided before the screen mounts, so a forbidden screen never calls the API. */
export function canOpen(subject: Subject | readonly Role[], route: Pick<RouteMatch, 'permission'>): boolean {
  return can(subject, route.permission)
}
export function navFor(subject: Subject | readonly Role[]): NavItem[] {
  return NAV.filter(item => can(subject, item.permission))
}
/** Landing route after login or when visiting /admin. */
export function homeFor(subject: Subject | readonly Role[]): string {
  return navFor(subject)[0]?.to ?? '/login'
}
