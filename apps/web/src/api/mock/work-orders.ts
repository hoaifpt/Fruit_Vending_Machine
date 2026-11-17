// Mock of the real backend for FM7 (api-contract/api.yaml): work orders (#66, docs/work-orders.md), restock (#68,
// docs/restock.md), maintenance commands (#64, docs/maintenance-commands.md) and maintenance plans (#70,
// docs/maintenance-plans.md). Business 409s start with the backend's code (`STALE_VERSION: …`), messages in English as
// the backend sends them. Nothing is ever deleted except a restock line nothing was loaded against (DELETE of the API).
import { conflict, created, fixedPage, Form, MockHttpError, notFound, ok } from './http.ts'
import type { Reply } from './http.ts'
import type { HandlerContext, Route } from './handlers.ts'
import { headOf, history, machineView, permissionsOfUser, presentItems, setItemStatus } from './handlers.ts'
import type { MockAlert, MockItem, MockStore, MockUser } from './seed.ts'
import type { components } from '../schema'
import { addDays, isDateString, vietnamDate } from '../../admin/maintenance-schedules.ts'

type S = components['schemas']
type Status = NonNullable<S['WorkOrderResponse']['status']>
type WorkOrderType = NonNullable<S['WorkOrderResponse']['type']>
type Source = NonNullable<S['WorkOrderResponse']['source']>
type Priority = NonNullable<S['WorkOrderResponse']['priority']>
type Operation = NonNullable<S['MaintenanceCommandResponse']['operation']>
type CommandStatus = NonNullable<S['MaintenanceCommandResponse']['status']>
type Reason = NonNullable<S['MaintenanceCommandResponse']['reason']>

export interface MockWorkOrder {
  id: string; code: string; type: WorkOrderType; source: Source; machineId: string
  title: string; description: string | null; priority: Priority; status: Status
  assigneeId: string | null; createdById: string | null; dueAt: string | null
  startedAt: string | null; completedAt: string | null; completedById: string | null; resultNote: string | null
  cancelledAt: string | null; cancelledById: string | null; cancelReason: string | null
  alertIds: string[]; linkedReports: S['WorkOrderLinkedReport'][]
  maintenancePlanId: string | null; scheduledFor: string | null
  version: number; createdAt: string; updatedAt: string
}
export type MockWorkOrderEvent = S['WorkOrderEventResponse'] & { id: string; workOrderId: string; createdAt: string }
export interface MockRestockLine {
  id: string; workOrderId: string; slotId: string; slotCode: string; productId: string; productName: string
  plannedQuantity: number; loadedQuantity: number; varianceReason: string | null; loads: S['RestockLoad'][]
}
export interface MockMaintenanceCommand {
  id: string; commandCode: string; machineId: string; slotId: string | null; operation: Operation; status: CommandStatus
  reason: Reason | null; note: string | null; targetItemId: string | null; requestedById: string; workOrderId: string | null
  attemptCount: number; createdAt: string; sentAt: string | null; acceptedAt: string | null; finishedAt: string | null
  failureReason: string | null; removedCount: number | null; reconciliationOutcome: 'DONE' | 'NOT_DONE' | null
  reconciledById: string | null; reconciledAt: string | null
  /** Idempotency-Key and the request it came with (same key + same request → the same command). */
  idempotencyKey: string; signature: string
}
export interface MockPlan {
  id: string; machineId: string; title: string; instructions: string | null; intervalDays: number; leadDays: number; dueTime: string
  priority: Priority; defaultAssigneeId: string | null; nextDueDate: string; active: boolean; lastCompletedAt: string | null
  createdById: string; version: number; createdAt: string; updatedAt: string
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const STATUSES: readonly Status[] = ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'DONE', 'CANCELLED']
const TYPES: readonly WorkOrderType[] = ['RESTOCK', 'MAINTENANCE', 'INCIDENT']
const SOURCES: readonly Source[] = ['MANUAL', 'ALERT', 'SCHEDULE', 'CUSTOMER_REPORT']
const PRIORITIES: readonly Priority[] = ['LOW', 'NORMAL', 'HIGH', 'URGENT']
const PRIORITY_RANK: Record<Priority, number> = { URGENT: 0, HIGH: 1, NORMAL: 2, LOW: 3 }
const OPERATIONS: readonly Operation[] = ['REMOVE_ITEM', 'EMPTY_COLUMN', 'OPEN_REFILL', 'CLOSE_REFILL', 'RESET']
const COLUMN_OPERATIONS: readonly Operation[] = ['REMOVE_ITEM', 'EMPTY_COLUMN', 'OPEN_REFILL', 'CLOSE_REFILL']
const COMMAND_STATUSES: readonly CommandStatus[] = ['PENDING', 'SENT', 'ACCEPTED', 'COMPLETED', 'FAILED', 'NEEDS_RECONCILIATION', 'RECONCILED']
const REASONS: readonly Reason[] = ['EXPIRED', 'DAMAGED', 'DISPENSE_FAILED', 'RESTOCK', 'INSPECTION', 'OTHER']
const UNFINISHED_COMMAND: readonly CommandStatus[] = ['PENDING', 'SENT', 'ACCEPTED']
const REMOVABLE: readonly MockItem['status'][] = ['AVAILABLE', 'EXPIRED', 'DISPENSE_FAILED']
const LOW_STOCK_THRESHOLD = 2
/** The reservation hold: a batch must stay valid this long after loading (BATCH_EXPIRED otherwise). */
const HOLD_MS = 5 * 60_000
export const ACCEPT_TIMEOUT_MS = 30_000
export const COMPLETE_TIMEOUT_MS = 90_000

const iso = (ms: number) => new Date(ms).toISOString()
const newId = () => crypto.randomUUID()
const decode = (value: string) => decodeURIComponent(value)
export const closed = (status: Status) => status === 'DONE' || status === 'CANCELLED'
const has = (ctx: HandlerContext, code: string) => permissionsOfUser(ctx.store, ctx.user!).includes(code)
const randomCode = (length: number) => Array.from({ length }, () => '0123456789ABCDEFGHJKMNPQRSTVWXYZ'[Math.floor(Math.random() * 32)]).join('')
const isExpired = (item: MockItem, now: number) => item.status === 'EXPIRED' || Date.parse(item.expiresAt) <= now
const person = (store: MockStore, userId: string | null | undefined) => {
  if (!userId) return null
  const user = store.users.find(candidate => candidate.id === userId)
  return { id: userId, fullName: user?.fullName ?? '' }
}
function uuidParam(value: string, name = 'id'): string {
  const text = decode(value)
  if (!UUID.test(text)) throw new MockHttpError(400, 'Invalid request parameter', { [name]: 'Must be a valid UUID' })
  return text
}
function route(method: string, template: string, policy: Route['policy'], handle: Route['handle']): Route {
  return { method, pattern: new RegExp(`^${template.replace(/:(\w+)/g, '(?<$1>[^/]+)')}/?$`), policy, handle }
}
function enumParam<T extends string>(query: URLSearchParams, name: string, values: readonly T[], errors: Record<string, string>): T[] {
  const all = query.getAll(name).filter(Boolean)
  if (all.some(value => !values.includes(value as T))) errors[name] = `Must be one of: ${values.join(', ')}`
  return all as T[]
}
function uuidQuery(query: URLSearchParams, name: string, errors: Record<string, string>): string | null {
  const value = query.get(name)
  if (value && !UUID.test(value)) errors[name] = 'Must be a valid UUID'
  return value || null
}
function boolQuery(query: URLSearchParams, name: string, errors: Record<string, string>): boolean | null {
  const value = query.get(name)
  if (!value) return null
  if (value !== 'true' && value !== 'false') errors[name] = 'Must be true or false'
  return value === 'true'
}
function failOn(errors: Record<string, string>) {
  if (Object.keys(errors).length) throw new MockHttpError(400, 'Invalid request parameter', errors)
}
function versionOf(form: Form): number {
  return form.integer('version', 0, Number.MAX_SAFE_INTEGER)
}

// ---- work orders

/** WO-yyyyMMdd-XXXX with the business day (Vietnam). */
export function workOrderCode(createdAt: string, id: string): string {
  return `WO-${vietnamDate(Date.parse(createdAt)).replaceAll('-', '')}-${id.replaceAll('-', '').slice(-4).toUpperCase()}`
}

export function workOrderView(store: MockStore, order: MockWorkOrder, now: number) {
  const machine = store.machines.find(candidate => candidate.id === order.machineId)
  const lines = store.restockLines.filter(line => line.workOrderId === order.id)
  const plan = store.maintenancePlans.find(candidate => candidate.id === order.maintenancePlanId)
  return {
    id: order.id, code: order.code, type: order.type, source: order.source, machineId: order.machineId, machineCode: machine?.code, machineName: machine?.name,
    title: order.title, description: order.description, priority: order.priority, status: order.status,
    assignee: person(store, order.assigneeId), createdBy: person(store, order.createdById), dueAt: order.dueAt,
    overdue: !closed(order.status) && !!order.dueAt && Date.parse(order.dueAt) < now,
    startedAt: order.startedAt, completedAt: order.completedAt, completedBy: person(store, order.completedById), resultNote: order.resultNote,
    cancelledAt: order.cancelledAt, cancelledBy: person(store, order.cancelledById), cancelReason: order.cancelReason,
    linkedAlerts: order.alertIds.flatMap(alertId => {
      const alert = store.alerts.find(candidate => candidate.id === alertId)
      return alert ? [{ id: alert.id, type: alert.type, severity: alert.severity, status: alert.status, title: alert.title }] : []
    }),
    linkedReports: order.linkedReports,
    restockSummary: order.type === 'RESTOCK' ? {
      lines: lines.length, plannedTotal: lines.reduce((sum, line) => sum + line.plannedQuantity, 0),
      loadedTotal: lines.reduce((sum, line) => sum + line.loadedQuantity, 0), varianceLines: lines.filter(line => line.loadedQuantity !== line.plannedQuantity).length,
    } : null,
    maintenancePlan: plan ? { id: plan.id, title: plan.title } : null, scheduledFor: order.scheduledFor,
    version: order.version, createdAt: order.createdAt, updatedAt: order.updatedAt,
  }
}

export function recordEvent(store: MockStore, order: MockWorkOrder, type: NonNullable<S['WorkOrderEventResponse']['type']>, actorId: string | null, at: number,
  extra: { before?: Status | null; note?: string | null; details?: Record<string, unknown> | null } = {}) {
  store.workOrderEvents.push({
    id: newId(), workOrderId: order.id, type, statusBefore: extra.before ?? null, statusAfter: order.status, actor: person(store, actorId) ?? undefined,
    note: extra.note ?? null, details: extra.details ?? null, createdAt: iso(at),
  })
}
function touch(order: MockWorkOrder, now: number) {
  order.version += 1
  order.updatedAt = iso(now)
}

export interface NewWorkOrder {
  type: WorkOrderType; source: Source; machineId: string; title: string; description?: string | null; priority?: Priority | null
  assigneeId?: string | null; dueAt?: string | null; createdById: string | null; alertIds?: string[]; linkedReports?: S['WorkOrderLinkedReport'][]
  maintenancePlanId?: string | null; scheduledFor?: string | null
}
/** Creates a work order (OPEN, or ASSIGNED with an assignee) and its CREATED event (plus ASSIGNED). */
export function createWorkOrder(store: MockStore, input: NewWorkOrder, now: number): MockWorkOrder {
  const id = newId(), at = iso(now)
  const order: MockWorkOrder = {
    id, code: workOrderCode(at, id), type: input.type, source: input.source, machineId: input.machineId, title: input.title, description: input.description ?? null,
    priority: input.priority ?? 'NORMAL', status: input.assigneeId ? 'ASSIGNED' : 'OPEN', assigneeId: input.assigneeId ?? null, createdById: input.createdById,
    dueAt: input.dueAt ?? null, startedAt: null, completedAt: null, completedById: null, resultNote: null, cancelledAt: null, cancelledById: null, cancelReason: null,
    alertIds: input.alertIds ?? [], linkedReports: input.linkedReports ?? [], maintenancePlanId: input.maintenancePlanId ?? null, scheduledFor: input.scheduledFor ?? null,
    version: 0, createdAt: at, updatedAt: at,
  }
  store.workOrders.push(order)
  recordEvent(store, order, 'CREATED', input.createdById, now, { before: null })
  if (order.assigneeId) recordEvent(store, order, 'ASSIGNED', input.createdById, now, { before: 'OPEN', details: { assigneeId: order.assigneeId } })
  return order
}

