// FE 7.2 Thực hiện phiếu nạp hàng (O4): which step a restock is at (from server data only), quantity limits, plan vs
// result, error wording, and the mock of the draft (api-contract/drafts/work-tickets.yaml restock lines): loading and
// removing through the lines, the note rule on completion and the LOW_STOCK alerts closed by the system.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { ApiError, configureClient } from '../src/api/client.ts'
import { alertsApi, authApi, inventoryApi, maintenanceCommandsApi, ticketsApi } from '../src/api/resources.ts'
import { createMockFetcher, groupOf, parseSelection } from '../src/api/mock/fetcher.ts'
import { MOCK_ACCOUNTS, MOCK_PASSWORDS } from '../src/api/mock/seed.ts'
import { ValidationError } from '../src/admin/form-error.ts'
import { breadcrumbFor, matchRoute } from '../src/admin/routes.ts'
import { ticketActionError } from '../src/admin/tickets.ts'
import {
  NOTE_REQUIRED, RESTOCK_STALE, defaultQuantity, describeCompleteError, describeLineLoadError, describeLineRemoveError, differenceText,
  hasRestockLines, lineLoadBody, lineQuantityProblem, lineRemoveBody, reconcile, refillSince, removalPlan, resolvedText, restockCompleteBody,
  restockPath, restockStep, shownStep, stepProgress, stepState,
} from '../src/admin/restock.ts'

const root = fileURLToPath(new URL('../../../', import.meta.url))
const id = (prefix, n) => `${prefix}-0000-0000-0000-${String(n).padStart(12, '0')}`
const T2 = id('61000000', 2)
const LINE_A2 = id('63000000', 1)
const LINE_B1 = id('63000000', 2)
const LOW_STOCK_A2 = id('60000000', 5)
const MACHINE_1 = id('20000000', 1)
const SLOT_B1 = id('30000000', 3)
const BATCH_MIXED = id('50000000', 1)
const BATCH_WATERMELON = id('50000000', 2)
const START = '2026-12-04T03:00:00.000Z'

const line = (fields = {}) => ({ id: 'l1', slotId: 's1', slotCode: 'A2', productId: 'p', productName: 'Watermelon bowl', plannedQuantity: 4, loadedQuantity: 0, removedQuantity: 0, ...fields })
const command = (type, status, createdAt, fields = {}) => ({ id: `${type}-${createdAt}`, commandCode: 'M-1', machineId: 'm', type, status, createdAt, updatedAt: createdAt, completedAt: status === 'SUCCESS' ? createdAt : null, requestedById: 'u', ...fields })
const at = minutes => new Date(Date.parse(START) + minutes * 60_000).toISOString()
const step = (fields = {}) => restockStep({ status: 'IN_PROGRESS', startedAt: START, lines: [line()], commands: [], expiredLeft: 0, ...fields })

// ---- contract and route

test('draft: restock lines, reconciliation, resolvedAlertIds and the two line endpoints; never a delete', () => {
  const yaml = readFileSync(`${root}api-contract/drafts/work-tickets.yaml`, 'utf8')
  for (const text of ['/restock-lines/{lineId}/load:', '/restock-lines/{lineId}/remove:', 'RestockLineResponse:', 'RestockReconciliation:', 'LoadRestockLineRequest:', 'RemoveRestockItemRequest:', 'resolvedAlertIds:', 'plannedQuantity:', 'loadedQuantity:', 'removedQuantity:', 'noteRequired:']) {
    assert.ok(yaml.includes(text), text)
  }
  assert.match(yaml, /resolvedByName = "Hệ thống"/)
  assert.doesNotMatch(yaml, /\n\s+delete:/)
  assert.equal(groupOf(`/work-tickets/${T2}/restock-lines/${LINE_A2}/load`), 'tickets')
  const route = matchRoute(`/admin/tickets/${T2}/restock`)
  assert.equal(route.page, 'ticket-restock')
  assert.equal(route.id, T2)
  assert.equal(route.permission, 'TICKET_READ')
  assert.deepEqual(breadcrumbFor(route).map(crumb => crumb.label), ['Vận hành', 'Phiếu công việc', 'Thực hiện nạp hàng'])
  assert.equal(restockPath(T2), `/admin/tickets/${T2}/restock`)
  assert.equal(hasRestockLines({ type: 'RESTOCK', restockLines: [line()] }), true)
  assert.equal(hasRestockLines({ type: 'RESTOCK', restockLines: [] }), false)
  assert.equal(hasRestockLines({ type: 'MAINTENANCE' }), false)
})

