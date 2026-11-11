// In-memory data built from backend/db/dev/seed.sql (machines, slots, products, batches, stock). The dev seed has
// no accounts, kiosk keys, orders or payments, so those rows are invented here to exercise the screens.
// MOCK_PASSWORDS are fake values for the mock only; they exist nowhere else.
import type { components } from '../schema'
import type { components as DispenseDraft } from '../drafts/dispense-commands'
import type { components as AlertsDraft } from '../drafts/alerts'

type S = components['schemas']

export const MOCK_PASSWORDS = { admin: 'mock-admin-password', staff: 'mock-staff-password' } as const
export const MOCK_ACCOUNTS = { admin: 'admin@freshvend.test', staff: 'staff@freshvend.test' } as const

export type MockUser = S['UserResponse'] & { password: string }
export type MockCredential = S['KioskCredentialResponse'] & { credentialId: string; machineId: string; apiKey: string }
export type MockBatch = S['ProductBatchResponse'] & { id: string; productId: string; batchCode: string; expiresAt: string; quantity: number; createdAt: string }
export type MockItem = Omit<S['InventoryItemResponse'], 'expired'> & { id: string; batchId: string; slotId: string; machineId: string; productId: string; status: NonNullable<S['InventoryItemResponse']['status']>; expiresAt: string; loadedAt: string }
export type MockTransaction = S['InventoryTransactionResponse'] & { id: string; createdAt: string }
export type MockOrderItem = S['OrderItemDetailResponse'] & { productId: string; quantity: number; totalPrice: number; allocations: S['OrderAllocationResponse'][] }
export type MockOrder = Omit<S['OrderDetailResponse'], 'payments' | 'items'> & {
  id: string; orderCode: string; machineId: string; machineCode: string; status: NonNullable<S['OrderDetailResponse']['status']>
  totalAmount: number; createdAt: string; items: MockOrderItem[]
  /** Created by the kiosk during this session; only these advance over time (seed rows stay put). */
  live: boolean
}
/**
 * A webhook log as the backend really answers it: rawPayload is the stored jsonb as a JSON value (the generated schema
 * types it as a string, which the backend should fix: object | null).
 */
export type MockWebhookLog = Omit<S['PaymentWebhookLogDetailResponse'], 'rawPayload'> & { rawPayload: Record<string, unknown> | null }
export type MockPayment = Omit<S['PaymentDetailResponse'], 'orderCode' | 'machineCode'> & {
  id: string; orderId: string; provider: string; status: NonNullable<S['PaymentDetailResponse']['status']>; amount: number; createdAt: string
}
/** Draft of backend 3.3 (api-contract/drafts/dispense-commands.yaml): one command per paid bowl. */
export type MockDispenseCommand = DispenseDraft['schemas']['DispenseCommandResponse']
/** Draft of backend 3.6 (api-contract/drafts/alerts.yaml): an alert of a machine, people named by fullName. */
export type MockAlert = AlertsDraft['schemas']['AlertResponse']

export interface MockStore {
  users: MockUser[]
  products: S['ProductResponse'][]
  machines: S['MachineResponse'][]
  slots: S['MachineSlotResponse'][]
  credentials: MockCredential[]
  batches: MockBatch[]
  items: MockItem[]
  transactions: MockTransaction[]
  orders: MockOrder[]
  payments: MockPayment[]
  dispenseCommands: MockDispenseCommand[]
  alerts: MockAlert[]
  webhookLogs: MockWebhookLog[]
  /** Backend #48 reference data (V8 roles, V13 permissions and their seed mapping); only a role's set can change. */
  permissions: MockPermission[]
  roles: MockRole[]
}

export interface MockPermission { code: string; description: string }
export interface MockRole { id: string; name: string; description: string | null; permissions: string[] }