/** The unfinished work order handling an alert (AlertResponse.workOrderId/workOrderCode). */
export function activeWorkOrderOf(store: MockStore, alertId: string): MockWorkOrder | undefined {
  return store.workOrders.find(order => order.alertIds.includes(alertId) && !closed(order.status))
}

/** A work order the caller may see: READ_ALL, or their own; anything else is the same 404 as an unknown id. */
function findWorkOrder(ctx: HandlerContext, raw = ctx.params.id): MockWorkOrder {
  const id = uuidParam(raw)
  const order = ctx.store.workOrders.find(candidate => candidate.id === id)
  if (!order || (!has(ctx, 'WORK_ORDER_READ_ALL') && order.assigneeId !== ctx.user!.id)) throw notFound('Work order not found')
  return order
}
/** Start, notes, complete, restock loads, linked commands: the assignee, or a manager (Admin) acting for them. */
function findExecutable(ctx: HandlerContext, raw = ctx.params.id): MockWorkOrder {
  const order = findWorkOrder(ctx, raw)
  if (order.assigneeId !== ctx.user!.id && !has(ctx, 'WORK_ORDER_MANAGE')) throw notFound('Work order not found')
  return order
}
function checkVersion(order: MockWorkOrder, version: number) {
  if (version !== order.version) throw conflict(`STALE_VERSION: work order ${order.code} was changed by someone else; read it again`)
}
function transition(order: MockWorkOrder, from: readonly Status[], action: string) {
  if (!from.includes(order.status)) throw conflict(`INVALID_WORK_ORDER_TRANSITION: cannot ${action} a work order that is ${order.status}`)
}
/** assigneeId of a body: an ACTIVE account holding WORK_ORDER_EXECUTE, else a 400 on the field. */
function assigneeOf(ctx: HandlerContext, form: Form, value: unknown): MockUser | null {
  if (typeof value !== 'string' || !UUID.test(value)) { form.reject('assigneeId', 'Must be a valid UUID'); return null }
  const user = ctx.store.users.find(candidate => candidate.id === value)
  if (!user || user.status !== 'ACTIVE' || !permissionsOfUser(ctx.store, user).includes('WORK_ORDER_EXECUTE')) {
    form.reject('assigneeId', 'Assignee must be an ACTIVE user holding WORK_ORDER_EXECUTE')
    return null
  }
  return user
}
function futureInstant(ctx: HandlerContext, form: Form, data: Record<string, unknown>, field: string): string | null | undefined {
  if (!Object.hasOwn(data, field)) return undefined
  if (data[field] === null) return null
  const value = form.instant(field)
  if (value && value <= ctx.now) { form.reject(field, 'Must be in the future'); return undefined }
  return value ? iso(value) : undefined
}

function listOrders(ctx: HandlerContext, mine: boolean): Reply {
  const { query, store, now } = ctx
  const errors: Record<string, string> = {}
  const statuses = enumParam(query, 'status', STATUSES, errors)
  const overdue = boolQuery(query, 'overdue', errors)
  let rows = store.workOrders.filter(order => (!statuses.length || statuses.includes(order.status)))
  if (mine) rows = rows.filter(order => order.assigneeId === ctx.user!.id)
  else {
    const [type] = enumParam(query, 'type', TYPES, errors), [source] = enumParam(query, 'source', SOURCES, errors), [priority] = enumParam(query, 'priority', PRIORITIES, errors)
    const machineId = uuidQuery(query, 'machineId', errors), assigneeId = uuidQuery(query, 'assigneeId', errors), planId = uuidQuery(query, 'maintenancePlanId', errors)
    rows = rows.filter(order => (!type || order.type === type) && (!source || order.source === source) && (!priority || order.priority === priority)
      && (!machineId || order.machineId === machineId) && (!assigneeId || order.assigneeId === assigneeId) && (!planId || order.maintenancePlanId === planId))
  }
  failOn(errors)
  const views = rows.map(order => workOrderView(store, order, now)).filter(view => overdue === null || view.overdue === overdue)
  views.sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]
    || (a.dueAt ? (b.dueAt ? a.dueAt.localeCompare(b.dueAt) : -1) : b.dueAt ? 1 : 0) || a.createdAt.localeCompare(b.createdAt))
  return ok(fixedPage(views, query, { defaultSize: 20, maxSize: 100 }))
}

/** Lines of POST /work-orders or POST .../restock-lines: slot of the machine, slot not INACTIVE, product ACTIVE, ≤ capacity, one per (slot, product). */
function checkLine(ctx: HandlerContext, order: Pick<MockWorkOrder, 'id' | 'machineId'>, input: unknown, existing: MockRestockLine[], field = ''): MockRestockLine {
  const form = new Form(input, ['slotId', 'productId', 'plannedQuantity'])
  const slotId = form.text('slotId'), productId = form.text('productId'), planned = form.integer('plannedQuantity', 1, 1000)
  const slot = ctx.store.slots.find(candidate => candidate.id === slotId)
  if (slotId && (!slot || slot.machineId !== order.machineId)) form.reject('slotId', 'Slot does not belong to the machine of the work order')
  if (slot && planned > (slot.capacity ?? 0)) form.reject('plannedQuantity', `Must be at most the slot capacity (${slot.capacity})`)
  if (field && Object.keys(form.errors).length) throw new MockHttpError(400, 'Validation Failed', Object.fromEntries(Object.entries(form.errors).map(([key, message]) => [`${field}.${key}`, message])))
  form.done()
  if (slot!.status === 'INACTIVE') throw conflict(`SLOT_INACTIVE: slot ${slot!.slotCode} is INACTIVE`)
  const product = ctx.store.products.find(candidate => candidate.id === productId)
  if (!product) throw notFound('Product not found')
  if (product.status !== 'ACTIVE') throw conflict(`PRODUCT_INACTIVE: product ${product.sku} is not ACTIVE`)
  if (existing.some(line => line.slotId === slotId && line.productId === productId)) throw conflict(`DUPLICATE_LINE: slot ${slot!.slotCode} already has a line for ${product.name}`)
  return {
    id: newId(), workOrderId: order.id, slotId: slot!.id!, slotCode: slot!.slotCode ?? '', productId: product.id!, productName: product.name ?? '',
    plannedQuantity: planned, loadedQuantity: 0, varianceReason: null, loads: [],
  }
}

/** What the scheduler and health check do after a work order is done or cancelled (plans, stock alerts). */
function afterClosed(ctx: HandlerContext, order: MockWorkOrder) {
  const { store, now } = ctx
  const plan = store.maintenancePlans.find(candidate => candidate.id === order.maintenancePlanId)
  if (plan) {
    const computed = order.status === 'DONE' ? addDays(vietnamDate(now), plan.intervalDays) : addDays(order.scheduledFor ?? plan.nextDueDate, plan.intervalDays)
    if (order.status === 'DONE') plan.lastCompletedAt = order.completedAt
    plan.nextDueDate = computed > plan.nextDueDate ? computed : plan.nextDueDate
    plan.updatedAt = iso(now)
  }
  if (order.type !== 'RESTOCK' || order.status !== 'DONE') return
  // Health check right after a restock: LOW_STOCK / PRODUCT_* of the machine whose condition is gone close by themselves.
  for (const alert of store.alerts) {
    if (alert.machineId !== order.machineId || alert.status === 'RESOLVED' || !alert.slotId) continue
    const present = presentItems(store, alert.slotId)
    const fresh = present.filter(item => item.status === 'AVAILABLE' && !isExpired(item, now)).length
    const cleared = alert.type === 'LOW_STOCK' ? fresh > LOW_STOCK_THRESHOLD
      : alert.type === 'PRODUCT_EXPIRED' || alert.type === 'PRODUCT_EXPIRING' ? !present.some(item => isExpired(item, now) || vietnamDate(Date.parse(item.expiresAt)) === vietnamDate(now)) : false
    if (cleared) Object.assign(alert, { status: 'RESOLVED', resolvedAt: iso(Math.max(now, Date.parse(alert.triggeredAt))), resolvedBy: 'system', resolutionNote: 'Condition cleared' })
  }
}

/** POST /alerts/{alertId}/work-orders (handlers.ts): source ALERT, the alert's machine, the alert linked and acknowledged. */
export function workOrderFromAlert(ctx: HandlerContext, alert: MockAlert): Reply {
  const data = (ctx.body ?? {}) as Record<string, unknown>
  const form = new Form(data, ['type', 'title', 'description', 'priority', 'assigneeId', 'dueAt'])
  const type = data.type === undefined || data.type === null ? null : form.oneOf('type', TYPES)
  const priority = data.priority === undefined || data.priority === null ? null : form.oneOf('priority', PRIORITIES)
  const title = form.optionalText('title', 200), description = form.optionalText('description', 2000)
  const dueAt = futureInstant(ctx, form, data, 'dueAt')
  const assignee = data.assigneeId !== undefined && data.assigneeId !== null ? assigneeOf(ctx, form, data.assigneeId) : null
  form.done()
  if (alert.status === 'RESOLVED') throw conflict('ALERT_RESOLVED: the alert is already resolved')
  const active = activeWorkOrderOf(ctx.store, alert.id!)
  if (active) throw conflict(`ALERT_ALREADY_HANDLED: the alert is handled by work order ${active.code}`)
  const restock = alert.type === 'LOW_STOCK' || alert.type === 'PRODUCT_EXPIRED' || alert.type === 'PRODUCT_EXPIRING'
  const order = createWorkOrder(ctx.store, {
    type: type ?? (restock ? 'RESTOCK' : 'MAINTENANCE'), source: 'ALERT', machineId: alert.machineId!, title: title ?? alert.title ?? 'Cảnh báo', description,
    priority: priority ?? (alert.severity === 'CRITICAL' ? 'URGENT' : alert.severity === 'WARNING' ? 'HIGH' : 'NORMAL'),
    assigneeId: assignee?.id ?? null, dueAt: dueAt ?? null, createdById: ctx.user!.id, alertIds: [alert.id!],
  }, ctx.now)
  if (alert.status === 'OPEN') Object.assign(alert, { status: 'ACKNOWLEDGED', acknowledgedAt: iso(ctx.now), acknowledgedBy: ctx.user!.email })
  return created(workOrderView(ctx.store, order, ctx.now))
}

// ---- restock