// ---- step from server data

test('step: open until the ticket is started and OPEN_REFILL succeeded after the start (also while it runs)', () => {
  assert.equal(step({ status: 'ASSIGNED', startedAt: null }), 'open')
  assert.equal(step({ commands: [] }), 'open')
  assert.equal(step({ commands: undefined }), 'open')
  assert.equal(step({ commands: [command('OPEN_REFILL', 'SENT', at(1))] }), 'open')
  // A door opened before this ticket started does not count; a failed attempt neither.
  assert.equal(step({ commands: [command('OPEN_REFILL', 'SUCCESS', at(-5))] }), 'open')
  assert.equal(step({ commands: [command('OPEN_REFILL', 'TIMEOUT', at(1))] }), 'open')
  // A CLOSE alone (someone else) is not "done".
  assert.equal(step({ commands: [command('CLOSE_REFILL', 'SUCCESS', at(2))] }), 'open')
})

test('step: door open → remove while expired bowls are left (or unknown) and nothing is loaded; then load; all full → close', () => {
  const opened = [command('OPEN_REFILL', 'SUCCESS', at(1))]
  assert.equal(step({ commands: opened, expiredLeft: 2 }), 'remove')
  assert.equal(step({ commands: opened, expiredLeft: undefined }), 'remove')
  assert.equal(step({ commands: opened, expiredLeft: 0 }), 'load')
  // Once loading started, expired bowls left do not pull the person back (they may go back themselves).
  assert.equal(step({ commands: opened, expiredLeft: 1, lines: [line({ loadedQuantity: 2 })] }), 'load')
  assert.equal(step({ commands: opened, lines: [line({ loadedQuantity: 4 }), line({ id: 'l2', loadedQuantity: 7, plannedQuantity: 6 })] }), 'close')
  assert.equal(step({ commands: [command('CLOSE_REFILL', 'ACKNOWLEDGED', at(9)), ...opened] }), 'close')
})

test('step: CLOSE_REFILL succeeded after this ticket opened → reconcile; reopened → back to load; closed tickets → done', () => {
  const opened = command('OPEN_REFILL', 'SUCCESS', at(1))
  const closed = command('CLOSE_REFILL', 'SUCCESS', at(9))
  assert.equal(step({ commands: [closed, opened] }), 'reconcile')
  assert.equal(step({ commands: [command('OPEN_REFILL', 'SUCCESS', at(12)), closed, opened], lines: [line({ loadedQuantity: 1 })] }), 'load')
  assert.equal(step({ status: 'COMPLETED' }), 'done')
  assert.equal(step({ status: 'CANCELLED' }), 'done')
  assert.deepEqual(refillSince([closed, opened], START), { state: 'closed', at: at(9) })
  assert.deepEqual(refillSince([opened], START), { state: 'open', at: at(1) })
  assert.deepEqual(refillSince([opened], null), { state: 'none' })
  // No maintenance commands on the server (BE 4.2 missing): the door is handled by hand, the restock goes on.
  assert.equal(step({ commands: undefined, doorByHand: true, expiredLeft: 0 }), 'load')
})

