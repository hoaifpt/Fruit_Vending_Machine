// In-memory data built from backend/db/dev/seed.sql (machines, slots, products, batches, stock). The dev seed has
// no accounts, kiosk keys, orders or payments, so those rows are invented here to exercise the screens.
// MOCK_PASSWORDS are fake values for the mock only; they exist nowhere else.
import type { components } from '../schema'

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
export type MockPayment = Omit<S['PaymentDetailResponse'], 'orderCode' | 'machineCode'> & {
  id: string; orderId: string; provider: string; status: NonNullable<S['PaymentDetailResponse']['status']>; amount: number; createdAt: string
}

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
  webhookLogs: S['PaymentWebhookLogDetailResponse'][]
}

const HOUR = 3_600_000
const DAY = 24 * HOUR
const uuid = (prefix: string, n: number) => `${prefix}-0000-0000-0000-${String(n).padStart(12, '0')}`
const compactDate = (iso: string) => iso.slice(0, 10).replaceAll('-', '')

export function createStore(nowMs: number): MockStore {
  const iso = (offset: number) => new Date(nowMs + offset).toISOString()
  const stamp = { createdAt: iso(-30 * DAY), updatedAt: iso(-DAY) }

  const users: MockUser[] = [
    { id: uuid('10000000', 1), email: MOCK_ACCOUNTS.admin, fullName: 'Quản trị viên', phone: '0900000001', status: 'ACTIVE', roles: ['ADMIN'], password: MOCK_PASSWORDS.admin, ...stamp },
    { id: uuid('10000000', 2), email: MOCK_ACCOUNTS.staff, fullName: 'Nhân viên vận hành', phone: '0900000002', status: 'ACTIVE', roles: ['STAFF'], password: MOCK_PASSWORDS.staff, ...stamp },
    { id: uuid('10000000', 3), email: 'staff.inactive@freshvend.test', fullName: 'Nhân viên đã nghỉ', phone: null, status: 'INACTIVE', roles: ['STAFF'], password: MOCK_PASSWORDS.staff, ...stamp },
    { id: uuid('10000000', 4), email: 'staff.locked@freshvend.test', fullName: 'Nhân viên bị khóa', phone: null, status: 'LOCKED', roles: ['STAFF'], password: MOCK_PASSWORDS.staff, ...stamp },
  ]
  const adminId = users[0].id
  const staffId = users[1].id

  const machine = (n: number, code: string, name: string, status: S['MachineResponse']['status'], lastSeenAt: string | null): S['MachineResponse'] =>
    ({ id: uuid('20000000', n), code, name, location: 'Local development', status, minTemperature: 2, maxTemperature: 8, minHumidity: 0, maxHumidity: 100, lastSeenAt, ...stamp })
  const machines = [
    machine(1, 'DEV-MACHINE-01', 'Development fruit machine', 'ACTIVE', iso(0)),
    machine(2, 'DEV-MACHINE-02', 'Maintenance test machine', 'MAINTENANCE', null),
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
      transactions.push({ id: uuid('71000000', stockIndex * 100 + n), inventoryItemId: id, batchId: source.id, batchCode: source.batchCode, machineId, slotId, type: 'LOAD', referenceId: uuid('72000000', stockIndex + 1), performedBy: staffId, reason: 'Development seed', statusAfter: 'AVAILABLE', createdAt: loadedAt })
    }
  })

  const credentials: MockCredential[] = [
    { credentialId: uuid('80000000', 1), machineId: machines[0].id, apiKey: 'fvk_mockrevoked_notasecret', keyPrefix: 'mockrevoked', status: 'REVOKED', createdAt: iso(-20 * DAY), createdBy: adminId, revokedAt: iso(-10 * DAY), revokedBy: adminId },
    { credentialId: uuid('80000000', 2), machineId: machines[0].id, apiKey: 'fvk_mockactive_notasecret', keyPrefix: 'mockactive', status: 'ACTIVE', createdAt: iso(-10 * DAY), createdBy: adminId },
  ]

  // Enough history to page through, covering every order and payment status the screens render.
  const ORDER_STATUSES: MockOrder['status'][] = ['COMPLETED', 'COMPLETED', 'COMPLETED', 'CANCELLED', 'PENDING_PAYMENT', 'PAID', 'DISPENSING', 'DISPENSE_FAILED', 'PAYMENT_FAILED', 'REFUNDED']
  const orders: MockOrder[] = []
  const payments: MockPayment[] = []
  const webhookLogs: S['PaymentWebhookLogDetailResponse'][] = []

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
    const verified = n % 7 !== 0
    webhookLogs.push({
      id: uuid('b0000000', n), provider: n % 3 === 0 ? 'PAYOS' : 'MOCK', eventType: verified ? 'PAYMENT_SUCCESS' : 'UNKNOWN', reference, verified, receivedAt: iso(createdMs + 60_000),
      // Every tenth body is not JSON and carries markup, so the "show as escaped text" rule is visible on screen.
      rawPayload: n % 10 === 0 ? null : JSON.stringify({ paymentReference: reference, transactionId: `TXN${String(n).padStart(8, '0')}`, amount: item.price, status: 'SUCCESS' }),
      rawBody: n % 10 === 0 ? `<script>alert('webhook ${n}')</script> not json` : null,
    })
  }

  // "Cần xử lý": a late payment on a cancelled order, and a duplicate SUCCESS on one order.
  const cancelled = orders.find(order => order.status === 'CANCELLED')!
  const late = payments.find(payment => payment.orderId === cancelled.id)!
  Object.assign(late, { status: 'SUCCESS', transactionId: 'TXNLATE00001', paidAt: iso(-HOUR) })
  const completed = orders.find(order => order.status === 'COMPLETED')!
  payments.push({ id: uuid('a0000000', 99), orderId: completed.id, provider: 'MOCK', status: 'SUCCESS', amount: completed.totalAmount, paymentReference: 'MOCKREFDUP001', transactionId: 'TXNDUP000001', createdAt: iso(-2 * HOUR), paidAt: iso(-2 * HOUR), expiredAt: iso(-HOUR) })

  return { users, products, machines, slots, credentials, batches, items, transactions, orders, payments, webhookLogs }
}
