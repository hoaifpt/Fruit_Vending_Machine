// FE 7.4 Điều khiển bảo trì máy: pure rules of src/admin/maintenance-commands.ts (when the buttons are locked and why,
// what a slot command would take out, request bodies limited to the draft fields, error text) and the mock of the draft
// contract api-contract/drafts/machine-maintenance.yaml (PENDING → SENT → ACKNOWLEDGED → SUCCESS over time, failures,
// timeout, bowls REMOVED with a REMOVE transaction, 400/404/409).
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { ApiError, configureClient } from '../src/api/client.ts'
import { authApi, inventoryApi, machinesApi, maintenanceCommandsApi, telemetryApi } from '../src/api/resources.ts'
import { createMockFetcher, groupOf, parseSelection } from '../src/api/mock/fetcher.ts'
import { MOCK_ACCOUNTS, MOCK_PASSWORDS } from '../src/api/mock/seed.ts'
import { STATUS_CATALOG } from '../src/lib/status.ts'
import { DRAFT_PERMISSIONS, can } from '../src/admin/permissions.ts'
import {
  COMMAND_INFO, MAINTENANCE_COMMAND_TYPES, MAINTENANCE_MISSING, MAINTENANCE_TARGET_GONE, NOT_MAINTENANCE_NEXT_ADMIN, NOT_MAINTENANCE_NEXT_STAFF, SLOT_COMMANDS,
  commandDetail, describeMaintenanceError, failureText, isMaintenanceMissing, machineLock, maintenanceAvailability, maintenanceCommandBody,
  needsRefresh, refillState, runningCommand, sendMaintenanceCommand, slotPlan, validateCommand,
} from '../src/admin/maintenance-commands.ts'

const root = fileURLToPath(new URL('../../../', import.meta.url))
const yaml = readFileSync(`${root}api-contract/drafts/machine-maintenance.yaml`, 'utf8')
const id = (prefix, n) => `${prefix}-0000-0000-0000-${String(n).padStart(12, '0')}`
const MACHINE_1 = id('20000000', 1)
const MACHINE_2 = id('20000000', 2)
const M1_A1 = id('30000000', 1)
const M1_B1 = id('30000000', 3)
const M2_A1 = id('30000000', 4)
const M2_A2 = id('30000000', 5)

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
const latest = async (machineId = MACHINE_1) => (await maintenanceCommandsApi.list(machineId, { page: 0, size: 1 })).content[0]

// ---- contract and vocabulary

test('draft: five command types, dispense-command statuses, paths, permission, nothing deleted', () => {
  assert.ok(yaml.includes(`enum: [${MAINTENANCE_COMMAND_TYPES.join(', ')}]`))
  assert.deepEqual([...MAINTENANCE_COMMAND_TYPES], ['OPEN_REFILL', 'CLOSE_REFILL', 'REMOVE_ITEM', 'EMPTY_COLUMN', 'RESET'])
  assert.ok(yaml.includes(`enum: [${Object.keys(STATUS_CATALOG.dispense).join(', ')}]`), 'same life cycle as a dispense command')
  assert.ok(yaml.includes('/api/v1/machines/{machineId}/maintenance-commands:'))
  assert.ok(yaml.includes('x-required-permission: MACHINE_MAINTENANCE') && yaml.includes('x-required-permission: MACHINE_READ'))
  assert.doesNotMatch(yaml, /\n\s+delete:/)
  assert.deepEqual([...SLOT_COMMANDS], ['REMOVE_ITEM', 'EMPTY_COLUMN'])
  for (const type of MAINTENANCE_COMMAND_TYPES) assert.ok(COMMAND_INFO[type].label && COMMAND_INFO[type].does.length > 40, type)
  assert.equal(COMMAND_INFO.EMPTY_COLUMN.confirm, true, 'EMPTY_COLUMN cần xác nhận')
  assert.equal(COMMAND_INFO.EMPTY_COLUMN.danger, true)
  assert.equal(COMMAND_INFO.RESET.confirm, true)
  assert.equal(COMMAND_INFO.OPEN_REFILL.confirm, false)
  assert.equal(groupOf(`/machines/${MACHINE_1}/maintenance-commands`), 'maintenance-commands')
})

