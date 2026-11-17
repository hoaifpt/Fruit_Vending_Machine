// FE 7.4 Điều khiển bảo trì máy on the real API (backend #64, docs/maintenance-commands.md): pure rules of
// src/admin/maintenance-commands.ts (locks and why, what a column command would take out, request bodies limited to
// CreateMaintenanceCommandRequest, Idempotency-Key per click, error text) and the mock that plays the backend
// (PENDING → SENT → ACCEPTED → COMPLETED, ACCEPT_TIMEOUT, NEEDS_RECONCILIATION → RECONCILED, effects on stock and gates).
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { ApiError, configureClient } from '../src/api/client.ts'
import { authApi, inventoryApi, machinesApi, maintenanceCommandsApi, slotsApi } from '../src/api/resources.ts'
import { createMockFetcher, groupOf, parseSelection } from '../src/api/mock/fetcher.ts'
import { MOCK_ACCOUNTS, MOCK_PASSWORDS } from '../src/api/mock/seed.ts'
import { STATUS_CATALOG } from '../src/lib/status.ts'
import { ROLE_PERMISSIONS } from '../src/admin/permissions.ts'
import {
  COLUMN_OPERATIONS, COMMAND_INFO, MAINTENANCE_MISSING, MAINTENANCE_OPERATIONS, MAINTENANCE_TARGET_GONE, NOT_MAINTENANCE_NEXT_ADMIN, NOT_MAINTENANCE_NEXT_STAFF,
  REASONS, commandDetail, createAttempts, describeMaintenanceError, failureText, isMaintenanceMissing, machineLock, maintenanceAvailability,
  maintenanceCommandBody, needsReconciliation, needsRefresh, reconcileBody, retryable, runningCommand, sendMaintenanceCommand, sendReset, slotPlan,
  validateCommand,
} from '../src/admin/maintenance-commands.ts'

const root = fileURLToPath(new URL('../../../', import.meta.url))
const yaml = readFileSync(`${root}api-contract/api.yaml`, 'utf8').replace(/\r\n/g, '\n')
const id = (prefix, n) => `${prefix}-0000-0000-0000-${String(n).padStart(12, '0')}`
const MACHINE_1 = id('20000000', 1)
const MACHINE_2 = id('20000000', 2)
const M1_A1 = id('30000000', 1)
const M1_B1 = id('30000000', 3)
const M2_A1 = id('30000000', 4)
const NEEDS_RECONCILIATION_SEED = id('c7400000', 6)

