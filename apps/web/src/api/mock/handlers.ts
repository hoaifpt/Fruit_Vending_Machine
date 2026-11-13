// One handler per endpoint the web calls. Rules follow api-contract/api.yaml and docs/*.md, and each write updates the
// in-memory store, so a change shows up on the next read and is gone after a page reload.
import { conflict, created, Form, MockHttpError, notFound, ok, paginate } from './http.ts'
import type { Reply } from './http.ts'
import type {
  MockAlert, MockCredential, MockHeartbeat, MockItem, MockMaintenanceCommand, MockOrder, MockPayment, MockRestockLine, MockRole, MockSchedule, MockStore,
  MockTicket, MockUser,
} from './seed.ts'
import type { components as AuthMe } from '../drafts/auth-me'
import { restockReconciliation } from './seed.ts'
import { addDays, dueInstant, isDateString, nextDueDate, scheduleBase, vietnamDate, vietnamDateOf } from '../../admin/maintenance-schedules.ts'
import { DRAFT_ROLE_PERMISSIONS, PERMISSIONS } from '../../admin/permissions.ts'
import type { Role } from '../session.ts'
import { incidentReportRoutes } from './incident-reports.ts'
import { refundRoutes } from './refunds.ts'
import { boxPrice, linePricing } from './pricing.ts'

export interface HandlerContext {
  store: MockStore
  now: number
  params: Record<string, string>
  query: URLSearchParams
  body: unknown
  user: MockUser | undefined
  /** Machine of the kiosk key, for kiosk routes. */
  machineId: string
  options: KioskSimulation
}
/** How the mock plays the backend's background work for kiosk orders (payment webhook, dispensing, machine state). */
export interface KioskSimulation {
  autoPayMs: number
  dispenseMs: number
  autoPay: boolean
  /** `fail`: the machine reports DISPENSE_FAILED; `slow`: the order stays DISPENSING (no report from the machine). */
  dispense: 'ok' | 'fail' | 'slow'
  /** The kiosk's machine is shown in MAINTENANCE (scenario `maintenance`), without changing the stored machine. */
  maintenance: boolean
}
/**
 * `{ permission }`: backend #48 style check against the role → permission table in the store (roles screen only for now).
 * `{ draftPermission }`: a code proposed by a draft contract, not in the backend's table yet (ALERT_READ/ALERT_WRITE of
 * drafts/alerts.yaml, TICKET_READ/TICKET_WRITE of drafts/work-tickets.yaml, MAINTENANCE_SCHEDULE_READ/_WRITE of
 * drafts/maintenance-schedules.yaml, MACHINE_MAINTENANCE of drafts/machine-maintenance.yaml); checked against the web's
 * proposed seed DRAFT_ROLE_PERMISSIONS.
 */
export type Policy = 'public' | 'any' | 'admin' | 'kiosk' | { permission: string } | { draftPermission: string }
export interface Route { method: string; pattern: RegExp; policy: Policy; handle: (ctx: HandlerContext) => Reply }

const RESERVATION_MS = 5 * 60_000
const MIN_REMAINING_HOLD_MS = 30_000
const PRESENT_STATUSES: readonly MockItem['status'][] = ['AVAILABLE', 'RESERVED', 'EXPIRED', 'DISPENSE_FAILED']
const USER_STATUSES = ['ACTIVE', 'INACTIVE', 'LOCKED'] as const
const MACHINE_STATUSES = ['ACTIVE', 'INACTIVE', 'MAINTENANCE'] as const
const SLOT_STATUSES = ['ACTIVE', 'INACTIVE', 'ERROR'] as const
const PRODUCT_STATUSES = ['ACTIVE', 'INACTIVE'] as const


const iso = (ms: number) => new Date(ms).toISOString()
const newId = () => crypto.randomUUID()
const decode = (value: string) => decodeURIComponent(value)
const randomCode = (length: number) => Array.from({ length }, () => '0123456789ABCDEFGHJKMNPQRSTVWXYZ'[Math.floor(Math.random() * 32)]).join('')

function byId<T extends { id: string }>(rows: T[], id: string, message: string): T {
  const row = rows.find(candidate => candidate.id === decode(id))
  if (!row) throw notFound(message)
  return row
}
const findUser = (ctx: HandlerContext) => byId(ctx.store.users, ctx.params.id, 'Không tìm thấy tài khoản.')
const findProduct = (ctx: HandlerContext) => byId(ctx.store.products, ctx.params.id, 'Không tìm thấy sản phẩm.')
function findAlert(ctx: HandlerContext): MockAlert {
  if (!UUID_PATTERN.test(decode(ctx.params.id))) throw new MockHttpError(400, 'Invalid alert id')
  return byId(ctx.store.alerts, ctx.params.id, 'Alert not found')
}
const findMachine = (ctx: HandlerContext, id = ctx.params.machineId) => byId(ctx.store.machines, id, 'Machine not found') // MachineService, English as the backend sends it
function findSlot(ctx: HandlerContext) {
  findMachine(ctx)
  const slot = byId(ctx.store.slots, ctx.params.slotId, 'Slot not found in specified machine')
  if (slot.machineId !== decode(ctx.params.machineId)) throw notFound('Slot not found in specified machine')
  return slot
}

const eq = (query: URLSearchParams, name: string, value: unknown) => !query.get(name) || query.get(name) === value
const contains = (needle: string | null, ...values: (string | null | undefined)[]) => !needle || values.some(value => value?.toLowerCase().includes(needle.toLowerCase()))
function within(query: URLSearchParams, fromName: string, toName: string, value: string | undefined): boolean {
  const from = query.get(fromName), to = query.get(toName), at = Date.parse(value ?? '')
  return (!from || at >= Date.parse(from)) && (!to || at < Date.parse(to))
}
const flag = (query: URLSearchParams, name: string, value: boolean) => !query.get(name) || (query.get(name) === 'true') === value

/** Draft codes an account holds through its roles (proposed seed of the draft contracts). */
export function draftPermissionsOfUser(user: Pick<MockUser, 'roles'>): string[] {
  return [...new Set(user.roles.map(role => role.replace(/^ROLE_/, '')).flatMap(role => DRAFT_ROLE_PERMISSIONS[role as Role] ?? []))].sort()
}

/** Effective permissions of an account: the union of its roles' sets, read from the store on every request (like #48). */
export function permissionsOfUser(store: MockStore, user: Pick<MockUser, 'roles'>): string[] {
  const names = new Set(user.roles.map(role => role.replace(/^ROLE_/, '')))
  return [...new Set(store.roles.filter(role => names.has(role.name)).flatMap(role => role.permissions))].sort()
}

// Roles & permissions, exactly as RolePermissionService of backend #48 (messages are the backend's, in English).
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** Permissions.ADMIN_REQUIRED of #48, same order (it shapes the 409 message). */
const ADMIN_REQUIRED = ['PERMISSION_MANAGE', 'USER_WRITE'] as const
const roleView = (role: MockRole) => ({ id: role.id, name: role.name, description: role.description, permissions: [...role.permissions].sort() })
function findRole(ctx: HandlerContext): MockRole {
  const id = decode(ctx.params.id)
  if (!UUID_PATTERN.test(id)) throw new MockHttpError(400, 'Invalid request parameter', { id: 'Must be a valid UUID' })
  const role = ctx.store.roles.find(candidate => candidate.id.toLowerCase() === id.toLowerCase())
  if (!role) throw notFound('Role not found')
  return role
}
/** Body checks of ReplaceRolePermissionsRequest: @NotNull, @Size(max = 200), @NotBlank items, no other field. */
function replaceCodes(ctx: HandlerContext): string[] {
  const form = new Form(ctx.body, ['permissions'])
  const value = (ctx.body as Record<string, unknown>).permissions
  if (!Array.isArray(value)) form.reject('permissions', 'must not be null')
  else if (value.length > 200) form.reject('permissions', 'size must be between 0 and 200')
  else if (value.some(code => typeof code !== 'string' || !code.trim())) form.reject('permissions', 'must not be blank')
  form.done()
  const codes = value as string[]
  const duplicates = [...new Set(codes.filter((code, index) => codes.indexOf(code) !== index))].sort()
  if (duplicates.length) throw new MockHttpError(400, 'Duplicate permission codes', { permissions: `Duplicate codes: ${duplicates.join(', ')}` })
  const unknown = [...new Set(codes.filter(code => !ctx.store.permissions.some(permission => permission.code === code)))].sort()
  if (unknown.length) throw new MockHttpError(400, 'Unknown permission codes', { permissions: `Unknown codes: ${unknown.join(', ')}` })
  return codes
}

const userView = ({ password: _password, ...user }: MockUser) => user
const credentialView = ({ apiKey: _apiKey, machineId: _machineId, ...credential }: MockCredential) => credential
const isExpired = (item: MockItem, now: number) => Date.parse(item.expiresAt) <= now
const itemView = (item: MockItem, now: number) => ({ ...item, expired: isExpired(item, now) })
/** Draft pricing-discount.yaml (FE 7.5): what a box sells at now; only boxes still on sale can be discounted. */
function itemPricing(store: MockStore, item: MockItem, now: number) {
  const listPrice = store.products.find(product => product.id === item.productId)?.price
  if (typeof listPrice !== 'number') return {}
  const { unitPrice, originalUnitPrice, discountPercent, discountReason } = item.status === 'AVAILABLE' || item.status === 'RESERVED' ? boxPrice(listPrice, item.expiresAt, now) : boxPrice(listPrice, undefined, now)
  return { unitPrice, originalUnitPrice, discountPercent, discountReason }
}
const paymentRow = (ctx: HandlerContext, { qrCode: _qrCode, ...payment }: MockPayment) => {
  const order = ctx.store.orders.find(candidate => candidate.id === payment.orderId)
  return { ...payment, orderCode: order?.orderCode, machineCode: order?.machineCode }
}

/** Earliest physically present bowl of a slot: the only one that can be dispensed. */
function headOf(store: MockStore, slotId: string): MockItem | undefined {
  return store.items.filter(item => item.slotId === slotId && PRESENT_STATUSES.includes(item.status))
    .sort((a, b) => a.loadedAt.localeCompare(b.loadedAt) || a.id.localeCompare(b.id))[0]
}

function history(store: MockStore, item: MockItem, type: MockStore['transactions'][number]['type'], at: number, extra: Partial<MockStore['transactions'][number]>) {
  store.transactions.push({ id: newId(), inventoryItemId: item.id, batchId: item.batchId, batchCode: item.batchCode, machineId: item.machineId, slotId: item.slotId, type, createdAt: iso(at), ...extra })
}

function setItemStatus(item: MockItem, status: MockItem['status'], at: number) {
  item.status = status
  item.updatedAt = iso(at)
}

function allocationItems(store: MockStore, order: MockOrder): MockItem[] {
  const ids = new Set(order.items.flatMap(line => line.allocations.map(allocation => allocation.inventoryItemId)))
  return store.items.filter(item => ids.has(item.id))
}

function releaseOrder(ctx: HandlerContext, order: MockOrder, reason: string) {
  const at = ctx.now
  order.status = 'CANCELLED'
  order.cancelledAt = iso(at)
  for (const line of order.items) for (const allocation of line.allocations) Object.assign(allocation, { status: 'RELEASED', releasedAt: iso(at) })
  for (const item of allocationItems(ctx.store, order)) {
    setItemStatus(item, 'AVAILABLE', at)
    history(ctx.store, item, 'RETURN', at, { referenceId: order.id, reason, statusBefore: 'RESERVED', statusAfter: 'AVAILABLE' })
  }
}

function markPaid(store: MockStore, order: MockOrder, payment: MockPayment, now: number) {
  Object.assign(payment, { status: 'SUCCESS', paidAt: iso(now), transactionId: `MOCK-TXN-${randomCode(8)}`, qrCode: undefined })
  order.status = 'PAID'
  order.paidAt = iso(now)
  createDispenseCommands(store, order, now)
}

/**
 * Plays a verified payment webhook for the newest live kiosk order still waiting on a PENDING QR (mock-only control used
 * by the UX tests to time PAID ≤ 3 s after the webhook). Returns the order code, or null when nothing was payable.
 */