test('draft permission MACHINE_MAINTENANCE: ADMIN and STAFF send commands', () => {
  assert.ok(DRAFT_PERMISSIONS.includes('MACHINE_MAINTENANCE'))
  assert.equal(can(['ADMIN'], 'MACHINE_MAINTENANCE'), true)
  assert.equal(can(['STAFF'], 'MACHINE_MAINTENANCE'), true)
  // Once GET /auth/me lists permissions, an account without it has the buttons locked.
  assert.equal(can({ roles: ['STAFF'], permissions: ['MACHINE_READ'] }, 'MACHINE_MAINTENANCE'), false)
})

// ---- done criterion: locked with a reason when the machine is not MAINTENANCE

test('Tiêu chí xong: nút khóa kèm lý do khi máy không MAINTENANCE (và hướng dẫn theo vai trò)', () => {
  const base = { canMaintain: true, canChangeStatus: true, machineStatus: 'MAINTENANCE', connection: 'ONLINE' }
  assert.equal(machineLock(base), null, 'MAINTENANCE + online: buttons open')
  for (const status of ['ACTIVE', 'INACTIVE']) {
    const admin = machineLock({ ...base, machineStatus: status })
    assert.equal(admin.code, 'status')
    assert.match(admin.reason, new RegExp(`Máy đang ở trạng thái ${STATUS_CATALOG.machine[status].label}\\.`))
    assert.match(admin.reason, /chỉ gửi được khi máy ở trạng thái Bảo trì/)
    assert.equal(admin.next, NOT_MAINTENANCE_NEXT_ADMIN)
    assert.equal(machineLock({ ...base, machineStatus: status, canChangeStatus: false }).next, NOT_MAINTENANCE_NEXT_STAFF)
  }
  assert.match(NOT_MAINTENANCE_NEXT_ADMIN, /Chuyển sang Bảo trì/)
  assert.match(NOT_MAINTENANCE_NEXT_STAFF, /Nhờ Quản trị viên/)
})

test('lock order: missing API, permission, status, OFFLINE (never connected), running command; UNKNOWN never locks', () => {
  const base = { canMaintain: true, canChangeStatus: false, machineStatus: 'MAINTENANCE', connection: 'ONLINE' }
  const running = { type: 'EMPTY_COLUMN', status: 'SENT', createdAt: '2026-12-08T06:05:00Z' }
  assert.equal(machineLock({ ...base, missing: true, canMaintain: false, machineStatus: 'ACTIVE' }).code, 'missing')
  assert.equal(machineLock({ ...base, canMaintain: false, machineStatus: 'ACTIVE' }).code, 'permission')
  assert.equal(machineLock({ ...base, machineStatus: 'ACTIVE', connection: 'OFFLINE' }).code, 'status')
  const offline = machineLock({ ...base, connection: 'OFFLINE', running })
  assert.equal(offline.code, 'offline')
  assert.match(offline.reason, /OFFLINE/)
  assert.match(offline.next, /nguồn điện và Wi-Fi/)
  assert.match(machineLock({ ...base, connection: 'OFFLINE', neverConnected: true }).reason, /chưa từng kết nối/)
  const busy = machineLock({ ...base, running })
  assert.equal(busy.code, 'running')
  assert.match(busy.reason, /“Rút hết hộp trong ngăn” gửi lúc 08\/12\/2026 13:05 xong \(đã gửi\)/)
  assert.equal(machineLock({ ...base, connection: 'UNKNOWN' }), null)
  assert.equal(runningCommand([{ status: 'SUCCESS' }, { status: 'ACKNOWLEDGED', id: 'x' }])?.id, 'x')
  assert.equal(runningCommand([{ status: 'FAILED' }, { status: 'TIMEOUT' }]), undefined)
})