/** V13__create_permissions.sql, in code order like GET /permissions (descriptions are the backend's, in English). */
export const SEED_PERMISSIONS: readonly MockPermission[] = [
  { code: 'BATCH_CREATE', description: 'Create product batches' },
  { code: 'BATCH_READ', description: 'List and view product batches' },
  { code: 'INVENTORY_READ', description: 'View inventory items, machine and slot inventory, summaries and history' },
  { code: 'INVENTORY_WRITE', description: 'Load bowls into slots and remove bowls' },
  { code: 'KIOSK_CREDENTIAL_MANAGE', description: 'Issue, list and revoke kiosk credentials' },
  { code: 'MACHINE_READ', description: 'List and view machines and slots' },
  { code: 'MACHINE_WRITE', description: 'Create and update machines and slots and change their status' },
  { code: 'ORDER_READ', description: 'List and view orders' },
  { code: 'PAYMENT_READ', description: 'List and view payments' },
  { code: 'PAYMENT_WEBHOOK_LOG_READ', description: 'List and view payment webhook logs' },
  { code: 'PERMISSION_MANAGE', description: "View roles and permissions and change a role's permissions" },
  { code: 'PRODUCT_READ', description: 'List and view products' },
  { code: 'PRODUCT_WRITE', description: 'Create and update products and change product status' },
  { code: 'USER_READ', description: 'List and view management user accounts' },
  { code: 'USER_WRITE', description: 'Create users, update profiles and change account status' },
]
/** V8 role ids (fixed in every environment); V13 maps ADMIN to every permission and STAFF to the operations ones. */
export const SEED_ROLE_IDS = { ADMIN: '10000000-0000-0000-0000-000000000001', STAFF: '10000000-0000-0000-0000-000000000002' } as const
export const SEED_STAFF_PERMISSIONS = ['BATCH_CREATE', 'BATCH_READ', 'INVENTORY_READ', 'INVENTORY_WRITE', 'MACHINE_READ', 'ORDER_READ', 'PRODUCT_READ'] as const
const seedRoles = (): MockRole[] => [
  { id: SEED_ROLE_IDS.ADMIN, name: 'ADMIN', description: 'System administrator', permissions: SEED_PERMISSIONS.map(permission => permission.code) },
  { id: SEED_ROLE_IDS.STAFF, name: 'STAFF', description: 'Machine operations and inventory staff', permissions: [...SEED_STAFF_PERMISSIONS] },
]

const HOUR = 3_600_000
const DAY = 24 * HOUR
const uuid = (prefix: string, n: number) => `${prefix}-0000-0000-0000-${String(n).padStart(12, '0')}`
const compactDate = (iso: string) => iso.slice(0, 10).replaceAll('-', '')