test('shown step: free moves between the door-open steps only; reconcile by choice only when the door is handled by hand', () => {
  assert.equal(shownStep('load', 'remove'), 'remove')
  assert.equal(shownStep('remove', 'close'), 'close')
  assert.equal(shownStep('load', 'reconcile'), 'load')
  assert.equal(shownStep('load', 'reconcile', true), 'reconcile')
  assert.equal(shownStep('reconcile', 'load'), 'reconcile')
  assert.equal(shownStep('open', 'load'), 'open')
  assert.equal(shownStep('done', 'load'), 'done')
  assert.equal(shownStep('load', null), 'load')
  assert.deepEqual(stepProgress('load'), { index: 3, total: 5, label: 'Nạp theo dòng' })
  assert.deepEqual(stepProgress('done'), { index: 5, total: 5, label: 'Đã xong' })
  assert.deepEqual(['open', 'remove', 'load', 'close', 'reconcile'].map(key => stepState(key, 'load')), ['done', 'done', 'current', 'todo', 'todo'])
  assert.equal(stepState('reconcile', 'done'), 'done')
})

// ---- bowls, quantities, reconciliation

test('removal plan: expired (stored or past expiry) first in dispense order, sellable ones apart, held ones locked', () => {
  const now = Date.parse(START)
  const item = (n, status, expiresAt, loadedAt) => ({ id: `i${n}`, status, expiresAt, loadedAt, batchCode: 'B' })
  const plan = removalPlan([
    item(1, 'AVAILABLE', at(-60), at(-200)),
    item(2, 'EXPIRED', at(-60), at(-300)),
    item(3, 'AVAILABLE', at(600), at(-100)),
    item(4, 'RESERVED', at(600), at(-400)),
    item(5, 'SOLD', at(-60), at(-500)),
  ], now)
  assert.deepEqual(plan.expired.map(entry => entry.id), ['i2', 'i1'])
  assert.deepEqual(plan.others.map(entry => entry.id), ['i3'])
  assert.equal(plan.locked, 1)
  assert.deepEqual(lineRemoveBody('i1', '  Hộp hết hạn '), { inventoryItemId: 'i1', reason: 'Hộp hết hạn' })
  assert.throws(() => lineRemoveBody('i1', ' '), error => error instanceof ValidationError && !!error.fieldErrors.reason)
})

test('quantity: default = rest of the plan capped by free places and batch; problems use the FE 4.3 wording', () => {
  assert.equal(defaultQuantity(line(), { free: 10 }), '4')
  assert.equal(defaultQuantity(line(), { free: 3 }), '3')
  assert.equal(defaultQuantity(line(), { free: 10, declared: 20, loaded: 18 }), '2')
  assert.equal(defaultQuantity(line({ loadedQuantity: 4 }), { free: 10 }), '')
  assert.equal(defaultQuantity(line(), { free: 0 }), '')
  assert.match(lineQuantityProblem('5', { slotCode: 'A2', free: 4 }), /^Ngăn A2 chỉ còn trống 4 chỗ\. Nhập tối đa 4 hộp/)
  assert.match(lineQuantityProblem('1.5', {}), /không dùng dấu chấm/)
  assert.equal(lineQuantityProblem('4', { free: 4 }), '')
  // Body: exactly batchId and an integer quantity; problems under the fields.
  assert.deepEqual(lineLoadBody('b1', ' 4 ', { free: 4 }), { batchId: 'b1', quantity: 4 })
  assert.throws(() => lineLoadBody('', '5', { free: 4 }), error => error instanceof ValidationError && !!error.fieldErrors.batchId && /chỉ còn trống 4/.test(error.fieldErrors.quantity))
  assert.throws(() => lineLoadBody('b1', '0'), error => error instanceof ValidationError && !!error.fieldErrors.quantity)
})