function restockView(store: MockStore, order: MockWorkOrder) {
  const lines = store.restockLines.filter(line => line.workOrderId === order.id)
  const commands = store.maintenanceCommands.filter(command => command.workOrderId === order.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  const removedByReason: Record<string, number> = {}
  for (const command of commands) {
    const applied = command.status === 'COMPLETED' || (command.status === 'RECONCILED' && command.reconciliationOutcome === 'DONE')
    if (applied && command.removedCount) removedByReason[command.reason ?? 'OTHER'] = (removedByReason[command.reason ?? 'OTHER'] ?? 0) + command.removedCount
  }
  return {
    workOrderId: order.id, workOrderCode: order.code, status: order.status,
    lines: lines.map(({ loads, ...line }) => ({ ...line, loads: loads.map(load => ({ ...load })) })),
    plannedTotal: lines.reduce((sum, line) => sum + line.plannedQuantity, 0), loadedTotal: lines.reduce((sum, line) => sum + line.loadedQuantity, 0),
    maintenanceCommands: commands.map(command => ({
      id: command.id, commandCode: command.commandCode, operation: command.operation, status: command.status, reason: command.reason,
      slotCode: store.slots.find(slot => slot.id === command.slotId)?.slotCode ?? null, removedCount: command.removedCount,
      reconciliationOutcome: command.reconciliationOutcome, createdAt: command.createdAt,
    })),
    removedByReason,
  }
}

function slotSuggestion(store: MockStore, slot: MockStore['slots'][number], now: number) {
  const present = presentItems(store, slot.id!)
  const today = vietnamDate(now)
  const expired = present.filter(item => isExpired(item, now))
  const expiringToday = present.filter(item => !isExpired(item, now) && vietnamDate(Date.parse(item.expiresAt)) === today)
  const failed = present.filter(item => item.status === 'DISPENSE_FAILED')
  const head = present[0]
  const headStatus = head ? (isExpired(head, now) ? 'EXPIRED' : head.status) : null
  const headBlocked = headStatus === 'EXPIRED' || headStatus === 'DISPENSE_FAILED'
  const sellable = headBlocked ? 0 : present.filter(item => item.status === 'AVAILABLE' && !isExpired(item, now)).length
  const newest = [...present].sort((a, b) => b.loadedAt.localeCompare(a.loadedAt))[0]
  const product = newest && store.products.find(candidate => candidate.id === newest.productId)
  const capacity = slot.capacity ?? 0
  let action: 'NONE' | 'LOAD' | 'EMPTY_THEN_LOAD' = 'NONE', quantity = 0
  if (slot.status === 'INACTIVE') action = 'NONE'
  else if (expired.length || expiringToday.length || failed.length || headBlocked) { action = 'EMPTY_THEN_LOAD'; quantity = capacity }
  else if (sellable > LOW_STOCK_THRESHOLD || present.length >= capacity) action = 'NONE'
  else { action = 'LOAD'; quantity = capacity - present.length }
  return {
    slotId: slot.id, slotCode: slot.slotCode, capacity, slotStatus: slot.status, refillGateOpen: !!slot.refillGateOpen, physicalCount: present.length, sellableCount: sellable,
    expiredCount: expired.length, expiringTodayCount: expiringToday.length, dispenseFailedCount: failed.length, headStatus,
    currentProduct: product ? { id: product.id, name: product.name } : null, suggestedAction: action, suggestedLoadQuantity: quantity,
    openAlerts: store.alerts.filter(alert => alert.slotId === slot.id && alert.status !== 'RESOLVED').map(alert => alert.type),
  }
}
function suggestions(store: MockStore, machine: MockStore['machines'][number], now: number) {
  const slots = store.slots.filter(slot => slot.machineId === machine.id).sort((a, b) => (a.slotCode ?? '').localeCompare(b.slotCode ?? ''))
  return { machineId: machine.id, machineCode: machine.code, lowStockThreshold: LOW_STOCK_THRESHOLD, slots: slots.map(slot => slotSuggestion(store, slot, now)) }
}

function findLine(ctx: HandlerContext, order: MockWorkOrder): MockRestockLine {
  const lineId = uuidParam(ctx.params.lineId, 'lineId')
  const line = ctx.store.restockLines.find(candidate => candidate.id === lineId && candidate.workOrderId === order.id)
  if (!line) throw notFound('Restock line not found')
  return line
}
function plannable(order: MockWorkOrder) {
  if (order.type !== 'RESTOCK') throw new MockHttpError(400, 'Restock lines only belong to RESTOCK work orders')
  if (closed(order.status)) throw conflict(`INVALID_WORK_ORDER_TRANSITION: work order ${order.code} is ${order.status}`)
}

/** POST .../loads: the load core shared with /inventory/load (FIFO by strictly increasing loaded_at), referencing the line. */
function loadLine(ctx: HandlerContext): Reply {
  const { store, now } = ctx
  const form = new Form(ctx.body, ['batchId', 'quantity', 'acknowledgeExpiryInversion'])
  const batchId = form.text('batchId'), quantity = form.integer('quantity', 1, 1000)
  const acknowledge = (ctx.body as Record<string, unknown>).acknowledgeExpiryInversion === true
  form.done()
  const order = findExecutable(ctx)
  const line = findLine(ctx, order)
  if (order.type !== 'RESTOCK' || order.status !== 'IN_PROGRESS') throw conflict(`WORK_ORDER_NOT_IN_PROGRESS: work order ${order.code} is ${order.status}`)
  const batch = store.batches.find(candidate => candidate.id === batchId)
  if (!batch) throw notFound('Batch not found')
  if (batch.productId !== line.productId) throw conflict('BATCH_PRODUCT_MISMATCH: the batch is not the product of the line')
  if (Date.parse(batch.expiresAt) <= now + HOLD_MS) throw conflict(`BATCH_EXPIRED: batch ${batch.batchCode} expires within the reservation hold`)
  const slot = store.slots.find(candidate => candidate.id === line.slotId)!
  if (slot.status !== 'ACTIVE' && slot.status !== 'ERROR') throw conflict(`SLOT_INACTIVE: slot ${slot.slotCode} is INACTIVE`)
  const present = presentItems(store, slot.id!)
  if (present.length + quantity > (slot.capacity ?? 0)) throw conflict(`SLOT_CAPACITY_EXCEEDED: slot ${slot.slotCode} has ${(slot.capacity ?? 0) - present.length} free places`)
  if (store.items.filter(item => item.batchId === batch.id).length + quantity > batch.quantity) throw conflict(`BATCH_QUANTITY_EXCEEDED: batch ${batch.batchCode} has fewer bowls left`)
  const later = present.filter(item => Date.parse(item.expiresAt) > Date.parse(batch.expiresAt))
  if (later.length && !acknowledge) throw conflict(`EXPIRY_INVERSION: batch ${batch.batchCode} expires before ${later.length} bowl(s) already in slot ${slot.slotCode}`)
  const last = Math.max(now, ...present.map(item => Date.parse(item.loadedAt) + 1))
  const ids: string[] = []
  for (let n = 0; n < quantity; n += 1) {
    const at = iso(last + n)
    const item: MockItem = {
      id: newId(), batchId: batch.id, batchCode: batch.batchCode, productId: batch.productId, productName: batch.productName, machineId: slot.machineId!, slotId: slot.id!,
      slotCode: slot.slotCode, status: 'AVAILABLE', expiresAt: batch.expiresAt, loadedAt: at, createdAt: at, updatedAt: at,
    }
    store.items.push(item)
    history(store, item, 'LOAD', now, { referenceId: line.id, performedBy: ctx.user!.id, reason: `Restock ${order.code}`, statusAfter: 'AVAILABLE' })
    ids.push(item.id)
  }
  line.loadedQuantity += quantity
  line.loads.push({ batchId: batch.id, batchCode: batch.batchCode, quantity, loadedAt: iso(now), actorId: ctx.user!.id, actorName: ctx.user!.fullName })
  recordEvent(store, order, 'NOTE', ctx.user!.id, now, { before: order.status, note: `Loaded ${quantity} bowl(s) of ${batch.batchCode} into slot ${slot.slotCode}` })
  order.updatedAt = iso(now)
  const { loads, ...rest } = line
  return ok({ line: { ...rest, loads: loads.map(load => ({ ...load })) }, loaded: quantity, inventoryItemIds: ids })
}

function completeOrder(ctx: HandlerContext): Reply {
  const { store, now } = ctx
  const form = new Form(ctx.body, ['resultNote', 'resolveLinkedAlerts', 'lineVariances'])
  const data = ctx.body as Record<string, unknown>
  const note = form.text('resultNote', 2000)
  const variances = Array.isArray(data.lineVariances) ? data.lineVariances as { lineId?: unknown; reason?: unknown }[] : []
  if (data.lineVariances !== undefined && data.lineVariances !== null && !Array.isArray(data.lineVariances)) form.reject('lineVariances', 'Must be an array')
  variances.forEach((variance, index) => {
    if (typeof variance?.lineId !== 'string' || !UUID.test(variance.lineId)) form.reject(`lineVariances[${index}].lineId`, 'Must be a valid UUID')
    if (typeof variance?.reason !== 'string' || !variance.reason.trim()) form.reject(`lineVariances[${index}].reason`, 'must not be blank')
    else if (variance.reason.length > 500) form.reject(`lineVariances[${index}].reason`, 'size must be between 1 and 500')
  })
  form.done()
  const order = findExecutable(ctx)
  transition(order, ['IN_PROGRESS'], 'complete')
  if (store.maintenanceCommands.some(command => command.machineId === order.machineId && (UNFINISHED_COMMAND.includes(command.status) || (command.workOrderId === order.id && command.status === 'NEEDS_RECONCILIATION')))) {
    throw conflict('MACHINE_COMMAND_IN_PROGRESS: a maintenance command of the machine is not finished')
  }
  if (order.type === 'RESTOCK') {
    const lines = store.restockLines.filter(line => line.workOrderId === order.id)
    const given = new Map(variances.map(variance => [variance.lineId as string, (variance.reason as string).trim()]))
    const missing = lines.filter(line => line.loadedQuantity !== line.plannedQuantity && !given.get(line.id) && !line.varianceReason)
    if (missing.length) throw conflict(`RESTOCK_VARIANCE_REASON_REQUIRED: lines ${missing.map(line => line.slotCode).join(', ')} differ from the plan without a reason`)
    if (store.slots.some(slot => slot.machineId === order.machineId && slot.refillGateOpen)) throw conflict('REFILL_GATE_OPEN: a refill gate of the machine is open')
    for (const line of lines) if (given.get(line.id)) line.varianceReason = given.get(line.id)!
  }
  const before = order.status
  Object.assign(order, { status: 'DONE', completedAt: iso(now), completedById: ctx.user!.id, resultNote: note })
  touch(order, now)
  if (data.resolveLinkedAlerts !== false) {
    for (const alertId of order.alertIds) {
      const alert = store.alerts.find(candidate => candidate.id === alertId)
      if (alert && alert.status !== 'RESOLVED') Object.assign(alert, { status: 'RESOLVED', resolvedAt: iso(Math.max(now, Date.parse(alert.triggeredAt ?? ''))), resolvedBy: ctx.user!.email, resolutionNote: `Resolved by ${order.code}` })
    }
  }
  recordEvent(store, order, 'COMPLETED', ctx.user!.id, now, { before, note })
  afterClosed(ctx, order)
  return ok(workOrderView(store, order, now))
}

// ---- maintenance commands

function commandView(store: MockStore, command: MockMaintenanceCommand) {
  const machine = store.machines.find(candidate => candidate.id === command.machineId)
  const slot = store.slots.find(candidate => candidate.id === command.slotId)
  const target = store.items.find(item => item.id === command.targetItemId)
  return {
    id: command.id, commandCode: command.commandCode, machineId: command.machineId, machineCode: machine?.code, slotId: command.slotId, slotCode: slot?.slotCode ?? null,
    operation: command.operation, status: command.status, reason: command.reason, note: command.note,
    targetItem: target ? { inventoryItemId: target.id, productId: target.productId, productName: target.productName, batchId: target.batchId, batchCode: target.batchCode } : null,
    requestedBy: person(store, command.requestedById), workOrderId: command.workOrderId, attemptCount: command.attemptCount, createdAt: command.createdAt,
    sentAt: command.sentAt, acceptedAt: command.acceptedAt, finishedAt: command.finishedAt, failureReason: command.failureReason, removedCount: command.removedCount,
    reconciliationOutcome: command.reconciliationOutcome, reconciledBy: person(store, command.reconciledById), reconciledAt: command.reconciledAt,
  }
}

function idempotencyKey(ctx: HandlerContext): string {
  const key = ctx.headers?.get('idempotency-key') ?? ''
  if (!/^[\w-]{8,64}$/.test(key)) throw new MockHttpError(400, 'Idempotency-Key header is required (8 to 64 letters, digits, underscores or hyphens)')
  return key
}
/** Same key: the same request answers the existing command (200), another request is IDEMPOTENCY_KEY_REUSED. */
function replay(ctx: HandlerContext, key: string, signature: string): Reply | undefined {
  const previous = ctx.store.maintenanceCommands.find(command => command.idempotencyKey === key && command.requestedById === ctx.user!.id)
  if (!previous) return undefined
  if (previous.signature !== signature) throw conflict('IDEMPOTENCY_KEY_REUSED: this Idempotency-Key was used for another request')
  return ok(commandView(ctx.store, previous))
}
/** Conditions every command shares (under the machine lock). */
function machineReady(ctx: HandlerContext, machine: MockStore['machines'][number]) {
  if (machine.status !== 'MAINTENANCE') throw conflict(`MACHINE_NOT_IN_MAINTENANCE: machine ${machine.code} is ${machine.status}`)
  if (ctx.store.maintenanceCommands.some(command => command.machineId === machine.id && UNFINISHED_COMMAND.includes(command.status))) {
    throw conflict(`MACHINE_COMMAND_IN_PROGRESS: machine ${machine.code} is running another command`)
  }
  const connectivity = machineView(ctx.store, machine, ctx.now).connectivity
  if (connectivity === 'OFFLINE' || connectivity === 'NEVER_SEEN') throw conflict(`MACHINE_OFFLINE: machine ${machine.code} is offline`)
}
function newCommand(ctx: HandlerContext, fields: Pick<MockMaintenanceCommand, 'machineId' | 'slotId' | 'operation' | 'reason' | 'note' | 'targetItemId' | 'workOrderId' | 'idempotencyKey' | 'signature'>): MockMaintenanceCommand {
  const command: MockMaintenanceCommand = {
    id: newId(), commandCode: `MC-${vietnamDate(ctx.now).replaceAll('-', '')}-${randomCode(6)}`, status: 'PENDING', requestedById: ctx.user!.id, attemptCount: 0,
    createdAt: iso(ctx.now), sentAt: null, acceptedAt: null, finishedAt: null, failureReason: null, removedCount: null, reconciliationOutcome: null,
    reconciledById: null, reconciledAt: null, ...fields,
  }
  ctx.store.maintenanceCommands.push(command)
  return command
}

function createColumnCommand(ctx: HandlerContext): Reply {
  const { store } = ctx
  const key = idempotencyKey(ctx)
  const form = new Form(ctx.body, ['operation', 'reason', 'note', 'inventoryItemId', 'workOrderId'])
  const data = ctx.body as Record<string, unknown>
  const operation = form.oneOf('operation', COLUMN_OPERATIONS)
  const removal = operation === 'REMOVE_ITEM' || operation === 'EMPTY_COLUMN'
  const reason = data.reason === undefined || data.reason === null ? null : form.oneOf('reason', REASONS)
  const note = form.optionalText('note', 500)
  if (removal && !reason) form.reject('reason', 'must not be null when bowls are taken out')
  if (!removal && reason) form.reject('reason', `must be null for ${operation}`)
  if (reason === 'OTHER' && !note) form.reject('note', 'must not be blank when the reason is OTHER')
  const itemId = data.inventoryItemId
  if (itemId !== undefined && itemId !== null && (operation !== 'REMOVE_ITEM' || typeof itemId !== 'string' || !UUID.test(itemId))) form.reject('inventoryItemId', operation === 'REMOVE_ITEM' ? 'Must be a valid UUID' : `must be null for ${operation}`)
  const workOrderId = data.workOrderId
  if (workOrderId !== undefined && workOrderId !== null && (typeof workOrderId !== 'string' || !UUID.test(workOrderId))) form.reject('workOrderId', 'Must be a valid UUID')
  form.done()
  const signature = JSON.stringify([ctx.params.machineId, ctx.params.slotId, operation, reason, note, itemId ?? null, workOrderId ?? null])
  const again = replay(ctx, key, signature)
  if (again) return again
  const machine = store.machines.find(candidate => candidate.id === decode(ctx.params.machineId))
  if (!machine) throw notFound('Machine not found')
  const slot = store.slots.find(candidate => candidate.id === decode(ctx.params.slotId) && candidate.machineId === machine.id)
  if (!slot) throw notFound('Slot not found in specified machine')
  let order: MockWorkOrder | undefined
  if (typeof workOrderId === 'string') {
    order = findExecutable(ctx, workOrderId)
    if (order.machineId !== machine.id) throw conflict(`WORK_ORDER_OTHER_MACHINE: work order ${order.code} belongs to another machine`)
    if (order.status !== 'IN_PROGRESS') throw conflict(`WORK_ORDER_NOT_IN_PROGRESS: work order ${order.code} is ${order.status}`)
  }
  machineReady(ctx, machine)
  const present = presentItems(store, slot.id!)
  if (operation !== 'CLOSE_REFILL' && present.some(item => item.status === 'RESERVED')) throw conflict(`SLOT_HAS_RESERVED_ITEM: slot ${slot.slotCode} holds a bowl reserved for an order`)
  let target: MockItem | undefined
  if (operation === 'REMOVE_ITEM') {
    target = present[0]
    if (!target) throw conflict(`SLOT_EMPTY: slot ${slot.slotCode} is empty`)
    if (!REMOVABLE.includes(target.status)) throw conflict(`HEAD_NOT_REMOVABLE: the head of slot ${slot.slotCode} is ${target.status}`)
    if (typeof itemId === 'string' && itemId !== target.id) throw conflict(`NOT_HEAD_ITEM: the bowl is not the head of slot ${slot.slotCode}`)
    if (slot.refillGateOpen) throw conflict(`REFILL_GATE_OPEN: the refill gate of slot ${slot.slotCode} is open`)
  } else if (operation === 'EMPTY_COLUMN') {
    if (!present.length) throw conflict(`SLOT_EMPTY: slot ${slot.slotCode} is empty`)
    if (slot.refillGateOpen) throw conflict(`REFILL_GATE_OPEN: the refill gate of slot ${slot.slotCode} is open`)
  } else if (operation === 'OPEN_REFILL' && slot.refillGateOpen) throw conflict(`REFILL_GATE_OPEN: the refill gate of slot ${slot.slotCode} is already open`)
  const command = newCommand(ctx, { machineId: machine.id!, slotId: slot.id!, operation, reason, note, targetItemId: target?.id ?? null, workOrderId: order?.id ?? null, idempotencyKey: key, signature })
  return created(commandView(store, command))
}

function createReset(ctx: HandlerContext): Reply {
  const key = idempotencyKey(ctx)
  const body = ctx.body ?? {}
  const form = new Form(body, ['note'])
  const note = form.optionalText('note', 500)
  form.done()
  const signature = JSON.stringify([ctx.params.machineId, 'RESET', note])
  const again = replay(ctx, key, signature)
  if (again) return again
  const machine = ctx.store.machines.find(candidate => candidate.id === decode(ctx.params.machineId))
  if (!machine) throw notFound('Machine not found')
  machineReady(ctx, machine)
  const command = newCommand(ctx, { machineId: machine.id!, slotId: null, operation: 'RESET', reason: null, note, targetItemId: null, workOrderId: null, idempotencyKey: key, signature })
  return created(commandView(ctx.store, command))
}

/** Effect of a command the machine (or a reconciliation DONE) says was done. Returns false when a REMOVE_ITEM head changed. */
function applyEffect(store: MockStore, command: MockMaintenanceCommand, now: number): boolean {
  const slot = store.slots.find(candidate => candidate.id === command.slotId)
  const reason = command.reason ?? 'OTHER'
  const take = (items: MockItem[]) => {
    for (const item of items) {
      const before = item.status
      setItemStatus(item, 'REMOVED', now)
      item.removedAt = iso(now)
      history(store, item, 'REMOVE', now, { referenceId: command.id, performedBy: command.requestedById, reason: `${reason} (${command.commandCode})`, statusBefore: before, statusAfter: 'REMOVED' })
    }
    command.removedCount = items.length
  }
  if (command.operation === 'REMOVE_ITEM') {
    const head = slot ? headOf(store, slot.id!) : undefined
    if (!head || head.id !== command.targetItemId || !REMOVABLE.includes(head.status)) return false
    take([head])
  } else if (command.operation === 'EMPTY_COLUMN' && slot) take(presentItems(store, slot.id!).filter(item => REMOVABLE.includes(item.status)))
  else if (command.operation === 'OPEN_REFILL' && slot) slot.refillGateOpen = true
  else if (command.operation === 'CLOSE_REFILL' && slot) slot.refillGateOpen = false
  else if (command.operation === 'RESET') {
    const heartbeat = store.heartbeats.find(candidate => candidate.machineId === command.machineId)
    if (heartbeat?.dispenseState === 'FAULT') {
      heartbeat.dispenseState = 'IDLE'
      store.machineEvents.push({ id: newId(), machineId: command.machineId, eventType: 'FAULT_CLEARED', source: 'MACHINE', messageId: `mock-${randomCode(8)}`, payload: { eventType: 'FAULT_CLEARED', details: {} }, createdAt: iso(now) })
    }
  }
  return true
}

/**
 * What the dispatcher and the machine do in the background, applied before each request: PENDING → SENT after a quarter
 * of dispenseMs, ACCEPTED after half, COMPLETED after dispenseMs (RESET right after ACCEPTED). A machine that does not
 * answer (heartbeat stopped, scenario dispense-slow) → FAILED ACCEPT_TIMEOUT 30 s after createdAt; scenario
 * dispense-failed → the machine aborts after accepting → NEEDS_RECONCILIATION; a controller in FAULT rejects a column
 * command → FAILED CONTROLLER_FAULT; ACCEPTED without a report for 90 s → NEEDS_RECONCILIATION COMPLETE_TIMEOUT.
 */
export function advanceMaintenanceCommands(ctx: HandlerContext) {
  const { store, now, options } = ctx
  for (const command of store.maintenanceCommands) {
    if (!UNFINISHED_COMMAND.includes(command.status)) continue
    const createdMs = Date.parse(command.createdAt)
    const heartbeat = store.heartbeats.find(candidate => candidate.machineId === command.machineId)
    const answers = options.dispense !== 'slow' && !!heartbeat?.live
    if (command.status === 'PENDING' && createdMs + options.dispenseMs / 4 <= now) Object.assign(command, { status: 'SENT', sentAt: iso(createdMs + options.dispenseMs / 4), attemptCount: 1 })
    if (answers && command.status === 'SENT' && createdMs + options.dispenseMs / 2 <= now) {
      if (command.operation !== 'RESET' && heartbeat?.dispenseState === 'FAULT') { Object.assign(command, { status: 'FAILED', failureReason: 'CONTROLLER_FAULT', finishedAt: iso(now) }); continue }
      Object.assign(command, { status: 'ACCEPTED', acceptedAt: iso(createdMs + options.dispenseMs / 2) })
    }
    if (answers && command.status === 'ACCEPTED' && createdMs + options.dispenseMs <= now) {
      if (options.dispense === 'fail' && command.operation !== 'RESET') { Object.assign(command, { status: 'NEEDS_RECONCILIATION', failureReason: 'ABORTED', finishedAt: iso(now) }); continue }
      const applied = applyEffect(store, command, now)
      Object.assign(command, applied ? { status: 'COMPLETED', finishedAt: iso(now) } : { status: 'NEEDS_RECONCILIATION', failureReason: 'HEAD_CHANGED', finishedAt: iso(now) })
      continue
    }
    if ((command.status === 'PENDING' || command.status === 'SENT') && createdMs + ACCEPT_TIMEOUT_MS <= now) Object.assign(command, { status: 'FAILED', failureReason: 'ACCEPT_TIMEOUT', finishedAt: iso(now) })
    else if (command.status === 'ACCEPTED' && Date.parse(command.acceptedAt ?? command.createdAt) + COMPLETE_TIMEOUT_MS <= now) Object.assign(command, { status: 'NEEDS_RECONCILIATION', failureReason: 'COMPLETE_TIMEOUT', finishedAt: iso(now) })
  }
}

function reconcileCommand(ctx: HandlerContext): Reply {
  const form = new Form(ctx.body, ['outcome', 'note'])
  const outcome = form.oneOf('outcome', ['DONE', 'NOT_DONE'] as const)
  const note = form.optionalText('note', 500)
  form.done()
  const id = uuidParam(ctx.params.id)
  const command = ctx.store.maintenanceCommands.find(candidate => candidate.id === id)
  if (!command) throw notFound('Maintenance command not found')
  if (command.status !== 'NEEDS_RECONCILIATION' || command.operation === 'RESET') throw conflict(`NOT_RECONCILABLE: command ${command.commandCode} is ${command.status}`)
  if (outcome === 'DONE' && !applyEffect(ctx.store, command, ctx.now)) throw conflict('EFFECT_NOT_POSSIBLE: the head of the slot is no longer the bowl of the command')
  Object.assign(command, { status: 'RECONCILED', reconciliationOutcome: outcome, reconciledById: ctx.user!.id, reconciledAt: iso(ctx.now), note: note ?? command.note })
  return ok(commandView(ctx.store, command))
}

// ---- maintenance plans

const today = (now: number) => vietnamDate(now)
/** Vietnam day + local time → instant. */
const dueAtOf = (date: string, time: string) => new Date(Date.parse(`${date}T${time}:00+07:00`)).toISOString()
function unfinishedOfPlan(store: MockStore, plan: MockPlan): MockWorkOrder | undefined {
  return store.workOrders.find(order => order.maintenancePlanId === plan.id && !closed(order.status))
}
export function planView(store: MockStore, plan: MockPlan, now: number) {
  const machine = store.machines.find(candidate => candidate.id === plan.machineId)
  const current = unfinishedOfPlan(store, plan)
  return {
    id: plan.id, machineId: plan.machineId, machineCode: machine?.code, machineName: machine?.name, title: plan.title, instructions: plan.instructions,
    intervalDays: plan.intervalDays, leadDays: plan.leadDays, dueTime: plan.dueTime, priority: plan.priority, defaultAssignee: person(store, plan.defaultAssigneeId),
    nextDueDate: plan.nextDueDate, active: plan.active, overdue: plan.active && plan.nextDueDate < today(now) && !current,
    currentWorkOrder: current ? { id: current.id, code: current.code, status: current.status } : null, lastCompletedAt: plan.lastCompletedAt,
    createdBy: person(store, plan.createdById), version: plan.version, createdAt: plan.createdAt, updatedAt: plan.updatedAt,
  }
}
/** The work order of the plan's current occurrence, given to the default assignee when they may still execute. */
function generate(store: MockStore, plan: MockPlan, now: number): MockWorkOrder {
  const assignee = store.users.find(user => user.id === plan.defaultAssigneeId && user.status === 'ACTIVE' && permissionsOfUser(store, user).includes('WORK_ORDER_EXECUTE'))
  return createWorkOrder(store, {
    type: 'MAINTENANCE', source: 'SCHEDULE', machineId: plan.machineId, title: plan.title, description: plan.instructions, priority: plan.priority,
    assigneeId: assignee?.id ?? null, dueAt: dueAtOf(plan.nextDueDate, plan.dueTime), createdById: null, maintenancePlanId: plan.id, scheduledFor: plan.nextDueDate,
  }, now)
}
/** The hourly job of #70, played when plans are read or written: due plans (nextDueDate − leadDays ≤ today) get their work order. */
export function syncPlans(store: MockStore, now: number) {
  for (const plan of store.maintenancePlans) {
    if (!plan.active || addDays(plan.nextDueDate, -plan.leadDays) > today(now)) continue
    if (store.machines.find(machine => machine.id === plan.machineId)?.status === 'INACTIVE' || unfinishedOfPlan(store, plan)) continue
    if (store.workOrders.some(order => order.maintenancePlanId === plan.id && order.scheduledFor === plan.nextDueDate)) continue
    generate(store, plan, now)
  }
}
function findPlan(ctx: HandlerContext): MockPlan {
  const id = uuidParam(ctx.params.id)
  const plan = ctx.store.maintenancePlans.find(candidate => candidate.id === id)
  if (!plan) throw notFound('Maintenance plan not found')
  return plan
}
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/
/** Fields shared by POST and PATCH; `partial`: only those present are checked. */
function planFields(ctx: HandlerContext, form: Form, data: Record<string, unknown>, partial: boolean) {
  const present = (field: string) => !partial || (Object.hasOwn(data, field) && data[field] !== null)
  const values: Partial<MockPlan> & { defaultAssigneeId?: string | null } = {}
  if (present('title')) values.title = form.text('title', 200)
  if (Object.hasOwn(data, 'instructions') && data.instructions !== null) values.instructions = form.optionalText('instructions', 2000)
  if (present('intervalDays')) values.intervalDays = form.integer('intervalDays', 1, 365)
  if (Object.hasOwn(data, 'leadDays') && data.leadDays !== null) values.leadDays = form.integer('leadDays', 0, 30)
  if (Object.hasOwn(data, 'dueTime') && data.dueTime !== null) {
    if (typeof data.dueTime !== 'string' || !TIME.test(data.dueTime)) form.reject('dueTime', 'Must be a time HH:mm')
    else values.dueTime = data.dueTime
  }
  if (Object.hasOwn(data, 'priority') && data.priority !== null) values.priority = form.oneOf('priority', PRIORITIES)
  if (Object.hasOwn(data, 'defaultAssigneeId') && data.defaultAssigneeId !== null) {
    const user = assigneeOf(ctx, form, data.defaultAssigneeId)
    if (user) values.defaultAssigneeId = user.id
    else if (form.errors.assigneeId) { form.reject('defaultAssigneeId', form.errors.assigneeId); delete form.errors.assigneeId }
  }
  return values
}
function checkDate(form: Form, data: Record<string, unknown>, field: string, now: number): string | undefined {
  if (!Object.hasOwn(data, field) || data[field] === null) return undefined
  const value = data[field]
  if (typeof value !== 'string' || !isDateString(value)) { form.reject(field, 'Must be a date (yyyy-MM-dd)'); return undefined }
  if (value < today(now)) { form.reject(field, 'Must be today or later'); return undefined }
  return value
}

// ---- routes

export const workOrderRoutes: Route[] = [
  // Work orders (#66). /me before /:id.
  route('GET', '/work-orders/me', { permission: 'WORK_ORDER_READ_ASSIGNED' }, ctx => listOrders(ctx, true)),
  route('GET', '/work-orders', { permission: 'WORK_ORDER_READ_ALL' }, ctx => listOrders(ctx, false)),
  route('GET', '/work-orders/:id', { permission: 'WORK_ORDER_READ_ASSIGNED' }, ctx => ok(workOrderView(ctx.store, findWorkOrder(ctx), ctx.now))),
  route('GET', '/work-orders/:id/events', { permission: 'WORK_ORDER_READ_ASSIGNED' }, ctx => {
    const order = findWorkOrder(ctx)
    return ok(ctx.store.workOrderEvents.filter(event => event.workOrderId === order.id).map(({ workOrderId: _workOrderId, ...event }) => event))
  }),
  route('POST', '/work-orders', { permission: 'WORK_ORDER_MANAGE' }, ctx => {
    const { store, now } = ctx
    const data = ctx.body as Record<string, unknown>
    const form = new Form(ctx.body, ['type', 'machineId', 'title', 'description', 'priority', 'assigneeId', 'dueAt', 'restockLines'])
    const type = form.oneOf('type', TYPES)
    const title = form.text('title', 200), description = form.optionalText('description', 2000)
    const priority = data.priority === undefined || data.priority === null ? null : form.oneOf('priority', PRIORITIES)
    const machineId = typeof data.machineId === 'string' && UUID.test(data.machineId) ? data.machineId : (form.reject('machineId', 'Must be a valid UUID'), '')
    const dueAt = futureInstant(ctx, form, data, 'dueAt')
    const assignee = data.assigneeId !== undefined && data.assigneeId !== null ? assigneeOf(ctx, form, data.assigneeId) : null
    const lines = data.restockLines
    if (lines !== undefined && lines !== null && (!Array.isArray(lines) || type !== 'RESTOCK')) form.reject('restockLines', type !== 'RESTOCK' ? 'Only a RESTOCK work order has restock lines' : 'Must be an array')
    form.done()
    const machine = store.machines.find(candidate => candidate.id === machineId)
    if (!machine) throw notFound('Machine not found')
    if (Array.isArray(lines) && lines.length && !has(ctx, 'RESTOCK_PLAN')) throw new MockHttpError(403, 'Access denied')
    const draft = { id: newId(), machineId }
    const planned: MockRestockLine[] = []
    if (Array.isArray(lines)) lines.forEach((line, index) => planned.push(checkLine(ctx, draft, line, planned, `restockLines[${index}]`)))
    const order = createWorkOrder(store, { type, source: 'MANUAL', machineId, title, description, priority, assigneeId: assignee?.id ?? null, dueAt: dueAt ?? null, createdById: ctx.user!.id }, now)
    for (const line of planned) store.restockLines.push({ ...line, workOrderId: order.id })
    return created(workOrderView(store, order, now))
  }),
  route('PATCH', '/work-orders/:id', { permission: 'WORK_ORDER_MANAGE' }, ctx => {
    const data = ctx.body as Record<string, unknown>
    const form = new Form(ctx.body, ['version', 'title', 'description', 'priority', 'dueAt'])
    const version = versionOf(form)
    const title = Object.hasOwn(data, 'title') && data.title !== null ? form.text('title', 200) : undefined
    const description = Object.hasOwn(data, 'description') && data.description !== null ? form.optionalText('description', 2000) : undefined
    const priority = Object.hasOwn(data, 'priority') && data.priority !== null ? form.oneOf('priority', PRIORITIES) : undefined
    const dueAt = futureInstant(ctx, form, data, 'dueAt')
    form.done()
    const order = findWorkOrder(ctx)
    if (closed(order.status)) throw conflict(`INVALID_WORK_ORDER_TRANSITION: work order ${order.code} is ${order.status}`)
    checkVersion(order, version)
    const changes: Record<string, unknown> = {}
    if (title !== undefined && title !== order.title) changes.title = title
    if (description !== undefined && description !== order.description) changes.description = description
    if (priority !== undefined && priority !== order.priority) changes.priority = priority
    if (dueAt !== undefined && dueAt !== order.dueAt) changes.dueAt = dueAt
    if (Object.keys(changes).length) {
      Object.assign(order, changes)
      touch(order, ctx.now)
      recordEvent(ctx.store, order, 'UPDATED', ctx.user!.id, ctx.now, { before: order.status, details: changes })
    }
    return ok(workOrderView(ctx.store, order, ctx.now))
  }),
  route('POST', '/work-orders/:id/assign', { permission: 'WORK_ORDER_MANAGE' }, ctx => {
    const form = new Form(ctx.body, ['assigneeId', 'version'])
    const version = versionOf(form)
    const assignee = assigneeOf(ctx, form, (ctx.body as Record<string, unknown>).assigneeId)
    form.done()
    const order = findWorkOrder(ctx)
    transition(order, ['OPEN', 'ASSIGNED', 'IN_PROGRESS'], 'assign')
    checkVersion(order, version)
    const before = order.status
    Object.assign(order, { assigneeId: assignee!.id, status: before === 'IN_PROGRESS' ? 'IN_PROGRESS' : 'ASSIGNED' })
    touch(order, ctx.now)
    recordEvent(ctx.store, order, 'ASSIGNED', ctx.user!.id, ctx.now, { before, details: { assigneeId: assignee!.id } })
    return ok(workOrderView(ctx.store, order, ctx.now))
  }),
  route('POST', '/work-orders/:id/unassign', { permission: 'WORK_ORDER_MANAGE' }, ctx => {
    const form = new Form(ctx.body, ['version'])
    const version = versionOf(form)
    form.done()
    const order = findWorkOrder(ctx)
    transition(order, ['ASSIGNED'], 'unassign')
    checkVersion(order, version)
    Object.assign(order, { assigneeId: null, status: 'OPEN' })
    touch(order, ctx.now)
    recordEvent(ctx.store, order, 'UNASSIGNED', ctx.user!.id, ctx.now, { before: 'ASSIGNED' })
    return ok(workOrderView(ctx.store, order, ctx.now))
  }),
  route('POST', '/work-orders/:id/start', { permission: 'WORK_ORDER_EXECUTE' }, ctx => {
    const { store, now } = ctx
    let stopMachine = false
    if (ctx.body !== undefined && ctx.body !== null) {
      const form = new Form(ctx.body, ['stopMachine'])
      const value = (ctx.body as Record<string, unknown>).stopMachine
      if (value !== undefined && value !== null && typeof value !== 'boolean') form.reject('stopMachine', 'Must be a boolean')
      form.done()
      stopMachine = value === true
    }
    const order = findExecutable(ctx)
    if (order.status === 'IN_PROGRESS') return ok(workOrderView(store, order, now))
    transition(order, ['ASSIGNED'], 'start')
    const machine = store.machines.find(candidate => candidate.id === order.machineId)!
    if (machine.status === 'INACTIVE') throw conflict(`MACHINE_INACTIVE: machine ${machine.code} is INACTIVE`)
    if (order.type === 'RESTOCK' && !store.restockLines.some(line => line.workOrderId === order.id)) throw conflict(`RESTOCK_WITHOUT_LINES: work order ${order.code} has no restock line`)
    const stops = order.type !== 'INCIDENT' || stopMachine
    if (stops && store.orders.some(candidate => candidate.live && candidate.machineId === machine.id && ['PENDING_PAYMENT', 'PAID', 'DISPENSING'].includes(candidate.status))) {
      throw conflict(`MACHINE_HAS_ACTIVE_ORDERS: machine ${machine.code} still has orders being paid or dispensed`)
    }
    if (stops && machine.status === 'ACTIVE') Object.assign(machine, { status: 'MAINTENANCE', updatedAt: iso(now) })
    Object.assign(order, { status: 'IN_PROGRESS', startedAt: iso(now) })
    touch(order, now)
    recordEvent(store, order, 'STARTED', ctx.user!.id, now, { before: 'ASSIGNED', details: { stopMachine: stops } })
    return ok(workOrderView(store, order, now))
  }),
  route('POST', '/work-orders/:id/notes', { permission: 'WORK_ORDER_EXECUTE' }, ctx => {
    const form = new Form(ctx.body, ['note'])
    const note = form.text('note', 2000)
    form.done()
    const order = findExecutable(ctx)
    if (closed(order.status)) throw conflict(`INVALID_WORK_ORDER_TRANSITION: work order ${order.code} is ${order.status}`)
    order.updatedAt = iso(ctx.now)
    recordEvent(ctx.store, order, 'NOTE', ctx.user!.id, ctx.now, { before: order.status, note })
    return ok(workOrderView(ctx.store, order, ctx.now))
  }),
  route('POST', '/work-orders/:id/complete', { permission: 'WORK_ORDER_EXECUTE' }, completeOrder),
  route('POST', '/work-orders/:id/cancel', { permission: 'WORK_ORDER_MANAGE' }, ctx => {
    const form = new Form(ctx.body, ['reason', 'version'])
    const reason = form.text('reason', 500), version = versionOf(form)
    form.done()
    const order = findWorkOrder(ctx)
    if (closed(order.status)) throw conflict(`INVALID_WORK_ORDER_TRANSITION: work order ${order.code} is ${order.status}`)
    checkVersion(order, version)
    const before = order.status
    Object.assign(order, { status: 'CANCELLED', cancelledAt: iso(ctx.now), cancelledById: ctx.user!.id, cancelReason: reason })
    touch(order, ctx.now)
    recordEvent(ctx.store, order, 'CANCELLED', ctx.user!.id, ctx.now, { before, note: reason })
    afterClosed(ctx, order)
    return ok(workOrderView(ctx.store, order, ctx.now))
  }),
  route('POST', '/work-orders/:id/alerts', { permission: 'WORK_ORDER_MANAGE' }, ctx => {
    const form = new Form(ctx.body, ['alertId'])
    const alertId = form.text('alertId')
    form.done()
    const order = findWorkOrder(ctx)
    const alert = ctx.store.alerts.find(candidate => candidate.id === alertId)
    if (!alert) throw notFound('Alert not found')
    if (alert.machineId !== order.machineId) throw new MockHttpError(400, 'The alert belongs to another machine')
    if (closed(order.status)) throw conflict(`INVALID_WORK_ORDER_TRANSITION: work order ${order.code} is ${order.status}`)
    if (!order.alertIds.includes(alert.id!)) order.alertIds.push(alert.id!)
    return ok(workOrderView(ctx.store, order, ctx.now))
  }),

  // Restock (#68).
  route('GET', '/machines/:machineId/restock-suggestions', { permission: 'RESTOCK_PLAN' }, ctx => {
    const machine = ctx.store.machines.find(candidate => candidate.id === uuidParam(ctx.params.machineId, 'machineId'))
    if (!machine) throw notFound('Machine not found')
    return ok(suggestions(ctx.store, machine, ctx.now))
  }),
  route('POST', '/machines/:machineId/restock-work-orders', { permission: 'RESTOCK_PLAN' }, ctx => {
    const { store, now } = ctx
    const data = ctx.body as Record<string, unknown>
    const form = new Form(ctx.body, ['fromSuggestions', 'title', 'priority', 'assigneeId', 'dueAt'])
    if (data.fromSuggestions !== true) form.reject('fromSuggestions', 'must be true')
    const title = form.optionalText('title', 200)
    const priority = data.priority === undefined || data.priority === null ? null : form.oneOf('priority', PRIORITIES)
    const dueAt = futureInstant(ctx, form, data, 'dueAt')
    const assignee = data.assigneeId !== undefined && data.assigneeId !== null ? assigneeOf(ctx, form, data.assigneeId) : null
    form.done()
    const machine = store.machines.find(candidate => candidate.id === uuidParam(ctx.params.machineId, 'machineId'))
    if (!machine) throw notFound('Machine not found')
    const slots = suggestions(store, machine, now).slots.filter(slot => slot.suggestedAction !== 'NONE' && slot.currentProduct && slot.suggestedLoadQuantity > 0)
    if (!slots.length) throw conflict(`NOTHING_TO_RESTOCK: no slot of machine ${machine.code} needs restocking`)
    const alertIds = store.alerts.filter(alert => alert.machineId === machine.id && alert.status !== 'RESOLVED' && slots.some(slot => slot.slotId === alert.slotId)
      && (alert.type === 'LOW_STOCK' || alert.type === 'PRODUCT_EXPIRED' || alert.type === 'PRODUCT_EXPIRING') && !activeWorkOrderOf(store, alert.id!)).map(alert => alert.id!)
    const order = createWorkOrder(store, {
      type: 'RESTOCK', source: 'MANUAL', machineId: machine.id!, title: title ?? `Nạp hàng máy ${machine.code}`, priority, assigneeId: assignee?.id ?? null,
      dueAt: dueAt ?? null, createdById: ctx.user!.id, alertIds,
    }, now)
    for (const slot of slots) {
      store.restockLines.push({
        id: newId(), workOrderId: order.id, slotId: slot.slotId!, slotCode: slot.slotCode ?? '', productId: slot.currentProduct!.id!, productName: slot.currentProduct!.name ?? '',
        plannedQuantity: slot.suggestedLoadQuantity, loadedQuantity: 0, varianceReason: null, loads: [],
      })
    }
    return created(workOrderView(store, order, now))
  }),
  route('GET', '/work-orders/:id/restock', { permission: 'WORK_ORDER_READ_ASSIGNED' }, ctx => ok(restockView(ctx.store, findWorkOrder(ctx)))),
  route('POST', '/work-orders/:id/restock-lines', { permission: 'RESTOCK_PLAN' }, ctx => {
    const order = findWorkOrder(ctx)
    plannable(order)
    const line = checkLine(ctx, order, ctx.body, ctx.store.restockLines.filter(candidate => candidate.workOrderId === order.id))
    ctx.store.restockLines.push(line)
    order.updatedAt = iso(ctx.now)
    return created({ ...line, loads: [] })
  }),
  route('PATCH', '/work-orders/:id/restock-lines/:lineId', { permission: 'RESTOCK_PLAN' }, ctx => {
    const data = ctx.body as Record<string, unknown>
    const form = new Form(ctx.body, ['plannedQuantity', 'productId'])
    const planned = Object.hasOwn(data, 'plannedQuantity') && data.plannedQuantity !== null ? form.integer('plannedQuantity', 1, 1000) : undefined
    const productId = Object.hasOwn(data, 'productId') && data.productId !== null ? form.text('productId') : undefined
    form.done()
    const order = findWorkOrder(ctx)
    plannable(order)
    const line = findLine(ctx, order)
    if (line.loadedQuantity > 0) throw conflict(`LINE_ALREADY_LOADED: bowls were already loaded against the line of slot ${line.slotCode}`)
    const slot = ctx.store.slots.find(candidate => candidate.id === line.slotId)
    if (planned !== undefined && planned > (slot?.capacity ?? 0)) throw new MockHttpError(400, 'Validation Failed', { plannedQuantity: `Must be at most the slot capacity (${slot?.capacity})` })
    if (productId !== undefined && productId !== line.productId) {
      const product = ctx.store.products.find(candidate => candidate.id === productId)
      if (!product) throw notFound('Product not found')
      if (product.status !== 'ACTIVE') throw conflict(`PRODUCT_INACTIVE: product ${product.sku} is not ACTIVE`)
      if (ctx.store.restockLines.some(other => other.workOrderId === order.id && other.id !== line.id && other.slotId === line.slotId && other.productId === productId)) throw conflict('DUPLICATE_LINE: the slot already has a line for this product')
      Object.assign(line, { productId, productName: product.name ?? '' })
    }
    if (planned !== undefined) line.plannedQuantity = planned
    return ok({ ...line, loads: [] })
  }),
  route('DELETE', '/work-orders/:id/restock-lines/:lineId', { permission: 'RESTOCK_PLAN' }, ctx => {
    const order = findWorkOrder(ctx)
    plannable(order)
    const line = findLine(ctx, order)
    if (line.loadedQuantity > 0) throw conflict(`LINE_ALREADY_LOADED: bowls were already loaded against the line of slot ${line.slotCode}`)
    ctx.store.restockLines.splice(ctx.store.restockLines.indexOf(line), 1)
    return ok(null)
  }),
  route('POST', '/work-orders/:id/restock-lines/:lineId/loads', { permission: 'RESTOCK_EXECUTE' }, loadLine),

  // Maintenance commands (#64, #68).
  route('POST', '/machines/:machineId/slots/:slotId/maintenance-commands', { permission: 'MAINTENANCE_COMMAND_EXECUTE' }, createColumnCommand),
  route('POST', '/machines/:machineId/reset', { permission: 'MACHINE_RESET' }, createReset),
  route('GET', '/maintenance-commands', { permission: 'MAINTENANCE_COMMAND_READ' }, ctx => {
    const { query, store } = ctx
    const errors: Record<string, string> = {}
    const machineId = uuidQuery(query, 'machineId', errors), slotId = uuidQuery(query, 'slotId', errors)
    const [operation] = enumParam(query, 'operation', OPERATIONS, errors), [status] = enumParam(query, 'status', COMMAND_STATUSES, errors)
    failOn(errors)
    const from = Date.parse(query.get('from') ?? ''), to = Date.parse(query.get('to') ?? '')
    const rows = store.maintenanceCommands.filter(command => (!machineId || command.machineId === machineId) && (!slotId || command.slotId === slotId)
      && (!operation || command.operation === operation) && (!status || command.status === status)
      && (!Number.isFinite(from) || Date.parse(command.createdAt) >= from) && (!Number.isFinite(to) || Date.parse(command.createdAt) < to))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id)).map(command => commandView(store, command))
    return ok(fixedPage(rows, query, { defaultSize: 20, maxSize: 100 }))
  }),
  route('GET', '/maintenance-commands/:id', { permission: 'MAINTENANCE_COMMAND_READ' }, ctx => {
    const id = uuidParam(ctx.params.id)
    const command = ctx.store.maintenanceCommands.find(candidate => candidate.id === id)
    if (!command) throw notFound('Maintenance command not found')
    return ok(commandView(ctx.store, command))
  }),
  route('POST', '/maintenance-commands/:id/reconcile', { permission: 'MAINTENANCE_COMMAND_EXECUTE' }, reconcileCommand),

  // Maintenance plans (#70). /upcoming before /:id.
  route('GET', '/maintenance-plans/upcoming', { permission: 'MAINTENANCE_PLAN_READ' }, ctx => {
    const { query, store, now } = ctx
    const errors: Record<string, string> = {}
    const raw = query.get('days')
    const days = raw === null ? 30 : Number(raw)
    if (!Number.isInteger(days) || days < 1 || days > 90) errors.days = 'Must be between 1 and 90'
    const machineId = uuidQuery(query, 'machineId', errors)
    failOn(errors)
    syncPlans(store, now)
    const until = addDays(today(now), days)
    return ok(store.maintenancePlans.filter(plan => plan.active && plan.nextDueDate <= until && (!machineId || plan.machineId === machineId))
      .sort((a, b) => a.nextDueDate.localeCompare(b.nextDueDate) || a.id.localeCompare(b.id)).map(plan => planView(store, plan, now)))
  }),
  route('GET', '/maintenance-plans', { permission: 'MAINTENANCE_PLAN_READ' }, ctx => {
    const { query, store, now } = ctx
    const errors: Record<string, string> = {}
    const machineId = uuidQuery(query, 'machineId', errors), active = boolQuery(query, 'active', errors)
    failOn(errors)
    syncPlans(store, now)
    const rows = store.maintenancePlans.filter(plan => (!machineId || plan.machineId === machineId) && (active === null || plan.active === active))
      .sort((a, b) => a.nextDueDate.localeCompare(b.nextDueDate) || a.id.localeCompare(b.id)).map(plan => planView(store, plan, now))
    return ok(fixedPage(rows, query, { defaultSize: 20, maxSize: 100 }))
  }),
  route('GET', '/maintenance-plans/:id', { permission: 'MAINTENANCE_PLAN_READ' }, ctx => {
    const plan = findPlan(ctx)
    syncPlans(ctx.store, ctx.now)
    return ok(planView(ctx.store, plan, ctx.now))
  }),
  route('GET', '/maintenance-plans/:id/work-orders', { permission: 'MAINTENANCE_PLAN_READ' }, ctx => {
    const plan = findPlan(ctx)
    return ok(ctx.store.workOrders.filter(order => order.maintenancePlanId === plan.id).sort((a, b) => (b.scheduledFor ?? '').localeCompare(a.scheduledFor ?? ''))
      .map(order => ({ id: order.id, code: order.code, status: order.status, scheduledFor: order.scheduledFor, dueAt: order.dueAt, assignee: person(ctx.store, order.assigneeId), completedAt: order.completedAt, cancelledAt: order.cancelledAt })))
  }),
  route('POST', '/maintenance-plans', { permission: 'MAINTENANCE_PLAN_MANAGE' }, ctx => {
    const { store, now } = ctx
    const data = ctx.body as Record<string, unknown>
    const form = new Form(ctx.body, ['machineId', 'title', 'instructions', 'intervalDays', 'leadDays', 'dueTime', 'priority', 'defaultAssigneeId', 'firstDueDate'])
    const machineId = typeof data.machineId === 'string' && UUID.test(data.machineId) ? data.machineId : (form.reject('machineId', 'Must be a valid UUID'), '')
    const values = planFields(ctx, form, data, false)
    const firstDue = checkDate(form, data, 'firstDueDate', now)
    const lead = values.leadDays ?? 1
    if (values.intervalDays && lead >= values.intervalDays) form.reject('leadDays', 'Must be less than intervalDays')
    form.done()
    const machine = store.machines.find(candidate => candidate.id === machineId)
    if (!machine) throw notFound('Machine not found')
    if (machine.status === 'INACTIVE') throw conflict(`MACHINE_INACTIVE: machine ${machine.code} is INACTIVE`)
    const at = iso(now)
    const plan: MockPlan = {
      id: newId(), machineId, title: values.title!, instructions: values.instructions ?? null, intervalDays: values.intervalDays!, leadDays: lead,
      dueTime: values.dueTime ?? '17:00', priority: values.priority ?? 'NORMAL', defaultAssigneeId: values.defaultAssigneeId ?? null,
      nextDueDate: firstDue ?? addDays(today(now), values.intervalDays!), active: true, lastCompletedAt: null, createdById: ctx.user!.id, version: 0, createdAt: at, updatedAt: at,
    }
    store.maintenancePlans.push(plan)
    syncPlans(store, now)
    return created(planView(store, plan, now))
  }),
  route('PATCH', '/maintenance-plans/:id', { permission: 'MAINTENANCE_PLAN_MANAGE' }, ctx => {
    const { store, now } = ctx
    const data = ctx.body as Record<string, unknown>
    const form = new Form(ctx.body, ['version', 'title', 'instructions', 'intervalDays', 'leadDays', 'dueTime', 'priority', 'defaultAssigneeId', 'clearDefaultAssignee', 'nextDueDate'])
    const version = versionOf(form)
    const values = planFields(ctx, form, data, true)
    const nextDue = checkDate(form, data, 'nextDueDate', now)
    if (data.clearDefaultAssignee !== undefined && data.clearDefaultAssignee !== null && typeof data.clearDefaultAssignee !== 'boolean') form.reject('clearDefaultAssignee', 'Must be a boolean')
    form.done()
    const plan = findPlan(ctx)
    if (version !== plan.version) throw conflict(`STALE_VERSION: maintenance plan "${plan.title}" was changed by someone else; read it again`)
    const interval = values.intervalDays ?? plan.intervalDays, lead = values.leadDays ?? plan.leadDays
    if (lead >= interval) throw new MockHttpError(400, 'Validation Failed', { leadDays: 'Must be less than intervalDays' })
    const before = JSON.stringify(plan)
    if (values.title !== undefined) plan.title = values.title
    // `""` clears the instructions; null or absent keeps them.
    if (Object.hasOwn(data, 'instructions') && data.instructions !== null) plan.instructions = values.instructions ?? null
    plan.intervalDays = interval
    plan.leadDays = lead
    if (values.dueTime) plan.dueTime = values.dueTime
    if (values.priority) plan.priority = values.priority
    if (data.clearDefaultAssignee === true) plan.defaultAssigneeId = null
    else if (values.defaultAssigneeId) plan.defaultAssigneeId = values.defaultAssigneeId
    if (nextDue) plan.nextDueDate = nextDue
    if (JSON.stringify(plan) !== before) { plan.version += 1; plan.updatedAt = iso(now) }
    syncPlans(store, now)
    return ok(planView(store, plan, now))
  }),
  route('POST', '/maintenance-plans/:id/activate', { permission: 'MAINTENANCE_PLAN_MANAGE' }, ctx => {
    const plan = findPlan(ctx)
    if (!plan.active) Object.assign(plan, { active: true, version: plan.version + 1, updatedAt: iso(ctx.now) })
    syncPlans(ctx.store, ctx.now)
    return ok(planView(ctx.store, plan, ctx.now))
  }),
  route('POST', '/maintenance-plans/:id/deactivate', { permission: 'MAINTENANCE_PLAN_MANAGE' }, ctx => {
    const plan = findPlan(ctx)
    if (plan.active) Object.assign(plan, { active: false, version: plan.version + 1, updatedAt: iso(ctx.now) })
    return ok(planView(ctx.store, plan, ctx.now))
  }),
  route('POST', '/maintenance-plans/:id/generate-now', { permission: 'MAINTENANCE_PLAN_MANAGE' }, ctx => {
    const { store, now } = ctx
    const plan = findPlan(ctx)
    if (!plan.active) throw conflict(`MAINTENANCE_PLAN_INACTIVE: maintenance plan "${plan.title}" is not active`)
    const open = unfinishedOfPlan(store, plan)
    if (open) throw conflict(`PLAN_HAS_OPEN_WORK_ORDER: work order ${open.code} of the plan is not finished`)
    if (store.workOrders.some(order => order.maintenancePlanId === plan.id && order.scheduledFor === plan.nextDueDate)) throw conflict(`OCCURRENCE_ALREADY_GENERATED: the occurrence of ${plan.nextDueDate} already has a work order`)
    const machine = store.machines.find(candidate => candidate.id === plan.machineId)
    if (machine?.status === 'INACTIVE') throw conflict(`MACHINE_INACTIVE: machine ${machine.code} is INACTIVE`)
    return created(workOrderView(store, generate(store, plan, now), now))
  }),
]