function setup(search = '') {
  const state = { token: null, clock: Date.parse('2026-12-08T03:00:00Z'), search }
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
let keyN = 0
const key = () => `test-key-${String(++keyN).padStart(4, '0')}`
const latest = async (machineId = MACHINE_1) => (await maintenanceCommandsApi.list({ machineId, page: 0, size: 1 })).content[0]
async function toMaintenance(state, machineId = MACHINE_1) {
  await signIn(state, 'admin')
  await machinesApi.setStatus(machineId, 'MAINTENANCE')
}

// ---- contract and vocabulary

test('contract: five operations, seven statuses, column POST + RESET + reconcile paths, permissions, no delete', () => {
  assert.deepEqual([...MAINTENANCE_OPERATIONS].sort(), ['CLOSE_REFILL', 'EMPTY_COLUMN', 'OPEN_REFILL', 'REMOVE_ITEM', 'RESET'])
  assert.deepEqual([...COLUMN_OPERATIONS], ['OPEN_REFILL', 'CLOSE_REFILL', 'REMOVE_ITEM', 'EMPTY_COLUMN'])
  assert.deepEqual(Object.keys(STATUS_CATALOG.maintenanceCommand), ['PENDING', 'SENT', 'ACCEPTED', 'COMPLETED', 'FAILED', 'NEEDS_RECONCILIATION', 'RECONCILED'])
  assert.deepEqual([...REASONS], ['EXPIRED', 'DAMAGED', 'DISPENSE_FAILED', 'RESTOCK', 'INSPECTION', 'OTHER'])
  for (const path of ['/machines/{machineId}/slots/{slotId}/maintenance-commands', '/machines/{machineId}/reset', '/maintenance-commands', '/maintenance-commands/{id}/reconcile']) assert.ok(yaml.includes(`"/api/v1${path}":`), path)
  assert.ok(yaml.includes('Idempotency-Key'))
  for (const type of MAINTENANCE_OPERATIONS) assert.ok(COMMAND_INFO[type].label && COMMAND_INFO[type].does.length > 40, type)
  assert.equal(COMMAND_INFO.EMPTY_COLUMN.danger, true)
  assert.equal(COMMAND_INFO.OPEN_REFILL.confirm, false)
  for (const code of ['MAINTENANCE_COMMAND_EXECUTE', 'MAINTENANCE_COMMAND_READ']) assert.ok(ROLE_PERMISSIONS.STAFF.includes(code), code)
  assert.ok(!ROLE_PERMISSIONS.STAFF.includes('MACHINE_RESET') && ROLE_PERMISSIONS.ADMIN.includes('MACHINE_RESET'))
  assert.equal(groupOf(`/machines/${MACHINE_1}/slots/${M1_A1}/maintenance-commands`), 'maintenance-commands')
  assert.equal(groupOf(`/machines/${MACHINE_1}/reset`), 'maintenance-commands')
  assert.equal(groupOf('/maintenance-commands'), 'maintenance-commands')
  assert.equal(groupOf(`/machines/${MACHINE_1}/slots`), 'slots')
})

test('Tiêu chí xong: nút khóa kèm lý do khi máy không MAINTENANCE (và hướng dẫn theo vai trò)', () => {
  const base = { canMaintain: true, canChangeStatus: true, machineStatus: 'MAINTENANCE', connection: 'ONLINE' }
  assert.equal(machineLock(base), null)
  for (const status of ['ACTIVE', 'INACTIVE']) {
    const admin = machineLock({ ...base, machineStatus: status })
    assert.equal(admin.code, 'status')
    assert.match(admin.reason, new RegExp(`Máy đang ở trạng thái ${STATUS_CATALOG.machine[status].label}\\.`))
    assert.equal(admin.next, NOT_MAINTENANCE_NEXT_ADMIN)
    assert.equal(machineLock({ ...base, machineStatus: status, canChangeStatus: false }).next, NOT_MAINTENANCE_NEXT_STAFF)
  }
})

test('lock order: missing API, permission, status, OFFLINE (never connected), running command; UNKNOWN never locks', () => {
  const base = { canMaintain: true, canChangeStatus: false, machineStatus: 'MAINTENANCE', connection: 'ONLINE' }
  const running = { operation: 'EMPTY_COLUMN', status: 'SENT', createdAt: '2026-12-08T06:05:00Z' }
  assert.equal(machineLock({ ...base, missing: true, canMaintain: false, machineStatus: 'ACTIVE' }).code, 'missing')
  assert.equal(machineLock({ ...base, canMaintain: false, machineStatus: 'ACTIVE' }).code, 'permission')
  assert.equal(machineLock({ ...base, machineStatus: 'ACTIVE', connection: 'OFFLINE' }).code, 'status')
  assert.equal(machineLock({ ...base, connection: 'OFFLINE', running }).code, 'offline')
  assert.match(machineLock({ ...base, connection: 'OFFLINE', neverConnected: true }).reason, /chưa từng kết nối/)
  const busy = machineLock({ ...base, running })
  assert.equal(busy.code, 'running')
  assert.match(busy.reason, /“Xả cả ngăn” gửi lúc 08\/12\/2026 13:05 xong \(đã gửi\)/)
  assert.equal(machineLock({ ...base, connection: 'UNKNOWN' }), null)
  assert.equal(runningCommand([{ status: 'COMPLETED' }, { status: 'ACCEPTED', id: 'x' }])?.id, 'x')
  assert.equal(runningCommand([{ status: 'FAILED' }, { status: 'NEEDS_RECONCILIATION' }]), undefined)
})

test('slot plan: how many bowls a column command takes out, or why it cannot (gate, reserved, empty)', () => {
  const summary = patch => ({ occupiedCount: 5, reservedCount: 0, headStatus: 'AVAILABLE', ...patch })
  assert.deepEqual(slotPlan('EMPTY_COLUMN', summary()), { count: 5 })
  assert.deepEqual(slotPlan('REMOVE_ITEM', summary()), { count: 1 })
  assert.deepEqual(slotPlan('CLOSE_REFILL', undefined), { count: 0 })
  assert.match(slotPlan('REMOVE_ITEM', summary({ occupiedCount: 0 })).blocked, /trống/)
  assert.match(slotPlan('REMOVE_ITEM', summary(), true).blocked, /Cổng nạp của ngăn đang mở/)
  assert.match(slotPlan('OPEN_REFILL', summary(), true).blocked, /đã mở/)
  assert.match(slotPlan('EMPTY_COLUMN', summary({ reservedCount: 1 })).blocked, /đang được giữ cho đơn/)
  assert.match(slotPlan('EMPTY_COLUMN', undefined).blocked, /Chọn ngăn/)
})

test('body: only CreateMaintenanceCommandRequest fields; reason only for removals, inventoryItemId for REMOVE_ITEM, workOrderId when given', () => {
  const everything = { reason: 'EXPIRED', note: '  móp  ', inventoryItemId: id('70000000', 1), workOrderId: id('61000000', 2) }
  assert.deepEqual(maintenanceCommandBody('OPEN_REFILL', everything), { operation: 'OPEN_REFILL', note: 'móp', workOrderId: id('61000000', 2) })
  assert.deepEqual(maintenanceCommandBody('EMPTY_COLUMN', everything), { operation: 'EMPTY_COLUMN', reason: 'EXPIRED', note: 'móp', workOrderId: id('61000000', 2) })
  assert.deepEqual(maintenanceCommandBody('REMOVE_ITEM', everything), { operation: 'REMOVE_ITEM', reason: 'EXPIRED', note: 'móp', inventoryItemId: id('70000000', 1), workOrderId: id('61000000', 2) })
  assert.deepEqual(maintenanceCommandBody('CLOSE_REFILL'), { operation: 'CLOSE_REFILL' })
  assert.deepEqual(validateCommand('EMPTY_COLUMN', {}), { reason: 'Chọn lý do rút hộp.' })
  assert.deepEqual(validateCommand('REMOVE_ITEM', { reason: 'OTHER' }), { note: 'Ghi rõ lý do khác.' })
  assert.deepEqual(validateCommand('OPEN_REFILL', {}), {})
  assert.deepEqual(reconcileBody('', ''), { errors: { outcome: 'Chọn máy đã làm hay chưa làm.' } })
  assert.deepEqual(reconcileBody('DONE', ' thấy rơi '), { body: { outcome: 'DONE', note: 'thấy rơi' } })
  assert.equal(needsReconciliation({ status: 'NEEDS_RECONCILIATION', operation: 'RESET' }), false)
})

test('Idempotency-Key: one per click, the same key when retrying after a network error or 5xx, forgotten after a success or a refusal', () => {
  const attempts = createAttempts()
  const first = attempts.keyFor('sig')
  assert.match(first, /^[\w-]{8,64}$/)
  attempts.settle('sig', new ApiError(0, 'network'))
  assert.equal(attempts.keyFor('sig'), first, 'retry of the same click')
  attempts.settle('sig', new ApiError(409, 'MACHINE_OFFLINE: x'))
  assert.notEqual(attempts.keyFor('sig'), first, 'a refusal forgets the key')
  attempts.settle('sig')
  assert.equal(attempts.has('sig'), false)
  assert.deepEqual([retryable(new ApiError(0, '')), retryable(new ApiError(502, '')), retryable(new ApiError(409, ''))], [true, true, false])
})

test('errors in Vietnamese by backend code with the next step; 404/501 explained', () => {
  const text = (status, message) => describeMaintenanceError(new ApiError(status, message)).message
  assert.match(text(409, 'MACHINE_NOT_IN_MAINTENANCE: x'), /không còn ở trạng thái Bảo trì/)
  assert.match(text(409, 'MACHINE_OFFLINE: x'), /mất kết nối/)
  assert.match(text(409, 'MACHINE_COMMAND_IN_PROGRESS: x'), /đang chạy một lệnh khác/)
  assert.match(text(409, 'REFILL_GATE_OPEN: x'), /Cổng nạp của ngăn đang mở/)
  assert.match(text(409, 'IDEMPOTENCY_KEY_REUSED: x'), /bấm lại nút/)
  assert.match(text(409, 'NOT_RECONCILABLE: x'), /đã được đối soát/)
  assert.match(text(409, 'Something else'), /vừa thay đổi/)
  assert.equal(text(404, 'x'), MAINTENANCE_TARGET_GONE)
  assert.equal(text(501, 'x'), MAINTENANCE_MISSING)
  assert.deepEqual(describeMaintenanceError(new ApiError(400, 'Validation Failed', { reason: 'must not be null' })).fieldErrors, { reason: 'must not be null' })
  assert.equal(needsRefresh(new ApiError(409, 'x')), true)
  assert.deepEqual([404, 405, 501, 403, 401, 500].map(status => maintenanceAvailability(new ApiError(status, ''))), ['missing', 'missing', 'missing', 'forbidden', 'unauthorized', 'error'])
  assert.equal(isMaintenanceMissing(new TypeError('Failed to fetch')), false)
})

test('history wording: column, target bowl, reason, removed count once applied, failure and reconciliation', () => {
  assert.equal(commandDetail({ slotCode: 'B1', operation: 'EMPTY_COLUMN', reason: 'EXPIRED', removedCount: 2, status: 'COMPLETED' }), 'Ngăn B1 · Hộp hết hạn · đã rút 2 hộp')
  assert.equal(commandDetail({ slotCode: 'A1', operation: 'REMOVE_ITEM', targetItem: { productName: 'Mango', batchCode: 'L1' }, status: 'SENT' }), 'Ngăn A1 · hộp Mango (lô L1)')
  assert.match(commandDetail({ slotCode: null, operation: 'RESET', status: 'FAILED', failureReason: 'ACCEPT_TIMEOUT' }), /30 giây/)
  assert.match(commandDetail({ operation: 'REMOVE_ITEM', status: 'RECONCILED', reconciliationOutcome: 'NOT_DONE' }), /máy chưa làm/)
  assert.match(failureText('ABORTED_BY_USER'), /dừng giữa chừng/)
  assert.match(failureText('WEIRD'), /mã WEIRD/)
})

// ---- mock of the real backend

test('mock: 409 MACHINE_NOT_IN_MAINTENANCE; then PENDING → SENT → ACCEPTED → COMPLETED over time; the same key answers the same command', async () => {
  const { state } = setup()
  await signIn(state, 'staff')
  const attempts = createAttempts()
  await rejects(sendMaintenanceCommand(attempts, MACHINE_1, M1_A1, 'OPEN_REFILL'), 409, error => /không còn ở trạng thái Bảo trì/.test(error.message))
  await toMaintenance(state)
  await signIn(state, 'staff')
  await rejects(maintenanceCommandsApi.create(MACHINE_1, M1_A1, { operation: 'OPEN_REFILL' }, 'short'), 400)
  const k = key()
  const sent = await maintenanceCommandsApi.create(MACHINE_1, M1_A1, { operation: 'OPEN_REFILL' }, k)
  assert.deepEqual([sent.status, sent.operation, sent.slotCode, sent.requestedBy.fullName], ['PENDING', 'OPEN_REFILL', 'A1', 'Nhân viên vận hành'])
  assert.equal((await maintenanceCommandsApi.create(MACHINE_1, M1_A1, { operation: 'OPEN_REFILL' }, k)).id, sent.id, 'same key + same body → the same command')
  await rejects(maintenanceCommandsApi.create(MACHINE_1, M1_A1, { operation: 'CLOSE_REFILL' }, k), 409, error => error.message.startsWith('IDEMPOTENCY_KEY_REUSED'))
  await rejects(maintenanceCommandsApi.create(MACHINE_1, M1_B1, { operation: 'OPEN_REFILL' }, key()), 409, error => error.message.startsWith('MACHINE_COMMAND_IN_PROGRESS'))
  state.clock += 1_000; assert.equal((await latest()).status, 'SENT')
  state.clock += 1_000; assert.equal((await latest()).status, 'ACCEPTED')
  state.clock += 2_000
  const done = await maintenanceCommandsApi.get(sent.id)
  assert.equal(done.status, 'COMPLETED')
  assert.equal((await slotsApi.list(MACHINE_1, { page: 0, size: 10 })).content.find(slot => slot.id === M1_A1).refillGateOpen, true)
  await rejects(maintenanceCommandsApi.create(MACHINE_1, M1_A1, { operation: 'REMOVE_ITEM', reason: 'EXPIRED' }, key()), 409, error => error.message.startsWith('REFILL_GATE_OPEN'))
})

test('mock: EMPTY_COLUMN takes every bowl out on COMPLETED (REMOVED + REMOVE history referencing the command); REMOVE_ITEM only the head', async () => {
  const { state } = setup()
  await toMaintenance(state)
  await signIn(state, 'staff')
  await rejects(maintenanceCommandsApi.create(MACHINE_1, M1_B1, { operation: 'EMPTY_COLUMN' }, key()), 400, error => !!error.fieldErrors.reason)
  const empty = await maintenanceCommandsApi.create(MACHINE_1, M1_B1, { operation: 'EMPTY_COLUMN', reason: 'EXPIRED' }, key())
  state.clock += 4_000
  const done = await maintenanceCommandsApi.get(empty.id)
  assert.deepEqual([done.status, done.removedCount], ['COMPLETED', 2])
  const removed = (await inventoryApi.list({ slotId: M1_B1, status: 'REMOVED', page: 0, size: 20 })).content
  assert.equal(removed.length, 2)
  const history = (await inventoryApi.history({ referenceId: empty.id, page: 0, size: 20 })).content
  assert.ok(history.length === 2 && history.every(row => row.type === 'REMOVE'))
  const head = (await inventoryApi.list({ slotId: M1_A1, status: 'AVAILABLE', sort: 'loadedAt,asc', page: 0, size: 1 })).content[0]
  await rejects(maintenanceCommandsApi.create(MACHINE_1, M1_A1, { operation: 'REMOVE_ITEM', reason: 'DAMAGED', inventoryItemId: id('70000000', 2) }, key()), 409, error => error.message.startsWith('NOT_HEAD_ITEM'))
  const one = await maintenanceCommandsApi.create(MACHINE_1, M1_A1, { operation: 'REMOVE_ITEM', reason: 'DAMAGED', inventoryItemId: head.id }, key())
  assert.equal(one.targetItem.inventoryItemId, head.id)
  state.clock += 4_000
  assert.equal((await maintenanceCommandsApi.get(one.id)).removedCount, 1)
})

test('mock: a silent machine → FAILED ACCEPT_TIMEOUT; dispense-failed → NEEDS_RECONCILIATION, reconciled once (DONE applies the effect)', async () => {
  const { state, fetcher } = setup()
  await toMaintenance(state)
  await signIn(state, 'staff')
  fetcher.control.stopHeartbeat('DEV-MACHINE-01')
  const silent = await maintenanceCommandsApi.create(MACHINE_1, M1_A1, { operation: 'OPEN_REFILL' }, key())
  state.clock += 31_000
  assert.deepEqual([(await maintenanceCommandsApi.get(silent.id)).status, (await maintenanceCommandsApi.get(silent.id)).failureReason], ['FAILED', 'ACCEPT_TIMEOUT'])
  fetcher.control.resumeHeartbeat('DEV-MACHINE-01')
  state.search = '?scenario=dispense-failed'
  const empty = await maintenanceCommandsApi.create(MACHINE_1, M1_B1, { operation: 'EMPTY_COLUMN', reason: 'RESTOCK' }, key())
  state.clock += 4_000
  assert.equal((await maintenanceCommandsApi.get(empty.id)).status, 'NEEDS_RECONCILIATION')
  assert.equal((await inventoryApi.list({ slotId: M1_B1, status: 'REMOVED', page: 0, size: 5 })).totalElements, 0, 'nothing changed before the reconciliation')
  state.search = ''
  const reconciled = await maintenanceCommandsApi.reconcile(empty.id, { outcome: 'DONE', note: 'Thấy ngăn trống' })
  assert.deepEqual([reconciled.status, reconciled.reconciliationOutcome, reconciled.removedCount], ['RECONCILED', 'DONE', 2])
  await rejects(maintenanceCommandsApi.reconcile(empty.id, { outcome: 'NOT_DONE' }), 409, error => error.message.startsWith('NOT_RECONCILABLE'))
})

test('mock: RESET needs MACHINE_RESET; offline machine 409; seed has a command waiting for reconciliation; filters of the list', async () => {
  const { state } = setup()
  await signIn(state, 'staff')
  await rejects(maintenanceCommandsApi.reset(MACHINE_2, {}, key()), 403)
  await rejects(sendReset(createAttempts(), MACHINE_1), 403)
  const waiting = await maintenanceCommandsApi.get(NEEDS_RECONCILIATION_SEED)
  assert.deepEqual([waiting.status, waiting.operation, waiting.failureReason], ['NEEDS_RECONCILIATION', 'REMOVE_ITEM', 'COMPLETE_TIMEOUT'])
  const failed = await maintenanceCommandsApi.list({ machineId: MACHINE_2, status: 'NEEDS_RECONCILIATION', page: 0, size: 10 })
  assert.deepEqual(failed.content.map(row => row.id), [NEEDS_RECONCILIATION_SEED])
  await rejects(maintenanceCommandsApi.list({ operation: 'DISPENSE', page: 0, size: 10 }), 400)
  await signIn(state, 'admin')
  await rejects(maintenanceCommandsApi.reset(MACHINE_2, {}, key()), 409, error => error.message.startsWith('MACHINE_OFFLINE'))
  await rejects(maintenanceCommandsApi.create(MACHINE_2, M2_A1, { operation: 'OPEN_REFILL' }, key()), 409, error => error.message.startsWith('MACHINE_OFFLINE'))
  await rejects(maintenanceCommandsApi.create(MACHINE_1, M2_A1, { operation: 'OPEN_REFILL' }, key()), 404)
  await rejects(maintenanceCommandsApi.create(MACHINE_1, M1_A1, { operation: 'RESET' }, key()), 400, error => !!error.fieldErrors.operation)
})
