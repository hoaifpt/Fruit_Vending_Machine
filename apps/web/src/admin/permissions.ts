// The single place that decides what the web shows to whom. Pages, navigation and route guards ask `can()`;
// none of them compare roles directly. Permission codes are the backend's (issue #48, V13__create_permissions.sql):
// UPPER_SNAKE, one per endpoint group, read and write kept apart exactly as the backend's @PreAuthorize checks them.
//
// Today the permissions are derived from the roles in the JWT (#48 has no endpoint returning them yet, see
// api-contract/drafts/auth-me.yaml). When GET /auth/me ships, pass its `permissions` array as `Subject.permissions`
// and nothing else changes. This is a UI hint only: the backend remains the authority and every call must still handle 403.
import type { Role } from '../api/session.ts'

export const PERMISSIONS = [
  'USER_READ', 'USER_WRITE', 'PERMISSION_MANAGE',
  'PRODUCT_READ', 'PRODUCT_WRITE',
  'MACHINE_READ', 'MACHINE_WRITE', 'KIOSK_CREDENTIAL_MANAGE',
  'BATCH_READ', 'BATCH_CREATE',
  'INVENTORY_READ', 'INVENTORY_WRITE',
  'ORDER_READ', 'PAYMENT_READ', 'PAYMENT_WEBHOOK_LOG_READ',
] as const

/**
 * Codes proposed by the web's draft contracts, not in the backend yet (so not in PERMISSIONS, which mirrors V13 of #48):
 * ALERT_READ / ALERT_WRITE of api-contract/drafts/alerts.yaml (FE 6.3, waiting for BE 3.6) and TICKET_READ /
 * TICKET_WRITE of api-contract/drafts/work-tickets.yaml (FE 7.1, waiting for BE 4.3); MAINTENANCE_SCHEDULE_READ /
 * MAINTENANCE_SCHEDULE_WRITE of api-contract/drafts/maintenance-schedules.yaml (FE 7.3, waiting for BE 4.5); REFUND_RECORD
 * of api-contract/drafts/refunds.yaml (FE 8.1, waiting for BE 5.1). When the backend adds them to its
 * permissions table, move them into PERMISSIONS and ROLE_PERMISSIONS and drop them here.
 * REPORT_READ of api-contract/drafts/revenue-reports.yaml (FE 9.1/9.2, waiting for BE 6.1): revenue report, ADMIN only.
 */
export const DRAFT_PERMISSIONS = ['ALERT_READ', 'ALERT_WRITE', 'TICKET_READ', 'TICKET_WRITE', 'MAINTENANCE_SCHEDULE_READ', 'MAINTENANCE_SCHEDULE_WRITE', 'MACHINE_MAINTENANCE', 'REFUND_RECORD', 'REPORT_READ'] as const
export type DraftPermission = (typeof DRAFT_PERMISSIONS)[number]
export type Permission = (typeof PERMISSIONS)[number] | DraftPermission

export const ROLES: readonly Role[] = ['ADMIN', 'STAFF']

/**
 * Role → permission seed of V13 (the backend grants each code separately; a write code does not imply its read code).
 * ADMIN: every permission. STAFF: read products and machines (with their slots), read and create batches,
 * read and change inventory, read orders.
 */
export const ROLE_PERMISSIONS: Readonly<Record<Role, readonly Permission[]>> = {
  ADMIN: PERMISSIONS,
  STAFF: ['PRODUCT_READ', 'MACHINE_READ', 'BATCH_READ', 'BATCH_CREATE', 'INVENTORY_READ', 'INVENTORY_WRITE', 'ORDER_READ'],
}

/**
 * Proposed seed of the draft codes: staff on site see, acknowledge and close alerts like admins do; they read (only their
 * own, the server filters) and carry out work tickets, while opening, assigning and cancelling tickets is for admins.
 * Staff read maintenance schedules (to plan visits); creating, changing and pausing them is for admins.
 * MACHINE_MAINTENANCE (api-contract/drafts/machine-maintenance.yaml, FE 7.4, waiting for BE 4.2): staff on site send
 * maintenance commands to the machine (open/close refill, take bowls out, reset) like admins do.
 * Recording a refund (REFUND_RECORD) is ADMIN only and never granted to STAFF (BR-19/20: payments and refunds are admin-only).
 */
export const DRAFT_ROLE_PERMISSIONS: Readonly<Record<Role, readonly DraftPermission[]>> = {
  ADMIN: DRAFT_PERMISSIONS,
  STAFF: ['ALERT_READ', 'ALERT_WRITE', 'TICKET_READ', 'MAINTENANCE_SCHEDULE_READ', 'MACHINE_MAINTENANCE'],
}
const KNOWN: readonly string[] = [...PERMISSIONS, ...DRAFT_PERMISSIONS]

/** Who is asking: roles from the session and, once the backend provides them, explicit permissions. */
export interface Subject { roles: readonly Role[]; permissions?: readonly string[] }

/**
 * Effective permissions of a subject; explicit permissions win over the role table (draft codes included only when the
 * backend lists them), unknown codes are ignored.
 */
export function permissionsOf(subject: Subject | readonly Role[]): Set<Permission> {
  const { roles, permissions } = Array.isArray(subject) ? { roles: subject as readonly Role[], permissions: undefined } : subject as Subject
  const granted = new Set<Permission>()
  const source = permissions ?? roles.flatMap(role => [...ROLE_PERMISSIONS[role] ?? [], ...DRAFT_ROLE_PERMISSIONS[role] ?? []])
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
