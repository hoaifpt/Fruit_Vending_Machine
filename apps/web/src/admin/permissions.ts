// The single place that decides what the web shows to whom. Pages, navigation and route guards ask `can()`;
// none of them compare roles directly. Permission names follow api-contract/drafts/auth-me.yaml.
//
// Today the permissions are derived from the roles in the JWT (the backend has no endpoint returning them yet,
// BE 3.1). When GET /auth/me ships, pass its `permissions` array as `Subject.permissions` and nothing else changes.
// This is a UI hint only: the backend remains the authority and every call must still handle 403.
import type { Role } from '../api/session.ts'

export const PERMISSIONS = [
  'users:manage', 'products:read', 'products:manage', 'machines:read', 'machines:manage', 'slots:read', 'slots:manage',
  'kiosk-credentials:manage', 'batches:write', 'inventory:write', 'orders:read', 'payments:read', 'webhook-logs:read',
] as const
export type Permission = (typeof PERMISSIONS)[number]

export const ROLES: readonly Role[] = ['ADMIN', 'STAFF']

/**
 * Role matrix (docs/admin-implementation.md, backend @PreAuthorize). `:manage` implies `:read`.
 * ADMIN: everything. STAFF: read products/machines/slots, create batches, load/remove boxes, read orders.
 */
const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  ADMIN: ['users:manage', 'products:manage', 'machines:manage', 'slots:manage', 'kiosk-credentials:manage', 'batches:write', 'inventory:write', 'orders:read', 'payments:read', 'webhook-logs:read'],
  STAFF: ['products:read', 'machines:read', 'slots:read', 'batches:write', 'inventory:write', 'orders:read'],
}

/** Who is asking: roles from the session and, once the backend provides them, explicit permissions. */
export interface Subject { roles: readonly Role[]; permissions?: readonly string[] }

const IMPLIED: Partial<Record<Permission, Permission>> = {
  'products:manage': 'products:read', 'machines:manage': 'machines:read', 'slots:manage': 'slots:read',
}

/** Effective permissions of a subject; explicit permissions win over the role table. */
export function permissionsOf(subject: Subject | readonly Role[]): Set<Permission> {
  const { roles, permissions } = Array.isArray(subject) ? { roles: subject as readonly Role[], permissions: undefined } : subject as Subject
  const granted = new Set<Permission>()
  const source = permissions ?? roles.flatMap(role => ROLE_PERMISSIONS[role] ?? [])
  for (const name of source) {
    if (!(PERMISSIONS as readonly string[]).includes(name)) continue
    granted.add(name as Permission)
    const implied = IMPLIED[name as Permission]
    if (implied) granted.add(implied)
  }
  return granted
}

export function can(subject: Subject | readonly Role[], permission: Permission): boolean {
  return permissionsOf(subject).has(permission)
}

/** Roles that hold a permission, in ROLES order (used for display and the legacy `roles` field of routes). */
export function rolesWith(permission: Permission): Role[] {
  return ROLES.filter(role => can([role], permission))
}
