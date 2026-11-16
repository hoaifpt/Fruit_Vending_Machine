// Order detail (T1, FE 6.1): timeline, bowl links and how far dispensing got, read from GET /orders/{id} only (status
// and allocations): the backend has no per-order dispense command endpoint, so the web never calls one.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { configureClient } from '../src/api/client.ts'
import { authApi, ordersApi } from '../src/api/resources.ts'
import { createMockFetcher, groupOf, parseSelection } from '../src/api/mock/fetcher.ts'
import { MOCK_ACCOUNTS, MOCK_PASSWORDS, seedCommandCode } from '../src/api/mock/seed.ts'
import { createKioskApi } from '../src/kiosk/api.ts'
import { readMapQuery } from '../src/admin/inventory-map.ts'
import { readHistoryFilters } from '../src/admin/inventory-history.ts'
import {
  STEP_STATE_TEXT, allocationRows, boxHistoryPath, dispenseTally, failedBowls, inventoryMapPath, isLiveOrder, machineEventsPath, noCommandText, orderAttention,
  orderTimeline, paymentPath, shortId, slotIdsByCode, wasPaid,
} from '../src/admin/order-detail.ts'

const root = fileURLToPath(new URL('../../../', import.meta.url))
const MACHINE = '20000000-0000-0000-0000-000000000001'
const SLOT_A1 = '30000000-0000-0000-0000-000000000001'
const ITEM = '70000000-0000-0000-0000-000000000002'
const T0 = '2026-11-09T06:00:00Z'
const plus = (ms, base = T0) => new Date(Date.parse(base) + ms).toISOString()

const allocation = (patch = {}) => ({ id: 'a1', inventoryItemId: ITEM, slotCode: 'A1', batchCode: 'SEED-MIXED-01', status: 'DISPENSED', ...patch })
const order = (patch = {}, allocations = [allocation()]) => ({
  id: '90000000-0000-0000-0000-000000000001', orderCode: 'ORD-20261109-00000001', machineId: MACHINE, machineCode: 'DEV-MACHINE-01',
  status: 'COMPLETED', subtotal: 35000, totalAmount: 35000, createdAt: T0, expiresAt: plus(300_000), paidAt: plus(60_000), completedAt: plus(90_000),
  items: [{ id: 'l1', productName: 'Mixed fruit bowl', sku: 'DEV-MIXED-FRUIT', quantity: allocations.length, unitPrice: 35000, totalPrice: 35000 * allocations.length, allocations }],
  payments: [{ id: 'a0000000-0000-0000-0000-000000000001', provider: 'MOCK', status: 'SUCCESS', amount: 35000, createdAt: plus(10_000), paidAt: plus(60_000) }],
  ...patch,
})
const keys = steps => steps.map(step => `${step.key}:${step.state}`)

// ---- no dispense command endpoint

test('the web never calls GET /orders/{id}/dispense-commands (not in api.yaml): no client function, no mock route', () => {
  const yaml = readFileSync(`${root}api-contract/api.yaml`, 'utf8')
  assert.doesNotMatch(yaml, /dispense-commands/)
  for (const file of ['src/api/resources.ts', 'src/admin/order-detail.ts', 'src/admin/pages/OrderDetailPage.tsx', 'src/api/mock/handlers.ts']) {
    assert.doesNotMatch(readFileSync(`${root}apps/web/${file}`, 'utf8'), /dispense-commands|dispenseCommandsApi/, file)
  }
  assert.equal(groupOf('/orders/o1/dispense-commands'), 'orders', 'no separate mock group any more')
})

// ---- links: one click from a bowl to its slot and its history

test('links: map and history paths use the formats the inventory screens read back', () => {
  const map = inventoryMapPath(MACHINE, SLOT_A1)
  assert.equal(map, `/admin/inventory?machineId=${MACHINE}&slotId=${SLOT_A1}`)
  assert.deepEqual(readMapQuery(new URL(map, 'http://x').searchParams), { view: 'map', machineId: MACHINE, slotId: SLOT_A1 })
  assert.equal(inventoryMapPath(MACHINE), `/admin/inventory?machineId=${MACHINE}`, 'slot unknown: the whole machine')
  assert.equal(inventoryMapPath('nope', SLOT_A1), '/admin/inventory', 'a non-UUID machine is never put in the URL')
  assert.equal(inventoryMapPath(MACHINE, 'A1'), `/admin/inventory?machineId=${MACHINE}`)

  const history = boxHistoryPath(ITEM)
  assert.equal(history, `/admin/inventory/history?inventoryItemId=${ITEM}`)
  const { filters, ignored } = readHistoryFilters(new URL(history, 'http://x').searchParams)
  assert.equal(filters.inventoryItemId, ITEM)
  assert.deepEqual(ignored, [])
  assert.equal(boxHistoryPath('x'), '')
  assert.equal(paymentPath('a0000000-0000-0000-0000-000000000001'), '/admin/payments/a0000000-0000-0000-0000-000000000001')
  assert.equal(paymentPath(undefined), '')
  assert.equal(shortId(ITEM), '…00000002')
  assert.equal(machineEventsPath(MACHINE), `/admin/machines/${MACHINE}?tab=sensors`, 'dispense commands show as machine events')
  assert.equal(machineEventsPath('x'), '')
})