export function createStore(nowMs: number): MockStore {
  const iso = (offset: number) => new Date(nowMs + offset).toISOString()
  const stamp = { createdAt: iso(-30 * DAY), updatedAt: iso(-DAY) }

  // Account ids use the 11000000 prefix so they never equal the V8 role ids (10000000-…-1/2) used by the roles API.
  const users: MockUser[] = [
    { id: uuid('11000000', 1), email: MOCK_ACCOUNTS.admin, fullName: 'Quản trị viên', phone: '0900000001', status: 'ACTIVE', roles: ['ADMIN'], password: MOCK_PASSWORDS.admin, ...stamp },
    { id: uuid('11000000', 2), email: MOCK_ACCOUNTS.staff, fullName: 'Nhân viên vận hành', phone: '0900000002', status: 'ACTIVE', roles: ['STAFF'], password: MOCK_PASSWORDS.staff, ...stamp },
    { id: uuid('11000000', 3), email: 'staff.inactive@freshvend.test', fullName: 'Nhân viên đã nghỉ', phone: null, status: 'INACTIVE', roles: ['STAFF'], password: MOCK_PASSWORDS.staff, ...stamp },
    { id: uuid('11000000', 4), email: 'staff.locked@freshvend.test', fullName: 'Nhân viên bị khóa', phone: null, status: 'LOCKED', roles: ['STAFF'], password: MOCK_PASSWORDS.staff, ...stamp },
    // Screen A2 needs a second ACTIVE admin (so it can be locked, leaving the signed-in admin as the last one), a LOCKED
    // admin (not counted as active) and a few more staff. Same fake passwords; only the first admin/staff are documented.
    { id: uuid('11000000', 5), email: 'admin.ca2@freshvend.test', fullName: 'Trần Thị Quản Lý', phone: '0900000005', status: 'ACTIVE', roles: ['ADMIN'], password: MOCK_PASSWORDS.admin, createdAt: iso(-20 * DAY), updatedAt: iso(-2 * DAY) },
    { id: uuid('11000000', 6), email: 'admin.locked@freshvend.test', fullName: 'Quản trị viên cũ', phone: null, status: 'LOCKED', roles: ['ADMIN'], password: MOCK_PASSWORDS.admin, createdAt: iso(-60 * DAY), updatedAt: iso(-10 * DAY) },
    { id: uuid('11000000', 7), email: 'kho.quan1@freshvend.test', fullName: 'Lê Văn Nạp Hàng', phone: '0900000007', status: 'ACTIVE', roles: ['STAFF'], password: MOCK_PASSWORDS.staff, createdAt: iso(-5 * DAY), updatedAt: iso(-5 * DAY) },
    { id: uuid('11000000', 8), email: 'ca.dem@freshvend.test', fullName: 'Phạm Thị Ca Đêm', phone: null, status: 'ACTIVE', roles: ['STAFF'], password: MOCK_PASSWORDS.staff, createdAt: iso(-3 * DAY), updatedAt: iso(-3 * DAY) },
  ]
  const adminId = users[0].id
  const staffId = users[1].id

  const machine = (n: number, code: string, name: string, status: S['MachineResponse']['status'], lastSeenAt: string | null): S['MachineResponse'] =>
    ({ id: uuid('20000000', n), code, name, location: 'Local development', status, minTemperature: 2, maxTemperature: 8, minHumidity: 0, maxHumidity: 100, lastSeenAt, ...stamp })
  const machines = [
    machine(1, 'DEV-MACHINE-01', 'Development fruit machine', 'ACTIVE', iso(0)),
    machine(2, 'DEV-MACHINE-02', 'Maintenance test machine', 'MAINTENANCE', null),
    // Just registered (FE 3.4): INACTIVE, never changed nor connected, no slots yet.
    { ...machine(3, 'DEV-MACHINE-03', 'New machine awaiting setup', 'INACTIVE', null), location: 'Warehouse bay 3', createdAt: iso(-2 * DAY), updatedAt: iso(-2 * DAY) },
  ]

  const slot = (n: number, machineIndex: number, slotCode: string, capacity: number): S['MachineSlotResponse'] =>
    ({ id: uuid('30000000', n), machineId: machines[machineIndex].id, slotCode, capacity, status: 'ACTIVE', ...stamp })
  const slots = [slot(1, 0, 'A1', 10), slot(2, 0, 'A2', 10), slot(3, 0, 'B1', 10), slot(4, 1, 'A1', 8), slot(5, 1, 'A2', 8)]

  const product = (n: number, sku: string, name: string, price: number, status: S['ProductResponse']['status'] = 'ACTIVE'): S['ProductResponse'] =>
    ({ id: uuid('40000000', n), sku, name, description: status === 'ACTIVE' ? 'Development sample' : 'Development sample (inactive)', price, imageUrl: null, status, ...stamp })
  const products = [
    product(1, 'DEV-MIXED-FRUIT', 'Mixed fruit bowl', 35000),
    product(2, 'DEV-WATERMELON', 'Watermelon bowl', 25000),
    product(3, 'DEV-PINEAPPLE', 'Pineapple bowl', 30000),
    product(4, 'DEV-MANGO', 'Mango bowl', 40000),
    product(5, 'DEV-PAPAYA', 'Papaya bowl', 28000, 'INACTIVE'),
    // Catalog-only rows (no batch or stock): one more of each status for the Products screen.
    product(6, 'DEV-GUAVA', 'Guava bowl', 22000),
    product(7, 'DEV-DRAGON-FRUIT', 'Dragon fruit bowl', 32000, 'INACTIVE'),
  ]

  const batch = (n: number, batchCode: string, productIndex: number, made: number, expires: number, quantity: number): MockBatch => ({
    id: uuid('50000000', n), batchCode, productId: products[productIndex].id, productSku: products[productIndex].sku, productName: products[productIndex].name,
    manufacturedAt: iso(made), expiresAt: iso(expires), quantity, createdBy: staffId, createdAt: iso(made),
  })
  const batches = [
    batch(1, 'SEED-MIXED-01', 0, -DAY, 30 * DAY, 20),
    batch(2, 'SEED-WATERMELON-01', 1, -DAY, 30 * DAY, 20),
    batch(3, 'SEED-PINEAPPLE-01', 2, -2 * DAY, 20 * HOUR, 10),
    batch(4, 'SEED-MANGO-EXPIRED', 3, -5 * DAY, -DAY, 5),
  ]

  const items: MockItem[] = []
  const transactions: MockTransaction[] = []
  const stock: [slotIndex: number, batchIndex: number, quantity: number, loadedAgo: number][] = [
    [0, 0, 8, DAY], [1, 1, 6, DAY], [2, 3, 2, 3 * DAY], [3, 2, 4, DAY], [4, 1, 1, DAY],
  ]
  stock.forEach(([slotIndex, batchIndex, quantity, loadedAgo], stockIndex) => {
    const { id: slotId, machineId, slotCode } = slots[slotIndex]
    const source = batches[batchIndex]
    for (let n = 1; n <= quantity; n += 1) {
      const id = uuid('70000000', stockIndex * 100 + n)
      const loadedAt = iso(-loadedAgo + n * 1000)
      items.push({ id, batchId: source.id, batchCode: source.batchCode, productId: source.productId, productName: source.productName, machineId, slotId, slotCode, status: 'AVAILABLE', expiresAt: source.expiresAt, loadedAt, createdAt: loadedAt, updatedAt: loadedAt })
      transactions.push({ id: uuid('71000000', stockIndex * 100 + n), inventoryItemId: id, batchId: source.id, batchCode: source.batchCode, machineId, slotId, type: 'LOAD', referenceId: uuid('72000000', stockIndex + 1), performedBy: staffId, statusAfter: 'AVAILABLE', createdAt: loadedAt })
    }
  })

  // Slot heads of the maintenance machine (FE 4.2 inventory map): A1's bottom bowl failed to dispense and blocks the
  // column; A2's only bowl is held for an order. Machine 1 (the kiosk's) keeps sellable heads, B1 an expired one.
  // History follows the backend (OrderReservationService RESERVE AVAILABLE→RESERVED, DispenseService ADJUSTMENT
  // RESERVED→DISPENSE_FAILED, reference = order id). Their orders (DISPENSE_FAILED, and PAID still holding A2's bowl)
  // are added to `orders` below, so "Mở đơn hàng" in the history opens them.
  const markHead = (stockIndex: number, steps: { type: MockTransaction['type']; before: MockItem['status']; after: MockItem['status']; reason?: string; ago: number }[], orderN: number) => {
    const head = items.find(item => item.id === uuid('70000000', stockIndex * 100 + 1))!
    steps.forEach((step, index) => {
      transactions.push({
        id: uuid('71000000', 9000 + stockIndex * 10 + index), inventoryItemId: head.id, batchId: head.batchId, batchCode: head.batchCode, machineId: head.machineId,
        slotId: head.slotId, type: step.type, referenceId: uuid('93000000', orderN), reason: step.reason, statusBefore: step.before, statusAfter: step.after, createdAt: iso(-step.ago),
      })
    })
    const last = steps[steps.length - 1]
    Object.assign(head, { status: last.after, updatedAt: iso(-last.ago) })
  }
  markHead(3, [
    { type: 'RESERVE', before: 'AVAILABLE', after: 'RESERVED', ago: 2 * HOUR },
    { type: 'ADJUSTMENT', before: 'RESERVED', after: 'DISPENSE_FAILED', reason: 'DISPENSE_TIMEOUT', ago: 2 * HOUR - 90_000 },
  ], 1)
  markHead(4, [{ type: 'RESERVE', before: 'AVAILABLE', after: 'RESERVED', ago: 60_000 }], 2)

  const credentials: MockCredential[] = [
    { credentialId: uuid('80000000', 1), machineId: machines[0].id, apiKey: 'fvk_mockrevoked_notasecret', keyPrefix: 'mockrevoked', status: 'REVOKED', createdAt: iso(-20 * DAY), createdBy: adminId, revokedAt: iso(-10 * DAY), revokedBy: adminId },
    { credentialId: uuid('80000000', 2), machineId: machines[0].id, apiKey: 'fvk_mockactive_notasecret', keyPrefix: 'mockactive', status: 'ACTIVE', createdAt: iso(-10 * DAY), createdBy: adminId },
  ]

  // Enough history to page through, covering every order and payment status the screens render.
  const ORDER_STATUSES: MockOrder['status'][] = ['COMPLETED', 'COMPLETED', 'COMPLETED', 'CANCELLED', 'PENDING_PAYMENT', 'PAID', 'DISPENSING', 'DISPENSE_FAILED', 'PAYMENT_FAILED', 'REFUNDED']
  const orders: MockOrder[] = []
  const payments: MockPayment[] = []
  const webhookLogs: MockWebhookLog[] = []

  for (let n = 1; n <= 45; n += 1) {
    const status = ORDER_STATUSES[(n - 1) % ORDER_STATUSES.length]
    const item = products[(n - 1) % 4]
    const source = batches[(n - 1) % 4]
    const createdMs = -n * 3 * HOUR
    const createdAt = iso(createdMs)
    const paid = ['COMPLETED', 'PAID', 'DISPENSING', 'DISPENSE_FAILED', 'REFUNDED'].includes(status)
    const id = uuid('90000000', n)
    const orderCode = `ORD-${compactDate(createdAt)}-${String(n).padStart(8, '0')}`
    const allocationStatus = status === 'COMPLETED' ? 'DISPENSED' : status === 'CANCELLED' || status === 'PAYMENT_FAILED' ? 'RELEASED' : 'RESERVED'
    orders.push({
      id, orderCode, machineId: machines[0].id, machineCode: machines[0].code, status, subtotal: item.price, totalAmount: item.price, createdAt,
      expiresAt: iso(createdMs + 5 * 60_000), paidAt: paid ? iso(createdMs + 60_000) : undefined, completedAt: status === 'COMPLETED' ? iso(createdMs + 90_000) : undefined,
      cancelledAt: status === 'CANCELLED' ? iso(createdMs + 120_000) : undefined, live: false,
      items: [{ id: uuid('91000000', n), productId: item.id, sku: item.sku, productName: item.name, quantity: 1, unitPrice: item.price, totalPrice: item.price, allocations: [{ id: uuid('92000000', n), inventoryItemId: uuid('70000000', (n % 8) + 1), slotCode: 'A1', batchCode: source.batchCode, batchExpiresAt: source.expiresAt, status: allocationStatus }] }],
    })
    const reference = `MOCKREF${String(n).padStart(6, '0')}`
    const paymentStatus: MockPayment['status'] = status === 'REFUNDED' ? 'REFUNDED' : paid ? 'SUCCESS' : status === 'PENDING_PAYMENT' ? 'PENDING' : status === 'PAYMENT_FAILED' ? 'FAILED' : 'EXPIRED'
    payments.push({
      id: uuid('a0000000', n), orderId: id, provider: n % 3 === 0 ? 'PAYOS' : 'MOCK', status: paymentStatus, amount: item.price, paymentReference: reference,
      transactionId: paid ? `TXN${String(n).padStart(8, '0')}` : undefined, createdAt: iso(createdMs + 10_000), paidAt: paid ? iso(createdMs + 60_000) : undefined,
      expiredAt: iso(createdMs + 5 * 60_000), qrCode: paymentStatus === 'PENDING' ? `FRESHVEND-MOCK-QR|${reference}|${item.price}` : undefined,
    })
  }

  // Orders of the maintenance machine's held / failed heads (see markHead): referenced by their history rows.
  const headOrder = (orderN: number, stockIndex: number, status: 'DISPENSE_FAILED' | 'PAID', ago: number) => {
    const head = items.find(item => item.id === uuid('70000000', stockIndex * 100 + 1))!
    const product = products.find(candidate => candidate.id === head.productId)!
    const source = batches.find(candidate => candidate.id === head.batchId)!
    const id = uuid('93000000', orderN)
    const createdAt = iso(-ago)
    orders.push({
      id, orderCode: `ORD-${compactDate(createdAt)}-${String(900 + orderN).padStart(8, '0')}`, machineId: machines[1].id, machineCode: machines[1].code, status,
      subtotal: product.price, totalAmount: product.price, createdAt, expiresAt: iso(-ago + 5 * 60_000), paidAt: iso(-ago + 20_000), live: false,
      items: [{ id: uuid('93100000', orderN), productId: product.id, sku: product.sku, productName: product.name, quantity: 1, unitPrice: product.price, totalPrice: product.price,
        allocations: [{ id: uuid('93200000', orderN), inventoryItemId: head.id, slotCode: head.slotCode, batchCode: source.batchCode, batchExpiresAt: source.expiresAt, status: 'RESERVED' }] }],
    })
    payments.push({
      id: uuid('a3000000', orderN), orderId: id, provider: 'MOCK', status: 'SUCCESS', amount: product.price, paymentReference: `MOCKREFM2${String(orderN).padStart(4, '0')}`,
      transactionId: `TXNM2${String(orderN).padStart(6, '0')}`, createdAt: iso(-ago + 5_000), paidAt: iso(-ago + 20_000), expiredAt: iso(-ago + 5 * 60_000),
    })
  }
  headOrder(1, 3, 'DISPENSE_FAILED', 2 * HOUR)
  headOrder(2, 4, 'PAID', 60_000)

  // "Cần xử lý": a late payment on a cancelled order, and a duplicate SUCCESS on one order.
  const cancelled = orders.find(order => order.status === 'CANCELLED')!
  const late = payments.find(payment => payment.orderId === cancelled.id)!
  Object.assign(late, { status: 'SUCCESS', transactionId: 'TXNLATE00001', paidAt: iso(-HOUR) })
  const completed = orders.find(order => order.status === 'COMPLETED')!
  payments.push({ id: uuid('a0000000', 99), orderId: completed.id, provider: 'MOCK', status: 'SUCCESS', amount: completed.totalAmount, paymentReference: 'MOCKREFDUP001', transactionId: 'TXNDUP000001', createdAt: iso(-2 * HOUR), paidAt: iso(-2 * HOUR), expiredAt: iso(-HOUR) })

  // Dispense commands (FE 6.1, draft of backend 3.3): one per allocation of every paid order. The second COMPLETED order
  // finished after the 60 s timeout (a late DISPENSE_COMPLETED), so the "kết quả đến muộn" note is visible.
  const lateOrder = orders.filter(order => order.status === 'COMPLETED')[1]
  if (lateOrder?.paidAt) lateOrder.completedAt = new Date(Date.parse(lateOrder.paidAt) + 75_000).toISOString()
  // The third COMPLETED order has two bowls: the first failed (its allocation stays RESERVED, as DispenseService.fail
  // leaves it), the second was dispensed afterwards, which moved the order to COMPLETED anyway (DispenseService.completed).
  const mixed = orders.filter(order => order.status === 'COMPLETED')[2]
  if (mixed) {
    const line = mixed.items[0]
    const amount = line.unitPrice! * 2
    line.allocations[0].status = 'RESERVED'
    line.allocations.push({ ...line.allocations[0], id: uuid('92000000', 900), inventoryItemId: uuid('70000000', 6), status: 'DISPENSED' })
    Object.assign(line, { quantity: 2, totalPrice: amount })
    Object.assign(mixed, { subtotal: amount, totalAmount: amount })
    for (const payment of payments) if (payment.orderId === mixed.id) payment.amount = amount
  }
  // Webhook logs (FE 6.2): the calls providers made, built once the amounts above are final so every body matches its
  // payment (the third COMPLETED order is 2 bowls, its body says the doubled total). b0000000-n is the first call about
  // payment n: a verified PAYMENT_SUCCESS / PAYMENT_FAILED, or for n % 7 a call with a bad signature and for n % 10 a body
  // that is not JSON (markup, so "escaped text only" is visible), both rejected; a paid one then has its verified call
  // as b1000000-n. Payments still PENDING or EXPIRED got no call. The three anomalies of the "Cần xử lý" view:
  // PAYMENT_LATE (the cancelled order's late payment), PAYMENT_DUPLICATE (b0000000-99) and PAYMENT_AMOUNT_MISMATCH
  // (b2000000-24: 1.000 ₫ reported for a payment of another amount, so the payment stayed EXPIRED).
  // rawPayload is a JSON object, as the real backend sends it (jsonb); a body that was not JSON has rawPayload null and
  // the exact text in rawBody (PaymentWebhookLogService).
  const body = (payment: MockPayment, status: 'SUCCESS' | 'FAILED', amount = payment.amount): Record<string, unknown> => (payment.provider === 'PAYOS'
    ? { code: status === 'SUCCESS' ? '00' : '01', desc: status === 'SUCCESS' ? 'success' : 'failed', success: status === 'SUCCESS',
      data: { orderCode: payment.paymentReference, amount, description: `FV ${payment.paymentReference}`, reference: payment.transactionId ?? null, transactionDateTime: payment.paidAt ?? payment.createdAt } }
    : { paymentReference: payment.paymentReference, transactionId: payment.transactionId ?? null, amount, status })
  const call = (id: string, payment: MockPayment, receivedAt: string, kind: 'SUCCESS' | 'FAILED' | 'REJECTED' | 'NOT_JSON', amount?: number): MockWebhookLog => ({
    id, provider: payment.provider, reference: payment.paymentReference ?? null, receivedAt,
    verified: kind === 'SUCCESS' || kind === 'FAILED',
    eventType: kind === 'SUCCESS' ? 'PAYMENT_SUCCESS' : kind === 'FAILED' ? 'PAYMENT_FAILED' : 'UNKNOWN',
    rawPayload: kind === 'NOT_JSON' ? null : body(payment, kind === 'FAILED' ? 'FAILED' : 'SUCCESS', amount),
    rawBody: kind === 'NOT_JSON' ? `<script>alert('webhook ${id.slice(-2)}')</script> not json` : null,
  })
  const plus = (instant: string, ms: number) => new Date(Date.parse(instant) + ms).toISOString()
  for (let n = 1; n <= 45; n += 1) {
    const payment = payments.find(candidate => candidate.id === uuid('a0000000', n))!
    const paidCall = payment.status === 'SUCCESS' || payment.status === 'REFUNDED'
    const at = payment.paidAt ?? plus(payment.createdAt, 50_000)
    const rejected = n % 10 === 0 ? 'NOT_JSON' : n % 7 === 0 ? 'REJECTED' : undefined
    if (rejected) {
      webhookLogs.push(call(uuid('b0000000', n), payment, plus(at, -20_000), rejected))
      if (paidCall) webhookLogs.push(call(uuid('b1000000', n), payment, at, 'SUCCESS'))
    } else if (paidCall) webhookLogs.push(call(uuid('b0000000', n), payment, at, 'SUCCESS'))
    else if (payment.status === 'FAILED') webhookLogs.push(call(uuid('b0000000', n), payment, at, 'FAILED'))
  }
  const duplicate = payments.find(payment => payment.id === uuid('a0000000', 99))!
  webhookLogs.push(call(uuid('b0000000', 99), duplicate, duplicate.paidAt!, 'SUCCESS'))
  const mismatched = payments.find(payment => payment.id === uuid('a0000000', 24))!
  webhookLogs.push(call(uuid('b2000000', 24), { ...mismatched, transactionId: 'TXNMISMATCH01' }, plus(mismatched.createdAt, 90_000), 'SUCCESS', 1000))
  for (const payment of payments) if (payment.id.startsWith('a3000000')) webhookLogs.push(call(`b3000000${payment.id.slice(8)}`, payment, payment.paidAt!, 'SUCCESS'))
  const dispenseCommands = seedDispenseCommands(orders, items, { timeoutOrderId: uuid('93000000', 1) })
  const alerts = seedAlerts(nowMs, { machines, slots, orders, admin: users[0], staff: users[1] })

  return {
    users, products, machines, slots, credentials, batches, items, transactions, orders, payments, dispenseCommands, alerts, webhookLogs,
    permissions: SEED_PERMISSIONS.map(permission => ({ ...permission })), roles: seedRoles(),
  }
}

