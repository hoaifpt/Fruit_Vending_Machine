// FE 7.2 Thực hiện phiếu nạp hàng on the real API (backend #68, docs/restock.md): the step derived from server data, old
// bowls of a column, quantities, reconciliation with a reason per differing line, planning lines, error text, and the mock
// end to end (start → take old bowls out with commands linked to the work order → load per line → gates closed →
// complete with lineVariances; the health check closes the stock alerts of the filled slot).
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { ApiError, configureClient } from '../src/api/client.ts'
import { alertsApi, authApi, batchesApi, inventoryApi, machinesApi, maintenanceCommandsApi, restockApi, slotsApi, workOrdersApi } from '../src/api/resources.ts'
import { createMockFetcher, parseSelection } from '../src/api/mock/fetcher.ts'
import { MOCK_ACCOUNTS, MOCK_PASSWORDS } from '../src/api/mock/seed.ts'
import { MOCK_LOW_STOCK_THRESHOLD } from '../src/api/mock/work-orders.ts'
import { ROLE_PERMISSIONS } from '../src/admin/permissions.ts'
import { ValidationError } from '../src/admin/form-error.ts'
import { createAttempts, sendMaintenanceCommand } from '../src/admin/maintenance-commands.ts'
import {
  NEW_LINE, RESTOCK_NOT_ASSIGNEE, RESTOCK_STALE, VARIANCE_REQUIRED, bowls, columnState, columnText, defaultQuantity, describeCompleteError, describeLineLoadError,
  describePlanError, differenceText, leftToLoad, lineInputBody, lineLoadBody, linkedAttention, openGates, reconcile, removedText, restockCompleteBody, restockPath,
  restockStep, shownStep, stepProgress, stepState, suggestionText, updateLineBody, validateLine, varianceField,
} from '../src/admin/restock.ts'

const root = fileURLToPath(new URL('../../../', import.meta.url))
const yaml = readFileSync(`${root}api-contract/api.yaml`, 'utf8').replace(/\r\n/g, '\n')
const id = (prefix, n) => `${prefix}-0000-0000-0000-${String(n).padStart(12, '0')}`
const MACHINE_1 = id('20000000', 1)
const A2 = id('30000000', 2), B1 = id('30000000', 3)
const WO_RESTOCK = id('61000000', 2)
const LINE_A2 = id('63000000', 1), LINE_B1 = id('63000000', 2)
const MIXED = id('40000000', 1), WATERMELON = id('40000000', 2)
const BATCH_MIXED = id('50000000', 1), BATCH_WATERMELON = id('50000000', 2)
const ALERT_EXPIRED_B1 = id('60000000', 3), ALERT_LOW_A2 = id('60000000', 5)
const STAFF = id('11000000', 2)

function setup(search = '') {
  const state = { token: null, clock: Date.parse('2026-12-04T03:00:00Z'), search }
  const fetcher = createMockFetcher(parseSelection('all'), { now: () => state.clock, getSearch: () => state.search })
  configureClient({ baseUrl: '', fetcher, getToken: () => state.token, onUnauthorized: () => {} })
  return { state, fetcher }
}
async function signIn(state, account) {
  state.token = (await authApi.login({ email: MOCK_ACCOUNTS[account], password: MOCK_PASSWORDS[account] })).accessToken
}
async function rejects(promise, status, check) {
  await assert.rejects(promise, error => error instanceof ApiError && error.status === status && (!check || check(error)))
}
/** A command sent and then left to the machine (4 s of mock time). */
async function run(state, operation, slotId, reason) {
  const command = await sendMaintenanceCommand(createAttempts(), MACHINE_1, slotId, operation, { reason, workOrderId: WO_RESTOCK })
  state.clock += 4_000
  return maintenanceCommandsApi.get(command.id)
}
const line = (planned, loaded, extra = {}) => ({ id: `l-${planned}-${loaded}`, slotCode: 'A2', productName: 'Watermelon bowl', plannedQuantity: planned, loadedQuantity: loaded, ...extra })