export function payLatestKioskOrder(ctx: HandlerContext): string | null {
  advanceOrders(ctx)
  const order = [...ctx.store.orders].reverse().find(candidate => candidate.live && candidate.status === 'PENDING_PAYMENT' && latestPayment(ctx.store, candidate.id)?.status === 'PENDING')
  if (!order) return null
  markPaid(ctx.store, order, latestPayment(ctx.store, order.id)!, ctx.now)
  return order.orderCode
}

/**
 * Simulates what the backend does in the background (payment webhook, dispensing, reservation sweep) for kiosk orders:
 * PENDING_PAYMENT → PAID (webhook) → DISPENSING (command acknowledged, after a quarter of dispenseMs) → COMPLETED or
 * DISPENSE_FAILED (machine report, after dispenseMs). The real dispense-command read endpoint is BE 3.3 (due 30/11).
 */
export function advanceOrders(ctx: HandlerContext) {
  const { store, now, options } = ctx
  for (const order of store.orders) {
    if (!order.live) continue
    const payment = latestPayment(store, order.id)
    if (order.status === 'PENDING_PAYMENT') {
      if (payment?.status === 'PENDING' && payment.expiredAt && Date.parse(payment.expiredAt) <= now) payment.status = 'EXPIRED'
      if (options.autoPay && payment?.status === 'PENDING' && Date.parse(payment.createdAt) + options.autoPayMs <= now) markPaid(store, order, payment, now)
      else if (order.expiresAt && Date.parse(order.expiresAt) <= now) releaseOrder(ctx, order, 'RESERVATION_EXPIRED')
    }
    const paidAt = order.paidAt ? Date.parse(order.paidAt) : NaN
    const commands = store.dispenseCommands.filter(command => command.orderId === order.id)
    if (order.status === 'PAID' && paidAt + options.dispenseMs / 4 <= now) {
      order.status = 'DISPENSING'
      for (const command of commands) if (command.status === 'PENDING') Object.assign(command, { status: 'SENT', sentAt: iso(now), updatedAt: iso(now) })
    }
    if (order.status !== 'DISPENSING' || paidAt + options.dispenseMs > now || options.dispense === 'slow') continue
    if (options.dispense === 'fail') {
      order.status = 'DISPENSE_FAILED'
      for (const command of commands) Object.assign(command, { status: 'FAILED', acknowledgedAt: command.acknowledgedAt ?? iso(now), completedAt: iso(now), updatedAt: iso(now) })
      for (const item of allocationItems(store, order)) setItemStatus(item, 'DISPENSE_FAILED', now)
      continue
    }
    order.status = 'COMPLETED'
    order.completedAt = iso(now)
    for (const command of commands) Object.assign(command, { status: 'SUCCESS', sentAt: command.sentAt ?? iso(now), acknowledgedAt: command.acknowledgedAt ?? iso(now), completedAt: iso(now), updatedAt: iso(now) })
    for (const line of order.items) for (const allocation of line.allocations) allocation.status = 'DISPENSED'
    for (const item of allocationItems(store, order)) {
      setItemStatus(item, 'SOLD', now)
      history(store, item, 'SALE', now, { referenceId: order.id, reason: 'ORDER_COMPLETED', statusBefore: 'RESERVED', statusAfter: 'SOLD' })
    }
  }
}

/**
 * Like the payment webhook + DispenseService for a kiosk order: one PENDING command per bowl, created with the move to
 * PAID. advanceOrders then sends them (SENT, order DISPENSING) and ends them SUCCESS, or FAILED with scenario `dispense-failed`.
 */
function createDispenseCommands(store: MockStore, order: MockOrder, now: number) {
  for (const allocation of order.items.flatMap(line => line.allocations)) {
    const item = store.items.find(candidate => candidate.id === allocation.inventoryItemId)
    if (!item) continue
    const code = `D-${Array.from({ length: 16 }, () => '0123456789ABCDEF'[Math.floor(Math.random() * 16)]).join('')}`
    store.dispenseCommands.push({
      id: newId(), commandCode: code, orderId: order.id, machineId: order.machineId, slotId: item.slotId, slotCode: allocation.slotCode ?? item.slotCode,
      inventoryItemId: item.id, status: 'PENDING', createdAt: iso(now), sentAt: null, acknowledgedAt: null, completedAt: null, updatedAt: iso(now),
    })
  }
}

const latestPayment = (store: MockStore, orderId: string): MockPayment | undefined =>
  store.payments.filter(payment => payment.orderId === orderId).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]

const kioskPaymentView = (payment: MockPayment) => ({
  paymentId: payment.id, orderId: payment.orderId, provider: payment.provider, status: payment.status, amount: payment.amount,
  qrCode: payment.status === 'PENDING' ? payment.qrCode ?? null : null, expiresAt: payment.expiredAt,
})

function kioskOrderView(store: MockStore, order: MockOrder) {
  const payment = latestPayment(store, order.id)
  return {
    id: order.id, orderCode: order.orderCode, machineId: order.machineId, status: order.status,
    items: order.items.map(({ productId, sku, productName, quantity, unitPrice, totalPrice, originalUnitPrice, discountAmount, discountPercent, discountReason }) => ({ productId, sku, productName, quantity, unitPrice, totalPrice, originalUnitPrice: originalUnitPrice ?? unitPrice, discountAmount: discountAmount ?? 0, discountPercent: discountPercent ?? null, discountReason: discountReason ?? null })),
    subtotal: order.subtotal, totalAmount: order.totalAmount, discountAmount: order.discountAmount ?? 0, createdAt: order.createdAt, expiresAt: order.expiresAt, cancelledAt: order.cancelledAt ?? null,
    currentPayment: payment ? kioskPaymentView(payment) : null,
  }
}

function findKioskOrder(ctx: HandlerContext): MockOrder {
  const order = byId(ctx.store.orders, ctx.params.orderId, 'Không tìm thấy đơn hàng.')
  if (order.machineId !== ctx.machineId) throw notFound('Không tìm thấy đơn hàng.')
  return order
}

/** Slots of the machine whose head can be sold for at least the reservation window. */
function sellableHeads(ctx: HandlerContext, machineId: string) {
  const { store, now } = ctx
  const holdUntil = now + RESERVATION_MS
  const machine = store.machines.find(candidate => candidate.id === machineId)
  if (machine?.status !== 'ACTIVE') return []
  return store.slots.filter(slot => slot.machineId === machineId && slot.status === 'ACTIVE').flatMap(slot => {
    const head = headOf(store, slot.id)
    if (!head || head.status !== 'AVAILABLE' || Date.parse(head.expiresAt) <= holdUntil) return []
    return store.products.some(product => product.id === head.productId && product.status === 'ACTIVE') ? [{ slot, head }] : []
  })
}

function machineForm(body: unknown, allowed: readonly string[]) {
  const form = new Form(body, allowed)
  // Contract limits: name 1–200, location 1–500.
  const name = form.text('name', 200), location = form.text('location', 500)
  const minTemperature = form.decimal('minTemperature', -100, 100), maxTemperature = form.decimal('maxTemperature', -100, 100)
  const minHumidity = form.decimal('minHumidity', 0, 100), maxHumidity = form.decimal('maxHumidity', 0, 100)
  return { form, values: { name, location, minTemperature, maxTemperature, minHumidity, maxHumidity } }
}
/**
 * After bean validation passed, the backend service checks min < max and answers a plain 400 without field errors
 * (MachineService), so the mock does the same.
 */
function checkThresholdOrder(values: { minTemperature: number; maxTemperature: number; minHumidity: number; maxHumidity: number }) {
  if (values.minTemperature >= values.maxTemperature || values.minHumidity >= values.maxHumidity) {
    throw new MockHttpError(400, 'Minimum environmental thresholds must be strictly below maximum thresholds')
  }
}
const MACHINE_FIELDS = ['name', 'location', 'minTemperature', 'maxTemperature', 'minHumidity', 'maxHumidity'] as const

function productForm(body: unknown, allowed: readonly string[]) {
  const form = new Form(body, allowed)
  // Contract limits: name 1–200, description unbounded TEXT, imageUrl up to 2048.
  const name = form.text('name', 200), description = form.optionalText('description', Infinity), imageUrl = form.optionalText('imageUrl', 2048)
  const price = form.decimal('price', 0.01, 9_999_999_999.99)
  return { form, values: { name, description, price, imageUrl } }
}
const PRODUCT_FIELDS = ['name', 'description', 'price', 'imageUrl'] as const

function statusForm<T extends string>(ctx: HandlerContext, values: readonly T[]): T {
  const form = new Form(ctx.body, ['status'])
  const status = form.oneOf('status', values)
  form.done()
  return status
}

// ---- work tickets (draft of backend 4.3, api-contract/drafts/work-tickets.yaml). Messages in English as the backend would send.
const TICKET_STATUSES = ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'] as const
const TICKET_TYPES = ['RESTOCK', 'MAINTENANCE'] as const
/** Holds TICKET_WRITE: sees every ticket, opens, assigns and cancels. Everyone else only ever gets their own. */
const managesTickets = (user: MockUser) => draftPermissionsOfUser(user).includes('TICKET_WRITE')
function findTicket(ctx: HandlerContext): MockTicket {
  if (!UUID_PATTERN.test(decode(ctx.params.id))) throw new MockHttpError(400, 'Invalid request parameter', { id: 'Must be a valid UUID' })
  const ticket = byId(ctx.store.tickets, ctx.params.id, 'Work ticket not found')
  // Not disclosed to someone who may not see it: the same 404 as an unknown id.
  if (!managesTickets(ctx.user!) && ticket.assigneeId !== ctx.user!.id) throw notFound('Work ticket not found')
  return ticket
}
/** assigneeId of a body: an ACTIVE account holding STAFF; otherwise a field error (and null). */
function ticketAssignee(ctx: HandlerContext, form: Form, value: unknown): MockUser | null {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) { form.reject('assigneeId', 'Must be a valid UUID'); return null }
  const user = ctx.store.users.find(candidate => candidate.id === value)
  if (!user || user.status !== 'ACTIVE' || !user.roles.includes('STAFF')) { form.reject('assigneeId', 'Assignee must be an active STAFF account'); return null }
  return user
}
function assignTo(ticket: MockTicket, assignee: MockUser, by: MockUser, at: string) {
  Object.assign(ticket, { status: 'ASSIGNED', assigneeId: assignee.id, assigneeName: assignee.fullName, assignedAt: at, assignedById: by.id, assignedByName: by.fullName, updatedAt: at })
}
function onlyAssignee(ctx: HandlerContext, ticket: MockTicket) {
  if (ticket.assigneeId !== ctx.user!.id) throw new MockHttpError(403, 'Only the assignee can do this')
}
/** FE 7.2: the line of a RESTOCK ticket the assignee (with INVENTORY_WRITE) works on, while IN_PROGRESS. */
function findRestockLine(ctx: HandlerContext) {
  const ticket = findTicket(ctx)
  onlyAssignee(ctx, ticket)
  if (!permissionsOfUser(ctx.store, ctx.user!).includes('INVENTORY_WRITE')) throw new MockHttpError(403, 'Access denied')
  const line = ticket.restockLines?.find(candidate => candidate.id === decode(ctx.params.lineId))
  if (!line) throw notFound('Restock line not found')
  if (ticket.type !== 'RESTOCK' || ticket.status !== 'IN_PROGRESS') throw conflict('Ticket is not IN_PROGRESS')
  return { ticket, line }
}
function touchRestock(ticket: MockTicket, now: number) {
  ticket.reconciliation = restockReconciliation(ticket.restockLines ?? [])
  ticket.updatedAt = iso(now)
}
/** Runs another mock endpoint with this request's caller (the restock lines reuse the inventory rules as they are). */
function callRoute(ctx: HandlerContext, method: string, path: string, body: unknown): Reply {
  for (const candidate of routes) {
    const match = candidate.method === method ? candidate.pattern.exec(path) : null
    if (match) return candidate.handle({ ...ctx, params: match.groups ?? {}, body })
  }
  throw new MockHttpError(501, `Mock chưa có handler cho ${method} ${path}`)
}
/** Same as LOW_STOCK_THRESHOLD of src/admin/overview.ts: an ACTIVE slot with at most this many sellable bowls is low. */
export const MOCK_LOW_STOCK_THRESHOLD = 1
/**
 * Lines the server writes when a RESTOCK ticket is created (proposal of drafts/work-tickets.yaml): one per ACTIVE slot of
 * the machine below the low-stock threshold (sellable = AVAILABLE and not expired, at most MOCK_LOW_STOCK_THRESHOLD),
 * planned = the slot's free places, product = the one of the newest bowl ever loaded in the slot, batch = the loadable
 * batch of that product (not expired, bowls left) expiring first, or null when there is none. Slot code order. A slot
 * without a free place, or that never held a bowl (no product to plan), gets no line.
 */
