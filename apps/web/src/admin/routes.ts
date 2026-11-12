// Management web routes. Each route and nav item names the permission it needs; who holds which permission is
// decided only in permissions.ts. Pure data so it can be unit-tested; the backend still enforces every call.
import type { Role } from '../api/session.ts'
import { can, rolesWith } from './permissions.ts'
import type { Permission, Subject } from './permissions.ts'

export type PageKey =
  | 'overview' | 'users' | 'products' | 'machines' | 'machine-detail' | 'batches' | 'inventory' | 'inventory-history'
  | 'orders' | 'order-detail' | 'payments' | 'payment-detail' | 'webhook-logs' | 'webhook-log-detail' | 'roles'
  | 'alerts' | 'alert-detail' | 'tickets' | 'ticket-detail' | 'maintenance-schedules'

/** `roles` lists the roles that hold `permission` today (derived, for display and older callers). */
export interface RouteMatch { page: PageKey; id?: string; permission: Permission; roles: readonly Role[] }

const ROUTES: { pattern: RegExp; page: PageKey; permission: Permission }[] = [
  // O1 (FE 6.5): MACHINE_READ for the page; each block checks its own source's permission (overview.ts).
  { pattern: /^\/admin\/overview$/, page: 'overview', permission: 'MACHINE_READ' },
  { pattern: /^\/admin\/users$/, page: 'users', permission: 'USER_READ' },
  { pattern: /^\/admin\/roles$/, page: 'roles', permission: 'PERMISSION_MANAGE' },
  { pattern: /^\/admin\/products$/, page: 'products', permission: 'PRODUCT_READ' },
  { pattern: /^\/admin\/machines$/, page: 'machines', permission: 'MACHINE_READ' },
  { pattern: /^\/admin\/machines\/([^/]+)$/, page: 'machine-detail', permission: 'MACHINE_READ' },
  { pattern: /^\/admin\/batches$/, page: 'batches', permission: 'BATCH_READ' },
  { pattern: /^\/admin\/inventory$/, page: 'inventory', permission: 'INVENTORY_READ' },
  { pattern: /^\/admin\/inventory\/history$/, page: 'inventory-history', permission: 'INVENTORY_READ' },
  { pattern: /^\/admin\/alerts$/, page: 'alerts', permission: 'ALERT_READ' },
  { pattern: /^\/admin\/alerts\/([^/]+)$/, page: 'alert-detail', permission: 'ALERT_READ' },
  // O3 (FE 7.1): draft permission of api-contract/drafts/work-tickets.yaml; staff only receive their own tickets.
  { pattern: /^\/admin\/tickets$/, page: 'tickets', permission: 'TICKET_READ' },
  { pattern: /^\/admin\/tickets\/([^/]+)$/, page: 'ticket-detail', permission: 'TICKET_READ' },
  // O5 (FE 7.3): draft permission of api-contract/drafts/maintenance-schedules.yaml; changes need MAINTENANCE_SCHEDULE_WRITE.
  { pattern: /^\/admin\/maintenance-schedules$/, page: 'maintenance-schedules', permission: 'MAINTENANCE_SCHEDULE_READ' },
  { pattern: /^\/admin\/orders$/, page: 'orders', permission: 'ORDER_READ' },
  { pattern: /^\/admin\/orders\/([^/]+)$/, page: 'order-detail', permission: 'ORDER_READ' },
  { pattern: /^\/admin\/payments$/, page: 'payments', permission: 'PAYMENT_READ' },
  { pattern: /^\/admin\/payments\/([^/]+)$/, page: 'payment-detail', permission: 'PAYMENT_READ' },
  { pattern: /^\/admin\/webhook-logs$/, page: 'webhook-logs', permission: 'PAYMENT_WEBHOOK_LOG_READ' },
  { pattern: /^\/admin\/webhook-logs\/([^/]+)$/, page: 'webhook-log-detail', permission: 'PAYMENT_WEBHOOK_LOG_READ' },
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
  // First item: the landing screen after sign-in for everyone who may read machines (homeFor).
  { to: '/admin/overview', label: 'Tổng quan', group: 'Vận hành', permission: 'MACHINE_READ', match: ['overview'] },
  { to: '/admin/machines', label: 'Máy bán hàng', group: 'Vận hành', permission: 'MACHINE_READ', match: ['machines', 'machine-detail'] },
  { to: '/admin/products', label: 'Sản phẩm', group: 'Vận hành', permission: 'PRODUCT_READ', match: ['products'] },
  { to: '/admin/batches', label: 'Lô hàng', group: 'Vận hành', permission: 'BATCH_READ', match: ['batches'] },
  { to: '/admin/inventory', label: 'Tồn kho', group: 'Vận hành', permission: 'INVENTORY_READ', match: ['inventory', 'inventory-history'] },
  // Draft permission (api-contract/drafts/alerts.yaml, BE 3.6): see DRAFT_PERMISSIONS in permissions.ts.
  { to: '/admin/alerts', label: 'Cảnh báo', group: 'Vận hành', permission: 'ALERT_READ', match: ['alerts', 'alert-detail'] },
  // Draft permission (api-contract/drafts/work-tickets.yaml, BE 4.3).
  { to: '/admin/tickets', label: 'Phiếu công việc', group: 'Vận hành', permission: 'TICKET_READ', match: ['tickets', 'ticket-detail'] },
  // Draft permission (api-contract/drafts/maintenance-schedules.yaml, BE 4.5).
  { to: '/admin/maintenance-schedules', label: 'Lịch bảo trì', group: 'Vận hành', permission: 'MAINTENANCE_SCHEDULE_READ', match: ['maintenance-schedules'] },
  { to: '/admin/orders', label: 'Đơn hàng', group: 'Giao dịch', permission: 'ORDER_READ', match: ['orders', 'order-detail'] },
  { to: '/admin/payments', label: 'Thanh toán', group: 'Giao dịch', permission: 'PAYMENT_READ', match: ['payments', 'payment-detail'] },
  { to: '/admin/webhook-logs', label: 'Webhook thanh toán', group: 'Giao dịch', permission: 'PAYMENT_WEBHOOK_LOG_READ', match: ['webhook-logs', 'webhook-log-detail'] },
  { to: '/admin/users', label: 'Tài khoản', group: 'Hệ thống', permission: 'USER_READ', match: ['users'] },
  { to: '/admin/roles', label: 'Vai trò & quyền', group: 'Hệ thống', permission: 'PERMISSION_MANAGE', match: ['roles'] },
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
/**
 * Where to go after signing in: back to `next` (already checked by safeNext) when this account may open it, otherwise
 * the account's own first screen. Someone else's expired session must not drop a STAFF account on a 403 page.
 * Paths without a route (/admin, /staff, unknown screens) are kept: AdminApp redirects or explains them.
 */
export function landingFor(subject: Subject | readonly Role[], next: string | null): string {
  if (!next) return homeFor(subject)
  const route = matchRoute(new URL(next, 'https://web.invalid').pathname)
  return route && !canOpen(subject, route) ? homeFor(subject) : next
}
/** Landing route after login or when visiting /admin. */
export function homeFor(subject: Subject | readonly Role[]): string {
  return navFor(subject)[0]?.to ?? '/login'
}