// ---- contract

test('contract: restock view, lines (POST/PATCH/DELETE), loads, suggestions, restock work orders; permissions per role', () => {
  for (const path of ['/work-orders/{id}/restock', '/work-orders/{id}/restock-lines', '/work-orders/{id}/restock-lines/{lineId}', '/work-orders/{id}/restock-lines/{lineId}/loads', '/machines/{machineId}/restock-suggestions', '/machines/{machineId}/restock-work-orders']) {
    assert.ok(yaml.includes(`"/api/v1${path}":`), path)
  }
  assert.ok(ROLE_PERMISSIONS.STAFF.includes('RESTOCK_EXECUTE'))
  for (const code of ['RESTOCK_PLAN', 'INVENTORY_LOAD_DIRECT']) assert.ok(!ROLE_PERMISSIONS.STAFF.includes(code) && ROLE_PERMISSIONS.ADMIN.includes(code), code)
  assert.equal(restockPath(WO_RESTOCK), `/admin/tickets/${WO_RESTOCK}/restock`)
  assert.equal(MOCK_LOW_STOCK_THRESHOLD, 2)
})

// ---- steps from server data

test('step: not started → start; a running removal → remove, OPEN_REFILL → load, CLOSE_REFILL → close; done when DONE/CANCELLED', () => {
  const lines = [line(4, 0)]
  assert.equal(restockStep({ status: 'ASSIGNED', lines, gatesOpen: 0 }), 'start')
  assert.equal(restockStep({ status: 'OPEN', lines, gatesOpen: 0 }), 'start')
  assert.equal(restockStep({ status: 'IN_PROGRESS', lines, gatesOpen: 0, running: { operation: 'EMPTY_COLUMN' } }), 'remove')
  assert.equal(restockStep({ status: 'IN_PROGRESS', lines, gatesOpen: 0, running: { operation: 'OPEN_REFILL' } }), 'load')
  assert.equal(restockStep({ status: 'IN_PROGRESS', lines, gatesOpen: 1, running: { operation: 'CLOSE_REFILL' } }), 'close')
  assert.equal(restockStep({ status: 'DONE', lines, gatesOpen: 0 }), 'done')
  assert.equal(restockStep({ status: 'CANCELLED', lines, gatesOpen: 1 }), 'done')
})

test('step: gates closed and nothing loaded → remove; a gate open → load, or close once every line is full; loaded and closed → reconcile', () => {
  assert.equal(restockStep({ status: 'IN_PROGRESS', lines: [line(4, 0)], gatesOpen: 0 }), 'remove')
  assert.equal(restockStep({ status: 'IN_PROGRESS', lines: [line(4, 1)], gatesOpen: 1 }), 'load')
  assert.equal(restockStep({ status: 'IN_PROGRESS', lines: [line(4, 4)], gatesOpen: 1 }), 'close')
  assert.equal(restockStep({ status: 'IN_PROGRESS', lines: [line(4, 2)], gatesOpen: 0 }), 'reconcile')
})

test('shown step: free moves between the work steps while IN_PROGRESS; reconcile never with a gate open', () => {
  assert.equal(shownStep('remove', 'load'), 'load')
  assert.equal(shownStep('load', 'reconcile', 1), 'load')
  assert.equal(shownStep('reconcile', 'close', 0), 'close')
  assert.equal(shownStep('start', 'load'), 'start')
  assert.equal(shownStep('done', 'load'), 'done')
  assert.deepEqual(stepProgress('load'), { index: 3, total: 5, label: 'Nạp theo dòng' })
  assert.deepEqual(['start', 'remove', 'load', 'close', 'reconcile'].map(key => stepState(key, 'load')), ['done', 'done', 'current', 'todo', 'todo'])
})