/** `D-` and 16 upper-case hex digits, like DispenseService.newCode; deterministic for seed rows. */
export function seedCommandCode(n: number): string {
  const mixed = (BigInt(n) * 0x9E3779B97F4A7C15n + 0x632BE59BD9B4E019n) & 0xFFFFFFFFFFFFFFFFn
  return `D-${mixed.toString(16).toUpperCase().padStart(16, '0')}`
}

/**
 * Commands of the seed orders, following DispenseService: created with the move to PAID (createdAt = paidAt), SENT on
 * the first publish, ACKNOWLEDGED on DISPENSE_ACCEPTED, then SUCCESS (order COMPLETED), FAILED (DISPENSE_ABORTED) or
 * TIMEOUT (no result within 60 s). Order status → command status: PAID → PENDING (not delivered yet), DISPENSING →
 * ACKNOWLEDGED or SENT (alternately), COMPLETED → SUCCESS (FAILED for a bowl whose allocation is still RESERVED),
 * DISPENSE_FAILED → FAILED (TIMEOUT for `timeoutOrderId`), REFUNDED → FAILED.
 */
function seedDispenseCommands(orders: MockOrder[], items: MockItem[], { timeoutOrderId }: { timeoutOrderId: string }): MockDispenseCommand[] {
  const at = (base: string, offsetMs: number) => new Date(Date.parse(base) + offsetMs).toISOString()
  const commands: MockDispenseCommand[] = []
  let dispensing = 0
  for (const order of orders) {
    if (!order.paidAt) continue
    const paidAt = order.paidAt
    for (const allocation of order.items.flatMap(line => line.allocations)) {
      const item = items.find(candidate => candidate.id === allocation.inventoryItemId)
      if (!item) continue
      const n = commands.length + 1
      const base = { id: `94000000-0000-0000-0000-${String(n).padStart(12, '0')}`, commandCode: seedCommandCode(n), orderId: order.id, machineId: order.machineId, slotId: item.slotId, slotCode: allocation.slotCode ?? item.slotCode, inventoryItemId: item.id, createdAt: paidAt }
      const sent = { sentAt: at(paidAt, 1_000) }
      const acknowledged = { ...sent, acknowledgedAt: at(paidAt, 3_000) }
      let row: Omit<MockDispenseCommand, 'updatedAt'>
      // A bowl still RESERVED in a COMPLETED order is one whose command failed before another bowl succeeded.
      if (order.status === 'COMPLETED' && allocation.status === 'RESERVED') row = { ...base, ...acknowledged, status: 'FAILED', completedAt: at(paidAt, 20_000) }
      else if (order.status === 'COMPLETED') row = { ...base, ...acknowledged, status: 'SUCCESS', completedAt: order.completedAt ?? at(paidAt, 30_000) }
      // DISPENSING starts with the first publish (markSent): alternately still SENT, and already ACKNOWLEDGED.
      else if (order.status === 'DISPENSING') row = (dispensing++ % 2) ? { ...base, ...sent, status: 'SENT' } : { ...base, ...acknowledged, status: 'ACKNOWLEDGED' }
      else if (order.status === 'DISPENSE_FAILED' && order.id === timeoutOrderId) row = { ...base, ...sent, status: 'TIMEOUT', completedAt: at(paidAt, 70_000) }
      else if (order.status === 'DISPENSE_FAILED' || order.status === 'REFUNDED') row = { ...base, ...acknowledged, status: 'FAILED', completedAt: at(paidAt, 20_000) }
      // PAID: the command exists but was not published yet (machine offline or MQTT off); once sent the order is DISPENSING.
      else row = { ...base, status: 'PENDING', sentAt: null }
      commands.push({ ...row, updatedAt: row.completedAt ?? row.acknowledgedAt ?? row.sentAt ?? row.createdAt })
    }
  }
  return commands
}