export function planRestockLines(store: MockStore, machineId: string, now: number): MockRestockLine[] {
  const lines: MockRestockLine[] = []
  const slots = store.slots.filter(slot => slot.machineId === machineId && slot.status === 'ACTIVE').sort((a, b) => a.slotCode.localeCompare(b.slotCode))
  for (const slot of slots) {
    const present = presentItems(store, slot.id)
    const sellable = present.filter(item => item.status === 'AVAILABLE' && !isExpired(item, now)).length
    const free = slot.capacity - present.length
    if (sellable > MOCK_LOW_STOCK_THRESHOLD || free <= 0) continue
    const newest = store.items.filter(item => item.slotId === slot.id).sort((a, b) => b.loadedAt.localeCompare(a.loadedAt))[0]
    const product = newest && store.products.find(candidate => candidate.id === newest.productId)
    if (!product?.id) continue
    const batch = store.batches
      .filter(candidate => candidate.productId === product.id && Date.parse(candidate.expiresAt) > now
        && store.items.filter(item => item.batchId === candidate.id).length < candidate.quantity)
      .sort((a, b) => a.expiresAt.localeCompare(b.expiresAt))[0]
    lines.push({
      id: newId(), slotId: slot.id, slotCode: slot.slotCode, productId: product.id, productName: product.name ?? '',
      batchId: batch?.id ?? null, batchCode: batch?.batchCode ?? null, batchExpiresAt: batch?.expiresAt ?? null,
      plannedQuantity: free, loadedQuantity: 0, removedQuantity: 0,
    })
  }
  return lines
}
/**
 * Rule of POST /complete for a RESTOCK ticket (draft): the LOW_STOCK alerts of its machine still open whose slot has a
 * line loaded in full (or, without a slot, when every line is) are resolved by the system. Returns their ids.
 */
function resolveLowStock(store: MockStore, ticket: MockTicket, now: number): string[] {
  const lines = ticket.restockLines ?? []
  const full = lines.filter(line => line.loadedQuantity >= line.plannedQuantity)
  const resolved: string[] = []
  for (const alert of store.alerts) {
    if (alert.type !== 'LOW_STOCK' || alert.machineId !== ticket.machineId || alert.status === 'RESOLVED') continue
    const line = alert.slotId ? full.find(candidate => candidate.slotId === alert.slotId) : undefined
    if (alert.slotId ? !line : full.length !== lines.length) continue
    const at = iso(Math.max(now, Date.parse(alert.triggeredAt)))
    const what = line ? `đã nạp ${line.loadedQuantity} hộp vào ngăn ${line.slotCode}.` : `đã nạp đủ ${lines.length} ngăn theo kế hoạch.`
    Object.assign(alert, { status: 'RESOLVED', resolvedAt: at, resolvedById: null, resolvedByName: 'Hệ thống', resolutionNote: `Tự đóng khi hoàn tất phiếu nạp hàng “${ticket.title}”: ${what}`, updatedAt: at })
    resolved.push(alert.id)
  }
  return resolved
}

// ---- maintenance schedules (draft of backend 4.5, api-contract/drafts/maintenance-schedules.yaml). English messages.
const SCHEDULE_FIELDS = ['machineId', 'title', 'intervalDays', 'startDate', 'assigneeId', 'note'] as const
function findSchedule(ctx: HandlerContext): MockSchedule {
  if (!UUID_PATTERN.test(decode(ctx.params.id))) throw new MockHttpError(400, 'Invalid request parameter', { id: 'Must be a valid UUID' })
  return byId(ctx.store.schedules, ctx.params.id, 'Maintenance schedule not found')
}
const dueDateOf = (schedule: MockSchedule) => vietnamDateOf(schedule.nextDueAt)
/** What the server answers: the stored row plus `overdue` as of now (active and the due day is before today). */
function scheduleView(schedule: MockSchedule, now: number) {
  const due = dueDateOf(schedule)
  return { ...schedule, overdue: schedule.active && !!due && due < vietnamDate(now) }
}
/** The due date rule of the draft (same function as the web's preview). */
function recomputeDue(schedule: MockSchedule, now: number) {
  schedule.nextDueAt = schedule.active ? dueInstant(nextDueDate(scheduleBase(schedule), schedule.intervalDays, vietnamDate(now))) : null
}
/** 409 when another active schedule of the same machine already has this title (case-insensitive). */
function duplicateTitle(store: MockStore, machineId: string, title: string, except?: string): boolean {
  return store.schedules.some(other => other.active && other.id !== except && other.machineId === machineId && other.title.toLowerCase() === title.toLowerCase())
}
/** The daily job of the draft: one MAINTENANCE ticket for a schedule due today or earlier, given to its assignee. */
function openScheduleTicket(store: MockStore, schedule: MockSchedule, now: number) {
  const at = iso(now)
  const assignee = schedule.assigneeId ? store.users.find(user => user.id === schedule.assigneeId && user.status === 'ACTIVE' && user.roles.includes('STAFF')) : undefined
  const ticket: MockTicket = {
    id: newId(), type: 'MAINTENANCE', status: assignee ? 'ASSIGNED' : 'OPEN', title: `${schedule.title} · máy ${schedule.machineCode}`.slice(0, 200),
    description: [`Bảo trì định kỳ theo lịch (mỗi ${schedule.intervalDays} ngày).`, schedule.note].filter(Boolean).join(' '),
    machineId: schedule.machineId, machineCode: schedule.machineCode, machineName: schedule.machineName ?? null, alertId: null,
    dueAt: dueInstant(addDays(dueDateOf(schedule)!, 1)), assigneeId: assignee?.id ?? null, assigneeName: assignee?.fullName ?? null,
    createdById: schedule.createdById, createdByName: schedule.createdByName ?? null,
    assignedAt: assignee ? at : null, assignedById: assignee ? schedule.createdById : null, assignedByName: assignee ? schedule.createdByName ?? null : null,
    startedAt: null, startedById: null, startedByName: null, completedAt: null, completedById: null, completedByName: null, completionNote: null,
    cancelledAt: null, cancelledById: null, cancelledByName: null, cancelReason: null, createdAt: at, updatedAt: at,
  }
  store.tickets.push(ticket)
  Object.assign(schedule, { openTicketId: ticket.id, openTicketStatus: ticket.status })
}
/**
 * Plays the server's background work whenever schedules are read or written: a COMPLETED ticket moves its schedule
 * (lastCompletedAt, nextDueAt = completed day + N), a CANCELLED one only frees it, and a due schedule without a ticket
 * gets one. Not run on other endpoints, so the work ticket screens see the seed unchanged until schedules are opened.
 */
function syncSchedules(store: MockStore, now: number) {
  const today = vietnamDate(now)
  for (const schedule of store.schedules) {
    if (schedule.openTicketId) {
      const ticket = store.tickets.find(candidate => candidate.id === schedule.openTicketId)
      if (!ticket || ticket.status === 'CANCELLED') Object.assign(schedule, { openTicketId: null, openTicketStatus: null })
      else if (ticket.status === 'COMPLETED') {
        Object.assign(schedule, { openTicketId: null, openTicketStatus: null, lastCompletedAt: ticket.completedAt, updatedAt: ticket.completedAt ?? iso(now) })
        recomputeDue(schedule, now)
      } else schedule.openTicketStatus = ticket.status
    }
    const due = dueDateOf(schedule)
    if (schedule.active && !schedule.openTicketId && due && due <= today) openScheduleTicket(store, schedule, now)
  }
}

function route(method: string, template: string, policy: Policy, handle: Route['handle']): Route {
  const source = template.replace(/:(\w+)/g, '(?<$1>[^/]+)')
  return { method, pattern: new RegExp(`^${source}/?$`), policy, handle }
}