test('slot plan: how many bowls a slot command takes out, or why it cannot', () => {
  const summary = patch => ({ occupiedCount: 5, availableCount: 3, expiredCount: 2, reservedCount: 0, headStatus: 'AVAILABLE', ...patch })
  assert.deepEqual(slotPlan('EMPTY_COLUMN', summary()), { count: 5 })
  assert.deepEqual(slotPlan('REMOVE_ITEM', summary()), { count: 1 })
  assert.deepEqual(slotPlan('REMOVE_ITEM', summary({ headStatus: 'EXPIRED' })), { count: 1 })
  assert.match(slotPlan('REMOVE_ITEM', summary({ occupiedCount: 0, availableCount: 0, expiredCount: 0, headStatus: null })).blocked, /trống/)
  assert.match(slotPlan('REMOVE_ITEM', summary({ headStatus: 'RESERVED', reservedCount: 1, occupiedCount: 6 })).blocked, /đang được giữ cho một đơn/)
  assert.match(slotPlan('REMOVE_ITEM', summary({ headStatus: 'DISPENSE_FAILED', occupiedCount: 6 })).blocked, /nhả hàng thất bại/)
  assert.match(slotPlan('EMPTY_COLUMN', summary({ reservedCount: 1, occupiedCount: 6 })).blocked, /Ngăn có 1 hộp đang được giữ/)
  assert.match(slotPlan('EMPTY_COLUMN', summary({ occupiedCount: 7 })).blocked, /Ngăn có 2 hộp nhả hàng thất bại/)
  assert.match(slotPlan('EMPTY_COLUMN', undefined).blocked, /Chọn ngăn/)
})

// ---- body, validation, errors

test('body: only fields of CreateMaintenanceCommandRequest; slotId for slot commands, inventoryItemId for REMOVE_ITEM, reason when not blank', () => {
  const allowed = ['type', 'slotId', 'inventoryItemId', 'reason']
  for (const field of allowed) assert.match(yaml, new RegExp(`\\n        ${field}:`), field)
  const everything = { slotId: M1_A1, inventoryItemId: id('70000000', 1), reason: '  Hộp móp  ' }
  assert.deepEqual(maintenanceCommandBody('OPEN_REFILL', everything), { type: 'OPEN_REFILL', reason: 'Hộp móp' })
  assert.deepEqual(maintenanceCommandBody('CLOSE_REFILL'), { type: 'CLOSE_REFILL' })
  assert.deepEqual(maintenanceCommandBody('RESET', { slotId: M1_A1, reason: '   ' }), { type: 'RESET' })
  assert.deepEqual(maintenanceCommandBody('EMPTY_COLUMN', everything), { type: 'EMPTY_COLUMN', slotId: M1_A1, reason: 'Hộp móp' })
  assert.deepEqual(maintenanceCommandBody('REMOVE_ITEM', everything), { type: 'REMOVE_ITEM', slotId: M1_A1, inventoryItemId: id('70000000', 1), reason: 'Hộp móp' })
  for (const type of MAINTENANCE_COMMAND_TYPES) for (const key of Object.keys(maintenanceCommandBody(type, everything))) assert.ok(allowed.includes(key), `${type}.${key}`)
  assert.deepEqual(validateCommand('EMPTY_COLUMN', {}), { slotId: 'Chọn ngăn cần rút hộp.' })
  assert.deepEqual(validateCommand('RESET', { reason: 'x'.repeat(501) }), { reason: 'Tối đa 500 ký tự.' })
  assert.deepEqual(validateCommand('OPEN_REFILL', {}), {})
})

