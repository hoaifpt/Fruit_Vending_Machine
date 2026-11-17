// Mock of GET /dashboard/overview (backend #76, docs/reports.md §5). DASHBOARD_READ (ADMIN, STAFF); `today` and
// `refunds` only for callers holding REPORT_SALES_READ (absent, not zero, for STAFF). Same rules as the rest of the mock:
// connectivity of machineView, alerts not RESOLVED, work orders of #66, stock with the health-check predicates of #58
// (machines not INACTIVE; low stock = ACTIVE slot with at most 2 sellable bowls; blocked = slot ERROR or head bowl
// DISPENSE_FAILED; expiring today = physical unexpired bowls expiring before the end of the business day), today's
// sales with the definitions of the sales report (revenue.ts), pending refunds = the current refund candidates.
import { ok } from './http.ts'
import type { HandlerContext, Route } from './handlers.ts'
import { machineView, permissionsOfUser, presentItems } from './handlers.ts'
import type { MockItem, MockStore } from './seed.ts'
import { refundCandidates } from './refunds.ts'
import { readScope, salesSummary } from './revenue.ts'
import { MOCK_LOW_STOCK_THRESHOLD } from './work-orders.ts'
import type { components } from '../schema'
import { addDays, dueInstant, vietnamDate } from '../../admin/maintenance-schedules.ts'

type S = components['schemas']
const UNFINISHED = ['OPEN', 'ASSIGNED', 'IN_PROGRESS']
const expired = (item: MockItem, now: number) => Date.parse(item.expiresAt) <= now

/** Bowls of a slot the kiosk can sell now: none when the head is blocked (expired or DISPENSE_FAILED). */
function sellableInSlot(store: MockStore, slotId: string, now: number): number {
  const present = presentItems(store, slotId)
  const head = present[0]
  if (head && (head.status === 'DISPENSE_FAILED' || expired(head, now))) return 0
  return present.filter(item => item.status === 'AVAILABLE' && !expired(item, now)).length
}
/** Catalog rule of the kiosk: only an ACTIVE machine sells, from ACTIVE slots, bowls of ACTIVE products. */
function sellableBowls(store: MockStore, machine: MockStore['machines'][number], now: number): number {
  if (machine.status !== 'ACTIVE') return 0
  return store.slots.filter(slot => slot.machineId === machine.id && slot.status === 'ACTIVE').reduce((sum, slot) => {
    const head = presentItems(store, slot.id!)[0]
    const productActive = !head || store.products.some(product => product.id === head.productId && product.status === 'ACTIVE')
    return sum + (productActive ? sellableInSlot(store, slot.id!, now) : 0)
  }, 0)
}

export function dashboardOverview(ctx: HandlerContext): S['DashboardOverviewResponse'] {
  const { store, now } = ctx
  const views = store.machines.map(machine => machineView(store, machine, now))
  const count = <T>(rows: readonly T[], test: (row: T) => boolean) => rows.filter(test).length
  const machines: S['Machines'] = {
    total: views.length, active: count(views, machine => machine.status === 'ACTIVE'), maintenance: count(views, machine => machine.status === 'MAINTENANCE'),
    inactive: count(views, machine => machine.status === 'INACTIVE'), online: count(views, machine => machine.connectivity === 'ONLINE'),
    warning: count(views, machine => machine.connectivity === 'WARNING'), offline: count(views, machine => machine.connectivity === 'OFFLINE'),
    neverSeen: count(views, machine => machine.connectivity === 'NEVER_SEEN'),
  }
  const open = store.alerts.filter(alert => alert.status !== 'RESOLVED')
  const alerts: S['Alerts'] = {
    open: open.length, critical: count(open, alert => alert.severity === 'CRITICAL'), warning: count(open, alert => alert.severity === 'WARNING'), info: count(open, alert => alert.severity === 'INFO'),
  }
  const unfinished = store.workOrders.filter(order => UNFINISHED.includes(order.status))
  const workOrders: S['WorkOrders'] = {
    open: count(unfinished, order => order.status === 'OPEN' || order.status === 'ASSIGNED'), inProgress: count(unfinished, order => order.status === 'IN_PROGRESS'),
    overdue: count(unfinished, order => !!order.dueAt && Date.parse(order.dueAt) < now), assignedToMe: count(unfinished, order => order.assigneeId === ctx.user?.id),
  }
  const serving = new Set(store.machines.filter(machine => machine.status !== 'INACTIVE').map(machine => machine.id))
  const slots = store.slots.filter(slot => serving.has(slot.machineId!))
  const endOfToday = Date.parse(dueInstant(addDays(vietnamDate(now), 1)))
  const stock: S['Stock'] = {
    lowStockSlots: count(slots, slot => slot.status === 'ACTIVE' && sellableInSlot(store, slot.id!, now) <= MOCK_LOW_STOCK_THRESHOLD),
    blockedSlots: count(slots, slot => slot.status === 'ERROR' || presentItems(store, slot.id!)[0]?.status === 'DISPENSE_FAILED'),
    bowlsExpiringToday: slots.reduce((sum, slot) => sum + count(presentItems(store, slot.id!), item => !expired(item, now) && Date.parse(item.expiresAt) < endOfToday), 0),
  }
  const machinesDetail: S['MachineDetail'][] = views.sort((a, b) => a.code.localeCompare(b.code, 'en')).map(machine => {
    const reading = store.readings.filter(candidate => candidate.machineId === machine.id && typeof candidate.temperature === 'number')
      .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt) || b.id - a.id)[0]
    return {
      machineId: machine.id, code: machine.code, name: machine.name, status: machine.status, connectivity: machine.connectivity ?? undefined,
      lastSeenAt: machine.lastSeenAt ?? undefined, temperature: reading?.temperature ?? undefined,
      sellableBowls: sellableBowls(store, machine, now), openAlerts: count(open, alert => alert.machineId === machine.id),
    }
  })
  const result: S['DashboardOverviewResponse'] = { generatedAt: new Date(now).toISOString(), machines, alerts, workOrders, stock, machinesDetail }
  if (ctx.user && permissionsOfUser(store, ctx.user).includes('REPORT_SALES_READ')) {
    const today = vietnamDate(now), yesterday = addDays(today, -1)
    const day = (date: string) => salesSummary(store, readScope(store, new URLSearchParams({ from: date, to: date })), now)
    const sales = day(today)
    const candidates = refundCandidates(store)
    result.today = { date: today, ordersSold: sales.ordersSold, netSales: sales.netSales, yesterdayNetSales: day(yesterday).netSales }
    result.refunds = { pendingCount: candidates.length, pendingAmount: candidates.reduce((sum, row) => sum + row.payment.amount, 0) }
  }
  return result
}

export const dashboardRoutes: Route[] = [
  { method: 'GET', pattern: /^\/dashboard\/overview\/?$/, policy: { permission: 'DASHBOARD_READ' }, handle: ctx => ok(dashboardOverview(ctx)) },
]