function base64Url(text: string): string {
  return btoa(String.fromCharCode(...new TextEncoder().encode(text))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export const routes: Route[] = [
  // ---- auth
  route('POST', '/auth/login', 'public', ctx => {
    const form = new Form(ctx.body, ['email', 'password'])
    const email = form.email('email'), password = form.password('password')
    form.done()
    const user = ctx.store.users.find(candidate => candidate.email === email)
    if (!user || user.password !== password || user.status !== 'ACTIVE') throw new MockHttpError(401, 'Invalid email or password')
    const iat = Math.floor(ctx.now / 1000), expiresIn = 3600
    // `iatMs` (mock only) keeps the exact issue time: `iat` is in whole seconds, too coarse for the `expire` scenario.
    const claims = { sub: user.id, email: user.email, roles: user.roles.map(role => `ROLE_${role}`), iat, iatMs: ctx.now, exp: iat + expiresIn }
    return ok({ accessToken: `${base64Url(JSON.stringify({ alg: 'none', typ: 'JWT' }))}.${base64Url(JSON.stringify(claims))}.mock`, tokenType: 'Bearer', expiresIn })
  }),
  route('GET', '/auth/me', 'any', ctx => {
    const { id, email, fullName, phone, status, roles } = ctx.user!
    // Read from the store's role table like #48 does per request, so a change on screen A3 shows up here at once.
    // Listed in catalog order (PERMISSIONS of the web), unknown codes last.
    const rank = (code: string) => { const index = (PERMISSIONS as readonly string[]).indexOf(code); return index < 0 ? PERMISSIONS.length : index }
    const permissions = permissionsOfUser(ctx.store, ctx.user!).sort((a, b) => rank(a) - rank(b) || a.localeCompare(b, 'en'))
    const data: AuthMe['schemas']['AuthMeResponse'] = { id, email, fullName, phone, status, roles, permissions }
    return ok(data)
  }),

  // ---- roles & permissions (backend #48, draft api-contract/drafts/roles-permissions.yaml)
  route('GET', '/permissions', { permission: 'PERMISSION_MANAGE' }, ctx => ok([...ctx.store.permissions].sort((a, b) => a.code.localeCompare(b.code, 'en')).map(permission => ({ ...permission })))),
  route('GET', '/roles', { permission: 'PERMISSION_MANAGE' }, ctx => ok([...ctx.store.roles].sort((a, b) => a.name.localeCompare(b.name, 'en')).map(roleView))),
  route('GET', '/roles/:id', { permission: 'PERMISSION_MANAGE' }, ctx => ok(roleView(findRole(ctx)))),
  route('PUT', '/roles/:id/permissions', { permission: 'PERMISSION_MANAGE' }, ctx => {
    // Same order as the backend: body (400), role (404), lockout guard (409).
    const codes = replaceCodes(ctx)
    const role = findRole(ctx)
    if (role.name === 'ADMIN' && ADMIN_REQUIRED.some(code => !codes.includes(code))) {
      throw conflict(`The ADMIN role must keep ${ADMIN_REQUIRED.join(' and ')}; otherwise nobody could manage users or permissions`)
    }
    role.permissions = [...codes].sort()
    return ok(roleView(role))
  }),

  // ---- users
  route('GET', '/users', 'admin', ctx => {
    const { query } = ctx
    const status = query.get('status'), role = query.get('role')
    if (status && !(USER_STATUSES as readonly string[]).includes(status)) throw new MockHttpError(400, 'Tham số lọc không hợp lệ.', { status: `Phải là một trong: ${USER_STATUSES.join(', ')}.` })
    if (role && role !== 'ADMIN' && role !== 'STAFF') throw new MockHttpError(400, 'Tham số lọc không hợp lệ.', { role: 'Phải là ADMIN hoặc STAFF.' })
    const rows = ctx.store.users.filter(user => eq(query, 'status', user.status) && (!role || user.roles.includes(role)))
    return ok(paginate(rows.map(userView), query, { sorts: { createdAt: row => row.createdAt }, defaultSort: 'createdAt,desc', fixedSort: true }))
  }),
  route('POST', '/users', 'admin', ctx => {
    const form = new Form(ctx.body, ['email', 'password', 'fullName', 'phone'])
    const email = form.email('email'), password = form.password('password', 12), fullName = form.text('fullName', 200), phone = form.optionalText('phone', 32)
    if (password && new TextEncoder().encode(password).length > 72) form.reject('password', 'Tối đa 72 byte.')
    form.done()
    if (ctx.store.users.some(user => user.email === email)) throw conflict('Email này đã được sử dụng.')
    const at = iso(ctx.now)
    const user: MockUser = { id: newId(), email, password, fullName, phone, status: 'ACTIVE', roles: ['STAFF'], createdAt: at, updatedAt: at }
    ctx.store.users.push(user)
    return created(userView(user))
  }),
  route('PUT', '/users/:id', 'admin', ctx => {
    const user = findUser(ctx)
    const form = new Form(ctx.body, ['fullName', 'phone'])
    const fullName = form.text('fullName', 200), phone = form.optionalText('phone', 32)
    form.done()
    Object.assign(user, { fullName, phone, updatedAt: iso(ctx.now) })
    return ok(userView(user))
  }),
  route('PATCH', '/users/:id/status', 'admin', ctx => {
    const user = findUser(ctx)
    const status = statusForm(ctx, USER_STATUSES)
    if (status !== 'ACTIVE' && user.id === ctx.user!.id) throw conflict('Không thể tự khóa hoặc vô hiệu hóa tài khoản của chính mình.')
    const otherAdmins = ctx.store.users.filter(other => other.id !== user.id && other.status === 'ACTIVE' && other.roles.includes('ADMIN'))
    if (status !== 'ACTIVE' && user.status === 'ACTIVE' && user.roles.includes('ADMIN') && !otherAdmins.length) throw conflict('Không thể vô hiệu hóa ADMIN đang hoạt động cuối cùng.')
    Object.assign(user, { status, updatedAt: iso(ctx.now) })
    return ok(userView(user))
  }),

  // ---- products
  route('GET', '/products', 'any', ctx => {
    const { query } = ctx
    const rows = ctx.store.products.filter(product => eq(query, 'status', product.status) && contains(query.get('search')?.trim() ?? null, product.sku, product.name))
    return ok(paginate(rows, query, { sorts: { id: row => row.id, sku: row => row.sku, name: row => row.name, price: row => row.price, status: row => row.status, createdAt: row => row.createdAt, updatedAt: row => row.updatedAt }, defaultSort: 'createdAt,desc' }))
  }),
  route('POST', '/products', 'admin', ctx => {
    const { form, values } = productForm(ctx.body, ['sku', ...PRODUCT_FIELDS])
    const sku = form.text('sku', 64).toUpperCase()
    form.done()
    if (ctx.store.products.some(product => product.sku === sku)) throw conflict('SKU is already in use') // the backend's message (contract example)
    const at = iso(ctx.now)
    const product = { id: newId(), sku, ...values, status: 'ACTIVE' as const, createdAt: at, updatedAt: at }
    ctx.store.products.push(product)
    return created(product)
  }),
  route('PUT', '/products/:id', 'admin', ctx => {
    const product = findProduct(ctx)
    const { form, values } = productForm(ctx.body, PRODUCT_FIELDS)
    form.done()
    Object.assign(product, values, { updatedAt: iso(ctx.now) })
    return ok(product)
  }),
  route('PATCH', '/products/:id/status', 'admin', ctx => {
    const product = findProduct(ctx)
    Object.assign(product, { status: statusForm(ctx, PRODUCT_STATUSES), updatedAt: iso(ctx.now) })
    return ok(product)
  }),

  // ---- machines
  route('GET', '/machines', 'any', ctx => {
    const { query } = ctx
    const rows = ctx.store.machines.filter(machine => eq(query, 'status', machine.status) && contains(query.get('search'), machine.code, machine.name, machine.location))
    return ok(paginate(rows, query, { sorts: { id: row => row.id, code: row => row.code, name: row => row.name, location: row => row.location, status: row => row.status, createdAt: row => row.createdAt, updatedAt: row => row.updatedAt }, defaultSort: 'createdAt,desc' }))
  }),
  route('GET', '/machines/:machineId', 'any', ctx => ok(findMachine(ctx))),
  route('POST', '/machines', 'admin', ctx => {
    const { form, values } = machineForm(ctx.body, ['code', ...MACHINE_FIELDS])
    const code = form.text('code', 64).toUpperCase()
    form.done()
    checkThresholdOrder(values)
    if (ctx.store.machines.some(machine => machine.code === code)) throw conflict('Machine code is already in use')
    const at = iso(ctx.now)
    const machine = { id: newId(), code, ...values, status: 'INACTIVE' as const, lastSeenAt: null, createdAt: at, updatedAt: at }
    ctx.store.machines.push(machine)
    return created(machine)
  }),
  route('PUT', '/machines/:machineId', 'admin', ctx => {
    const machine = findMachine(ctx)
    const { form, values } = machineForm(ctx.body, MACHINE_FIELDS)
    form.done()
    checkThresholdOrder(values)
    Object.assign(machine, values, { updatedAt: iso(ctx.now) })
    return ok(machine)
  }),
  route('PATCH', '/machines/:machineId/status', 'admin', ctx => {
    const machine = findMachine(ctx)
    Object.assign(machine, { status: statusForm(ctx, MACHINE_STATUSES), updatedAt: iso(ctx.now) })
    return ok(machine)
  }),

  // ---- slots
  route('GET', '/machines/:machineId/slots', 'any', ctx => {
    const machine = findMachine(ctx)
    const rows = ctx.store.slots.filter(slot => slot.machineId === machine.id && eq(ctx.query, 'status', slot.status))
    return ok(paginate(rows, ctx.query, { sorts: { id: row => row.id, slotCode: row => row.slotCode, capacity: row => row.capacity, status: row => row.status, createdAt: row => row.createdAt, updatedAt: row => row.updatedAt }, defaultSort: 'slotCode,asc' }))
  }),
  route('POST', '/machines/:machineId/slots', 'admin', ctx => {
    const machine = findMachine(ctx)
    const form = new Form(ctx.body, ['slotCode', 'capacity'])
    const slotCode = form.text('slotCode', 32).toUpperCase(), capacity = form.integer('capacity', 1, 2_147_483_647)
    form.done()
    if (ctx.store.slots.some(slot => slot.machineId === machine.id && slot.slotCode === slotCode)) throw conflict('Slot code is already in use for this machine') // MachineSlotService, English as the backend sends it
    const at = iso(ctx.now)
    const slot = { id: newId(), machineId: machine.id, slotCode, capacity, status: 'ACTIVE' as const, createdAt: at, updatedAt: at }
    ctx.store.slots.push(slot)
    return created(slot)
  }),
  route('PUT', '/machines/:machineId/slots/:slotId', 'admin', ctx => {
    const slot = findSlot(ctx)
    const form = new Form(ctx.body, ['capacity'])
    const capacity = form.integer('capacity', 1, 2_147_483_647)
    form.done()
    Object.assign(slot, { capacity, updatedAt: iso(ctx.now) })
    return ok(slot)
  }),
  route('PATCH', '/machines/:machineId/slots/:slotId/status', 'admin', ctx => {
    const slot = findSlot(ctx)
    Object.assign(slot, { status: statusForm(ctx, SLOT_STATUSES), updatedAt: iso(ctx.now) })
    return ok(slot)
  }),
  route('GET', '/machines/:machineId/slots/:slotId/inventory/summary', 'any', ctx => {
    const { store, now } = ctx
    const slot = findSlot(ctx)
    const present = store.items.filter(item => item.slotId === slot.id && PRESENT_STATUSES.includes(item.status))
    const machine = findMachine(ctx)
    const available = present.filter(item => item.status === 'AVAILABLE' && !isExpired(item, now))
    const activeProducts = new Set(store.products.filter(product => product.status === 'ACTIVE').map(product => product.id))
    const head = headOf(store, slot.id)
    return ok({
      machineId: slot.machineId, slotId: slot.id, capacity: slot.capacity, occupiedCount: present.length, availableCount: available.length,
      expiredCount: present.filter(item => item.status === 'EXPIRED' || isExpired(item, now)).length, reservedCount: present.filter(item => item.status === 'RESERVED').length,
      sellableCount: machine.status === 'ACTIVE' && slot.status === 'ACTIVE' ? available.filter(item => activeProducts.has(item.productId)).length : 0,
      remainingCapacity: Math.max(0, slot.capacity - present.length), asOf: iso(now),
      headStatus: head?.status ?? null, headExpired: head ? head.status === 'EXPIRED' || isExpired(head, now) : false,
    })
  }),

  // ---- kiosk credentials (ADMIN)
  route('GET', '/machines/:machineId/kiosk-credentials', 'admin', ctx => {
    const machine = findMachine(ctx)
    return ok(ctx.store.credentials.filter(credential => credential.machineId === machine.id).sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? '')).map(credentialView))
  }),
  route('POST', '/machines/:machineId/kiosk-credentials', 'admin', ctx => {
    const machine = findMachine(ctx)
    const at = iso(ctx.now), actor = ctx.user!.id
    for (const credential of ctx.store.credentials) {
      if (credential.machineId === machine.id && credential.status === 'ACTIVE') Object.assign(credential, { status: 'REVOKED', revokedAt: at, revokedBy: actor })
    }
    const keyPrefix = randomCode(12).toLowerCase()
    const credential: MockCredential = { credentialId: newId(), machineId: machine.id, apiKey: `fvk_${keyPrefix}_mock-${randomCode(24).toLowerCase()}`, keyPrefix, status: 'ACTIVE', createdAt: at, createdBy: actor }
    ctx.store.credentials.push(credential)
    const { credentialId, machineId, apiKey, status, createdAt } = credential
    return created({ credentialId, machineId, keyPrefix, apiKey, status, createdAt })
  }),
  route('POST', '/machines/:machineId/kiosk-credentials/:credentialId/revoke', 'admin', ctx => {
    const machine = findMachine(ctx)
    const credential = ctx.store.credentials.find(candidate => candidate.credentialId === decode(ctx.params.credentialId) && candidate.machineId === machine.id)
    if (!credential) throw notFound('Kiosk credential not found')
    if (credential.status === 'ACTIVE') Object.assign(credential, { status: 'REVOKED', revokedAt: iso(ctx.now), revokedBy: ctx.user!.id })
    return ok(credentialView(credential))
  }),

  // ---- heartbeat, sensor readings, events: draft of backend 3.4/3.5 (api-contract/drafts/machine-telemetry.yaml)
  route('GET', '/machines/:machineId/heartbeat', { permission: 'MACHINE_READ' }, ctx => ok(heartbeatView(heartbeatOf(ctx.store, findMachine(ctx).id)))),
  route('GET', '/machines/:machineId/sensor-readings', { permission: 'MACHINE_READ' }, ctx => {
    const machine = findMachine(ctx)
    const rows = ctx.store.readings.filter(reading => reading.machineId === machine.id && within(ctx.query, 'recordedFrom', 'recordedTo', reading.recordedAt))
    return ok(paginate(rows, ctx.query, { sorts: { recordedAt: row => row.recordedAt }, defaultSort: 'recordedAt,desc' }))
  }),
  route('GET', '/machines/:machineId/events', { permission: 'MACHINE_READ' }, ctx => {
    const machine = findMachine(ctx)
    const rows = ctx.store.machineEvents.filter(event => event.machineId === machine.id && eq(ctx.query, 'eventType', event.eventType) && within(ctx.query, 'createdFrom', 'createdTo', event.createdAt))
    return ok(paginate(rows, ctx.query, { sorts: { createdAt: row => row.createdAt }, defaultSort: 'createdAt,desc' }))
  }),

  // ---- maintenance commands: draft of backend 4.2 (api-contract/drafts/machine-maintenance.yaml), FE 7.4
  route('GET', '/machines/:machineId/maintenance-commands', { permission: 'MACHINE_READ' }, ctx => {
    const machine = findMachine(ctx)
    const rows = ctx.store.maintenanceCommands.filter(command => command.machineId === machine.id)
    return ok(paginate(rows.map(command => ({ ...command })), ctx.query, { sorts: { createdAt: row => row.createdAt }, defaultSort: 'createdAt,desc', fixedSort: true }))
  }),
  route('POST', '/machines/:machineId/maintenance-commands', { draftPermission: 'MACHINE_MAINTENANCE' }, ctx => created(createMaintenanceCommand(ctx))),

  // ---- product batches
  route('GET', '/product-batches', 'any', ctx => {
    const rows = ctx.store.batches.filter(batch => eq(ctx.query, 'productId', batch.productId))
    return ok(paginate(rows, ctx.query, { sorts: { id: row => row.id, batchCode: row => row.batchCode, manufacturedAt: row => row.manufacturedAt, expiresAt: row => row.expiresAt, quantity: row => row.quantity, createdAt: row => row.createdAt }, defaultSort: 'createdAt,desc' }))
  }),
  route('POST', '/product-batches', 'any', ctx => {
    const form = new Form(ctx.body, ['batchCode', 'productId', 'manufacturedAt', 'expiresAt', 'quantity'])
    const batchCode = form.text('batchCode', 64).toUpperCase(), productId = form.text('productId')
    const manufacturedAt = form.instant('manufacturedAt'), expiresAt = form.instant('expiresAt'), quantity = form.integer('quantity', 1, 2_147_483_647)
    form.done()
    // Same order as ProductBatchService.createBatch: duplicate code (409), product (404), product ACTIVE (409), then the
    // two date rules as a 400 without field errors.
    if (ctx.store.batches.some(batch => batch.batchCode === batchCode)) throw conflict('Mã lô này đã tồn tại.')
    const product = ctx.store.products.find(candidate => candidate.id === productId)
    if (!product) throw notFound('Không tìm thấy sản phẩm.')
    if (product.status !== 'ACTIVE') throw conflict('Sản phẩm đang ngừng bán, không thể tạo lô.')
    if (expiresAt <= manufacturedAt) throw new MockHttpError(400, 'Hạn dùng phải sau thời điểm sản xuất.')
    if (expiresAt <= ctx.now) throw new MockHttpError(400, 'Hạn dùng phải ở tương lai.')
    const batch = { id: newId(), batchCode, productId, productSku: product.sku, productName: product.name, manufacturedAt: iso(manufacturedAt), expiresAt: iso(expiresAt), quantity, createdBy: ctx.user!.id, createdAt: iso(ctx.now) }
    ctx.store.batches.push(batch)
    return created(batch)
  }),

  // ---- inventory
  route('GET', '/inventory', 'any', ctx => {
    const { query, now } = ctx
    const rows = ctx.store.items.filter(item => eq(query, 'machineId', item.machineId) && eq(query, 'slotId', item.slotId) && eq(query, 'batchId', item.batchId) && eq(query, 'status', item.status) && flag(query, 'expired', isExpired(item, now)))
    return ok(paginate(rows.map(item => ({ ...itemView(item, now), ...itemPricing(ctx.store, item, now) })), query, { sorts: { id: row => row.id, status: row => row.status, loadedAt: row => row.loadedAt, createdAt: row => row.createdAt, updatedAt: row => row.updatedAt }, defaultSort: 'createdAt,desc' }))
  }),
  route('GET', '/inventory/transactions', 'any', ctx => {
    const { query } = ctx
    const rows = ctx.store.transactions.filter(row => eq(query, 'inventoryItemId', row.inventoryItemId) && eq(query, 'machineId', row.machineId) && eq(query, 'slotId', row.slotId) && eq(query, 'referenceId', row.referenceId) && eq(query, 'type', row.type))
    return ok(paginate(rows, query, { sorts: { createdAt: row => row.createdAt }, defaultSort: 'createdAt,desc', fixedSort: true }))
  }),
  route('POST', '/inventory/load', 'any', ctx => {
    const { store, now } = ctx
    const form = new Form(ctx.body, ['batchId', 'slotId', 'quantity'])
    const batchId = form.text('batchId'), slotId = form.text('slotId'), quantity = form.integer('quantity', 1, 1000)
    form.done()
    const batch = store.batches.find(candidate => candidate.id === batchId)
    const slot = store.slots.find(candidate => candidate.id === slotId)
    if (!batch) throw notFound('Không tìm thấy lô hàng.')
    if (!slot) throw notFound('Không tìm thấy ngăn.')
    const machine = store.machines.find(candidate => candidate.id === slot.machineId)
    const product = store.products.find(candidate => candidate.id === batch.productId)
    if (product?.status !== 'ACTIVE') throw conflict('Sản phẩm của lô đang ngừng bán.')
    if (Date.parse(batch.expiresAt) <= now) throw conflict('Lô hàng đã hết hạn.')
    if (machine?.status === 'INACTIVE') throw conflict('Máy đang ngừng hoạt động, không thể nạp hộp.')
    if (slot.status !== 'ACTIVE') throw conflict('Ngăn đang không hoạt động, không thể nạp hộp.')
    const occupied = store.items.filter(item => item.slotId === slot.id && PRESENT_STATUSES.includes(item.status)).length
    if (occupied + quantity > slot.capacity) throw conflict('Số hộp vượt quá sức chứa còn lại của ngăn.')
    if (store.items.filter(item => item.batchId === batch.id).length + quantity > batch.quantity) throw conflict('Số hộp vượt quá số lượng của lô.')
    const operationId = newId(), at = iso(now)
    const items = Array.from({ length: quantity }, (): MockItem => ({ id: newId(), batchId: batch.id, batchCode: batch.batchCode, productId: batch.productId, productName: batch.productName, machineId: slot.machineId, slotId: slot.id, slotCode: slot.slotCode, status: 'AVAILABLE', expiresAt: batch.expiresAt, loadedAt: at, createdAt: at, updatedAt: at }))
    for (const item of items) {
      store.items.push(item)
      history(store, item, 'LOAD', now, { referenceId: operationId, performedBy: ctx.user!.id, statusAfter: 'AVAILABLE' })
    }
    return created({ operationId, quantity, items: items.map(item => itemView(item, now)) })
  }),
  route('POST', '/inventory/:id/remove', 'any', ctx => {
    const { store, now } = ctx
    const item = byId(store.items, ctx.params.id, 'Không tìm thấy hộp hàng.')
    const form = new Form(ctx.body, ['reason'])
    const reason = form.text('reason', 500)
    form.done()
    if (item.status !== 'AVAILABLE' && item.status !== 'EXPIRED') throw conflict('Chỉ gỡ được hộp đang sẵn sàng hoặc đã hết hạn.')
    const before = item.status
    setItemStatus(item, 'REMOVED', now)
    item.removedAt = iso(now)
    // Like InventoryService.remove: a fresh random reference per removal, shared with no other row.
    history(store, item, 'REMOVE', now, { referenceId: newId(), performedBy: ctx.user!.id, reason, statusBefore: before, statusAfter: 'REMOVED' })
    return ok(itemView(item, now))
  }),

  // ---- orders
  route('GET', '/orders', 'any', ctx => {
    const { query } = ctx
    const rows = ctx.store.orders.filter(order => eq(query, 'status', order.status) && eq(query, 'machineId', order.machineId) && within(query, 'createdFrom', 'createdTo', order.createdAt) && contains(query.get('search'), order.orderCode)).map(order => ({
      id: order.id, orderCode: order.orderCode, machineId: order.machineId, machineCode: order.machineCode, status: order.status,
      itemCount: order.items.length, totalQuantity: order.items.reduce((sum, line) => sum + line.quantity, 0), totalAmount: order.totalAmount, discountAmount: order.discountAmount ?? 0,
      createdAt: order.createdAt, expiresAt: order.expiresAt, cancelledAt: order.cancelledAt,
    }))
    return ok(paginate(rows, query, { sorts: { createdAt: row => row.createdAt, totalAmount: row => row.totalAmount, orderCode: row => row.orderCode }, defaultSort: 'createdAt,desc' }))
  }),
  route('GET', '/orders/:id', 'any', ctx => {
    const { live: _live, ...stored } = byId(ctx.store.orders, ctx.params.id, 'Không tìm thấy đơn hàng.')
    // Draft pricing-discount.yaml (FE 7.5): 0 / equal prices when the line had no discount.
    const order = { ...stored, discountAmount: stored.discountAmount ?? 0, items: stored.items.map(line => ({ ...line, originalUnitPrice: line.originalUnitPrice ?? line.unitPrice, discountAmount: line.discountAmount ?? 0, discountPercent: line.discountPercent ?? null, discountReason: line.discountReason ?? null })) }
    const payments = ctx.store.payments.filter(payment => payment.orderId === order.id).map(({ id, provider, status, amount, createdAt, paidAt, expiredAt }) => ({ id, provider, status, amount, createdAt, paidAt, expiredAt }))
    return ok({ ...order, payments })
  }),

  // Draft of backend 3.3 (api-contract/drafts/dispense-commands.yaml): commands of one order, oldest first. An order
  // unknown to the mock (VITE_API_MOCK=dispense-commands with real orders) answers 404 like the backend would.
  route('GET', '/orders/:orderId/dispense-commands', 'any', ctx => {
    const order = byId(ctx.store.orders, ctx.params.orderId, 'Không tìm thấy đơn hàng.')
    const rows = ctx.store.dispenseCommands.filter(command => command.orderId === order.id)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
    return ok(rows.map(command => ({ ...command })))
  }),

  // ---- alerts: draft of backend 3.6 (api-contract/drafts/alerts.yaml). Messages in English as the backend would send.
  route('GET', '/alerts', { draftPermission: 'ALERT_READ' }, ctx => {
    const { query } = ctx
    const rows = ctx.store.alerts.filter(alert => eq(query, 'status', alert.status) && eq(query, 'severity', alert.severity) && eq(query, 'type', alert.type)
      && eq(query, 'machineId', alert.machineId) && within(query, 'triggeredFrom', 'triggeredTo', alert.triggeredAt)).map(alert => ({ ...alert }))
    return ok(paginate(rows, query, { sorts: { triggeredAt: row => row.triggeredAt }, defaultSort: 'triggeredAt,desc' }))
  }),
  route('GET', '/alerts/:id', { draftPermission: 'ALERT_READ' }, ctx => ok({ ...findAlert(ctx) })),
  route('POST', '/alerts/:id/acknowledge', { draftPermission: 'ALERT_WRITE' }, ctx => {
    const alert = findAlert(ctx)
    if (alert.status !== 'OPEN') throw conflict('Alert is not OPEN')
    const at = iso(ctx.now)
    Object.assign(alert, { status: 'ACKNOWLEDGED', acknowledgedAt: at, acknowledgedById: ctx.user!.id, acknowledgedByName: ctx.user!.fullName, updatedAt: at })
    return ok({ ...alert })
  }),
  route('POST', '/alerts/:id/resolve', { draftPermission: 'ALERT_WRITE' }, ctx => {
    let note: string | null = null
    if (ctx.body !== undefined) {
      const form = new Form(ctx.body, ['note'])
      note = form.optionalText('note', 500)
      form.done()
    }
    const alert = findAlert(ctx)
    if (alert.status === 'RESOLVED') throw conflict('Alert is already RESOLVED')
    // ck_alerts_resolution: resolved_at >= triggered_at.
    const at = iso(Math.max(ctx.now, Date.parse(alert.triggeredAt)))
    Object.assign(alert, { status: 'RESOLVED', resolvedAt: at, resolvedById: ctx.user!.id, resolvedByName: ctx.user!.fullName, resolutionNote: note, updatedAt: at })
    return ok({ ...alert })
  }),

  // ---- work tickets: draft of backend 4.3 (api-contract/drafts/work-tickets.yaml).
  route('GET', '/work-tickets', { draftPermission: 'TICKET_READ' }, ctx => {
    const { query } = ctx
    const errors: Record<string, string> = {}
    if (query.get('status') && !(TICKET_STATUSES as readonly string[]).includes(query.get('status')!)) errors.status = `Must be one of: ${TICKET_STATUSES.join(', ')}`
    if (query.get('type') && !(TICKET_TYPES as readonly string[]).includes(query.get('type')!)) errors.type = `Must be one of: ${TICKET_TYPES.join(', ')}`
    for (const name of ['machineId', 'assigneeId']) if (query.get(name) && !UUID_PATTERN.test(query.get(name)!)) errors[name] = 'Must be a valid UUID'
    if (Object.keys(errors).length) throw new MockHttpError(400, 'Invalid request parameter', errors)
    // Server-side scope: without TICKET_WRITE the assignee filter is always the caller.
    const assignee = managesTickets(ctx.user!) ? query.get('assigneeId') : ctx.user!.id
    const rows = ctx.store.tickets.filter(ticket => eq(query, 'status', ticket.status) && eq(query, 'type', ticket.type) && eq(query, 'machineId', ticket.machineId)
      && (!assignee || ticket.assigneeId === assignee)).map(ticket => ({ ...ticket }))
    return ok(paginate(rows, query, { sorts: { createdAt: row => row.createdAt, dueAt: row => row.dueAt }, defaultSort: 'createdAt,desc' }))
  }),
  route('GET', '/work-tickets/:id', { draftPermission: 'TICKET_READ' }, ctx => ok({ ...findTicket(ctx) })),
  route('POST', '/work-tickets', { draftPermission: 'TICKET_WRITE' }, ctx => {
    const form = new Form(ctx.body, ['type', 'machineId', 'title', 'description', 'dueAt', 'alertId', 'assigneeId'])
    const data = ctx.body as Record<string, unknown>
    const type = form.oneOf('type', TICKET_TYPES)
    const title = form.text('title', 200)
    const description = form.optionalText('description', 1000)
    const machineIdValid = typeof data.machineId === 'string' && UUID_PATTERN.test(data.machineId)
    const machine = machineIdValid ? ctx.store.machines.find(candidate => candidate.id === data.machineId) : undefined
    if (!machine) form.reject('machineId', machineIdValid ? 'Machine not found' : 'Must be a valid UUID')
    let dueAt: string | null = null
    if (data.dueAt !== undefined && data.dueAt !== null) {
      const due = form.instant('dueAt')
      if (due && due <= ctx.now) form.reject('dueAt', 'Must be in the future')
      else if (due) dueAt = iso(due)
    }
    let alert: MockAlert | undefined
    if (data.alertId !== undefined && data.alertId !== null) {
      alert = typeof data.alertId === 'string' ? ctx.store.alerts.find(candidate => candidate.id === data.alertId) : undefined
      if (!alert) form.reject('alertId', 'Alert not found')
      else if (machine && alert.machineId !== machine.id) form.reject('alertId', 'Alert belongs to another machine')
    }
    const assignee = data.assigneeId !== undefined && data.assigneeId !== null ? ticketAssignee(ctx, form, data.assigneeId) : null
    form.done()
    if (alert?.status === 'RESOLVED') throw conflict('Alert is already RESOLVED')
    const at = iso(ctx.now)
    const ticket: MockTicket = {
      id: newId(), type, status: 'OPEN', title, description, machineId: machine!.id, machineCode: machine!.code, machineName: machine!.name,
      alertId: alert?.id ?? null, dueAt, assigneeId: null, assigneeName: null, createdById: ctx.user!.id, createdByName: ctx.user!.fullName,
      assignedAt: null, assignedById: null, assignedByName: null, startedAt: null, startedById: null, startedByName: null,
      completedAt: null, completedById: null, completedByName: null, completionNote: null,
      cancelledAt: null, cancelledById: null, cancelledByName: null, cancelReason: null, createdAt: at, updatedAt: at,
    }
    if (type === 'RESTOCK') {
      const restockLines = planRestockLines(ctx.store, ticket.machineId, ctx.now)
      Object.assign(ticket, { restockLines, reconciliation: restockReconciliation(restockLines) })
    }
    if (assignee) assignTo(ticket, assignee, ctx.user!, at)
    ctx.store.tickets.push(ticket)
    return created({ ...ticket })
  }),
  route('POST', '/work-tickets/:id/assign', { draftPermission: 'TICKET_WRITE' }, ctx => {
    const form = new Form(ctx.body, ['assigneeId'])
    const assignee = ticketAssignee(ctx, form, (ctx.body as Record<string, unknown>).assigneeId)
    form.done()
    const ticket = findTicket(ctx)
    if (ticket.status !== 'OPEN' && ticket.status !== 'ASSIGNED') throw conflict('Ticket can only be assigned while OPEN or ASSIGNED')
    assignTo(ticket, assignee!, ctx.user!, iso(ctx.now))
    return ok({ ...ticket })
  }),
  route('POST', '/work-tickets/:id/start', { draftPermission: 'TICKET_READ' }, ctx => {
    const ticket = findTicket(ctx)
    onlyAssignee(ctx, ticket)
    if (ticket.status !== 'ASSIGNED') throw conflict('Ticket is not ASSIGNED')
    const at = iso(ctx.now)
    Object.assign(ticket, { status: 'IN_PROGRESS', startedAt: at, startedById: ctx.user!.id, startedByName: ctx.user!.fullName, updatedAt: at })
    return ok({ ...ticket })
  }),
  route('POST', '/work-tickets/:id/complete', { draftPermission: 'TICKET_READ' }, ctx => {
    let note: string | null = null
    if (ctx.body !== undefined) {
      const form = new Form(ctx.body, ['note'])
      note = form.optionalText('note', 500)
      form.done()
    }
    const ticket = findTicket(ctx)
    onlyAssignee(ctx, ticket)
    if (ticket.status !== 'IN_PROGRESS') throw conflict('Ticket is not IN_PROGRESS')
    // FE 7.2 (restock lines): a note is mandatory when the result differs from the plan.
    const lines = ticket.type === 'RESTOCK' ? ticket.restockLines ?? [] : []
    if (lines.some(line => line.loadedQuantity !== line.plannedQuantity) && !note) {
      throw new MockHttpError(400, 'Dữ liệu gửi lên chưa hợp lệ.', { note: 'must not be blank when loaded differs from planned' })
    }
    const at = iso(ctx.now)
    Object.assign(ticket, { status: 'COMPLETED', completedAt: at, completedById: ctx.user!.id, completedByName: ctx.user!.fullName, completionNote: note, updatedAt: at })
    if (lines.length) ticket.resolvedAlertIds = resolveLowStock(ctx.store, ticket, ctx.now)
    return ok({ ...ticket })
  }),
  // FE 7.2: loading and removing through the lines of a RESTOCK ticket, with the rules of /inventory/load and /remove.
  route('POST', '/work-tickets/:id/restock-lines/:lineId/load', { draftPermission: 'TICKET_READ' }, ctx => {
    const form = new Form(ctx.body, ['batchId', 'quantity'])
    const batchId = form.text('batchId'), quantity = form.integer('quantity', 1, 1000)
    form.done()
    const { ticket, line } = findRestockLine(ctx)
    const batch = ctx.store.batches.find(candidate => candidate.id === batchId)
    if (!batch) throw notFound('Không tìm thấy lô hàng.')
    if (batch.productId !== line.productId) throw conflict('Batch product does not match the restock line')
    const reply = callRoute(ctx, 'POST', '/inventory/load', { batchId, slotId: line.slotId, quantity })
    const operationId = (reply.data as { operationId: string }).operationId
    for (const row of ctx.store.transactions) if (row.referenceId === operationId) row.referenceId = ticket.id
    line.loadedQuantity += quantity
    touchRestock(ticket, ctx.now)
    return ok({ ...ticket })
  }),
  route('POST', '/work-tickets/:id/restock-lines/:lineId/remove', { draftPermission: 'TICKET_READ' }, ctx => {
    const form = new Form(ctx.body, ['inventoryItemId', 'reason'])
    const itemId = form.text('inventoryItemId')
    form.text('reason', 500)
    form.done()
    const { ticket, line } = findRestockLine(ctx)
    const item = ctx.store.items.find(candidate => candidate.id === itemId)
    if (!item) throw notFound('Không tìm thấy hộp hàng.')
    if (item.slotId !== line.slotId) throw new MockHttpError(400, 'Dữ liệu gửi lên chưa hợp lệ.', { inventoryItemId: 'Item is not in the slot of this restock line' })
    callRoute(ctx, 'POST', `/inventory/${item.id}/remove`, { reason: (ctx.body as { reason: unknown }).reason })
    const row = ctx.store.transactions.findLast(candidate => candidate.inventoryItemId === item.id && candidate.type === 'REMOVE')
    if (row) row.referenceId = ticket.id
    line.removedQuantity += 1
    touchRestock(ticket, ctx.now)
    return ok({ ...ticket })
  }),
  route('POST', '/work-tickets/:id/cancel', { draftPermission: 'TICKET_WRITE' }, ctx => {
    const form = new Form(ctx.body, ['reason'])
    const reason = form.text('reason', 500)
    form.done()
    const ticket = findTicket(ctx)
    if (ticket.status === 'COMPLETED' || ticket.status === 'CANCELLED') throw conflict('Ticket is already COMPLETED or CANCELLED')
    const at = iso(ctx.now)
    Object.assign(ticket, { status: 'CANCELLED', cancelledAt: at, cancelledById: ctx.user!.id, cancelledByName: ctx.user!.fullName, cancelReason: reason, updatedAt: at })
    return ok({ ...ticket })
  }),

  // ---- maintenance schedules: draft of backend 4.5 (api-contract/drafts/maintenance-schedules.yaml). Never deleted.
  route('GET', '/maintenance-schedules', { draftPermission: 'MAINTENANCE_SCHEDULE_READ' }, ctx => {
    const { query } = ctx
    const errors: Record<string, string> = {}
    if (query.get('machineId') && !UUID_PATTERN.test(query.get('machineId')!)) errors.machineId = 'Must be a valid UUID'
    if (query.get('active') && !['true', 'false'].includes(query.get('active')!)) errors.active = 'Must be true or false'
    if (Object.keys(errors).length) throw new MockHttpError(400, 'Invalid request parameter', errors)
    syncSchedules(ctx.store, ctx.now)
    const rows = ctx.store.schedules.filter(schedule => eq(query, 'machineId', schedule.machineId) && flag(query, 'active', schedule.active)).map(schedule => scheduleView(schedule, ctx.now))
    return ok(paginate(rows, query, { sorts: { nextDueAt: row => row.nextDueAt, createdAt: row => row.createdAt }, defaultSort: 'nextDueAt,asc' }))
  }),
  route('GET', '/maintenance-schedules/:id', { draftPermission: 'MAINTENANCE_SCHEDULE_READ' }, ctx => {
    const schedule = findSchedule(ctx)
    syncSchedules(ctx.store, ctx.now)
    return ok(scheduleView(schedule, ctx.now))
  }),
  route('POST', '/maintenance-schedules', { draftPermission: 'MAINTENANCE_SCHEDULE_WRITE' }, ctx => {
    const form = new Form(ctx.body, SCHEDULE_FIELDS)
    const data = ctx.body as Record<string, unknown>
    const title = form.text('title', 200)
    const intervalDays = form.integer('intervalDays', 1, 365)
    if (!isDateString(typeof data.startDate === 'string' ? data.startDate : '')) form.reject('startDate', 'Must be a date (yyyy-MM-dd)')
    const note = form.optionalText('note', 1000)
    const machineIdValid = typeof data.machineId === 'string' && UUID_PATTERN.test(data.machineId)
    const machine = machineIdValid ? ctx.store.machines.find(candidate => candidate.id === data.machineId) : undefined
    if (!machine) form.reject('machineId', machineIdValid ? 'Machine not found' : 'Must be a valid UUID')
    const assignee = data.assigneeId !== undefined && data.assigneeId !== null ? ticketAssignee(ctx, form, data.assigneeId) : null
    form.done()
    if (duplicateTitle(ctx.store, machine!.id, title)) throw conflict('An active schedule with this title already exists for this machine')
    const at = iso(ctx.now)
    const schedule: MockSchedule = {
      id: newId(), machineId: machine!.id, machineCode: machine!.code, machineName: machine!.name ?? null, title, note, intervalDays, startDate: data.startDate as string,
      assigneeId: assignee?.id ?? null, assigneeName: assignee?.fullName ?? null, active: true, nextDueAt: null, lastCompletedAt: null,
      openTicketId: null, openTicketStatus: null, createdById: ctx.user!.id, createdByName: ctx.user!.fullName,
      deactivatedAt: null, deactivatedById: null, deactivatedByName: null, createdAt: at, updatedAt: at,
    }
    recomputeDue(schedule, ctx.now)
    ctx.store.schedules.push(schedule)
    syncSchedules(ctx.store, ctx.now)
    return created(scheduleView(schedule, ctx.now))
  }),
  route('PATCH', '/maintenance-schedules/:id', { draftPermission: 'MAINTENANCE_SCHEDULE_WRITE' }, ctx => {
    const form = new Form(ctx.body, SCHEDULE_FIELDS.filter(field => field !== 'machineId'))
    const data = ctx.body as Record<string, unknown>
    if (!Object.keys(data).length) throw new MockHttpError(400, 'At least one field is required', {})
    const has = (field: string) => Object.hasOwn(data, field)
    const title = has('title') ? form.text('title', 200) : undefined
    const intervalDays = has('intervalDays') ? form.integer('intervalDays', 1, 365) : undefined
    if (has('startDate') && !isDateString(typeof data.startDate === 'string' ? data.startDate : '')) form.reject('startDate', 'Must be a date (yyyy-MM-dd)')
    const assignee = has('assigneeId') && data.assigneeId !== null ? ticketAssignee(ctx, form, data.assigneeId) : null
    const note = has('note') ? form.optionalText('note', 1000) : undefined
    form.done()
    const schedule = findSchedule(ctx)
    if (title !== undefined && schedule.active && duplicateTitle(ctx.store, schedule.machineId, title, schedule.id)) throw conflict('An active schedule with this title already exists for this machine')
    const cycleChanged = (intervalDays !== undefined && intervalDays !== schedule.intervalDays) || (has('startDate') && data.startDate !== schedule.startDate)
    if (title !== undefined) schedule.title = title
    if (intervalDays !== undefined) schedule.intervalDays = intervalDays
    if (has('startDate')) schedule.startDate = data.startDate as string
    if (has('assigneeId')) Object.assign(schedule, { assigneeId: assignee?.id ?? null, assigneeName: assignee?.fullName ?? null })
    if (note !== undefined) schedule.note = note
    schedule.updatedAt = iso(ctx.now)
    if (cycleChanged) recomputeDue(schedule, ctx.now)
    syncSchedules(ctx.store, ctx.now)
    return ok(scheduleView(schedule, ctx.now))
  }),
  route('POST', '/maintenance-schedules/:id/deactivate', { draftPermission: 'MAINTENANCE_SCHEDULE_WRITE' }, ctx => {
    const schedule = findSchedule(ctx)
    if (!schedule.active) throw conflict('Schedule is already inactive')
    const at = iso(ctx.now)
    Object.assign(schedule, { active: false, nextDueAt: null, deactivatedAt: at, deactivatedById: ctx.user!.id, deactivatedByName: ctx.user!.fullName, updatedAt: at })
    return ok(scheduleView(schedule, ctx.now))
  }),
  route('POST', '/maintenance-schedules/:id/activate', { draftPermission: 'MAINTENANCE_SCHEDULE_WRITE' }, ctx => {
    const schedule = findSchedule(ctx)
    if (schedule.active) throw conflict('Schedule is already active')
    if (duplicateTitle(ctx.store, schedule.machineId, schedule.title, schedule.id)) throw conflict('An active schedule with this title already exists for this machine')
    Object.assign(schedule, { active: true, deactivatedAt: null, deactivatedById: null, deactivatedByName: null, updatedAt: iso(ctx.now) })
    recomputeDue(schedule, ctx.now)
    syncSchedules(ctx.store, ctx.now)
    return ok(scheduleView(schedule, ctx.now))
  }),

  // ---- payments (ADMIN)
  route('GET', '/payments', 'admin', ctx => {
    const { store, query } = ctx
    const orderOf = (payment: MockPayment) => store.orders.find(order => order.id === payment.orderId)
    const needsAttention = (payment: MockPayment) => payment.status === 'SUCCESS' && (orderOf(payment)?.status === 'CANCELLED' || store.payments.filter(other => other.orderId === payment.orderId && other.status === 'SUCCESS').length > 1)
    const rows = store.payments.filter(payment =>
      eq(query, 'status', payment.status) && (!query.get('provider') || query.get('provider')!.toUpperCase() === payment.provider) && eq(query, 'orderId', payment.orderId)
      && eq(query, 'machineId', orderOf(payment)?.machineId) && within(query, 'createdFrom', 'createdTo', payment.createdAt) && (query.get('requiresAttention') !== 'true' || needsAttention(payment)))
    return ok(paginate(rows.map(payment => paymentRow(ctx, payment)), query, { sorts: { createdAt: row => row.createdAt, amount: row => row.amount, paidAt: row => row.paidAt }, defaultSort: 'createdAt,desc' }))
  }),
  route('GET', '/payments/:id', 'admin', ctx => {
    const payment = byId(ctx.store.payments, ctx.params.id, 'Không tìm thấy thanh toán.')
    return ok({ ...paymentRow(ctx, payment), qrCode: payment.qrCode })
  }),

  // ---- webhook logs (ADMIN)
  route('GET', '/payment-webhook-logs', 'admin', ctx => {
    const { query } = ctx
    const rows = ctx.store.webhookLogs.filter(log =>
      (!query.get('provider') || query.get('provider')!.toLowerCase() === log.provider?.toLowerCase()) && flag(query, 'verified', !!log.verified)
      && eq(query, 'reference', log.reference) && within(query, 'receivedFrom', 'receivedTo', log.receivedAt)).map(({ rawPayload: _rawPayload, rawBody: _rawBody, ...summary }) => summary)
    return ok(paginate(rows, query, { sorts: { receivedAt: row => row.receivedAt, provider: row => row.provider }, defaultSort: 'receivedAt,desc' }))
  }),
  route('GET', '/payment-webhook-logs/:id', 'admin', ctx => {
    const log = ctx.store.webhookLogs.find(candidate => candidate.id === decode(ctx.params.id))
    if (!log) throw notFound('Không tìm thấy log webhook.')
    return ok(log)
  }),

  // ---- kiosk (X-Kiosk-Key)
  route('GET', '/kiosk/me', 'kiosk', ctx => {
    const machine = findMachine(ctx, ctx.machineId)
    return ok({ machineId: machine.id, machineCode: machine.code, machineName: machine.name, machineStatus: ctx.options.maintenance ? 'MAINTENANCE' : machine.status })
  }),
  route('GET', '/kiosk/catalog', 'kiosk', ctx => {
    const { store, now } = ctx
    const machine = findMachine(ctx, ctx.machineId)
    if (machine.status !== 'ACTIVE' || ctx.options.maintenance) return ok({ machineId: machine.id, machineCode: machine.code, acceptingOrders: false, products: [] })
    const heads = sellableHeads(ctx, machine.id)
    const holdUntil = now + RESERVATION_MS
    const products = [...new Set(heads.map(({ head }) => head.productId))].map(productId => {
      const product = store.products.find(candidate => candidate.id === productId)!
      const slotIds = new Set(heads.filter(({ head }) => head.productId === productId).map(({ slot }) => slot.id))
      const availableQuantity = store.items.filter(item => item.productId === productId && slotIds.has(item.slotId) && item.status === 'AVAILABLE' && Date.parse(item.expiresAt) > holdUntil).length
      // Draft pricing-discount.yaml (FE 7.5): price of the head POST /kiosk/orders would pick now (FEFO between heads).
      const next = heads.filter(({ head }) => head.productId === productId).map(({ head }) => head).sort((a, b) => a.expiresAt.localeCompare(b.expiresAt) || a.loadedAt.localeCompare(b.loadedAt))[0]
      const pricing = boxPrice(product.price, next?.expiresAt, now)
      return { productId, sku: product.sku, name: product.name, description: product.description ?? undefined, price: pricing.unitPrice, originalUnitPrice: pricing.originalUnitPrice, discountPercent: pricing.discountPercent, discountReason: pricing.discountReason, imageUrl: product.imageUrl ?? undefined, availableQuantity }
    })
    return ok({ machineId: machine.id, machineCode: machine.code, acceptingOrders: true, products })
  }),
  route('POST', '/kiosk/orders', 'kiosk', ctx => {
    const { store, now } = ctx
    const form = new Form(ctx.body, ['productId'])
    const productId = form.text('productId')
    form.done()
    const product = store.products.find(candidate => candidate.id === productId)
    if (!product) throw notFound('Không tìm thấy sản phẩm.')
    const machine = findMachine(ctx, ctx.machineId)
    if (ctx.options.maintenance) throw conflict('Requested product is not available on this machine')
    // First-expiring head between sellable slots; never a bowl behind a head.
    const choice = sellableHeads(ctx, machine.id).filter(({ head }) => head.productId === productId)
      .sort((a, b) => a.head.expiresAt.localeCompare(b.head.expiresAt) || a.head.loadedAt.localeCompare(b.head.loadedAt) || a.slot.slotCode.localeCompare(b.slot.slotCode))[0]
    if (!choice) throw conflict('Requested product is not available on this machine')
    const { head, slot } = choice
    const batch = store.batches.find(candidate => candidate.id === head.batchId)
    const createdAt = iso(now)
    // Price snapshot of the chosen box (draft pricing-discount.yaml, FE 7.5): near-expiry boxes sell at 50% off.
    const line = linePricing(boxPrice(product.price, head.expiresAt, now), 1)
    setItemStatus(head, 'RESERVED', now)
    const order: MockOrder = {
      id: newId(), orderCode: `ORD-${createdAt.slice(0, 10).replaceAll('-', '')}-${randomCode(8)}`, machineId: machine.id, machineCode: machine.code, status: 'PENDING_PAYMENT',
      subtotal: line.totalPrice, totalAmount: line.totalPrice, discountAmount: line.discountAmount, createdAt, expiresAt: iso(now + RESERVATION_MS), live: true,
      items: [{ id: newId(), productId, sku: product.sku, productName: product.name, quantity: 1, ...line, allocations: [{ id: newId(), inventoryItemId: head.id, slotCode: slot.slotCode, batchCode: head.batchCode, batchExpiresAt: batch?.expiresAt, status: 'RESERVED' }] }],
    }
    store.orders.push(order)
    history(store, head, 'RESERVE', now, { referenceId: order.id, statusBefore: 'AVAILABLE', statusAfter: 'RESERVED' })
    return created(kioskOrderView(store, order))
  }),
  route('GET', '/kiosk/orders/:orderId', 'kiosk', ctx => ok(kioskOrderView(ctx.store, findKioskOrder(ctx)))),
  route('POST', '/kiosk/orders/:orderId/cancel', 'kiosk', ctx => {
    const order = findKioskOrder(ctx)
    if (order.status === 'PENDING_PAYMENT') releaseOrder(ctx, order, 'ORDER_CANCELLED')
    else if (order.status !== 'CANCELLED') throw conflict('Đơn hàng không còn ở trạng thái có thể hủy.')
    return ok(kioskOrderView(ctx.store, order))
  }),
  route('POST', '/kiosk/orders/:orderId/payments', 'kiosk', ctx => {
    const { store, now } = ctx
    const order = findKioskOrder(ctx)
    if (order.status !== 'PENDING_PAYMENT') throw conflict('Đơn hàng không còn chờ thanh toán.')
    const expiresAt = Date.parse(order.expiresAt ?? '')
    if (expiresAt - now < MIN_REMAINING_HOLD_MS) throw conflict('Đơn hàng sắp hết hạn giữ chỗ.')
    const current = latestPayment(store, order.id)
    if (current?.status === 'PENDING' && current.qrCode) return ok(kioskPaymentView(current))
    const reference = `MOCK${randomCode(10)}`
    // Deliberately not the backend's "MOCK-QR|" prefix: that one shows a button posting to a real webhook, outside this client.
    const payment: MockPayment = { id: newId(), orderId: order.id, provider: 'MOCK', status: 'PENDING', amount: order.totalAmount, paymentReference: reference, createdAt: iso(now), expiredAt: iso(Math.min(expiresAt, now + RESERVATION_MS)), qrCode: `FRESHVEND-MOCK-QR|${reference}|${order.totalAmount}` }
    store.payments.push(payment)
    return created(kioskPaymentView(payment))
  }),

  // ---- public incident report (FE 8.2, draft api-contract/drafts/incident-reports.yaml)
  ...incidentReportRoutes,

  // ---- manual refunds (FE 8.1, draft api-contract/drafts/refunds.yaml)
  ...refundRoutes,
]

