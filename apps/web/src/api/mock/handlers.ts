// One handler per endpoint the web calls. Rules follow api-contract/api.yaml and docs/*.md, and each write updates the
// in-memory store, so a change shows up on the next read and is gone after a page reload.
import { conflict, created, fixedPage, Form, MockHttpError, notFound, ok, paginate } from './http.ts'
import type { Reply } from './http.ts'
import type { MockAlert, MockCredential, MockHeartbeat, MockItem, MockOrder, MockPayment, MockRole, MockStore, MockUser } from './seed.ts'
import type { components as AuthMe } from '../drafts/auth-me'
import { ROLE_PERMISSIONS, PERMISSIONS } from '../../admin/permissions.ts'
import type { Role } from '../session.ts'
import { incidentReportRoutes } from './incident-reports.ts'
import { refundRoutes } from './refunds.ts'
import { boxPrice, eligibleToday, lineDiscount, linePricing, pricingView, updatePricing } from './pricing.ts'
import { revenueReport } from './revenue.ts'
import { activeWorkOrderOf, workOrderFromAlert, workOrderRoutes } from './work-orders.ts'

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
  /** Request headers (Idempotency-Key of maintenance commands). */
  headers?: Headers
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
 * `{ permission }`: backend #48 style check against the role → permission table in the store.
 * `{ draftPermission }`: the code of a draft contract still mocked (refunds, incident reports, revenue), checked against the
 * web's role table ROLE_PERMISSIONS.
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
  return [...new Set(user.roles.map(role => role.replace(/^ROLE_/, '')).flatMap(role => ROLE_PERMISSIONS[role as Role] ?? []))].sort()
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
/** InventoryItemResponse: `expired`, and `discountEligibleToday` by the near-expiry rule of backend #61 (current setting). */
const itemView = (item: MockItem, now: number, store?: MockStore) => ({
  ...item, expired: isExpired(item, now),
  discountEligibleToday: !!store && (item.status === 'AVAILABLE' || item.status === 'RESERVED') && eligibleToday(item.expiresAt, now, store.pricing),
})
const paymentRow = (ctx: HandlerContext, { qrCode: _qrCode, ...payment }: MockPayment) => {
  const order = ctx.store.orders.find(candidate => candidate.id === payment.orderId)
  return { ...payment, orderCode: order?.orderCode, machineCode: order?.machineCode }
}

/** Earliest physically present bowl of a slot: the only one that can be dispensed. */
export function headOf(store: MockStore, slotId: string): MockItem | undefined {
  return store.items.filter(item => item.slotId === slotId && PRESENT_STATUSES.includes(item.status))
    .sort((a, b) => a.loadedAt.localeCompare(b.loadedAt) || a.id.localeCompare(b.id))[0]
}

export function history(store: MockStore, item: MockItem, type: MockStore['transactions'][number]['type'], at: number, extra: Partial<MockStore['transactions'][number]>) {
  store.transactions.push({ id: newId(), inventoryItemId: item.id, batchId: item.batchId, batchCode: item.batchCode, machineId: item.machineId, slotId: item.slotId, type, createdAt: iso(at), ...extra })
}

