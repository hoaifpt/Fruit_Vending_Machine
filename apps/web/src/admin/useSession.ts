import { useCallback, useMemo, useSyncExternalStore } from 'react'
import { getSession, subscribeSession } from '../api/session.ts'
import type { Role } from '../api/session.ts'
import { permissionsOf } from './permissions.ts'
import type { Permission } from './permissions.ts'

const NO_ROLES: readonly Role[] = []

/** Current session plus `can(permission)`; screens ask `can` instead of comparing roles (see permissions.ts). */
export function useSession() {
  const session = useSyncExternalStore(subscribeSession, () => getSession(), () => null)
  const roles = session?.user.roles ?? NO_ROLES
  const granted = useMemo(() => permissionsOf(roles), [roles])
  const can = useCallback((permission: Permission) => granted.has(permission), [granted])
  return { session, roles, can }
}