export interface RaiseAlertInput { type?: MockAlert['type']; severity?: MockAlert['severity']; machineId?: string; title?: string; message?: string | null }

/**
 * Mock-only control (window.__fvMock.raiseAlert, see index.ts): a machine raises a new OPEN alert now, as the backend
 * would from a sensor reading or a missed heartbeat. Lets tests prove the bell shows it within one poll.
 */
export function raiseAlert(store: MockStore, now: number, input: RaiseAlertInput = {}): MockAlert {
  const machine = store.machines.find(candidate => candidate.id === input.machineId) ?? store.machines[0]
  const at = iso(now)
  const alert: MockAlert = {
    id: newId(), machineId: machine.id, machineCode: machine.code, machineName: machine.name,
    type: input.type ?? 'HIGH_TEMPERATURE', severity: input.severity ?? 'CRITICAL', title: input.title ?? 'Temperature above range',
    message: input.message === undefined ? 'Reading of 12.00 C exceeds the 8.00 C maximum.' : input.message, status: 'OPEN', triggeredAt: at,
    slotId: null, slotCode: null, orderId: null, orderCode: null, acknowledgedAt: null, acknowledgedById: null, acknowledgedByName: null,
    resolvedAt: null, resolvedById: null, resolvedByName: null, resolutionNote: null, createdAt: at, updatedAt: at,
  }
  store.alerts.push(alert)
  return alert
}