/**
 * Alerts of the draft of backend 3.6. The first one is the alert of backend/db/dev/seed.sql (same id, type, title and
 * message); the others cover every status, severity and the slot/order context: 3 OPEN (one CRITICAL), 1 ACKNOWLEDGED,
 * 3 RESOLVED (one closed with a note, one closed without being acknowledged first).
 */
function seedAlerts(nowMs: number, { machines, slots, orders, admin, staff }: { machines: S['MachineResponse'][]; slots: S['MachineSlotResponse'][]; orders: MockOrder[]; admin: MockUser; staff: MockUser }): MockAlert[] {
  const iso = (offset: number) => new Date(nowMs + offset).toISOString()
  const [m1, m2] = machines
  const slotOf = (machine: S['MachineResponse'], code: string) => slots.find(slot => slot.machineId === machine.id && slot.slotCode === code)
  const failed = orders.find(order => order.id === uuid('93000000', 1))
  const failedMachine = machines.find(machine => machine.id === failed?.machineId) ?? m1
  const alert = (n: number, machine: S['MachineResponse'], fields: Partial<MockAlert> & Pick<MockAlert, 'type' | 'severity' | 'title' | 'status'>, triggered: number): MockAlert => ({
    id: uuid('60000000', n), machineId: machine.id, machineCode: machine.code, machineName: machine.name, message: null,
    slotId: null, slotCode: null, orderId: null, orderCode: null, acknowledgedAt: null, acknowledgedById: null, acknowledgedByName: null,
    resolvedAt: null, resolvedById: null, resolvedByName: null, resolutionNote: null,
    triggeredAt: iso(triggered), createdAt: iso(triggered), updatedAt: iso(triggered), ...fields,
  })
  const ack = (user: MockUser, at: number) => ({ acknowledgedAt: iso(at), acknowledgedById: user.id, acknowledgedByName: user.fullName, updatedAt: iso(at) })
  const done = (user: MockUser, at: number, note: string | null = null) => ({ resolvedAt: iso(at), resolvedById: user.id, resolvedByName: user.fullName, resolutionNote: note, updatedAt: iso(at) })
  const slot = (machine: S['MachineResponse'], code: string) => ({ slotId: slotOf(machine, code)?.id ?? null, slotCode: code })
  return [
    alert(1, m1, { type: 'HIGH_TEMPERATURE', severity: 'WARNING', title: 'Temperature above range', message: 'Seeded reading of 9.50 C exceeds the 8.00 C maximum.', status: 'OPEN' }, -2 * HOUR),
    alert(2, m2, { type: 'MACHINE_OFFLINE', severity: 'CRITICAL', title: 'Machine offline', message: 'No heartbeat for more than 180 seconds.', status: 'OPEN' }, -35 * 60_000),
    alert(3, m1, { type: 'PRODUCT_EXPIRED', severity: 'WARNING', title: 'Expired bowl at slot head', message: 'The bowl at the head of slot B1 has expired; the slot cannot sell until it is removed.', status: 'ACKNOWLEDGED', ...slot(m1, 'B1'), ...ack(staff, -4 * HOUR) }, -5 * HOUR),
    alert(4, failedMachine, { type: 'DISPENSE_FAILED', severity: 'CRITICAL', title: 'Dispense timed out', message: 'The machine did not report the drop within 60 seconds.', status: 'RESOLVED', orderId: failed?.id ?? null, orderCode: failed?.orderCode ?? null, ...ack(admin, -110 * 60_000), ...done(admin, -HOUR, 'Đã kiểm tra ngăn tại máy và hoàn tiền thủ công cho khách.') }, -2 * HOUR + 70_000),
    alert(5, m1, { type: 'LOW_STOCK', severity: 'INFO', title: 'Low stock', message: 'Slot A2 has 1 bowl left.', status: 'OPEN', ...slot(m1, 'A2') }, -50 * 60_000),
    alert(6, m1, { type: 'PRODUCT_EXPIRING', severity: 'INFO', title: 'Bowls expiring soon', message: 'Bowls in slot A1 expire within 2 days.', status: 'RESOLVED', ...slot(m1, 'A1'), ...ack(staff, -23 * HOUR), ...done(staff, -20 * HOUR) }, -DAY),
    alert(7, m2, { type: 'HIGH_HUMIDITY', severity: 'WARNING', title: 'Humidity above range', message: 'Humidity stayed at the configured maximum for 15 minutes.', status: 'RESOLVED', ...done(admin, -3 * DAY + 2 * HOUR) }, -3 * DAY),
  ]
}