test('bowls: slot id from the machine slots by code; each row has its two links', () => {
  const slots = slotIdsByCode([{ id: SLOT_A1, slotCode: 'A1' }, { id: '30000000-0000-0000-0000-000000000002', slotCode: 'A2' }])
  assert.deepEqual(slots, { A1: SLOT_A1, A2: '30000000-0000-0000-0000-000000000002' })
  const [byCode] = allocationRows(order(), slots)
  assert.equal(byCode.slotId, SLOT_A1)
  assert.equal(byCode.slotPath, `/admin/inventory?machineId=${MACHINE}&slotId=${SLOT_A1}`)
  assert.equal(byCode.boxPath, `/admin/inventory/history?inventoryItemId=${ITEM}`)
  assert.equal(byCode.productName, 'Mixed fruit bowl')
  const [unknown] = allocationRows(order(), {})
  assert.equal(unknown.slotPath, `/admin/inventory?machineId=${MACHINE}`, 'no slot list: still one click to the machine map')
  assert.deepEqual(allocationRows(order({ items: [] })), [])
})

test('dispensing from the allocations: DISPENSED handed out, RESERVED held (failed once the order is over), RELEASED returned', () => {
  const mixed = order({}, [allocation({ status: 'RESERVED' }), allocation({ id: 'a2', status: 'DISPENSED' }), allocation({ id: 'a3', status: 'RELEASED' })])
  assert.deepEqual(dispenseTally(mixed), { total: 3, dispensed: 1, held: 1, released: 1 })
  assert.equal(failedBowls(mixed), 1)
  assert.equal(failedBowls({ ...mixed, status: 'DISPENSING' }), 0, 'a live order still waits for the machine')
  assert.deepEqual(dispenseTally(order({ items: [] })), { total: 0, dispensed: 0, held: 0, released: 0 })
})

// ---- timeline

test('timeline: completed order goes created → paid → dispensed → completed, with the times of each step', () => {
  const steps = orderTimeline(order())
  assert.deepEqual(keys(steps), ['created:done', 'paid:done', 'dispense:done', 'completed:done'])
  assert.equal(steps[0].at, T0)
  assert.equal(steps[1].at, plus(60_000))
  assert.equal(steps[2].at, plus(90_000), 'dispensing ends with the order')
  assert.equal(steps[3].at, plus(90_000))
  assert.match(steps[2].detail, /1\/1 hộp/)
  assert.match(steps[0].detail, /09\/11\/2026 13:05/, 'expiry shown in Asia/Ho_Chi_Minh')
})

test('timeline: live and unpaid orders', () => {
  assert.deepEqual(keys(orderTimeline(order({ status: 'PENDING_PAYMENT', paidAt: undefined, completedAt: undefined, payments: [] }, [allocation({ status: 'RESERVED' })]))),
    ['created:done', 'paid:current', 'dispense:upcoming', 'completed:upcoming'])
  const paid = orderTimeline(order({ status: 'PAID', completedAt: undefined }, [allocation({ status: 'RESERVED' })]))
  assert.deepEqual(keys(paid), ['created:done', 'paid:done', 'dispense:current', 'completed:upcoming'])
  assert.match(paid[2].detail, /đang chờ gửi xuống máy/)
  assert.equal(paid[2].at, plus(60_000))
  const dispensing = orderTimeline(order({ status: 'DISPENSING', completedAt: undefined }, [allocation({ status: 'RESERVED' }), allocation({ id: 'a2' })]))
  assert.equal(dispensing[2].label, 'Đang nhả hàng')
  assert.match(dispensing[2].detail, /^Lệnh đã gửi xuống máy, đang chờ máy báo kết quả\. Máy đã nhả 1\/2 hộp\./)
  assert.doesNotMatch(dispensing[2].detail, /Máy đã nhận/, 'never claims the machine received the command')

  const cancelled = orderTimeline(order({ status: 'CANCELLED', paidAt: undefined, completedAt: undefined, cancelledAt: plus(120_000) }, [allocation({ status: 'RELEASED' })]))
  assert.deepEqual(keys(cancelled), ['created:done', 'cancelled:stopped'])
  assert.equal(cancelled[1].at, plus(120_000))
  assert.deepEqual(keys(orderTimeline(order({ status: 'PAYMENT_FAILED', paidAt: undefined, completedAt: undefined }))), ['created:done', 'payment-failed:failed'])
})

