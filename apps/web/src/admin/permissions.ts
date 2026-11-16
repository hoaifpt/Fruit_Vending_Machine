// The single place that decides what the web shows to whom. Pages, navigation and route guards ask `can()`;
// none of them compare roles directly. Permission codes are the backend's (V13, V16–V25 of
// backend/src/main/resources/db/migration): UPPER_SNAKE, one per endpoint group, read and write kept apart exactly as the
// backend's @PreAuthorize checks them.
//
// Today the permissions are derived from the roles in the JWT (the backend has no endpoint returning them yet, see
// api-contract/drafts/auth-me.yaml). When GET /auth/me ships, pass its `permissions` array as `Subject.permissions`
// and nothing else changes. This is a UI hint only: the backend remains the authority and every call must still handle 403.
import type { Role } from '../api/session.ts'

/** Every code of the backend's permissions table, in migration order. */
export const PERMISSIONS = [
  // V13 (#48)
  'USER_READ', 'USER_WRITE', 'PERMISSION_MANAGE',
  'PRODUCT_READ', 'PRODUCT_WRITE',
  'MACHINE_READ', 'MACHINE_WRITE', 'KIOSK_CREDENTIAL_MANAGE',
  'BATCH_READ', 'BATCH_CREATE',
  'INVENTORY_READ', 'INVENTORY_WRITE',
  'ORDER_READ', 'PAYMENT_READ', 'PAYMENT_WEBHOOK_LOG_READ',
  // V16 audit log, V17 alerts, V18 near-expiry pricing
  'AUDIT_LOG_READ',
  'ALERT_READ', 'ALERT_MANAGE', 'ALERT_NOTIFY',
  'PRICING_READ', 'PRICING_MANAGE',
  // V19 maintenance commands, V20 work orders, V21 restock, V22 maintenance plans
  'MAINTENANCE_COMMAND_READ', 'MAINTENANCE_COMMAND_EXECUTE', 'MACHINE_RESET',
  'WORK_ORDER_READ_ALL', 'WORK_ORDER_READ_ASSIGNED', 'WORK_ORDER_MANAGE', 'WORK_ORDER_EXECUTE',
  'RESTOCK_PLAN', 'RESTOCK_EXECUTE', 'INVENTORY_LOAD_DIRECT',
  'MAINTENANCE_PLAN_READ', 'MAINTENANCE_PLAN_MANAGE',
  // V23 refunds, V24 customer reports, V25 dashboard and sales reports
  'PAYMENT_REFUND', 'REFUND_READ',
  'CUSTOMER_REPORT_READ', 'CUSTOMER_REPORT_MANAGE', 'MACHINE_REPORT_LINK_MANAGE',
  'DASHBOARD_READ', 'REPORT_SALES_READ', 'REPORT_EXPORT',
] as const
export type Permission = (typeof PERMISSIONS)[number]

export const ROLES: readonly Role[] = ['ADMIN', 'STAFF']

/**
 * Role → permission seed of the migrations (the backend grants each code separately; a write code does not imply its
 * read code). ADMIN: every permission. STAFF: operations on site, never payments, refunds, users, roles or sales figures.
 */
export const ROLE_PERMISSIONS: Readonly<Record<Role, readonly Permission[]>> = {
  ADMIN: PERMISSIONS,
  STAFF: [
    'PRODUCT_READ', 'MACHINE_READ', 'BATCH_READ', 'BATCH_CREATE', 'INVENTORY_READ', 'INVENTORY_WRITE', 'ORDER_READ', // V13
    'ALERT_READ', 'ALERT_MANAGE', // V17
    'PRICING_READ', // V18
    'MAINTENANCE_COMMAND_READ', 'MAINTENANCE_COMMAND_EXECUTE', // V19
    'WORK_ORDER_READ_ASSIGNED', 'WORK_ORDER_EXECUTE', // V20
    'RESTOCK_EXECUTE', // V21
    'MAINTENANCE_PLAN_READ', // V22
    'CUSTOMER_REPORT_READ', // V24 (only reports of their own work orders, server-side)
    'DASHBOARD_READ', // V25
  ],
}
const KNOWN: readonly string[] = PERMISSIONS

/** Who is asking: roles from the session and, once the backend provides them, explicit permissions. */
export interface Subject { roles: readonly Role[]; permissions?: readonly string[] }

/** Effective permissions of a subject; explicit permissions win over the role table, unknown codes are ignored. */
export function permissionsOf(subject: Subject | readonly Role[]): Set<Permission> {
  const { roles, permissions } = Array.isArray(subject) ? { roles: subject as readonly Role[], permissions: undefined } : subject as Subject
  const granted = new Set<Permission>()
  const source = permissions ?? roles.flatMap(role => ROLE_PERMISSIONS[role] ?? [])
  for (const name of source) if (KNOWN.includes(name)) granted.add(name as Permission)
  return granted
}

export function can(subject: Subject | readonly Role[], permission: Permission): boolean {
  return permissionsOf(subject).has(permission)
}

/** Roles that hold a permission, in ROLES order (used for display and the legacy `roles` field of routes). */
export function rolesWith(permission: Permission): Role[] {
  return ROLES.filter(role => can([role], permission))
}
