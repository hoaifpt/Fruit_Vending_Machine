import { useSyncExternalStore } from 'react'
import { getSession, hasRole, subscribeSession } from '../api/session.ts'

export function useSession() {
  const session = useSyncExternalStore(subscribeSession, () => getSession(), () => null)
  return { session, isAdmin: hasRole(session, 'ADMIN'), isStaff: hasRole(session, 'STAFF') }
}