test('timeline: failed dispense (blocked or returned bowls), refund and unknown status', () => {
  const blocked = orderTimeline(order({ status: 'DISPENSE_FAILED', completedAt: undefined }, [allocation({ status: 'RESERVED' })]))
  assert.deepEqual(keys(blocked), ['created:done', 'paid:done', 'dispense:failed'])
  assert.match(blocked[2].detail, /1 hộp bị đánh dấu nhả lỗi và chặn ngăn/)
  assert.equal(blocked[2].at, undefined, 'no made-up time')
  const returned = orderTimeline(order({ status: 'DISPENSE_FAILED', completedAt: undefined }, [allocation({ status: 'RELEASED' })]))
  assert.match(returned[2].detail, /1 hộp đã được trả lại ngăn/)
  assert.doesNotMatch(returned[2].detail, /chặn ngăn/)
  assert.deepEqual(keys(orderTimeline(order({ status: 'REFUNDED' }, [allocation({ status: 'RESERVED' })]))), ['created:done', 'paid:done', 'dispense:failed', 'refunded:done'])
  assert.deepEqual(keys(orderTimeline(order({ status: 'REFUNDED' }, []))), ['created:done', 'paid:done', 'dispense:stopped', 'refunded:done'])
  assert.deepEqual(keys(orderTimeline(order({ status: 'REFUNDED' }))), ['created:done', 'paid:done', 'dispense:done', 'refunded:done'])
  assert.deepEqual(keys(orderTimeline(order({ status: 'ON_HOLD' }))), ['created:done', 'unknown:current'])
  for (const state of ['done', 'current', 'failed', 'stopped', 'upcoming']) assert.ok(STEP_STATE_TEXT[state])
})

test('order flags: live, paid and what needs a person', () => {
  assert.equal(isLiveOrder({ status: 'PENDING_PAYMENT' }), true)
  assert.equal(isLiveOrder({ status: 'DISPENSING' }), true)
  assert.equal(isLiveOrder({ status: 'COMPLETED' }), false)
  assert.equal(wasPaid({ status: 'PENDING_PAYMENT' }), false)
  assert.equal(wasPaid({ status: 'CANCELLED', paidAt: T0 }), false, 'a late payment on a cancelled order never gets a command')
  assert.equal(wasPaid({ status: 'PAYMENT_FAILED', paidAt: T0 }), false)
  assert.equal(wasPaid({ status: 'REFUNDED' }), true)
  assert.match(noCommandText({ status: 'PENDING_PAYMENT' }), /chỉ được tạo khi đơn đã thanh toán/)
  assert.match(noCommandText({ status: 'CANCELLED' }), /kết thúc trước bước nhả hàng/)

  assert.deepEqual(orderAttention(order()), [])
  assert.deepEqual(orderAttention(order({ status: 'DISPENSE_FAILED' })).map(item => item.key), ['dispense-failed'])
  const late = orderAttention(order({ status: 'CANCELLED', paidAt: undefined }))
  assert.deepEqual(late.map(item => item.key), ['late-payment'])
  assert.equal(late[0].paymentId, 'a0000000-0000-0000-0000-000000000001', 'one click to the payment to reconcile')
  const twice = order({ payments: [...order().payments, { id: 'a0000000-0000-0000-0000-000000000099', status: 'SUCCESS' }] })
  assert.deepEqual(orderAttention(twice).map(item => item.key), ['duplicate-payment'])
  assert.equal(orderAttention(twice)[0].paymentId, 'a0000000-0000-0000-0000-000000000099')
  assert.equal(orderAttention(order({ status: 'DISPENSE_FAILED' }))[0].paymentId, 'a0000000-0000-0000-0000-000000000001', 'refund item links the payment')
})

