// Management web routes and the role matrix from issue #39 §3. Pure data so it can be unit-tested;
// the backend still enforces permissions and every call must handle 403.
import type { Role } from '../api/session.ts'

export type PageKey =
  | 'users' | 'products' | 'machines' | 'machine-detail' | 'batches' | 'inventory' | 'inventory-history'
  | 'orders' | 'order-detail' | 'payments' | 'payment-detail' | 'webhook-logs' | 'webhook-log-detail'

export interface RouteMatch { page: PageKey; id?: string; roles: readonly Role[] }

const BOTH: readonly Role[] = ['ADMIN', 'STAFF']
const ADMIN: readonly Role[] = ['ADMIN']

const ROUTES: { pattern: RegExp; page: PageKey; roles: readonly Role[] }[] = [
  { pattern: /^\/admin\/users$/, page: 'users', roles: ADMIN },
  { pattern: /^\/admin\/products$/, page: 'products', roles: BOTH },
  { pattern: /^\/admin\/machines$/, page: 'machines', roles: BOTH },
  { pattern: /^\/admin\/machines\/([^/]+)$/, page: 'machine-detail', roles: BOTH },
  { pattern: /^\/admin\/batches$/, page: 'batches', roles: BOTH },
  { pattern: /^\/admin\/inventory$/, page: 'inventory', roles: BOTH },
  { pattern: /^\/admin\/inventory\/history$/, page: 'inventory-history', roles: BOTH },
  { pattern: /^\/admin\/orders$/, page: 'orders', roles: BOTH },
  { pattern: /^\/admin\/orders\/([^/]+)$/, page: 'order-detail', roles: BOTH },
  { pattern: /^\/admin\/payments$/, page: 'payments', roles: ADMIN },
  { pattern: /^\/admin\/payments\/([^/]+)$/, page: 'payment-detail', roles: ADMIN },
  { pattern: /^\/admin\/webhook-logs$/, page: 'webhook-logs', roles: ADMIN },
  { pattern: /^\/admin\/webhook-logs\/([^/]+)$/, page: 'webhook-log-detail', roles: ADMIN },
]

export function matchRoute(pathname: string): RouteMatch | undefined {
  const path = pathname.replace(/\/+$/, '') || '/'
  for (const route of ROUTES) {
    const match = route.pattern.exec(path)
    if (match) return { page: route.page, id: match[1] ? decodeURIComponent(match[1]) : undefined, roles: route.roles }
  }
  return undefined
}

export interface NavItem { to: string; label: string; icon: 'machine' | 'inventory' | 'transactions' | 'tasks' | 'users' | 'bag' | 'dashboard'; roles: readonly Role[]; match: PageKey[] }

export const NAV: NavItem[] = [
  { to: '/admin/machines', label: 'Máy bán hàng', icon: 'machine', roles: BOTH, match: ['machines', 'machine-detail'] },
  { to: '/admin/products', label: 'Sản phẩm', icon: 'bag', roles: BOTH, match: ['products'] },
  { to: '/admin/batches', label: 'Lô hàng', icon: 'tasks', roles: BOTH, match: ['batches'] },
  { to: '/admin/inventory', label: 'Tồn kho', icon: 'inventory', roles: BOTH, match: ['inventory', 'inventory-history'] },
  { to: '/admin/orders', label: 'Đơn hàng', icon: 'transactions', roles: BOTH, match: ['orders', 'order-detail'] },
  { to: '/admin/payments', label: 'Thanh toán', icon: 'dashboard', roles: ADMIN, match: ['payments', 'payment-detail'] },
  { to: '/admin/webhook-logs', label: 'Webhook thanh toán', icon: 'transactions', roles: ADMIN, match: ['webhook-logs', 'webhook-log-detail'] },
  { to: '/admin/users', label: 'Tài khoản', icon: 'users', roles: ADMIN, match: ['users'] },
]

export function canAccess(userRoles: readonly Role[], required: readonly Role[]): boolean {
  return required.some(role => userRoles.includes(role))
}
export function navFor(userRoles: readonly Role[]): NavItem[] {
  return NAV.filter(item => canAccess(userRoles, item.roles))
}
/** Landing route after login or when visiting /admin. */
export function homeFor(userRoles: readonly Role[]): string {
  return navFor(userRoles)[0]?.to ?? '/login'
}
