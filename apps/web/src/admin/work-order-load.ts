// Loading one work order for the detail and restock screens (FE 7.1/7.2), with the failures they explain themselves.
import { ApiError } from '../api/client.ts'
import { workOrdersApi } from '../api/resources.ts'
import type { WorkOrder } from '../api/resources.ts'
import { TICKETS_MISSING, TICKET_NOT_FOUND } from './tickets.ts'

/** The work order could not be shown: unknown (or not the caller's) id, or no work order endpoint at all. */
export class TicketUnavailable extends Error {
  readonly kind: 'missing' | 'not-found'
  constructor(kind: 'missing' | 'not-found') { super(kind === 'missing' ? TICKETS_MISSING : TICKET_NOT_FOUND); this.kind = kind }
}

/**
 * GET /work-orders/{id}: 400 (malformed id) and 404 (unknown, or someone else's without WORK_ORDER_READ_ALL) are "not
 * found"; 405/501 mean the backend has no work orders.
 */
export async function loadTicket(ticketId: string, signal: AbortSignal): Promise<WorkOrder> {
  try { return await workOrdersApi.get(ticketId, signal) } catch (error) {
    const code = error instanceof ApiError ? error.status : undefined
    if (code === 405 || code === 501) throw new TicketUnavailable('missing')
    if (code === 400 || code === 404) throw new TicketUnavailable('not-found')
    throw error
  }
}