// ---- columns, commands, gates

test('old bowls of a column in words; bowls removed by reason; linked command needing attention; open gates', () => {
  const state = columnState({ occupiedCount: 5, availableCount: 2, expiredCount: 2, reservedCount: 0, headStatus: 'EXPIRED', headExpired: true })
  assert.deepEqual(state, { present: 5, toRemove: 3, reserved: 0, headBlocked: true })
  assert.equal(columnText(state), 'Đang có 5 hộp, 3 hộp hết hạn hoặc nhả lỗi cần rút, hộp ở đáy ngăn đang chặn bán.')
  assert.equal(columnText({ present: 0, toRemove: 0, reserved: 0, headBlocked: false }), 'Ngăn đang trống, không có hộp cũ cần rút.')
  assert.equal(removedText({}), 'Chưa rút hộp nào trong phiếu này.')
  assert.equal(removedText({ EXPIRED: 2, DAMAGED: 1 }), 'Đã rút 3 hộp trong phiếu này (Hộp hết hạn: 2, Hộp dập, hỏng: 1).')
  assert.equal(linkedAttention([{ status: 'COMPLETED', createdAt: '2' }, { status: 'FAILED', createdAt: '1' }]), undefined, 'only the newest matters')
  assert.equal(linkedAttention([{ status: 'NEEDS_RECONCILIATION', createdAt: '2' }])?.status, 'NEEDS_RECONCILIATION')
  assert.deepEqual(openGates([{ id: 'a', refillGateOpen: true }, { id: 'b', refillGateOpen: false }]).map(slot => slot.id), ['a'])
  assert.equal(suggestionText({ slotCode: 'B1', currentProduct: { name: 'Mango' }, suggestedAction: 'EMPTY_THEN_LOAD', suggestedLoadQuantity: 10, expiredCount: 2 }), 'Ngăn B1 · Mango: xả ngăn (2 hộp hết hạn, sắp hết hạn hoặc nhả lỗi) rồi nạp 10 hộp')
  assert.equal(suggestionText({ slotCode: 'A1', suggestedAction: 'NONE' }), 'Ngăn A1 · chưa rõ sản phẩm: không cần nạp')
})

test('quantity: default = rest of the plan capped by free places and batch; load body with acknowledgeExpiryInversion only when confirmed', () => {
  assert.equal(leftToLoad(line(6, 2)), 4)
  assert.equal(leftToLoad(line(2, 5)), 0)
  assert.equal(defaultQuantity(line(6, 0), { free: 4 }), '4')
  assert.equal(defaultQuantity(line(6, 0), { free: 10, declared: 10, loaded: 8 }), '2')
  assert.equal(defaultQuantity(line(6, 6), { free: 10 }), '')
  assert.deepEqual(lineLoadBody('b', '3'), { batchId: 'b', quantity: 3 })
  assert.deepEqual(lineLoadBody('b', '3', {}, true), { batchId: 'b', quantity: 3, acknowledgeExpiryInversion: true })
  assert.throws(() => lineLoadBody('', '0'), error => error instanceof ValidationError && !!error.fieldErrors.batchId && !!error.fieldErrors.quantity)
})

