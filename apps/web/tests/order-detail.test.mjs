// Order detail (T1, FE 6.1): timeline, bowl links, dispense commands (draft API of backend 3.3) and the mock behind them.
import test from 'node:test'
import assert from 'node:assert/strict'
import { ApiError, configureClient } from '../src/api/client.ts'
import { authApi, dispenseCommandsApi, ordersApi } from '../src/api/resources.ts'
import { createMockFetcher, groupOf, parseSelection } from '../src/api/mock/fetcher.ts'
import { MOCK_ACCOUNTS, MOCK_PASSWORDS, seedCommandCode } from '../src/api/mock/seed.ts'
import { createKioskApi } from '../src/kiosk/api.ts'
import { readMapQuery } from '../src/admin/inventory-map.ts'
import { readHistoryFilters } from '../src/admin/inventory-history.ts'
import {
  DISPENSE_TIMEOUT_MS, STEP_STATE_TEXT, allocationRows, boxHistoryPath, commandEndedAt, commandNote, failedCommands, noCommandText, dispenseAvailability, dispenseTally, inventoryMapPath, isLateResult,
  isLiveOrder, isOverdue, orderAttention, orderTimeline, paymentPath, shortId, slotIdsByCode, wasPaid,
} from '../src/admin/order-detail.ts'
import { STATUS_CATALOG } from '../src/lib/status.ts'
import { jsonResponse } from './helpers.mjs'

const MACHINE = '20000000-0000-0000-0000-000000000001'
const SLOT_A1 = '30000000-0000-0000-0000-000000000001'
const ITEM = '70000000-0000-0000-0000-000000000002'
const T0 = '2026-11-09T06:00:00Z'
const plus = (ms, base = T0) => new Date(Date.parse(base) + ms).toISOString()

const order = (patch = {}) => ({
  id: '90000000-0000-0000-0000-000000000001', orderCode: 'ORD-20261109-00000001', machineId: MACHINE, machineCode: 'DEV-MACHINE-01',
  status: 'COMPLETED', subtotal: 35000, totalAmount: 35000, createdAt: T0, expiresAt: plus(300_000), paidAt: plus(60_000), completedAt: plus(90_000),
  items: [{ id: 'l1', productName: 'Mixed fruit bowl', sku: 'DEV-MIXED-FRUIT', quantity: 1, unitPrice: 35000, totalPrice: 35000,
    allocations: [{ id: 'a1', inventoryItemId: ITEM, slotCode: 'A1', batchCode: 'SEED-MIXED-01', status: 'DISPENSED' }] }],
  payments: [{ id: 'a0000000-0000-0000-0000-000000000001', provider: 'MOCK', status: 'SUCCESS', amount: 35000, createdAt: plus(10_000), paidAt: plus(60_000) }],
  ...patch,
})
const command = (patch = {}) => ({
  id: 'c1', commandCode: 'D-0123456789ABCDEF', orderId: order().id, machineId: MACHINE, slotId: SLOT_A1, slotCode: 'A1', inventoryItemId: ITEM,
  status: 'SUCCESS', createdAt: plus(60_000), sentAt: plus(61_000), acknowledgedAt: plus(63_000), completedAt: plus(80_000), updatedAt: plus(80_000), ...patch,
})
const keys = steps => steps.map(step => `${step.key}:${step.state}`)

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
})

