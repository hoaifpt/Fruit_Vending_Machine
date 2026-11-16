import type { TicketViewer } from './tickets.ts'
import { useSession } from './useSession.ts'

/** The signed-in account as the work order rules see it (FE 7.1): its id and the four WORK_ORDER_* permissions that matter. */
export function useTicketViewer(): TicketViewer {
  const { session, can } = useSession()
  return { userId: session?.user.id, canReadAll: can('WORK_ORDER_READ_ALL'), canWrite: can('WORK_ORDER_MANAGE'), canExecute: can('WORK_ORDER_EXECUTE') }
}