test('reconciliation: per line and total; complete body needs the result note and a reason for each differing line (stored reasons count)', () => {
  const lines = [line(4, 4, { id: 'a' }), line(6, 4, { id: 'b', slotCode: 'B1' }), line(2, 3, { id: 'c', slotCode: 'B2', varianceReason: 'Thêm 1 hộp' })]
  const result = reconcile(lines)
  assert.deepEqual([result.planned, result.loaded, result.difference, result.varianceLines], [12, 11, -1, 2])
  assert.deepEqual(result.rows.map(row => row.text), ['Khớp kế hoạch', 'Thiếu 2 hộp', 'Thừa 1 hộp'])
  assert.equal(differenceText(0), 'Khớp kế hoạch')
  const missing = restockCompleteBody('', result.rows, {})
  assert.ok(missing.errors.resultNote)
  assert.equal(missing.errors[varianceField('b')], VARIANCE_REQUIRED)
  assert.equal(missing.errors[varianceField('c')], undefined, 'a stored reason is enough')
  assert.deepEqual(restockCompleteBody(' Đã nạp ', result.rows, { b: ' Lô mới chỉ còn 4 ', a: 'không gửi' }).body,
    { resultNote: 'Đã nạp', lineVariances: [{ lineId: 'b', reason: 'Lô mới chỉ còn 4' }] })
  assert.deepEqual(restockCompleteBody('Xong', reconcile([line(4, 4, { id: 'a' })]).rows, {}).body, { resultNote: 'Xong' })
})

test('planning lines: client checks (1..capacity), bodies of POST and PATCH (only what changed)', () => {
  assert.deepEqual(validateLine(NEW_LINE), { slotId: 'Chọn ngăn.', productId: 'Chọn sản phẩm.', plannedQuantity: 'Số hộp phải là số nguyên từ 1 trở lên.' })
  assert.match(validateLine({ slotId: 's', productId: 'p', plannedQuantity: '12' }, 10).plannedQuantity, /Tối đa 10 hộp/)
  assert.deepEqual(validateLine({ slotId: 's', productId: 'p', plannedQuantity: '10' }, 10), {})
  assert.deepEqual(lineInputBody({ slotId: 's', productId: 'p', plannedQuantity: ' 4 ' }), { slotId: 's', productId: 'p', plannedQuantity: 4 })
  assert.equal(updateLineBody({ plannedQuantity: 4, productId: 'p' }, { plannedQuantity: '4', productId: 'p' }), undefined)
  assert.deepEqual(updateLineBody({ plannedQuantity: 4, productId: 'p' }, { plannedQuantity: '6', productId: 'q' }), { plannedQuantity: 6, productId: 'q' })
  assert.match(describePlanError(new ApiError(409, 'LINE_ALREADY_LOADED: x')).error.message, /đã có hộp được nạp/)
  assert.equal(describePlanError(new ApiError(409, 'DUPLICATE_LINE: x')).stale, true)
})

test('errors: capacity like FE 4.3, expiry inversion to confirm, wrong batch, stale work order, not the assignee; completion blockers', () => {
  const room = { slotCode: 'A2', free: 3, capacity: 10, batchCode: 'L1' }
  const capacity = describeLineLoadError(new ApiError(409, 'SLOT_CAPACITY_EXCEEDED: x'), 5, room)
  assert.ok(capacity.refresh && capacity.conflict.kind === 'slot' && capacity.error instanceof ValidationError)
  assert.match(describeLineLoadError(new ApiError(409, 'EXPIRY_INVERSION: x'), 5, room).inversion, /Lô L1 hết hạn sớm hơn/)
  assert.ok(describeLineLoadError(new ApiError(409, 'BATCH_PRODUCT_MISMATCH: x'), 5, room).error.fieldErrors.batchId)
  const stale = describeLineLoadError(new ApiError(409, 'WORK_ORDER_NOT_IN_PROGRESS: x'), 5, room)
  assert.equal(stale.error.message, RESTOCK_STALE)
  assert.equal(describeLineLoadError(new ApiError(404, 'x'), 5, room).error.message, RESTOCK_NOT_ASSIGNEE)
  const rows = reconcile([line(4, 2, { id: 'b' })]).rows
  assert.equal(describeCompleteError(new ApiError(409, 'RESTOCK_VARIANCE_REASON_REQUIRED: x'), rows).error.fieldErrors[varianceField('b')], VARIANCE_REQUIRED)
  assert.match(describeCompleteError(new ApiError(409, 'REFILL_GATE_OPEN: x'), rows).error.message, /Đóng cổng nạp/)
  assert.match(describeCompleteError(new ApiError(409, 'MACHINE_COMMAND_IN_PROGRESS: x'), rows).error.message, /lệnh bảo trì chưa xong/)
  assert.equal(bowls(3), '3 hộp')
})