test('bowls: slot id comes from the command, else from the machine slots by code; each row has its two links', () => {
  const slots = slotIdsByCode([{ id: SLOT_A1, slotCode: 'A1' }, { id: '30000000-0000-0000-0000-000000000002', slotCode: 'A2' }])
  assert.deepEqual(slots, { A1: SLOT_A1, A2: '30000000-0000-0000-0000-000000000002' })

  const [byCode] = allocationRows(order(), [], slots)
  assert.equal(byCode.slotId, SLOT_A1)
  assert.equal(byCode.slotPath, `/admin/inventory?machineId=${MACHINE}&slotId=${SLOT_A1}`)
  assert.equal(byCode.boxPath, `/admin/inventory/history?inventoryItemId=${ITEM}`)
  assert.equal(byCode.productName, 'Mixed fruit bowl')
  assert.equal(byCode.command, undefined)

  const other = '30000000-0000-0000-0000-000000000009'
  const [byCommand] = allocationRows(order(), [command({ slotId: other })], slots)
  assert.equal(byCommand.slotId, other, 'the command knows the exact slot')
  assert.equal(byCommand.command.status, 'SUCCESS')

  const [unknown] = allocationRows(order(), [], {})
  assert.equal(unknown.slotPath, `/admin/inventory?machineId=${MACHINE}`, 'no slot list: still one click to the machine map')
  assert.deepEqual(allocationRows(order({ items: [] })), [])
})

// ---- dispense commands

test('dispense: the draft endpoint missing on the backend reads as "no data yet", not as a broken page', () => {
  assert.equal(dispenseAvailability(new ApiError(404, 'No static resource')), 'missing')
  assert.equal(dispenseAvailability(new ApiError(405, 'x')), 'missing')
  assert.equal(dispenseAvailability(new ApiError(501, 'x')), 'missing')
  assert.equal(dispenseAvailability(new ApiError(403, 'x')), 'forbidden')
  assert.equal(dispenseAvailability(new ApiError(500, 'x')), 'error')
  assert.equal(dispenseAvailability(new TypeError('Failed to fetch')), 'error')
})

test('dispense: late result, overdue command and the note under each status', () => {
  assert.equal(isLateResult(command()), false)
  assert.equal(isLateResult(command({ completedAt: plus(60_000 + DISPENSE_TIMEOUT_MS + 15_000) })), true)
  assert.equal(isLateResult(command({ status: 'TIMEOUT', completedAt: plus(200_000) })), false)
  assert.match(commandNote(command({ completedAt: plus(135_000) }), 0), /^Kết quả đến muộn: máy báo nhả xong sau 75 giây/)

  const created = Date.parse(plus(60_000))
  assert.equal(isOverdue(command({ status: 'SENT' }), created + 30_000), false)
  assert.equal(isOverdue(command({ status: 'SENT' }), created + 61_000), true)
  assert.equal(isOverdue(command({ status: 'SUCCESS' }), created + 600_000), false)
  assert.match(commandNote(command({ status: 'ACKNOWLEDGED' }), created + 61_000), /quá 60 giây/)

  for (const status of Object.keys(STATUS_CATALOG.dispense)) assert.ok(commandNote(command({ status, completedAt: null }), created).length > 10, status)
  assert.match(commandNote(command({ status: 'SENT' }), created), /gửi lại cùng mã lệnh mỗi 5 giây/)
  assert.match(commandNote(command({ status: 'TIMEOUT' }), created), /60 giây/)
  assert.deepEqual(dispenseTally([command(), command({ status: 'TIMEOUT' }), command({ status: 'FAILED' }), command({ status: 'SENT' })]), { total: 4, success: 1, failed: 2, open: 1 })
})

// ---- timeline

test('timeline: completed order goes created → paid → dispensed → completed, with the times of each step', () => {
  const steps = orderTimeline(order(), [command()])
  assert.deepEqual(keys(steps), ['created:done', 'paid:done', 'dispense:done', 'completed:done'])
  assert.equal(steps[0].at, T0)
  assert.equal(steps[1].at, plus(60_000))
  assert.equal(steps[2].at, plus(80_000), 'dispense ends when the command ends')
  assert.equal(steps[3].at, plus(90_000))
  assert.match(steps[2].detail, /1\/1 hộp/)
  assert.match(orderTimeline(order(), [command({ completedAt: plus(200_000) })])[2].detail, /kết quả đến muộn/)
  assert.equal(orderTimeline(order())[2].at, plus(90_000), 'without commands the order time is used')
  assert.match(steps[0].detail, /09\/11\/2026 13:05/, 'expiry shown in Asia/Ho_Chi_Minh')
})