test('errors in Vietnamese with the next step; 404/501 means the backend has no such API yet', () => {
  const text = (status, message) => describeMaintenanceError(new ApiError(status, message)).message
  assert.match(text(409, 'Machine is not in MAINTENANCE'), /không còn ở trạng thái Bảo trì/)
  assert.match(text(409, 'Machine is offline'), /mất kết nối/)
  assert.match(text(409, 'Another maintenance command is still running'), /đang chạy một lệnh bảo trì khác/)
  assert.match(text(409, 'Slot is empty'), /Ngăn đã trống/)
  assert.match(text(409, 'Slot holds reserved or dispense-failed bowls'), /đang giữ cho đơn hoặc nhả hàng thất bại/)
  assert.match(text(409, 'Request conflicts with existing data'), /vừa thay đổi/)
  // The client makes every 404 message generic: on POST it means the machine or slot is gone (sending needs a loaded history).
  assert.equal(text(404, 'Không tìm thấy dữ liệu yêu cầu.'), MAINTENANCE_TARGET_GONE)
  assert.equal(text(501, 'Mock chưa có handler'), MAINTENANCE_MISSING)
  assert.match(text(403, 'Access denied'), /không có quyền gửi lệnh bảo trì/)
  const invalid = describeMaintenanceError(new ApiError(400, 'Validation Failed', { reason: 'size must be between 0 and 500' }))
  assert.deepEqual(invalid.fieldErrors, { reason: 'size must be between 0 and 500' })
  assert.equal(needsRefresh(new ApiError(409, 'x')), true)
  assert.equal(needsRefresh(new ApiError(400, 'x')), false)
  assert.deepEqual([404, 405, 501, 403, 401, 500].map(status => maintenanceAvailability(new ApiError(status, ''))), ['missing', 'missing', 'missing', 'forbidden', 'unauthorized', 'error'])
  assert.equal(isMaintenanceMissing(new TypeError('Failed to fetch')), false)
})

test('history wording: refill door from the last successful open/close, slot and bowls, failure codes', () => {
  assert.deepEqual(refillState([{ type: 'RESET', status: 'SUCCESS' }, { type: 'OPEN_REFILL', status: 'FAILED' }, { type: 'OPEN_REFILL', status: 'SUCCESS', completedAt: 'T' }]), { state: 'open', at: 'T' })
  assert.equal(refillState([{ type: 'CLOSE_REFILL', status: 'SUCCESS', completedAt: 'T' }]).state, 'closed')
  assert.equal(refillState([]).state, 'unknown')
  assert.equal(commandDetail({ slotCode: 'B1', itemCount: 2, removedCount: null, status: 'SENT' }), 'Ngăn B1 · 2 hộp')
  assert.equal(commandDetail({ slotCode: 'B1', itemCount: 2, removedCount: 2, status: 'SUCCESS' }), 'Ngăn B1 · đã rút 2 hộp')
  assert.match(commandDetail({ slotCode: null, itemCount: null, status: 'FAILED', failureCode: 'NOT_IN_FAULT' }), /không ở trạng thái lỗi FAULT/)
  assert.match(failureText('WEIRD_CODE'), /mã WEIRD_CODE/)
  assert.match(failureText(null), /không gửi lý do/)
})

// ---- mock of the draft

test('mock: 409 while the machine is not MAINTENANCE; then PENDING → SENT → ACKNOWLEDGED → SUCCESS over time, one at a time', async () => {
  const { state } = setup()
  await signIn(state, 'staff')
  await rejects(maintenanceCommandsApi.create(MACHINE_1, { type: 'OPEN_REFILL' }), 409, error => error.message === 'Machine is not in MAINTENANCE')
  await signIn(state, 'admin')
  await machinesApi.setStatus(MACHINE_1, 'MAINTENANCE')
  await signIn(state, 'staff')
  const command = await sendMaintenanceCommand(MACHINE_1, 'OPEN_REFILL', { reason: '  Nạp ca sáng ' })
  assert.equal(command.status, 'PENDING')
  assert.match(command.commandCode, /^M-[0-9A-F]{16}$/)
  assert.equal(command.reason, 'Nạp ca sáng')
  assert.equal(command.requestedByName, 'Nhân viên vận hành')
  assert.equal(command.slotId, null)
  await rejects(sendMaintenanceCommand(MACHINE_1, 'CLOSE_REFILL'), 409, error => /đang chạy một lệnh bảo trì khác/.test(error.message))
  state.clock += 1_000
  assert.equal((await latest()).status, 'SENT')
  state.clock += 1_000
  assert.equal((await latest()).status, 'ACKNOWLEDGED')
  state.clock += 2_000
  const done = await latest()
  assert.equal(done.status, 'SUCCESS')
  assert.ok(done.sentAt && done.acknowledgedAt && done.completedAt)
  // Newest first; the seed's history of the machine is still there (never deleted).
  const page = await maintenanceCommandsApi.list(MACHINE_1, { page: 0, size: 20 })
  assert.equal(page.content[0].id, command.id)
  assert.equal(page.totalElements, 4)
})