// ---- mock of the real backend

test('Tiêu chí xong (mock): staff carry out the RESTOCK work order end to end; the stock alerts of the filled slots close by themselves', async () => {
  const { state } = setup()
  await signIn(state, 'staff')
  const plan = await restockApi.view(WO_RESTOCK)
  assert.deepEqual(plan.lines.map(row => [row.slotCode, row.productId, row.plannedQuantity, row.loadedQuantity]), [['A2', WATERMELON, 4, 0], ['B1', MIXED, 6, 0]])
  await rejects(restockApi.load(WO_RESTOCK, LINE_A2, { batchId: BATCH_WATERMELON, quantity: 4 }), 409, error => error.message.startsWith('WORK_ORDER_NOT_IN_PROGRESS'))
  const started = await workOrdersApi.start(WO_RESTOCK)
  assert.equal(started.status, 'IN_PROGRESS')
  assert.equal((await machinesApi.get(MACHINE_1)).status, 'MAINTENANCE')

  // Old bowls: the two expired mango bowls of B1 come out with EMPTY_COLUMN linked to the work order.
  const emptied = await run(state, 'EMPTY_COLUMN', B1, 'EXPIRED')
  assert.deepEqual([emptied.status, emptied.removedCount, emptied.workOrderId], ['COMPLETED', 2, WO_RESTOCK])
  assert.deepEqual((await restockApi.view(WO_RESTOCK)).removedByReason, { EXPIRED: 2 })

  // Refill gate of B1 opened, 6 mixed bowls loaded against its line; A2 gets only 3 of its 4 watermelon bowls.
  assert.equal((await run(state, 'OPEN_REFILL', B1)).status, 'COMPLETED')
  await rejects(restockApi.load(WO_RESTOCK, LINE_B1, { batchId: BATCH_WATERMELON, quantity: 6 }), 409, error => error.message.startsWith('BATCH_PRODUCT_MISMATCH'))
  const loaded = await restockApi.load(WO_RESTOCK, LINE_B1, { batchId: BATCH_MIXED, quantity: 6 })
  assert.deepEqual([loaded.loaded, loaded.inventoryItemIds.length, loaded.line.loadedQuantity], [6, 6, 6])
  const history = (await inventoryApi.history({ referenceId: LINE_B1, page: 0, size: 20 })).content
  assert.ok(history.length === 6 && history.every(row => row.type === 'LOAD'))
  await restockApi.load(WO_RESTOCK, LINE_A2, { batchId: BATCH_WATERMELON, quantity: 3 })

  // Completion: the open gate, then the missing reason, are refused; with the gate closed and the reason it is DONE.
  await rejects(workOrdersApi.complete(WO_RESTOCK, { resultNote: 'Đã nạp' }), 409, error => error.message.startsWith('RESTOCK_VARIANCE_REASON_REQUIRED'))
  await rejects(workOrdersApi.complete(WO_RESTOCK, { resultNote: 'Đã nạp', lineVariances: [{ lineId: LINE_A2, reason: 'Thiếu hộp' }] }), 409, error => error.message.startsWith('REFILL_GATE_OPEN'))
  assert.equal((await run(state, 'CLOSE_REFILL', B1)).status, 'COMPLETED')
  const body = restockCompleteBody('Đã xả B1 và nạp đủ, A2 thiếu 1', reconcile((await restockApi.view(WO_RESTOCK)).lines).rows, { [LINE_A2]: 'Lô dưa hấu chỉ mang theo 3 hộp' }).body
  const done = await workOrdersApi.complete(WO_RESTOCK, body)
  assert.deepEqual([done.status, done.restockSummary.loadedTotal, done.restockSummary.varianceLines], ['DONE', 9, 1])
  const view = await restockApi.view(WO_RESTOCK)
  assert.equal(view.lines.find(row => row.id === LINE_A2).varianceReason, 'Lô dưa hấu chỉ mang theo 3 hộp')
  assert.equal(view.maintenanceCommands.length, 3)
  assert.equal((await alertsApi.get(ALERT_LOW_A2)).status, 'RESOLVED', 'linked alert resolved by the completion')
  assert.deepEqual([(await alertsApi.get(ALERT_EXPIRED_B1)).status, (await alertsApi.get(ALERT_EXPIRED_B1)).resolvedBy], ['RESOLVED', 'system'], 'health check after the restock')
  assert.equal((await machinesApi.get(MACHINE_1)).status, 'MAINTENANCE', 'the admin turns the machine back on')
})