test('timeline: live and unpaid orders', () => {
  assert.deepEqual(keys(orderTimeline(order({ status: 'PENDING_PAYMENT', paidAt: undefined, completedAt: undefined, payments: [] }))),
    ['created:done', 'paid:current', 'dispense:upcoming', 'completed:upcoming'])
  const paid = orderTimeline(order({ status: 'PAID', completedAt: undefined }), [command({ status: 'PENDING', sentAt: null, acknowledgedAt: null, completedAt: null })])
  assert.deepEqual(keys(paid), ['created:done', 'paid:done', 'dispense:current', 'completed:upcoming'])
  assert.match(paid[2].detail, /chưa gửi được/)
  const dispensing = orderTimeline(order({ status: 'DISPENSING', completedAt: undefined }), [command({ status: 'ACKNOWLEDGED', completedAt: null })])
  assert.equal(dispensing[2].label, 'Đang nhả hàng')
  assert.match(dispensing[2].detail, /^Máy đã nhận lệnh/)
  assert.equal(dispensing[2].at, plus(63_000))

  const cancelled = orderTimeline(order({ status: 'CANCELLED', paidAt: undefined, completedAt: undefined, cancelledAt: plus(120_000) }))
  assert.deepEqual(keys(cancelled), ['created:done', 'cancelled:stopped'])
  assert.equal(cancelled[1].at, plus(120_000))
  assert.deepEqual(keys(orderTimeline(order({ status: 'PAYMENT_FAILED', paidAt: undefined, completedAt: undefined }))), ['created:done', 'payment-failed:failed'])
})