test('several bowls: a failed bowl in a COMPLETED order (allocation still RESERVED) is flagged on the timeline and in "Cần xử lý"', () => {
  const both = order({}, [allocation({ status: 'RESERVED' }), allocation({ id: 'a2', inventoryItemId: '70000000-0000-0000-0000-000000000006', status: 'DISPENSED' })])
  const steps = orderTimeline(both)
  assert.deepEqual(keys(steps), ['created:done', 'paid:done', 'dispense:failed', 'completed:done'])
  assert.equal(steps[2].label, 'Nhả hàng có hộp lỗi')
  assert.match(steps[2].detail, /1 hộp nhả lỗi đang chặn ngăn.*Máy đã nhả 1\/2 hộp/)
  assert.match(steps[3].detail, /hộp nhả lỗi vẫn cần xử lý/)
  const attention = orderAttention(both)
  assert.deepEqual(attention.map(item => item.key), ['box-failed'])
  assert.equal(attention[0].paymentId, 'a0000000-0000-0000-0000-000000000001')
  assert.deepEqual(orderAttention({ ...both, status: 'DISPENSE_FAILED' }).map(item => item.key), ['dispense-failed'], 'not said twice')
  assert.deepEqual(orderAttention({ ...both, status: 'DISPENSING' }), [], 'a live order is not a failure yet')
})

// ---- mock

function setup(mode = 'all', overrides = {}) {
  const state = { token: null, clock: Date.parse('2026-11-11T03:00:00Z'), search: '' }
  const fetcher = createMockFetcher(parseSelection(mode), { getSearch: () => state.search, now: () => state.clock, ...overrides })
  configureClient({ baseUrl: '', fetcher, getToken: () => state.token, onUnauthorized: () => {} })
  return state
}
async function signIn(state, account = 'admin') {
  state.token = (await authApi.login({ email: MOCK_ACCOUNTS[account], password: MOCK_PASSWORDS[account] })).accessToken
}
const orderId = n => `90000000-0000-0000-0000-${String(n).padStart(12, '0')}`

test('mock: the seed orders carry allocations matching their status (one bowl failed in the third COMPLETED order)', async () => {
  const state = setup()
  await signIn(state, 'staff')
  const allocations = async id => (await ordersApi.get(id)).items.flatMap(line => line.allocations.map(row => row.status))
  assert.deepEqual(await allocations(orderId(1)), ['DISPENSED'])
  const mixed = await ordersApi.get(orderId(3))
  assert.equal(mixed.status, 'COMPLETED')
  assert.deepEqual(mixed.items[0].allocations.map(row => row.status), ['RESERVED', 'DISPENSED'])
  assert.equal(failedBowls(mixed), 1)
  assert.ok(orderAttention(mixed).some(item => item.key === 'box-failed'))
  assert.deepEqual(await allocations(orderId(4)), ['RELEASED'], 'cancelled before payment')
  assert.deepEqual(await allocations(orderId(7)), ['RESERVED'], 'DISPENSING: waiting for the machine')
  assert.deepEqual(await allocations('93000000-0000-0000-0000-000000000001'), ['RESERVED'], 'DISPENSE_FAILED: the bowl blocks its slot')
  assert.equal(seedCommandCode(1), seedCommandCode(1))
  assert.notEqual(seedCommandCode(1), seedCommandCode(2))
})

test('mock: a kiosk purchase goes PAID → DISPENSING → COMPLETED with the allocation DISPENSED', async () => {
  const state = setup('all', { autoPayMs: 10_000, dispenseMs: 4_000 })
  const kiosk = createKioskApi('any-kiosk-key')
  const created = await kiosk.createOrder('40000000-0000-0000-0000-000000000001')
  await kiosk.createPayment(created.data.id)
  await signIn(state)
  state.clock += 10_000
  const paid = await ordersApi.get(created.data.id)
  assert.equal(paid.status, 'PAID')
  assert.deepEqual(dispenseTally(paid), { total: 1, dispensed: 0, held: 1, released: 0 })
  state.clock += 1_000
  assert.equal((await ordersApi.get(created.data.id)).status, 'DISPENSING')
  state.clock += 3_000
  const done = await ordersApi.get(created.data.id)
  assert.equal(done.status, 'COMPLETED')
  assert.deepEqual(dispenseTally(done), { total: 1, dispensed: 1, held: 0, released: 0 })
  assert.deepEqual(keys(orderTimeline(done)), ['created:done', 'paid:done', 'dispense:done', 'completed:done'])
})