test('mock: loads need RESTOCK_EXECUTE and the assignee (or an Admin); capacity, expiry inversion confirmed, batch expired', async () => {
  const { state } = setup()
  await signIn(state, 'admin')
  await workOrdersApi.start(WO_RESTOCK).catch(() => {})
  // The admin is not the assignee but may act for them.
  await signIn(state, 'staff')
  await workOrdersApi.start(WO_RESTOCK)
  await rejects(restockApi.load(WO_RESTOCK, LINE_A2, { batchId: BATCH_WATERMELON, quantity: 5 }), 409, error => error.message.startsWith('SLOT_CAPACITY_EXCEEDED'))
  // A batch expiring before the watermelon bowls already in A2 needs the confirmation.
  await signIn(state, 'admin')
  const early = await batchesApi.create({ batchCode: 'EARLY-01', productId: WATERMELON, manufacturedAt: new Date(state.clock - 3_600_000).toISOString(), expiresAt: new Date(state.clock + 3_600_000).toISOString(), quantity: 5 })
  await rejects(restockApi.load(WO_RESTOCK, LINE_A2, { batchId: early.id, quantity: 1 }), 409, error => error.message.startsWith('EXPIRY_INVERSION'))
  assert.equal((await restockApi.load(WO_RESTOCK, LINE_A2, { batchId: early.id, quantity: 1, acknowledgeExpiryInversion: true })).loaded, 1)
  const soon = await batchesApi.create({ batchCode: 'SOON-01', productId: WATERMELON, manufacturedAt: new Date(state.clock - 3_600_000).toISOString(), expiresAt: new Date(state.clock + 60_000).toISOString(), quantity: 5 })
  await rejects(restockApi.load(WO_RESTOCK, LINE_A2, { batchId: soon.id, quantity: 1 }), 409, error => error.message.startsWith('BATCH_EXPIRED'))
  // Someone else's work order is 404 for staff.
  const other = await workOrdersApi.create({ type: 'RESTOCK', machineId: MACHINE_1, title: 'Khác', assigneeId: id('11000000', 7), restockLines: [{ slotId: A2, productId: WATERMELON, plannedQuantity: 1 }] })
  await signIn(state, 'staff')
  await rejects(restockApi.view(other.id), 404)
})