test('mock: EMPTY_COLUMN takes every bowl out on success (REMOVED + REMOVE history referencing the command); REMOVE_ITEM the head', async () => {
  const { state } = setup()
  await signIn(state, 'admin')
  await machinesApi.setStatus(MACHINE_1, 'MAINTENANCE')
  const empty = await sendMaintenanceCommand(MACHINE_1, 'EMPTY_COLUMN', { slotId: M1_B1 })
  assert.equal(empty.itemCount, 2)
  assert.equal(empty.slotCode, 'B1')
  // Nothing changes before the machine reports success.
  assert.equal((await inventoryApi.list({ slotId: M1_B1, status: 'REMOVED' })).totalElements, 0)
  state.clock += 4_000
  const done = await latest()
  assert.equal(done.status, 'SUCCESS')
  assert.equal(done.removedCount, 2)
  assert.equal((await inventoryApi.list({ slotId: M1_B1, status: 'REMOVED' })).totalElements, 2)
  const removals = await inventoryApi.history({ referenceId: empty.id })
  assert.equal(removals.totalElements, 2)
  assert.ok(removals.content.every(row => row.type === 'REMOVE' && row.statusAfter === 'REMOVED' && /EMPTY_COLUMN/.test(row.reason)))
  await rejects(sendMaintenanceCommand(MACHINE_1, 'EMPTY_COLUMN', { slotId: M1_B1 }), 409, error => /Ngăn đã trống/.test(error.message))

  // REMOVE_ITEM: a stale inventoryItemId is refused; without it the head goes.
  await rejects(maintenanceCommandsApi.create(MACHINE_1, { type: 'REMOVE_ITEM', slotId: M1_A1, inventoryItemId: id('70000000', 2) }), 409, error => error.message === 'Inventory item is not the slot head')
  const remove = await sendMaintenanceCommand(MACHINE_1, 'REMOVE_ITEM', { slotId: M1_A1, reason: 'Hộp móp' })
  assert.equal(remove.inventoryItemId, id('70000000', 1))
  assert.equal(remove.itemCount, 1)
  state.clock += 4_000
  assert.equal((await latest()).removedCount, 1)
  const [row] = (await inventoryApi.history({ inventoryItemId: remove.inventoryItemId })).content
  assert.equal(row.type, 'REMOVE')
  assert.equal(row.reason, 'Hộp móp')
})

test('mock: RESET is refused by a controller not in FAULT; an offline machine gets 409; a FAULT machine back online is reset', async () => {
  const { state, fetcher } = setup()
  await signIn(state, 'admin')
  await machinesApi.setStatus(MACHINE_1, 'MAINTENANCE')
  await sendMaintenanceCommand(MACHINE_1, 'RESET')
  state.clock += 4_000
  const refused = await latest()
  assert.equal(refused.status, 'FAILED')
  assert.equal(refused.failureCode, 'NOT_IN_FAULT')

  // DEV-MACHINE-02: MAINTENANCE but silent for 35 minutes, controller in FAULT.
  await rejects(maintenanceCommandsApi.create(MACHINE_2, { type: 'RESET' }), 409, error => error.message === 'Machine is offline')
  fetcher.control.resumeHeartbeat('DEV-MACHINE-02')
  await rejects(maintenanceCommandsApi.create(MACHINE_2, { type: 'REMOVE_ITEM', slotId: M2_A1 }), 409, error => error.message === 'Slot head cannot be removed')
  await rejects(maintenanceCommandsApi.create(MACHINE_2, { type: 'EMPTY_COLUMN', slotId: M2_A2 }), 409, error => error.message === 'Slot holds reserved or dispense-failed bowls')
  await maintenanceCommandsApi.create(MACHINE_2, { type: 'RESET' })
  state.clock += 4_000
  assert.equal((await latest(MACHINE_2)).status, 'SUCCESS')
  assert.equal((await telemetryApi.heartbeat(MACHINE_2)).dispenseState, 'IDLE')
})