/** Heartbeat row of a machine; machines registered during the session start with one that has never connected. */
function heartbeatOf(store: MockStore, machineId: string): MockHeartbeat {
  let heartbeat = store.heartbeats.find(candidate => candidate.machineId === machineId)
  if (!heartbeat) {
    heartbeat = { machineId, lastSeenAt: null, reportedAt: null, state: null, firmwareVersion: null, uptimeSeconds: null, rssi: null, dispenseState: null, live: false, bootedAt: null }
    store.heartbeats.push(heartbeat)
  }
  return heartbeat
}
function heartbeatView(heartbeat: MockHeartbeat) {
  const { machineId, lastSeenAt, reportedAt, state, firmwareVersion, uptimeSeconds, rssi, dispenseState } = heartbeat
  return { machineId, lastSeenAt, reportedAt, state, firmwareVersion, uptimeSeconds, rssi, dispenseState }
}

/**
 * What MachineMessageHandler does in the background, applied before each request: a machine whose heartbeat is live
 * keeps talking, so its last_seen_at (and the heartbeat) is "now". A stopped one keeps its last value and turns OFFLINE
 * on screen 180 s later.
 */
export function syncHeartbeats(store: MockStore, now: number) {
  for (const heartbeat of store.heartbeats) {
    if (!heartbeat.live) continue
    const at = iso(now)
    Object.assign(heartbeat, { lastSeenAt: at, reportedAt: at, state: 'ONLINE', uptimeSeconds: heartbeat.bootedAt ? Math.max(0, Math.floor((now - Date.parse(heartbeat.bootedAt)) / 1000)) : null })
    const machine = store.machines.find(candidate => candidate.id === heartbeat.machineId)
    if (machine) machine.lastSeenAt = at
  }
}