test('timeline: failed dispense, refund and unknown status', () => {
  const timeout = orderTimeline(order({ status: 'DISPENSE_FAILED', completedAt: undefined }), [command({ status: 'TIMEOUT', acknowledgedAt: null, completedAt: plus(130_000) })])
  assert.deepEqual(keys(timeout), ['created:done', 'paid:done', 'dispense:failed'])
  assert.equal(timeout[2].at, plus(130_000))
  assert.match(timeout[2].detail, /không báo kết quả trong 60 giây/)
  assert.match(orderTimeline(order({ status: 'DISPENSE_FAILED' }), [command({ status: 'FAILED' })])[2].detail, /không nhả được/)
  assert.deepEqual(keys(orderTimeline(order({ status: 'REFUNDED' }), [command({ status: 'FAILED' })])), ['created:done', 'paid:done', 'dispense:failed', 'refunded:done'])
  assert.deepEqual(keys(orderTimeline(order({ status: 'REFUNDED' }))), ['created:done', 'paid:done', 'dispense:stopped', 'refunded:done'])
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
  assert.match(noCommandText({ status: 'PENDING_PAYMENT' }), /chỉ được tạo khi đơn đã thanh toán/)
  assert.match(noCommandText({ status: 'CANCELLED' }), /kết thúc trước bước nhả hàng/)
  assert.equal(wasPaid({ status: 'REFUNDED' }), true)

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

test('several bowls: a failed bowl in a COMPLETED order is flagged on the timeline and in "Cần xử lý"', () => {
  const both = [command({ status: 'FAILED', completedAt: plus(80_000) }), command({ id: 'c2', inventoryItemId: '70000000-0000-0000-0000-000000000006', completedAt: plus(90_000) })]
  assert.equal(failedCommands(both).length, 1)
  const steps = orderTimeline(order(), both)
  assert.deepEqual(keys(steps), ['created:done', 'paid:done', 'dispense:failed', 'completed:done'])
  assert.equal(steps[2].label, 'Nhả hàng có hộp lỗi')
  assert.match(steps[2].detail, /1 hộp nhả lỗi đang chặn ngăn.*Máy đã nhả 1\/2 hộp/)
  assert.match(steps[3].detail, /hộp nhả lỗi vẫn cần xử lý/)
  const attention = orderAttention(order(), both)
  assert.deepEqual(attention.map(item => item.key), ['box-failed'])
  assert.equal(attention[0].paymentId, 'a0000000-0000-0000-0000-000000000001')
  assert.deepEqual(orderAttention(order(), [command()]), [], 'a late SUCCESS is not a failure')
  assert.deepEqual(orderAttention(order({ status: 'DISPENSE_FAILED' }), both).map(item => item.key), ['dispense-failed'], 'not said twice')
})

test('dispensing: "sent" until the machine acknowledges; failed commands never sent show their last update', () => {
  const sent = orderTimeline(order({ status: 'DISPENSING', completedAt: undefined }), [command({ status: 'SENT', acknowledgedAt: null, completedAt: null })])[2]
  assert.match(sent.detail, /^Lệnh đã gửi xuống máy, đang chờ máy xác nhận/)
  assert.equal(sent.at, plus(61_000))
  assert.doesNotMatch(orderTimeline(order({ status: 'DISPENSING' }))[2].detail, /Máy đã nhận/, 'unknown commands: never claim the machine received it')
  assert.deepEqual(commandEndedAt(command()), { at: plus(80_000), approximate: false })
  assert.deepEqual(commandEndedAt(command({ status: 'TIMEOUT', sentAt: null, acknowledgedAt: null, completedAt: null, updatedAt: plus(120_000) })), { at: plus(120_000), approximate: true })
  assert.deepEqual(commandEndedAt(command({ status: 'SENT', completedAt: null })), { at: undefined, approximate: false })
  const never = orderTimeline(order({ status: 'DISPENSE_FAILED' }), [command({ status: 'TIMEOUT', sentAt: null, acknowledgedAt: null, completedAt: null, updatedAt: plus(120_000) })])
  assert.equal(never[2].at, plus(120_000))
  assert.equal(orderTimeline(order({ status: 'DISPENSE_FAILED' }))[2].at, undefined, 'commands unknown: no made-up time')
})

// ---- mock of the draft endpoint

function setup(mode = 'all', overrides = {}) {
  const state = { token: null, clock: Date.parse('2026-11-11T03:00:00Z'), search: '', realCalls: [] }
  const fetcher = createMockFetcher(parseSelection(mode), {
    getSearch: () => state.search, now: () => state.clock,
    realFetch: async url => { state.realCalls.push(String(url)); return jsonResponse(404, { status: 404, message: 'No static resource' }) }, ...overrides,
  })
  configureClient({ baseUrl: '', fetcher, getToken: () => state.token, onUnauthorized: () => {} })
  return state
}
async function signIn(state, account = 'admin') {
  state.token = (await authApi.login({ email: MOCK_ACCOUNTS[account], password: MOCK_PASSWORDS[account] })).accessToken
}
const orderId = n => `90000000-0000-0000-0000-${String(n).padStart(12, '0')}`

test('mock: dispense commands have their own group, so they can be mocked while orders stay real', async () => {
  assert.equal(groupOf('/orders/o1/dispense-commands'), 'dispense-commands')
  assert.equal(groupOf('/orders/o1'), 'orders')
  const state = setup('auth,dispense-commands')
  await signIn(state)
  await assert.rejects(ordersApi.get(orderId(1)), error => error instanceof ApiError && error.status === 404)
  assert.equal(state.realCalls.length, 1, 'orders went to the real backend')
  assert.equal((await dispenseCommandsApi.listForOrder(orderId(1))).length, 1)
  assert.equal(state.realCalls.length, 1)
})

test('mock: one command per paid bowl, shaped by the order status, codes like the firmware accepts', async () => {
  const state = setup()
  await signIn(state, 'staff')
  const statusOf = async n => (await dispenseCommandsApi.listForOrder(orderId(n))).map(row => row.status)
  assert.deepEqual(await statusOf(1), ['SUCCESS'])
  assert.deepEqual(await statusOf(3), ['FAILED', 'SUCCESS'], 'two bowls: the first failed, the order still COMPLETED')
  const mixed = await ordersApi.get(orderId(3))
  assert.equal(mixed.status, 'COMPLETED')
  assert.deepEqual(mixed.items[0].allocations.map(row => row.status), ['RESERVED', 'DISPENSED'])
  assert.equal(mixed.totalAmount, mixed.items[0].unitPrice * 2)
  assert.deepEqual(await statusOf(17), ['SENT'], 'a SENT command only on a DISPENSING order')
  assert.deepEqual(await statusOf(4), [], 'cancelled before payment: no command')
  assert.deepEqual(await statusOf(5), [], 'waiting for payment: no command')
  assert.deepEqual(await statusOf(6), ['PENDING'])
  assert.deepEqual(await statusOf(7), ['ACKNOWLEDGED'])
  assert.deepEqual(await statusOf(8), ['FAILED'])
  assert.deepEqual(await statusOf(10), ['FAILED'])
  assert.deepEqual((await dispenseCommandsApi.listForOrder('93000000-0000-0000-0000-000000000001')).map(row => row.status), ['TIMEOUT'])
  assert.deepEqual((await dispenseCommandsApi.listForOrder('93000000-0000-0000-0000-000000000002')).map(row => row.status), ['PENDING'], 'PAID: not sent yet')
  const orders = (await ordersApi.list({ size: 100 })).content
  for (const row of orders) {
    const statuses = (await dispenseCommandsApi.listForOrder(row.id)).map(item => item.status)
    if (statuses.includes('SENT') || statuses.includes('ACKNOWLEDGED')) assert.equal(row.status, 'DISPENSING', row.orderCode)
    if (row.status === 'PAID') assert.ok(statuses.every(status => status === 'PENDING'), row.orderCode)
  }

  const [late] = await dispenseCommandsApi.listForOrder(orderId(2))
  assert.equal(isLateResult(late), true, 'the second completed order shows a late result')
  const detail = await ordersApi.get(orderId(2))
  assert.equal(detail.completedAt, late.completedAt, 'order and command agree on when it finished')

  const [row] = await dispenseCommandsApi.listForOrder(orderId(1))
  assert.match(row.commandCode, /^D-[0-9A-F]{16}$/)
  const allocation = (await ordersApi.get(orderId(1))).items[0].allocations[0]
  assert.equal(row.inventoryItemId, allocation.inventoryItemId)
  assert.equal(row.slotCode, allocation.slotCode)
  assert.equal(row.slotId, SLOT_A1)
  assert.equal(seedCommandCode(1), seedCommandCode(1))
  assert.notEqual(seedCommandCode(1), seedCommandCode(2))
  await assert.rejects(dispenseCommandsApi.listForOrder('90000000-0000-0000-0000-999999999999'), error => error.status === 404)
})

test('mock: a kiosk purchase creates a PENDING command at payment (order PAID) that ends SUCCESS with the order', async () => {
  const state = setup('all', { autoPayMs: 10_000, dispenseMs: 4_000 })
  const kiosk = createKioskApi('any-kiosk-key')
  const created = await kiosk.createOrder('40000000-0000-0000-0000-000000000001')
  await kiosk.createPayment(created.data.id)
  await signIn(state)
  assert.deepEqual(await dispenseCommandsApi.listForOrder(created.data.id), [])
  state.clock += 10_000
  const [sent] = await dispenseCommandsApi.listForOrder(created.data.id)
  assert.equal(sent.status, 'PENDING')
  assert.equal((await ordersApi.get(created.data.id)).status, 'PAID')
  assert.match(sent.commandCode, /^D-[0-9A-F]{16}$/)
  state.clock += 4_000
  const [done] = await dispenseCommandsApi.listForOrder(created.data.id)
  assert.equal(done.status, 'SUCCESS')
  assert.equal(done.commandCode, sent.commandCode, 'same command, never a second one')
  assert.equal((await ordersApi.get(created.data.id)).status, 'COMPLETED')
})

test('mock: scenario missing answers 404 like a backend without the endpoint', async () => {
  const state = setup()
  await signIn(state)
  state.search = '?scenario=missing:dispense-commands'
  await assert.rejects(dispenseCommandsApi.listForOrder(orderId(1)), error => error.status === 404 && dispenseAvailability(error) === 'missing')
  assert.equal((await ordersApi.get(orderId(1))).id, orderId(1), 'the order itself still loads')
})