test('reconciliation: per line and total difference in words; a note is required when any line differs', () => {
  const result = reconcile([line({ loadedQuantity: 4, removedQuantity: 1 }), line({ id: 'l2', slotCode: 'B1', plannedQuantity: 6, loadedQuantity: 5, removedQuantity: 2 })])
  assert.deepEqual(result.rows.map(row => [row.slotCode, row.difference, row.text]), [['A2', 0, 'Khớp kế hoạch'], ['B1', -1, 'Thiếu 1 hộp']])
  assert.deepEqual([result.planned, result.loaded, result.removed, result.difference, result.noteRequired], [10, 9, 3, -1, true])
  assert.equal(differenceText(2), 'Thừa 2 hộp')
  // Lines that compensate each other still need a note.
  assert.equal(reconcile([line({ loadedQuantity: 5 }), line({ id: 'l2', loadedQuantity: 3 })]).noteRequired, true)
  assert.equal(reconcile([line({ loadedQuantity: 4 })]).noteRequired, false)
  assert.deepEqual(restockCompleteBody('  ', true), { error: NOTE_REQUIRED })
  assert.deepEqual(restockCompleteBody('  ', false), { body: {} })
  assert.deepEqual(restockCompleteBody(' Lô chỉ còn 5 hộp ', true), { body: { note: 'Lô chỉ còn 5 hộp' } })
  assert.match(restockCompleteBody('x'.repeat(501), false).error, /Tối đa 500/)
  assert.equal(resolvedText(1), 'Đã tự đóng 1 cảnh báo Ngăn sắp hết hàng của máy này.')
  assert.match(resolvedText(0), /^Không có cảnh báo/)
})

test('errors: capacity 409 explained like FE 4.3, stale ticket, not the assignee, note rule in Vietnamese', () => {
  const capacity = describeLineLoadError(new ApiError(409, 'Số hộp vượt quá sức chứa còn lại của ngăn.'), 5, { slotCode: 'A2', free: 4 })
  assert.equal(capacity.refresh, true)
  assert.deepEqual(capacity.conflict, { kind: 'slot', quantity: 5 })
  assert.match(capacity.error.fieldErrors.quantity, /^Ngăn A2 không còn đủ chỗ cho 5 hộp/)
  assert.equal(describeLineLoadError(new ApiError(409, 'Slot capacity exceeded'), 5, {}).conflict.kind, 'slot')
  const stale = describeLineLoadError(new ApiError(409, 'Ticket is not IN_PROGRESS'), 1, {})
  assert.equal(stale.stale, true)
  assert.equal(stale.error.message, RESTOCK_STALE)
  assert.ok(describeLineLoadError(new ApiError(409, 'Batch product does not match the restock line'), 1, {}).error.fieldErrors.batchId)
  assert.equal(describeLineLoadError(new ApiError(403, 'Only the assignee can do this'), 1, {}).error.status, 403)
  assert.equal(describeLineRemoveError(new ApiError(400, 'x', { inventoryItemId: 'Item is not in the slot of this restock line' })).stale, true)
  assert.equal(describeLineRemoveError(new ApiError(409, 'Chỉ gỡ được hộp đang sẵn sàng hoặc đã hết hạn.')).stale, true)
  assert.equal(describeCompleteError(new ApiError(400, 'x', { note: 'must not be blank when loaded differs from planned' })).fieldErrors.note, NOTE_REQUIRED)
  // The plain "Hoàn tất" of the detail page explains the same rule.
  assert.match(ticketActionError(new ApiError(400, 'x', { note: 'must not be blank when loaded differs from planned' }), 'complete').fieldErrors.note, /khác kế hoạch/)
})

// ---- mock of the draft