/**
 * Mock-only control (window.__fvMock.stopHeartbeat, see index.ts): the machine (id or code) sends one last message now and
 * then goes silent, like a power cut. Returns that last `lastSeenAt`. `resumeHeartbeat` makes it talk again.
 */
export function setHeartbeat(store: MockStore, now: number, machine: string, live: boolean): string | null {
  const target = store.machines.find(candidate => candidate.id === machine || candidate.code === machine)
  if (!target) throw new Error(`Không có máy ${machine}`)
  const heartbeat = heartbeatOf(store, target.id)
  const at = iso(now)
  Object.assign(heartbeat, { live, lastSeenAt: at, reportedAt: at, state: 'ONLINE', bootedAt: heartbeat.bootedAt ?? at })
  target.lastSeenAt = at
  return at
}

// ---- maintenance commands (draft of backend 4.2, api-contract/drafts/machine-maintenance.yaml, FE 7.4). Messages in
// English as the backend would send them.
const MAINTENANCE_TYPES = ['OPEN_REFILL', 'CLOSE_REFILL', 'REMOVE_ITEM', 'EMPTY_COLUMN', 'RESET'] as const
const MAINTENANCE_SLOT_TYPES: readonly string[] = ['REMOVE_ITEM', 'EMPTY_COLUMN']
const MAINTENANCE_UNFINISHED: readonly string[] = ['PENDING', 'SENT', 'ACKNOWLEDGED']
const REMOVABLE: readonly MockItem['status'][] = ['AVAILABLE', 'EXPIRED']
/** Same as DISPENSE_TIMEOUT (60 s from createdAt), and the web's OFFLINE rule (180 s without a message). */
const MAINTENANCE_TIMEOUT_MS = 60_000
const MACHINE_OFFLINE_AFTER_MS = 180_000