// ---- seed (dates relative to now, Vietnam business days)

const uuid = (prefix: string, n: number) => `${prefix}-0000-0000-0000-${String(n).padStart(12, '0')}`
export const MOCK_LOW_STOCK_THRESHOLD = LOW_STOCK_THRESHOLD

/**
 * Work orders of the mock (FE 7.1), every status. staff@freshvend.test has: 2 RESTOCK ASSIGNED (from the LOW_STOCK alert,
 * two planned lines), 3 MAINTENANCE IN_PROGRESS (from the expired-bowl alert, overdue), 4 MAINTENANCE DONE (from plan 1).
 * Others: 1 OPEN (MACHINE_OFFLINE alert), 5 ASSIGNED to another staff (from plan 3), 6 IN_PROGRESS of another staff,
 * 7 RESTOCK CANCELLED. Every one has its history.
 */
export function seedWorkOrders(nowMs: number, store: Pick<MockStore, 'machines' | 'users' | 'alerts' | 'slots' | 'products'>) {
  const at = (offset: number) => iso(nowMs + offset)
  const HOUR = 3_600_000, DAY = 24 * HOUR
  const [m1, m2, m3] = store.machines
  const [admin, staff] = store.users
  const restocker = store.users.find(user => user.id === uuid('11000000', 7))!
  const night = store.users.find(user => user.id === uuid('11000000', 8))!
  const workOrders: MockWorkOrder[] = []
  const events: MockWorkOrderEvent[] = []
  const event = (order: MockWorkOrder, type: MockWorkOrderEvent['type'], actorId: string | null, when: number, before: Status | null, after: Status, note: string | null = null) => {
    const user = store.users.find(candidate => candidate.id === actorId)
    events.push({ id: newId(), workOrderId: order.id, type, statusBefore: before, statusAfter: after, actor: user ? { id: user.id, fullName: user.fullName } : undefined, note, details: null, createdAt: at(when) })
  }
  const order = (n: number, machine: MockStore['machines'][number], fields: Partial<MockWorkOrder> & Pick<MockWorkOrder, 'type' | 'title'>, createdAgo: number): MockWorkOrder => {
    const id = uuid('61000000', n), createdAt = at(createdAgo)
    const row: MockWorkOrder = {
      id, code: workOrderCode(createdAt, id), source: 'MANUAL', machineId: machine.id!, description: null, priority: 'NORMAL', status: 'OPEN', assigneeId: null,
      createdById: admin.id, dueAt: null, startedAt: null, completedAt: null, completedById: null, resultNote: null, cancelledAt: null, cancelledById: null,
      cancelReason: null, alertIds: [], linkedReports: [], maintenancePlanId: null, scheduledFor: null, version: 0, createdAt, updatedAt: createdAt, ...fields,
    }
    workOrders.push(row)
    event(row, 'CREATED', row.createdById, createdAgo, null, 'OPEN')
    return row
  }
  const assign = (row: MockWorkOrder, user: MockUser, when: number) => {
    Object.assign(row, { assigneeId: user.id, status: 'ASSIGNED', version: row.version + 1, updatedAt: at(when) })
    event(row, 'ASSIGNED', admin.id, when, 'OPEN', 'ASSIGNED')
  }
  const start = (row: MockWorkOrder, when: number) => {
    Object.assign(row, { status: 'IN_PROGRESS', startedAt: at(when), version: row.version + 1, updatedAt: at(when) })
    event(row, 'STARTED', row.assigneeId, when, 'ASSIGNED', 'IN_PROGRESS')
  }
  const today = vietnamDate(nowMs)

  const wo1 = order(1, m2, { type: 'MAINTENANCE', source: 'ALERT', priority: 'URGENT', title: 'Máy mất kết nối · máy DEV-MACHINE-02', description: 'Kiểm tra nguồn điện và Wi-Fi của máy, khởi động lại bộ điều khiển nếu cần.', alertIds: [uuid('60000000', 2)], dueAt: at(3 * HOUR) }, -30 * 60_000)
  const wo2 = order(2, m1, { type: 'RESTOCK', source: 'ALERT', title: 'Nạp thêm hộp ngăn A2 · máy DEV-MACHINE-01', description: 'Xả hộp sắp hết hạn, nạp hộp mới cho A2 và B1.', alertIds: [uuid('60000000', 5)], dueAt: at(5 * HOUR) }, -45 * 60_000)
  assign(wo2, staff, -40 * 60_000)
  const wo3 = order(3, m1, { type: 'MAINTENANCE', source: 'ALERT', priority: 'HIGH', title: 'Rút hộp hết hạn ngăn B1 · máy DEV-MACHINE-01', description: 'Hộp ở đáy ngăn B1 đã hết hạn và chặn cả ngăn.', alertIds: [uuid('60000000', 3)], dueAt: at(-HOUR) }, -4 * HOUR - 10 * 60_000)
  assign(wo3, staff, -4 * HOUR); start(wo3, -3 * HOUR)
  const doneAgo = -2 * DAY + 3 * HOUR
  const wo4 = order(4, m1, { type: 'MAINTENANCE', source: 'SCHEDULE', createdById: null, title: 'Vệ sinh khay nhả hàng', maintenancePlanId: uuid('62000000', 1), scheduledFor: vietnamDate(nowMs + doneAgo), dueAt: at(doneAgo + 2 * HOUR) }, -2 * DAY - HOUR)
  assign(wo4, staff, -2 * DAY); start(wo4, -2 * DAY + 2 * HOUR)
  Object.assign(wo4, { status: 'DONE', completedAt: at(doneAgo), completedById: staff.id, resultNote: 'Đã vệ sinh khay và thử nhả 2 hộp, máy chạy bình thường.', version: wo4.version + 1, updatedAt: at(doneAgo) })
  event(wo4, 'COMPLETED', staff.id, doneAgo, 'IN_PROGRESS', 'DONE', wo4.resultNote)
  const planDue = addDays(today, -3)
  const wo5 = order(5, m2, { type: 'MAINTENANCE', source: 'SCHEDULE', createdById: null, title: 'Kiểm tra gioăng cửa và khay nước ngưng', maintenancePlanId: uuid('62000000', 3), scheduledFor: planDue, dueAt: dueAtOf(planDue, '17:00') }, -4 * DAY)
  assign(wo5, restocker, -4 * DAY)
  const wo6 = order(6, m1, { type: 'MAINTENANCE', title: 'Thay bóng đèn khoang hàng · máy DEV-MACHINE-01' }, -7 * HOUR)
  assign(wo6, night, -6 * HOUR); start(wo6, -5 * HOUR)
  const wo7 = order(7, m3, { type: 'RESTOCK', title: 'Nạp hàng lần đầu · máy DEV-MACHINE-03' }, -2 * DAY - 30 * 60_000)
  assign(wo7, restocker, -2 * DAY)
  Object.assign(wo7, { status: 'CANCELLED', cancelledAt: at(-DAY - 2 * HOUR), cancelledById: admin.id, cancelReason: 'Máy chưa lắp đặt xong, chưa có ngăn nào. Sẽ mở phiếu mới khi máy sẵn sàng.', version: wo7.version + 1, updatedAt: at(-DAY - 2 * HOUR) })
  event(wo7, 'CANCELLED', admin.id, -DAY - 2 * HOUR, 'ASSIGNED', 'CANCELLED', wo7.cancelReason)
  void wo1

  // Restock plan of work order 2: A2 gets 4 watermelon bowls, B1 (2 expired mango bowls to take out first) 6 mixed fruit.
  const line = (n: number, slotCode: string, productIndex: number, plannedQuantity: number): MockRestockLine => {
    const slot = store.slots.find(candidate => candidate.machineId === m1.id && candidate.slotCode === slotCode)!
    const product = store.products[productIndex]
    return { id: uuid('63000000', n), workOrderId: wo2.id, slotId: slot.id!, slotCode, productId: product.id!, productName: product.name ?? '', plannedQuantity, loadedQuantity: 0, varianceReason: null, loads: [] }
  }
  const restockLines = [line(1, 'A2', 1, 4), line(2, 'B1', 0, 6)]
  return { workOrders, workOrderEvents: events, restockLines, doneAt: wo4.completedAt! }
}