function setup() {
  const state = { token: null, clock: Date.parse(START), search: '' }
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
/** Sends a door command and lets the machine finish it (the mock answers after dispenseMs = 4 s). */
async function door(state, type) {
  const sent = await maintenanceCommandsApi.create(MACHINE_1, { type })
  state.clock += 5_000
  const done = (await maintenanceCommandsApi.list(MACHINE_1, { page: 0, size: 10 })).content.find(entry => entry.id === sent.id)
  assert.equal(done.status, 'SUCCESS')
  return done
}

test('Tiêu chí xong (mock): staff carries out the RESTOCK ticket end to end; LOW_STOCK of the filled slot closes by itself', async () => {
  const { state, fetcher } = setup()
  await signIn(state, 'staff')
  const seeded = await ticketsApi.get(T2)
  assert.equal(seeded.type, 'RESTOCK')
  assert.equal(seeded.status, 'ASSIGNED')
  assert.deepEqual(seeded.restockLines.map(entry => [entry.id, entry.slotCode, entry.plannedQuantity, entry.batchId]), [[LINE_A2, 'A2', 4, BATCH_WATERMELON], [LINE_B1, 'B1', 6, BATCH_MIXED]])
  assert.deepEqual(seeded.reconciliation, { plannedQuantity: 10, loadedQuantity: 0, removedQuantity: 0, difference: -10, noteRequired: true })
  assert.equal(restockStep({ status: seeded.status, startedAt: seeded.startedAt, lines: seeded.restockLines, commands: [], expiredLeft: 0 }), 'open')
  // Not started: the lines refuse work.
  await rejects(ticketsApi.loadLine(T2, LINE_A2, { batchId: BATCH_WATERMELON, quantity: 1 }), 409, error => error.message === 'Ticket is not IN_PROGRESS')

  const started = await ticketsApi.start(T2)
  // The machine is ACTIVE: the door cannot be opened until an administrator puts it in MAINTENANCE.
  await rejects(maintenanceCommandsApi.create(MACHINE_1, { type: 'OPEN_REFILL' }), 409, error => error.message === 'Machine is not in MAINTENANCE')
  fetcher.control.setMachineStatus('DEV-MACHINE-01', 'MAINTENANCE')
  await door(state, 'OPEN_REFILL')
  let commands = (await maintenanceCommandsApi.list(MACHINE_1, { page: 0, size: 10 })).content

  // Step 2: B1 holds two expired mango bowls; staff takes them out by hand and records them through the ticket.
  const b1 = (await inventoryApi.list({ machineId: MACHINE_1, slotId: SLOT_B1, page: 0, size: 100 })).content
  const plan = removalPlan(b1, state.clock)
  assert.equal(plan.expired.length, 2)
  assert.equal(restockStep({ status: 'IN_PROGRESS', startedAt: started.startedAt, lines: seeded.restockLines, commands, expiredLeft: 2 }), 'remove')
  await rejects(ticketsApi.removeItem(T2, LINE_A2, { inventoryItemId: plan.expired[0].id, reason: 'Hộp hết hạn' }), 400, error => !!error.fieldErrors.inventoryItemId)
  await rejects(ticketsApi.removeItem(T2, LINE_B1, { inventoryItemId: plan.expired[0].id, reason: 'x', extra: 1 }), 400, error => !!error.fieldErrors.extra)
  for (const item of plan.expired) await ticketsApi.removeItem(T2, LINE_B1, { inventoryItemId: item.id, reason: 'Hộp hết hạn' })
  const removed = await inventoryApi.history({ referenceId: T2, type: 'REMOVE', page: 0, size: 20 })
  assert.equal(removed.totalElements, 2)
  assert.ok(removed.content.every(row => row.reason === 'Hộp hết hạn' && row.statusAfter === 'REMOVED'))

  // Step 3: A2 has 4 free places: 4 fit, a fifth is refused with the 4.3 capacity message.
  let ticket = await ticketsApi.loadLine(T2, LINE_A2, { batchId: BATCH_WATERMELON, quantity: 4 })
  assert.equal(ticket.restockLines[0].loadedQuantity, 4)
  await rejects(ticketsApi.loadLine(T2, LINE_A2, { batchId: BATCH_WATERMELON, quantity: 1 }), 409, error => describeLineLoadError(error, 1, { slotCode: 'A2', free: 0 }).conflict?.kind === 'slot')
  await rejects(ticketsApi.loadLine(T2, LINE_B1, { batchId: BATCH_WATERMELON, quantity: 1 }), 409, error => error.message === 'Batch product does not match the restock line')
  await rejects(ticketsApi.loadLine(T2, LINE_B1, { batchId: BATCH_MIXED, quantity: 0 }), 400, error => !!error.fieldErrors.quantity)
  ticket = await ticketsApi.loadLine(T2, LINE_B1, { batchId: BATCH_MIXED, quantity: 5 })
  assert.deepEqual(ticket.reconciliation, { plannedQuantity: 10, loadedQuantity: 9, removedQuantity: 2, difference: -1, noteRequired: true })
  const loads = await inventoryApi.history({ referenceId: T2, type: 'LOAD', page: 0, size: 20 })
  assert.equal(loads.totalElements, 9)

  // Step 4 and 5: close the door, then reconcile: B1 is one short, so a note is required.
  await door(state, 'CLOSE_REFILL')
  commands = (await maintenanceCommandsApi.list(MACHINE_1, { page: 0, size: 10 })).content
  assert.equal(restockStep({ status: 'IN_PROGRESS', startedAt: started.startedAt, lines: ticket.restockLines, commands, expiredLeft: 0 }), 'reconcile')
  await rejects(ticketsApi.complete(T2, {}), 400, error => /differs from planned/.test(error.fieldErrors.note))
  const done = await ticketsApi.complete(T2, { note: 'Lô trộn chỉ mang theo 5 hộp.' })
  assert.equal(done.status, 'COMPLETED')
  assert.deepEqual(done.resolvedAlertIds, [LOW_STOCK_A2])
  const alert = await alertsApi.get(LOW_STOCK_A2)
  assert.equal(alert.status, 'RESOLVED')
  assert.equal(alert.resolvedById, null)
  assert.equal(alert.resolvedByName, 'Hệ thống')
  assert.match(alert.resolutionNote, /^Tự đóng khi hoàn tất phiếu nạp hàng “Nạp thêm hộp ngăn A2 · máy DEV-MACHINE-01”: đã nạp 4 hộp vào ngăn A2\.$/)
  // Closed ticket: lines are read-only.
  await rejects(ticketsApi.loadLine(T2, LINE_B1, { batchId: BATCH_MIXED, quantity: 1 }), 409)
})

test('mock: a slot loaded short keeps its LOW_STOCK open; only the assignee (with INVENTORY_WRITE) works on the lines', async () => {
  const { state } = setup()
  await signIn(state, 'staff')
  await ticketsApi.start(T2)
  await ticketsApi.loadLine(T2, LINE_A2, { batchId: BATCH_WATERMELON, quantity: 3 })
  const done = await ticketsApi.complete(T2, { note: 'A2 thiếu 1 hộp, B1 chưa nạp.' })
  assert.deepEqual(done.resolvedAlertIds, [])
  assert.equal((await alertsApi.get(LOW_STOCK_A2)).status, 'OPEN')

  await signIn(state, 'admin')
  await rejects(ticketsApi.loadLine(id('61000000', 6), LINE_A2, { batchId: BATCH_WATERMELON, quantity: 1 }), 403)
  await rejects(ticketsApi.loadLine(T2, id('63000000', 99), { batchId: BATCH_WATERMELON, quantity: 1 }), 403)
})

test('mock: the plain completion of a restock ticket without loading needs a note and closes nothing (FE 7.1 path)', async () => {
  const { state } = setup()
  await signIn(state, 'staff')
  await ticketsApi.start(T2)
  await rejects(ticketsApi.complete(T2, {}), 400)
  assert.deepEqual((await ticketsApi.complete(T2, { note: 'Đã nạp 6 hộp vào ngăn A2' })).resolvedAlertIds, [])
  assert.equal((await alertsApi.get(LOW_STOCK_A2)).status, 'OPEN')
})