export function setItemStatus(item: MockItem, status: MockItem['status'], at: number) {
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

function markPaid(order: MockOrder, payment: MockPayment, now: number) {
  Object.assign(payment, { status: 'SUCCESS', paidAt: iso(now), transactionId: `MOCK-TXN-${randomCode(8)}`, qrCode: undefined })
  order.status = 'PAID'
  order.paidAt = iso(now)
}

/**
 * Plays a verified payment webhook for the newest live kiosk order still waiting on a PENDING QR (mock-only control used
 * by the UX tests to time PAID ≤ 3 s after the webhook). Returns the order code, or null when nothing was payable.
 */
export function payLatestKioskOrder(ctx: HandlerContext): string | null {
  advanceOrders(ctx)
  const order = [...ctx.store.orders].reverse().find(candidate => candidate.live && candidate.status === 'PENDING_PAYMENT' && latestPayment(ctx.store, candidate.id)?.status === 'PENDING')
  if (!order) return null
  markPaid(order, latestPayment(ctx.store, order.id)!, ctx.now)
  return order.orderCode
}

/**
 * Simulates what the backend does in the background (payment webhook, dispensing, reservation sweep) for kiosk orders:
 * PENDING_PAYMENT → PAID (webhook) → DISPENSING (command acknowledged, after a quarter of dispenseMs) → COMPLETED or
 * DISPENSE_FAILED (machine report, after dispenseMs). The backend has no read endpoint for dispense commands: only the
 * order and its allocations change.
 */
export function advanceOrders(ctx: HandlerContext) {
  const { store, now, options } = ctx
  for (const order of store.orders) {
    if (!order.live) continue
    const payment = latestPayment(store, order.id)
    if (order.status === 'PENDING_PAYMENT') {
      if (payment?.status === 'PENDING' && payment.expiredAt && Date.parse(payment.expiredAt) <= now) payment.status = 'EXPIRED'
      if (options.autoPay && payment?.status === 'PENDING' && Date.parse(payment.createdAt) + options.autoPayMs <= now) markPaid(order, payment, now)
      else if (order.expiresAt && Date.parse(order.expiresAt) <= now) releaseOrder(ctx, order, 'RESERVATION_EXPIRED')
    }
    const paidAt = order.paidAt ? Date.parse(order.paidAt) : NaN
    if (order.status === 'PAID' && paidAt + options.dispenseMs / 4 <= now) order.status = 'DISPENSING'
    if (order.status !== 'DISPENSING' || paidAt + options.dispenseMs > now || options.dispense === 'slow') continue
    if (options.dispense === 'fail') {
      order.status = 'DISPENSE_FAILED'
      for (const item of allocationItems(store, order)) setItemStatus(item, 'DISPENSE_FAILED', now)
      continue
    }
    order.status = 'COMPLETED'
    order.completedAt = iso(now)
    for (const line of order.items) for (const allocation of line.allocations) allocation.status = 'DISPENSED'
    for (const item of allocationItems(store, order)) {
      setItemStatus(item, 'SOLD', now)
      history(store, item, 'SALE', now, { referenceId: order.id, reason: 'ORDER_COMPLETED', statusBefore: 'RESERVED', statusAfter: 'SOLD' })
    }
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
    items: order.items.map(({ productId, sku, productName, quantity, unitPrice, totalPrice, originalUnitPrice, discountPercent, discountReason }) => ({ productId, sku, productName, quantity, unitPrice, totalPrice, originalUnitPrice: originalUnitPrice ?? unitPrice, discountPercent: discountPercent ?? 0, discountReason: discountReason ?? 'NONE' })),
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
    const connectivity = query.get('connectivity')
    if (connectivity && !(CONNECTIVITY as readonly string[]).includes(connectivity)) throw new MockHttpError(400, 'Invalid request parameter', { connectivity: `Must be one of: ${CONNECTIVITY.join(', ')}` })
    const rows = ctx.store.machines.map(machine => machineView(ctx.store, machine, ctx.now))
      .filter(machine => eq(query, 'status', machine.status) && eq(query, 'connectivity', machine.connectivity) && contains(query.get('search'), machine.code, machine.name, machine.location))
    return ok(paginate(rows, query, { sorts: { id: row => row.id, code: row => row.code, name: row => row.name, location: row => row.location, status: row => row.status, createdAt: row => row.createdAt, updatedAt: row => row.updatedAt }, defaultSort: 'createdAt,desc' }))
  }),
  route('GET', '/machines/:machineId', 'any', ctx => ok(machineView(ctx.store, findMachine(ctx), ctx.now))),
  route('POST', '/machines', 'admin', ctx => {
    const { form, values } = machineForm(ctx.body, ['code', ...MACHINE_FIELDS])
    const code = form.text('code', 64).toUpperCase()
    form.done()
    checkThresholdOrder(values)
    if (ctx.store.machines.some(machine => machine.code === code)) throw conflict('Machine code is already in use')
    const at = iso(ctx.now)
    const machine = { id: newId(), code, ...values, status: 'INACTIVE' as const, lastSeenAt: null, connectivity: 'NEVER_SEEN' as const, createdAt: at, updatedAt: at }
    ctx.store.machines.push(machine)
    return created(machineView(ctx.store, machine, ctx.now))
  }),
  route('PUT', '/machines/:machineId', 'admin', ctx => {
    const machine = findMachine(ctx)
    const { form, values } = machineForm(ctx.body, MACHINE_FIELDS)
    form.done()
    checkThresholdOrder(values)
    Object.assign(machine, values, { updatedAt: iso(ctx.now) })
    return ok(machineView(ctx.store, machine, ctx.now))
  }),
  route('PATCH', '/machines/:machineId/status', 'admin', ctx => {
    const machine = findMachine(ctx)
    Object.assign(machine, { status: statusForm(ctx, MACHINE_STATUSES), updatedAt: iso(ctx.now) })
    return ok(machineView(ctx.store, machine, ctx.now))
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
    const slotCode = form.oneOf('slotCode', ['A', 'B'] as const), capacity = form.integer('capacity', 1, 2_147_483_647)
    form.done()
    if (ctx.store.slots.some(slot => slot.machineId === machine.id && slot.slotCode === slotCode)) throw conflict('Slot code is already in use for this machine') // MachineSlotService, English as the backend sends it
    const at = iso(ctx.now)
    const slot = { id: newId(), machineId: machine.id, slotCode, capacity, status: 'ACTIVE' as const, refillGateOpen: false, createdAt: at, updatedAt: at }
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

  // ---- telemetry and events (backend #53, #56; api.yaml). MACHINE_READ; invalid parameters are 400 before the machine.
  route('GET', '/machines/:machineId/telemetry/latest', { permission: 'MACHINE_READ' }, ctx => {
    const machine = findMachine(ctx)
    const reading = ctx.store.readings.filter(row => row.machineId === machine.id).sort(newestReading)[0]
    const level = (value: number | null | undefined, min: number, max: number) => (typeof value !== 'number' ? null : value < min ? 'LOW' : value > max ? 'HIGH' : 'NORMAL')
    return ok({
      machineId: machine.id, recordedAt: reading?.recordedAt ?? null, temperature: reading?.temperature ?? null, humidity: reading?.humidity ?? null,
      temperatureStatus: level(reading?.temperature, machine.minTemperature, machine.maxTemperature),
      humidityStatus: level(reading?.humidity, machine.minHumidity, machine.maxHumidity),
      connectivity: machineView(ctx.store, machine, ctx.now).connectivity,
    })
  }),
  route('GET', '/machines/:machineId/telemetry', { permission: 'MACHINE_READ' }, ctx => {
    const { from, to } = instantRange(ctx.query, true, 31 * 86_400_000)
    const machine = findMachine(ctx)
    const rows = ctx.store.readings.filter(row => row.machineId === machine.id && Date.parse(row.recordedAt) >= from! && Date.parse(row.recordedAt) < to!)
      .sort(newestReading).map(({ recordedAt, temperature, humidity }) => ({ recordedAt, temperature, humidity }))
    return ok(fixedPage(rows, ctx.query, { defaultSize: 100, maxSize: 500 }))
  }),
  route('GET', '/machines/:machineId/events', { permission: 'MACHINE_READ' }, ctx => {
    const { query } = ctx
    const source = query.get('source')
    if (source && source !== 'MACHINE' && source !== 'BACKEND') throw new MockHttpError(400, 'Invalid request parameter', { source: 'Must be one of: MACHINE, BACKEND' })
    const { from, to } = instantRange(query, false)
    const machine = findMachine(ctx)
    const rows = ctx.store.machineEvents.filter(event => event.machineId === machine.id && eq(query, 'type', event.eventType) && eq(query, 'source', event.source)
      && (from === undefined || Date.parse(event.createdAt) >= from) && (to === undefined || Date.parse(event.createdAt) < to))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
      .map(({ machineId: _machineId, ...event }) => event)
    return ok(fixedPage(rows, query, { defaultSize: 50, maxSize: 200 }))
  }),

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
    return ok(paginate(rows.map(item => itemView(item, now, ctx.store)), query, { sorts: { id: row => row.id, status: row => row.status, loadedAt: row => row.loadedAt, createdAt: row => row.createdAt, updatedAt: row => row.updatedAt }, defaultSort: 'createdAt,desc' }))
  }),
  route('GET', '/inventory/transactions', 'any', ctx => {
    const { query } = ctx
    const rows = ctx.store.transactions.filter(row => eq(query, 'inventoryItemId', row.inventoryItemId) && eq(query, 'machineId', row.machineId) && eq(query, 'slotId', row.slotId) && eq(query, 'referenceId', row.referenceId) && eq(query, 'type', row.type))
    return ok(paginate(rows, query, { sorts: { createdAt: row => row.createdAt }, defaultSort: 'createdAt,desc', fixedSort: true }))
  }),
  // Direct load without a work order: ADMIN only since backend #68 (INVENTORY_LOAD_DIRECT); STAFF load through a restock.
  route('POST', '/inventory/load', { permission: 'INVENTORY_LOAD_DIRECT' }, ctx => {
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
    return created({ operationId, quantity, items: items.map(item => itemView(item, now, store)) })
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
    return ok(itemView(item, now, store))
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
    // Backend #61: lines without a discount carry the list price, percent 0 and reason NONE; the order its discountAmount.
    const order = { ...stored, discountAmount: stored.discountAmount ?? 0, items: stored.items.map(line => ({ ...line, originalUnitPrice: line.originalUnitPrice ?? line.unitPrice, discountPercent: line.discountPercent ?? 0, discountReason: line.discountReason ?? 'NONE' })) }
    const payments = ctx.store.payments.filter(payment => payment.orderId === order.id).map(({ id, provider, status, amount, createdAt, paidAt, expiredAt }) => ({ id, provider, status, amount, createdAt, paidAt, expiredAt }))
    return ok({ ...order, payments })
  }),

  // ---- alerts (backend #58, api.yaml). Messages in English as the backend sends them.
  route('GET', '/alerts', { permission: 'ALERT_READ' }, ctx => {
    const { query } = ctx
    const errors: Record<string, string> = {}
    const check = (name: string, values: readonly string[]) => { const value = query.get(name); if (value && !values.includes(value)) errors[name] = `Must be one of: ${values.join(', ')}` }
    check('status', ALERT_STATUSES); check('type', ALERT_TYPES); check('severity', ALERT_SEVERITIES)
    for (const name of ['machineId', 'slotId']) if (query.get(name) && !UUID_PATTERN.test(query.get(name)!)) errors[name] = 'Must be a valid UUID'
    if (Object.keys(errors).length) throw new MockHttpError(400, 'Invalid request parameter', errors)
    const { from, to } = instantRange(query, false)
    // No status: OPEN and ACKNOWLEDGED (every alert not closed yet). `sort` is not a parameter: the order is fixed.
    const status = query.get('status')
    const rows = ctx.store.alerts.filter(alert => (status ? alert.status === status : alert.status !== 'RESOLVED')
      && eq(query, 'severity', alert.severity) && eq(query, 'type', alert.type) && eq(query, 'machineId', alert.machineId) && eq(query, 'slotId', alert.slotId)
      && eq(query, 'errorCode', alert.errorCode)
      && (from === undefined || Date.parse(alert.triggeredAt) >= from) && (to === undefined || Date.parse(alert.triggeredAt) < to))
      .sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || b.triggeredAt.localeCompare(a.triggeredAt) || b.id.localeCompare(a.id))
      .map(alert => alertView(ctx.store, alert))
    return ok(fixedPage(rows, query, { defaultSize: 50, maxSize: 200 }))
  }),
  route('GET', '/alerts/:id', { permission: 'ALERT_READ' }, ctx => ok(alertView(ctx.store, findAlert(ctx)))),
  route('POST', '/alerts/:id/acknowledge', { permission: 'ALERT_MANAGE' }, ctx => {
    const alert = findAlert(ctx)
    if (alert.status === 'RESOLVED') throw conflict('Alert is already resolved')
    // Acknowledging an ACKNOWLEDGED alert again returns it unchanged.
    if (alert.status === 'OPEN') Object.assign(alert, { status: 'ACKNOWLEDGED', acknowledgedAt: iso(ctx.now), acknowledgedBy: ctx.user!.email })
    return ok(alertView(ctx.store, alert))
  }),
  route('POST', '/alerts/:id/resolve', { permission: 'ALERT_MANAGE' }, ctx => {
    let note: string | null = null
    if (ctx.body !== undefined && ctx.body !== null) {
      const form = new Form(ctx.body, ['note'])
      note = form.optionalText('note', 500)
      form.done()
    }
    const alert = findAlert(ctx)
    if (alert.status === 'RESOLVED') throw conflict('Alert is already resolved')
    // ck_alerts_resolution: resolved_at >= triggered_at.
    const at = iso(Math.max(ctx.now, Date.parse(alert.triggeredAt)))
    Object.assign(alert, { status: 'RESOLVED', resolvedAt: at, resolvedBy: ctx.user!.email, resolutionNote: note })
    return ok(alertView(ctx.store, alert))
  }),
  // POST /alerts/{alertId}/work-orders (WORK_ORDER_MANAGE): work order of the alert (work-orders.ts).
  route('POST', '/alerts/:id/work-orders', { permission: 'WORK_ORDER_MANAGE' }, ctx => workOrderFromAlert(ctx, findAlert(ctx))),

  // ---- work orders, restock, maintenance commands and plans (backend #64, #66, #68, #70): work-orders.ts
  ...workOrderRoutes,

  // ---- near-expiry discount setting (backend #61)
  route('GET', '/pricing/near-expiry-discount', { permission: 'PRICING_READ' }, ctx => ok(pricingView(ctx.store))),
  route('PUT', '/pricing/near-expiry-discount', { permission: 'PRICING_MANAGE' }, ctx => updatePricing(ctx.store, ctx.body, ctx.user!, ctx.now)),

  // ---- payments (ADMIN)
  // Draft of backend 6.1 (api-contract/drafts/revenue-reports.yaml, FE 9.1/9.2).
  route('GET', '/reports/revenue', { draftPermission: 'REPORT_SALES_READ' }, ctx => ok(revenueReport(ctx.store, ctx.query, ctx.now))),
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
      // Backend #61: price of the head POST /kiosk/orders would pick now (FEFO between heads), with the current setting.
      const next = heads.filter(({ head }) => head.productId === productId).map(({ head }) => head).sort((a, b) => a.expiresAt.localeCompare(b.expiresAt) || a.loadedAt.localeCompare(b.loadedAt))[0]
      const pricing = boxPrice(product.price!, next?.expiresAt, now, store.pricing)
      return { productId, sku: product.sku, name: product.name, description: product.description ?? undefined, price: pricing.unitPrice, originalPrice: pricing.originalUnitPrice, discountPercent: pricing.discountPercent, discountReason: pricing.discountReason, imageUrl: product.imageUrl ?? undefined, availableQuantity }
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
    // Price snapshot of the chosen bowl (backend #61): a bowl expiring today sells at the configured discount.
    const line = linePricing(boxPrice(product.price!, head.expiresAt, now, store.pricing), 1)
    setItemStatus(head, 'RESERVED', now)
    const order: MockOrder = {
      id: newId(), orderCode: `ORD-${createdAt.slice(0, 10).replaceAll('-', '')}-${randomCode(8)}`, machineId: machine.id, machineCode: machine.code, status: 'PENDING_PAYMENT',
      subtotal: line.originalUnitPrice, totalAmount: line.totalPrice, discountAmount: lineDiscount({ ...line, quantity: 1 }), createdAt, expiresAt: iso(now + RESERVATION_MS), live: true,
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

export interface RaiseAlertInput { type?: MockAlert['type']; severity?: MockAlert['severity']; machineId?: string; title?: string; message?: string | null; errorCode?: string | null }

/**
 * Mock-only control (window.__fvMock.raiseAlert, see index.ts): a machine raises a new OPEN alert now, as the backend
 * would from a sensor reading or a missed heartbeat. Lets tests prove the bell shows it within one poll.
 */
export function raiseAlert(store: MockStore, now: number, input: RaiseAlertInput = {}): MockAlert {
  const machine = store.machines.find(candidate => candidate.id === input.machineId) ?? store.machines[0]
  const at = iso(now)
  const alert: MockAlert = {
    id: newId(), machineId: machine.id, machineCode: machine.code,
    type: input.type ?? 'HIGH_TEMPERATURE', severity: input.severity ?? 'CRITICAL', title: input.title ?? 'Nhiệt độ cao',
    message: input.message === undefined ? 'Nhiệt độ 12.00 °C vượt ngưỡng tối đa 8.00 °C.' : input.message, errorCode: input.errorCode ?? null, status: 'OPEN', triggeredAt: at,
    slotId: null, slotCode: null, acknowledgedAt: null, acknowledgedBy: null, resolvedAt: null, resolvedBy: null, resolutionNote: null,
  }
  store.alerts.push(alert)
  return alert
}

/** Presence row of a machine; machines registered during the session start with one that has never connected. */
function heartbeatOf(store: MockStore, machineId: string): MockHeartbeat {
  let heartbeat = store.heartbeats.find(candidate => candidate.machineId === machineId)
  if (!heartbeat) {
    heartbeat = { machineId, lastHeartbeatAt: null, lastOfflineAt: null, firmwareVersion: null, uptimeSeconds: null, wifiRssi: null, freeHeapBytes: null, dispenseState: null, live: false, bootedAt: null }
    store.heartbeats.push(heartbeat)
  }
  return heartbeat
}

const CONNECTIVITY = ['ONLINE', 'WARNING', 'OFFLINE', 'NEVER_SEEN'] as const
const MACHINE_WARNING_AFTER_MS = 60_000
const MACHINE_OFFLINE_AFTER_MS = 180_000

/** Physically present bowls of a slot, head (next out) first. */
export function presentItems(store: MockStore, slotId: string): MockItem[] {
  return store.items.filter(item => item.slotId === slotId && PRESENT_STATUSES.includes(item.status))
    .sort((a, b) => a.loadedAt.localeCompare(b.loadedAt) || a.id.localeCompare(b.id))
}
/**
 * MachineResponse as the backend derives it (docs/machine-health.md): connectivity from lastSeenAt and the Last Will
 * (NEVER_SEEN, OFFLINE, WARNING after 60 s, OFFLINE after 180 s) and the last heartbeat's diagnostics.
 */
export function machineView(store: MockStore, machine: MockStore['machines'][number], now: number): MockStore['machines'][number] {
  const presence = store.heartbeats.find(candidate => candidate.machineId === machine.id)
  const seen = machine.lastSeenAt ? Date.parse(machine.lastSeenAt) : NaN
  const offline = presence?.lastOfflineAt ? Date.parse(presence.lastOfflineAt) : NaN
  const connectivity: typeof CONNECTIVITY[number] = !Number.isFinite(seen) ? 'NEVER_SEEN'
    : offline >= seen || now - seen > MACHINE_OFFLINE_AFTER_MS ? 'OFFLINE'
    : now - seen > MACHINE_WARNING_AFTER_MS ? 'WARNING' : 'ONLINE'
  return {
    ...machine, connectivity, lastHeartbeatAt: presence?.lastHeartbeatAt ?? null, firmwareVersion: presence?.firmwareVersion ?? null,
    uptimeSeconds: presence?.uptimeSeconds ?? null, wifiRssi: presence?.wifiRssi ?? null, freeHeapBytes: presence?.freeHeapBytes ?? null,
  }
}

/**
 * What MachineMessageHandler does in the background, applied before each request: a machine whose heartbeat is live
 * keeps talking, so its last_seen_at and last heartbeat are "now". A stopped one keeps its last value and turns WARNING
 * after 60 s and OFFLINE after 180 s.
 */
export function syncHeartbeats(store: MockStore, now: number) {
  for (const heartbeat of store.heartbeats) {
    if (!heartbeat.live) continue
    const at = iso(now)
    Object.assign(heartbeat, { lastHeartbeatAt: at, uptimeSeconds: heartbeat.bootedAt ? Math.max(0, Math.floor((now - Date.parse(heartbeat.bootedAt)) / 1000)) : null })
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
  Object.assign(heartbeat, { live, lastHeartbeatAt: at, bootedAt: heartbeat.bootedAt ?? at })
  target.lastSeenAt = at
  return at
}

// ---- alerts and telemetry helpers (backend #53, #56, #58)

const ALERT_STATUSES = ['OPEN', 'ACKNOWLEDGED', 'RESOLVED'] as const
const ALERT_SEVERITIES = ['INFO', 'WARNING', 'CRITICAL'] as const
const ALERT_TYPES = ['HIGH_TEMPERATURE', 'LOW_TEMPERATURE', 'HIGH_HUMIDITY', 'MACHINE_OFFLINE', 'PRODUCT_EXPIRED', 'PRODUCT_EXPIRING', 'DISPENSE_FAILED', 'LOW_STOCK', 'HARDWARE_FAULT'] as const
const SEVERITY_RANK: Record<MockAlert['severity'], number> = { CRITICAL: 0, WARNING: 1, INFO: 2 }

/** AlertResponse: the stored alert plus the unfinished work order handling it (issue #66). */
function alertView(store: MockStore, alert: MockAlert) {
  const order = activeWorkOrderOf(store, alert.id!)
  return { ...alert, workOrderId: order?.id ?? null, workOrderCode: order?.code ?? null }
}

const newestReading = (a: { recordedAt: string; id: number }, b: { recordedAt: string; id: number }) => b.recordedAt.localeCompare(a.recordedAt) || b.id - a.id

/** from (inclusive) / to (exclusive) ISO instants: 400 when malformed, missing while required, not ordered or too far apart. */
function instantRange(query: URLSearchParams, required: boolean, maxSpanMs?: number): { from?: number; to?: number } {
  const errors: Record<string, string> = {}
  const read = (name: string) => {
    const raw = query.get(name)
    if (!raw) { if (required) errors[name] = 'Required'; return undefined }
    const value = Date.parse(raw)
    if (!Number.isFinite(value) || !/T/.test(raw)) { errors[name] = 'Must be an ISO-8601 instant'; return undefined }
    return value
  }
  const from = read('from'), to = read('to')
  if (from !== undefined && to !== undefined && to <= from) errors.to = 'Must be after from'
  else if (maxSpanMs && from !== undefined && to !== undefined && to - from > maxSpanMs) errors.to = 'Range must be at most 31 days'
  if (Object.keys(errors).length) throw new MockHttpError(400, 'Invalid request parameter', errors)
  return { from, to }
}
