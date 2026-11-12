import type { TicketViewer } from './tickets.ts'
import { useSession } from './useSession.ts'

/** The signed-in account as the work ticket rules see it (FE 7.1): its id and whether it holds TICKET_WRITE. */
export function useTicketViewer(): TicketViewer {
  const { session, can } = useSession()
  return { userId: session?.user.id, canWrite: can('TICKET_WRITE') }
}