/** Physically present bowls of a slot, head (next out) first. */
function presentItems(store: MockStore, slotId: string): MockItem[] {
  return store.items.filter(item => item.slotId === slotId && PRESENT_STATUSES.includes(item.status))
    .sort((a, b) => a.loadedAt.localeCompare(b.loadedAt) || a.id.localeCompare(b.id))
}

function createMaintenanceCommand(ctx: HandlerContext): MockMaintenanceCommand {
  const { store, now } = ctx
  const machine = findMachine(ctx)
  const form = new Form(ctx.body, ['type', 'slotId', 'inventoryItemId', 'reason'])
  const body = ctx.body as Record<string, unknown>
  const type = form.oneOf('type', MAINTENANCE_TYPES)
  const slotCommand = MAINTENANCE_SLOT_TYPES.includes(type)
  const { slotId, inventoryItemId } = body
  if (slotCommand) {
    if (slotId === undefined || slotId === null) form.reject('slotId', `must not be null for ${type}`)
    else if (typeof slotId !== 'string' || !UUID_PATTERN.test(slotId)) form.reject('slotId', 'Must be a valid UUID')
  } else if (slotId !== undefined && slotId !== null) form.reject('slotId', `must be null for ${type}`)
  if (inventoryItemId !== undefined && inventoryItemId !== null) {
    if (type !== 'REMOVE_ITEM') form.reject('inventoryItemId', `must be null for ${type}`)
    else if (typeof inventoryItemId !== 'string' || !UUID_PATTERN.test(inventoryItemId)) form.reject('inventoryItemId', 'Must be a valid UUID')
  }
  const reason = form.optionalText('reason', 500)
  form.done()
  if (machine.status !== 'MAINTENANCE') throw conflict('Machine is not in MAINTENANCE')
  const seen = machine.lastSeenAt ? Date.parse(machine.lastSeenAt) : NaN
  if (!Number.isFinite(seen) || now - seen > MACHINE_OFFLINE_AFTER_MS) throw conflict('Machine is offline')
  if (store.maintenanceCommands.some(command => command.machineId === machine.id && MAINTENANCE_UNFINISHED.includes(command.status))) throw conflict('Another maintenance command is still running')
  let slot: MockStore['slots'][number] | undefined
  let items: MockItem[] = []
  if (slotCommand) {
    slot = store.slots.find(candidate => candidate.id === slotId && candidate.machineId === machine.id)
    if (!slot) throw notFound('Slot not found in specified machine')
    const present = presentItems(store, slot.id)
    if (!present.length) throw conflict('Slot is empty')
    if (type === 'REMOVE_ITEM') {
      if (!REMOVABLE.includes(present[0].status)) throw conflict('Slot head cannot be removed')
      if (inventoryItemId && inventoryItemId !== present[0].id) throw conflict('Inventory item is not the slot head')
      items = [present[0]]
    } else {
      if (present.some(item => !REMOVABLE.includes(item.status))) throw conflict('Slot holds reserved or dispense-failed bowls')
      items = present
    }
  }
  const at = iso(now)
  const command: MockMaintenanceCommand = {
    id: newId(), commandCode: `M-${Array.from({ length: 16 }, () => '0123456789ABCDEF'[Math.floor(Math.random() * 16)]).join('')}`, machineId: machine.id, type,
    slotId: slot?.id ?? null, slotCode: slot?.slotCode ?? null, inventoryItemId: type === 'REMOVE_ITEM' ? items[0].id : null, itemCount: slotCommand ? items.length : null,
    removedCount: null, reason, status: 'PENDING', failureCode: null, requestedById: ctx.user!.id, requestedByName: ctx.user!.fullName,
    createdAt: at, sentAt: null, acknowledgedAt: null, completedAt: null, updatedAt: at,
  }
  store.maintenanceCommands.push(command)
  return { ...command }
}

/** The machine reports success: bowls taken out become REMOVED with a REMOVE transaction (reference = the command). */
function completeMaintenanceCommand(store: MockStore, command: MockMaintenanceCommand, now: number) {
  const at = iso(now)
  const heartbeat = store.heartbeats.find(candidate => candidate.machineId === command.machineId)
  if (command.type === 'RESET' && heartbeat?.dispenseState !== 'FAULT') {
    Object.assign(command, { status: 'FAILED', failureCode: 'NOT_IN_FAULT', completedAt: at, updatedAt: at })
    return
  }
  if (command.type === 'RESET' && heartbeat) heartbeat.dispenseState = 'IDLE'
  let removed: number | null = null
  if (command.slotId) {
    const present = presentItems(store, command.slotId).filter(item => REMOVABLE.includes(item.status))
    const taken = command.type === 'REMOVE_ITEM' ? present.filter(item => item.id === command.inventoryItemId) : present.slice(0, command.itemCount ?? present.length)
    for (const item of taken) {
      const before = item.status
      setItemStatus(item, 'REMOVED', now)
      item.removedAt = at
      history(store, item, 'REMOVE', now, { referenceId: command.id, performedBy: command.requestedById, reason: command.reason ?? `Maintenance command ${command.commandCode} (${command.type})`, statusBefore: before, statusAfter: 'REMOVED' })
    }
    removed = taken.length
  }
  Object.assign(command, { status: 'SUCCESS', removedCount: removed, completedAt: at, updatedAt: at })
}

/**
 * What the backend and the machine do in the background, applied before each request (like advanceOrders): a command
 * is published (SENT) after a quarter of dispenseMs, accepted (ACKNOWLEDGED) after half, and ends after dispenseMs.
 * A silent machine (heartbeat stopped) or scenario `dispense-slow` never answers, so the command becomes TIMEOUT 60 s
 * after createdAt; scenario `dispense-failed` makes the machine abort (FAILED, ABORTED); RESET on a controller that is
 * not in FAULT is refused (FAILED, NOT_IN_FAULT).
 */
export function advanceMaintenanceCommands(ctx: HandlerContext) {
  const { store, now, options } = ctx
  for (const command of store.maintenanceCommands) {
    if (!MAINTENANCE_UNFINISHED.includes(command.status)) continue
    const created = Date.parse(command.createdAt)
    const answers = options.dispense !== 'slow' && !!store.heartbeats.find(candidate => candidate.machineId === command.machineId)?.live
    if (command.status === 'PENDING' && created + options.dispenseMs / 4 <= now) Object.assign(command, { status: 'SENT', sentAt: iso(created + options.dispenseMs / 4), updatedAt: iso(now) })
    if (answers && command.status === 'SENT' && created + options.dispenseMs / 2 <= now) Object.assign(command, { status: 'ACKNOWLEDGED', acknowledgedAt: iso(created + options.dispenseMs / 2), updatedAt: iso(now) })
    if (answers && command.status === 'ACKNOWLEDGED' && created + options.dispenseMs <= now) {
      if (options.dispense === 'fail') Object.assign(command, { status: 'FAILED', failureCode: 'ABORTED', completedAt: iso(now), updatedAt: iso(now) })
      else completeMaintenanceCommand(store, command, now)
      continue
    }
    if (MAINTENANCE_UNFINISHED.includes(command.status) && created + MAINTENANCE_TIMEOUT_MS <= now) {
      Object.assign(command, { status: 'TIMEOUT', completedAt: iso(now), updatedAt: iso(now) })
    }
  }
}