/**
 * Maintenance plans (FE 7.3), dates relative to today in Vietnam:
 * 1. DEV-MACHINE-01 every 7 days, last done by work order 4, so due 7 days after it.
 * 2. DEV-MACHINE-01 every 14 days, due in 2 days (lead 1 day: no work order yet), no default assignee.
 * 3. DEV-MACHINE-02 every 30 days, due 3 days ago; its work order 5 is still ASSIGNED.
 * 4. DEV-MACHINE-03 every 90 days, deactivated.
 * None is due without a work order, so reading plans does not create work orders on the seed.
 */
export function seedPlans(nowMs: number, store: Pick<MockStore, 'machines' | 'users'>, doneAt: string): MockPlan[] {
  const at = (offset: number) => iso(nowMs + offset)
  const DAY = 86_400_000
  const today = vietnamDate(nowMs)
  const [m1, m2, m3] = store.machines
  const [admin, staff] = store.users
  const restocker = store.users.find(user => user.id === uuid('11000000', 7))!
  const plan = (n: number, machine: MockStore['machines'][number], fields: Partial<MockPlan> & Pick<MockPlan, 'title' | 'intervalDays' | 'nextDueDate'>, createdAgo: number): MockPlan => ({
    id: uuid('62000000', n), machineId: machine.id!, instructions: null, leadDays: 1, dueTime: '17:00', priority: 'NORMAL', defaultAssigneeId: null, active: true,
    lastCompletedAt: null, createdById: admin.id, version: 0, createdAt: at(createdAgo), updatedAt: at(createdAgo), ...fields,
  })
  return [
    plan(1, m1, { title: 'Vệ sinh khay nhả hàng', intervalDays: 7, nextDueDate: addDays(vietnamDate(Date.parse(doneAt)), 7), lastCompletedAt: doneAt, defaultAssigneeId: staff.id, instructions: 'Lau khay, kiểm tra cảm biến rơi hộp, thử nhả 2 hộp.', version: 2 }, -30 * DAY),
    plan(2, m1, { title: 'Kiểm tra cảm biến nhiệt độ và độ ẩm', intervalDays: 14, nextDueDate: addDays(today, 2), instructions: 'So nhiệt kế cầm tay với số đo của máy; lệch quá 1 °C thì báo quản trị viên.' }, -12 * DAY),
    plan(3, m2, { title: 'Kiểm tra gioăng cửa và khay nước ngưng', intervalDays: 30, leadDays: 0, priority: 'HIGH', nextDueDate: addDays(today, -3), defaultAssigneeId: restocker.id }, -60 * DAY),
    plan(4, m3, { title: 'Vệ sinh tổng thể khoang lạnh', intervalDays: 90, leadDays: 3, nextDueDate: addDays(today, 70), active: false, version: 1, updatedAt: at(-DAY) }, -20 * DAY),
  ]
}