test('mock: a machine that stops answering → TIMEOUT after 60 s; scenario dispense-failed → FAILED (ABORTED); nothing removed', async () => {
  const { state, fetcher } = setup()
  await signIn(state, 'admin')
  await machinesApi.setStatus(MACHINE_1, 'MAINTENANCE')
  await sendMaintenanceCommand(MACHINE_1, 'EMPTY_COLUMN', { slotId: M1_B1 })
  fetcher.control.stopHeartbeat('DEV-MACHINE-01')
  state.clock += 30_000
  assert.equal((await latest()).status, 'SENT')
  state.clock += 31_000
  assert.equal((await latest()).status, 'TIMEOUT')
  assert.equal((await inventoryApi.list({ slotId: M1_B1, status: 'REMOVED' })).totalElements, 0)

  fetcher.control.resumeHeartbeat('DEV-MACHINE-01')
  state.search = '?scenario=dispense-failed'
  await sendMaintenanceCommand(MACHINE_1, 'OPEN_REFILL')
  state.clock += 4_000
  const failed = await latest()
  assert.equal(failed.status, 'FAILED')
  assert.equal(failed.failureCode, 'ABORTED')
})

test('mock: 400 on unknown or misplaced fields, 404 for a slot of another machine, 403 without the permission, missing API scenario', async () => {
  const { state } = setup()
  await signIn(state, 'admin')
  await machinesApi.setStatus(MACHINE_1, 'MAINTENANCE')
  await rejects(maintenanceCommandsApi.create(MACHINE_1, { type: 'OPEN_REFILL', extra: 1 }), 400, error => !!error.fieldErrors.extra)
  await rejects(maintenanceCommandsApi.create(MACHINE_1, { type: 'OPEN_REFILL', slotId: M1_A1 }), 400, error => /must be null/.test(error.fieldErrors.slotId))
  await rejects(maintenanceCommandsApi.create(MACHINE_1, { type: 'EMPTY_COLUMN' }), 400, error => /must not be null/.test(error.fieldErrors.slotId))
  await rejects(maintenanceCommandsApi.create(MACHINE_1, { type: 'RESET', inventoryItemId: id('70000000', 1) }), 400, error => !!error.fieldErrors.inventoryItemId)
  await rejects(maintenanceCommandsApi.create(MACHINE_1, { type: 'DISPENSE' }), 400, error => !!error.fieldErrors.type)
  await rejects(maintenanceCommandsApi.create(MACHINE_1, { type: 'RESET', reason: 'x'.repeat(501) }), 400, error => !!error.fieldErrors.reason)
  await rejects(maintenanceCommandsApi.create(MACHINE_1, { type: 'EMPTY_COLUMN', slotId: M2_A1 }), 404)
  await rejects(sendMaintenanceCommand(MACHINE_1, 'EMPTY_COLUMN', { slotId: M2_A1 }), 404, error => error.message === MAINTENANCE_TARGET_GONE)
  await rejects(maintenanceCommandsApi.create(id('20000000', 99), { type: 'RESET' }), 404)
  // Seed history: DEV-MACHINE-02 has a timed-out RESET, DEV-MACHINE-03 none.
  assert.equal((await latest(MACHINE_2)).status, 'TIMEOUT')
  assert.equal((await maintenanceCommandsApi.list(id('20000000', 3), { page: 0, size: 20 })).totalElements, 0)
  state.search = '?scenario=403:maintenance-commands'
  await rejects(maintenanceCommandsApi.create(MACHINE_1, { type: 'RESET' }), 403)
  state.search = '?scenario=missing:maintenance-commands'
  await assert.rejects(maintenanceCommandsApi.list(MACHINE_1, { page: 0, size: 1 }), error => isMaintenanceMissing(error))
})