test('mock: planning (RESTOCK_PLAN): add, change and take out a line while nothing is loaded; duplicates and loaded lines refused', async () => {
  const { state } = setup()
  await signIn(state, 'staff')
  await rejects(restockApi.addLine(WO_RESTOCK, { slotId: A2, productId: MIXED, plannedQuantity: 1 }), 403)
  await signIn(state, 'admin')
  await rejects(restockApi.addLine(WO_RESTOCK, { slotId: A2, productId: WATERMELON, plannedQuantity: 1 }), 409, error => error.message.startsWith('DUPLICATE_LINE'))
  await rejects(restockApi.addLine(WO_RESTOCK, { slotId: id('30000000', 4), productId: MIXED, plannedQuantity: 1 }), 400, error => !!error.fieldErrors.slotId)
  await rejects(restockApi.addLine(WO_RESTOCK, { slotId: A2, productId: MIXED, plannedQuantity: 11 }), 400, error => !!error.fieldErrors.plannedQuantity)
  await rejects(restockApi.addLine(WO_RESTOCK, { slotId: A2, productId: id('40000000', 5), plannedQuantity: 1 }), 409, error => error.message.startsWith('PRODUCT_INACTIVE'))
  const added = await restockApi.addLine(WO_RESTOCK, { slotId: A2, productId: MIXED, plannedQuantity: 2 })
  assert.equal((await restockApi.updateLine(WO_RESTOCK, added.id, { plannedQuantity: 3 })).plannedQuantity, 3)
  await restockApi.removeLine(WO_RESTOCK, added.id)
  assert.equal((await restockApi.view(WO_RESTOCK)).lines.length, 2)
  await signIn(state, 'staff')
  await workOrdersApi.start(WO_RESTOCK)
  await restockApi.load(WO_RESTOCK, LINE_A2, { batchId: BATCH_WATERMELON, quantity: 1 })
  await signIn(state, 'admin')
  await rejects(restockApi.updateLine(WO_RESTOCK, LINE_A2, { plannedQuantity: 1 }), 409, error => error.message.startsWith('LINE_ALREADY_LOADED'))
  await rejects(restockApi.removeLine(WO_RESTOCK, LINE_A2), 409, error => error.message.startsWith('LINE_ALREADY_LOADED'))
})

test('mock: suggestions per slot and a RESTOCK work order from them (lines, stock alerts linked); nothing to restock is 409', async () => {
  const { state } = setup()
  await signIn(state, 'admin')
  const suggestions = await restockApi.suggestions(MACHINE_1)
  const bySlot = Object.fromEntries(suggestions.slots.map(slot => [slot.slotCode, slot]))
  assert.equal(suggestions.lowStockThreshold, 2)
  assert.deepEqual([bySlot.A1.suggestedAction, bySlot.A1.sellableCount], ['NONE', 8])
  assert.deepEqual([bySlot.B1.suggestedAction, bySlot.B1.expiredCount, bySlot.B1.headStatus, bySlot.B1.suggestedLoadQuantity], ['EMPTY_THEN_LOAD', 2, 'EXPIRED', 10])
  assert.deepEqual([bySlot.A2.suggestedAction, bySlot.A2.expiringTodayCount], ['EMPTY_THEN_LOAD', 6], 'watermelon expires today')
  // The seed work order 2 already handles the A2 and B1 alerts: cancel it so the new one links them.
  const seed = await workOrdersApi.get(WO_RESTOCK)
  await workOrdersApi.cancel(WO_RESTOCK, { reason: 'Lập lại từ gợi ý', version: seed.version })
  const created = await restockApi.createFromSuggestions(MACHINE_1, { fromSuggestions: true, assigneeId: STAFF })
  assert.deepEqual([created.type, created.status, created.restockSummary.lines, created.restockSummary.plannedTotal], ['RESTOCK', 'ASSIGNED', 2, 20])
  // B1's expired-bowl alert stays with the maintenance work order 3 that already handles it.
  assert.deepEqual(created.linkedAlerts.map(alert => alert.id), [ALERT_LOW_A2])
  const machine3 = id('20000000', 3)
  await rejects(restockApi.createFromSuggestions(machine3, { fromSuggestions: true }), 409, error => error.message.startsWith('NOTHING_TO_RESTOCK'))
  // A direct load without a work order is ADMIN only.
  await signIn(state, 'staff')
  await rejects(inventoryApi.load({ batchId: BATCH_MIXED, slotId: A2, quantity: 1 }), 403)
  assert.equal((await slotsApi.list(MACHINE_1, { page: 0, size: 5 })).content.every(slot => slot.refillGateOpen === false), true)
})