/**
 * Maintenance commands (FE 7.4), none unfinished so a new one can be sent right away:
 * DEV-MACHINE-01 last week: refill gate of A1 opened and closed, a RESET; DEV-MACHINE-02: refill of A1 opened and closed two
 * hours ago, a REMOVE_ITEM of the failed head of A1 the machine accepted but never reported (NEEDS_RECONCILIATION), then a
 * RESET that timed out when the machine went quiet.
 */
export function seedMaintenanceCommands(nowMs: number, store: Pick<MockStore, 'machines' | 'users' | 'slots' | 'items'>): MockMaintenanceCommand[] {
  const at = (offset: number) => iso(nowMs + offset)
  const MINUTE = 60_000, HOUR = 60 * MINUTE, DAY = 24 * HOUR
  const [m1, m2] = store.machines
  const [admin, staff] = store.users
  const slotOf = (machine: MockStore['machines'][number], code: string) => store.slots.find(slot => slot.machineId === machine.id && slot.slotCode === code)!
  const command = (n: number, machine: MockStore['machines'][number], by: MockUser, operation: Operation, status: CommandStatus, createdAgo: number, fields: Partial<MockMaintenanceCommand> = {}): MockMaintenanceCommand => ({
    id: uuid('c7400000', n), commandCode: `MC-${vietnamDate(nowMs + createdAgo).replaceAll('-', '')}-SEED${String(n).padStart(2, '0')}`, machineId: machine.id!, slotId: null,
    operation, status, reason: null, note: null, targetItemId: null, requestedById: by.id, workOrderId: null, attemptCount: 1, createdAt: at(createdAgo),
    sentAt: at(createdAgo + 1_000), acceptedAt: status === 'FAILED' ? null : at(createdAgo + 2_000), finishedAt: at(createdAgo + 8_000), failureReason: null,
    removedCount: null, reconciliationOutcome: null, reconciledById: null, reconciledAt: null, idempotencyKey: `seed-command-${n}`, signature: '', ...fields,
  })
  const failedHead = store.items.find(item => item.slotId === slotOf(m2, 'A1').id && item.status === 'DISPENSE_FAILED')
  return [
    command(1, m1, staff, 'OPEN_REFILL', 'COMPLETED', -7 * DAY, { slotId: slotOf(m1, 'A1').id! }),
    command(2, m1, staff, 'CLOSE_REFILL', 'COMPLETED', -7 * DAY + 20 * MINUTE, { slotId: slotOf(m1, 'A1').id! }),
    command(3, m1, admin, 'RESET', 'COMPLETED', -7 * DAY + 25 * MINUTE, { note: 'Khởi động lại bộ nhả hàng sau khi vệ sinh khay.' }),
    command(4, m2, staff, 'OPEN_REFILL', 'COMPLETED', -2 * HOUR, { slotId: slotOf(m2, 'A1').id! }),
    command(5, m2, staff, 'CLOSE_REFILL', 'COMPLETED', -2 * HOUR + 15 * MINUTE, { slotId: slotOf(m2, 'A1').id! }),
    command(6, m2, staff, 'REMOVE_ITEM', 'NEEDS_RECONCILIATION', -100 * MINUTE, { slotId: slotOf(m2, 'A1').id!, reason: 'DISPENSE_FAILED', targetItemId: failedHead?.id ?? null, failureReason: 'COMPLETE_TIMEOUT', finishedAt: at(-100 * MINUTE + 92_000) }),
    command(7, m2, admin, 'RESET', 'FAILED', -36 * MINUTE, { note: 'Xóa lỗi FAULT sau khi kiểm tra hai cổng.', failureReason: 'ACCEPT_TIMEOUT', finishedAt: at(-36 * MINUTE + 30_000) }),
  ]
}
