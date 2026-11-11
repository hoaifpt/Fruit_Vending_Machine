import test from 'node:test'
import assert from 'node:assert/strict'
import { ApiError, configureClient } from '../src/api/client.ts'
import { authApi, inventoryApi, ordersApi } from '../src/api/resources.ts'
import { createMockFetcher, parseSelection } from '../src/api/mock/fetcher.ts'
import { MOCK_ACCOUNTS, MOCK_PASSWORDS } from '../src/api/mock/seed.ts'
import {
  BLOCKED_LABEL, ITEM_STATUSES, LIST_SORT, REMOVE_GONE, REMOVE_LOCKED, REMOVE_STALE, RESERVED_LOCKED, blockedText, boxDescription, boxStatusText, buildColumns, canRemove, columnLabel, columnSaleText,
  compareDispenseOrder, describeRemoveError, headLabel, headState, instantKey, isExpiredBox, loadMachineMap, lockedNextStep, mapColumns, mapOverview,
  listApiQuery, listFilterCount, listRemoveState, overviewText, readListQuery, readMapQuery, settleLimited,
} from '../src/admin/inventory-map.ts'

const MACHINE = '20000000-0000-0000-0000-000000000001'
const slot = (id, slotCode, capacity = 5, status = 'ACTIVE') => ({ id, machineId: MACHINE, slotCode, capacity, status, createdAt: '', updatedAt: '' })
let seq = 0
const box = (slotId, patch = {}) => {
  seq += 1
  return { id: `70000000-0000-0000-0000-${String(seq).padStart(12, '0')}`, slotId, machineId: MACHINE, status: 'AVAILABLE', expired: false, productName: 'Mango bowl', batchCode: 'B-1', expiresAt: '2026-11-20T01:00:00Z', loadedAt: `2026-11-10T0${seq % 10}:00:00Z`, ...patch }
}

test('URL: map is the default view; ids that are not UUIDs are dropped; a slot needs its machine', () => {
  assert.deepEqual(readMapQuery(new URLSearchParams('')), { view: 'map', machineId: '', slotId: '' })
  assert.deepEqual(readMapQuery(new URLSearchParams(`view=list&machineId=${MACHINE}`)), { view: 'list', machineId: MACHINE, slotId: '' })
  assert.equal(readMapQuery(new URLSearchParams('view=grid')).view, 'map')
  assert.equal(readMapQuery(new URLSearchParams('machineId=abc')).machineId, '')
  assert.equal(readMapQuery(new URLSearchParams(`slotId=${MACHINE}`)).slotId, '', 'slot without machine')
})

test('list URL: only what GET /inventory accepts is sent; the rest is listed as ignored', () => {
  const SLOT = '30000000-0000-0000-0000-000000000001', BATCH = '50000000-0000-0000-0000-000000000001'
  const clean = readListQuery(new URLSearchParams(`view=list&machineId=${MACHINE}&slotId=${SLOT}&batchId=${BATCH}&status=EXPIRED&expired=true&sort=updatedAt,desc`))
  assert.deepEqual(clean.query, { machineId: MACHINE, slotId: SLOT, batchId: BATCH, status: 'EXPIRED', expired: 'true', sort: 'updatedAt,desc' })
  assert.deepEqual(clean.ignored, [])
  assert.equal(listFilterCount(clean.query), 5)
  assert.deepEqual(listApiQuery(clean.query, 2, 20), { page: 2, size: 20, sort: 'updatedAt,desc', machineId: MACHINE, slotId: SLOT, batchId: BATCH, status: 'EXPIRED', expired: true })

  const none = readListQuery(new URLSearchParams('view=list'))
  assert.deepEqual(none.query, { machineId: '', slotId: '', batchId: '', status: '', expired: '', sort: LIST_SORT.fallback })
  assert.deepEqual(listApiQuery(none.query, 0, 20), { page: 0, size: 20, sort: 'loadedAt,desc', machineId: undefined, slotId: undefined, batchId: undefined, status: undefined, expired: undefined })

  const junk = readListQuery(new URLSearchParams('machineId=abc&slotId=x&batchId=1&status=LOST&expired=yes&sort=password,asc'))
  assert.deepEqual(junk.query, none.query, 'nothing invalid reaches the API')
  assert.deepEqual(junk.ignored.map(item => item.key), ['machineId', 'slotId', 'batchId', 'status', 'expired', 'sort'])
  assert.equal(listFilterCount(junk.query), 0)
  const lone = readListQuery(new URLSearchParams(`slotId=${SLOT}&expired=false`))
  assert.deepEqual([lone.query.slotId, lone.query.expired, lone.ignored.map(item => item.key)], ['', 'false', ['slotId']])
  assert.match(lone.ignored[0].reason, /chọn máy/)
  assert.equal(listApiQuery(lone.query, 0, 20).expired, false)
  assert.equal(readListQuery(new URLSearchParams('sort=status,sideways')).query.sort, LIST_SORT.fallback)
  for (const status of ITEM_STATUSES) assert.equal(readListQuery(new URLSearchParams(`status=${status}`)).query.status, status)
})

test('list "Rút hộp": open for AVAILABLE/EXPIRED, locked with a reason while held or failed, absent once out of the slot', () => {
  assert.deepEqual(listRemoveState(box('s')), { kind: 'ok' })
  assert.deepEqual(listRemoveState(box('s', { status: 'EXPIRED' })), { kind: 'ok' })
  assert.deepEqual(listRemoveState(box('s', { status: 'DISPENSE_FAILED' })), { kind: 'locked', reason: REMOVE_LOCKED })
  assert.deepEqual(listRemoveState(box('s', { status: 'RESERVED' })), { kind: 'locked', reason: RESERVED_LOCKED })
  assert.deepEqual(listRemoveState(box('s', { status: 'SOLD' })), { kind: 'hidden' })
  assert.deepEqual(listRemoveState(box('s', { status: 'REMOVED' })), { kind: 'hidden' })
})

test('dispense order: earliest loadedAt first, id breaks ties', () => {
  const a = { id: 'b', loadedAt: '2026-11-10T01:00:00Z' }, b = { id: 'a', loadedAt: '2026-11-10T01:00:00Z' }, c = { id: 'c', loadedAt: '2026-11-09T01:00:00Z' }
  assert.deepEqual([a, b, c].sort(compareDispenseOrder).map(item => item.id), ['c', 'a', 'b'])
})

test('dispense order compares real instants: fractions of any length, any offset; ids by code unit', () => {
  const at = (id, loadedAt) => ({ id, loadedAt })
  // .5 s is later than .499999999 s and earlier than .500000001 s, whatever the number of digits sent.
  const rows = [at('x', '2026-11-10T01:00:00.500000001Z'), at('y', '2026-11-10T01:00:00.5Z'), at('z', '2026-11-10T01:00:00.499999999Z'), at('w', '2026-11-10T01:00:00Z')]
  assert.deepEqual(rows.sort(compareDispenseOrder).map(row => row.id), ['w', 'z', 'y', 'x'])
  assert.equal(compareDispenseOrder(at('a', '2026-11-10T01:00:00.50Z'), at('b', '2026-11-10T01:00:00.500000Z')), -1, 'same instant: id decides')
  assert.equal(compareDispenseOrder(at('a', '2026-11-10T08:00:00+07:00'), at('b', '2026-11-10T00:59:59.9Z')), 1, 'offsets are honoured')
  assert.deepEqual(instantKey('2026-11-10T01:00:00.123Z'), [Date.parse('2026-11-10T01:00:00Z'), '123000000'])
  assert.equal(instantKey('nonsense')[0], Number.POSITIVE_INFINITY, 'unparsable sorts last')
  // Upper-case before lower-case and digits before letters, as plain `<` does (no locale rules).
  assert.equal(compareDispenseOrder(at('B', '2026-11-10T01:00:00Z'), at('a', '2026-11-10T01:00:00Z')), -1)
})

test('head state: ready, held, blocked by expiry (removable) or by a failed dispense (not removable), empty', () => {
  assert.deepEqual(headState(undefined), { kind: 'empty' })
  assert.deepEqual(headState(box('s')), { kind: 'ready' })
  assert.deepEqual(headState(box('s', { status: 'RESERVED' })), { kind: 'reserved' })
  assert.deepEqual(headState(box('s', { status: 'RESERVED', expired: true })), { kind: 'reserved' }, 'held box cannot be removed (409) until its order ends')
  assert.deepEqual(headState(box('s', { expired: true })), { kind: 'blocked', reason: 'expired', removable: true }, 'AVAILABLE with an expired batch')
  assert.deepEqual(headState(box('s', { status: 'EXPIRED' })), { kind: 'blocked', reason: 'expired', removable: true })
  assert.deepEqual(headState(box('s', { status: 'DISPENSE_FAILED' })), { kind: 'blocked', reason: 'dispenseFailed', removable: false })
  assert.equal(canRemove(box('s', { status: 'DISPENSE_FAILED' })), false, 'one switch: REMOVABLE_STATUSES')
  assert.equal(canRemove(box('s', { status: 'EXPIRED' })), true)
  assert.equal(isExpiredBox(box('s', { status: 'EXPIRED', expired: false })), true)
})

test('columns: only present boxes, head first, sorted per slot; blocked head when the bottom box is expired', () => {
  const slots = [slot('s1', 'A1', 5), slot('s2', 'A2', 3)]
  const items = [
    box('s1', { loadedAt: '2026-11-10T03:00:00Z' }),
    box('s1', { loadedAt: '2026-11-10T01:00:00Z', expired: true, batchCode: 'OLD' }),
    box('s1', { loadedAt: '2026-11-10T00:00:00Z', status: 'SOLD' }),
    box('s1', { loadedAt: '2026-11-09T00:00:00Z', status: 'REMOVED' }),
    box('s2', { loadedAt: '2026-11-10T02:00:00Z' }),
    box('other', {}),
  ]
  const [a1, a2] = buildColumns(slots, items)
  assert.equal(a1.occupied, 2, 'SOLD/REMOVED no longer in the column')
  assert.equal(a1.head.batchCode, 'OLD')
  assert.deepEqual(a1.state, { kind: 'blocked', reason: 'expired', removable: true })
  assert.equal(a1.free, 3)
  assert.equal(a1.emptyCells, 3)
  assert.equal(a2.state.kind, 'ready')
  assert.equal(columnSaleText(a1), 'Không bán: hộp đáy đã hết hạn nên chặn cả ngăn.')
  assert.equal(columnSaleText(a2), 'Đang bán: hộp đáy được bán tiếp theo.')
  assert.equal(blockedText(a1.state, a1.occupied - 1), 'Hộp đã hết hạn, máy không bán hộp nào của ngăn. 1 hộp phía trên chỉ bán được sau khi rút hộp này.')
  assert.match(boxDescription(a1.head, 1, a1), /^Vị trí 1 \(đáy\), Mango bowl, lô OLD, hạn dùng 20\/11\/2026 08:00, hết hạn, đang chặn ngăn$/)
  assert.equal(columnLabel(a2), 'Ngăn A2: 1/3 hộp. Đang bán: hộp đáy được bán tiếp theo.')
  assert.equal(BLOCKED_LABEL, 'Đang chặn ngăn')
})

test('columns: a failed dispense at the bottom blocks; boxes behind a held head wait; inactive slot and empty slot', () => {
  const slots = [slot('f', 'B1'), slot('r', 'B2'), slot('e', 'B3'), slot('x', 'B4', 4, 'INACTIVE')]
  const items = [
    box('f', { loadedAt: '2026-11-10T01:00:00Z', status: 'DISPENSE_FAILED' }), box('f', { loadedAt: '2026-11-10T02:00:00Z' }),
    box('r', { loadedAt: '2026-11-10T01:00:00Z', status: 'RESERVED' }), box('r', { loadedAt: '2026-11-10T02:00:00Z' }),
    box('x', {}),
  ]
  const [failed, held, empty, inactive] = buildColumns(slots, items)
  assert.deepEqual(failed.state, { kind: 'blocked', reason: 'dispenseFailed', removable: false })
  assert.equal(columnSaleText(failed), 'Không bán: hộp đáy nhả hàng thất bại nên chặn cả ngăn.')
  assert.equal(blockedText(failed.state, 0), 'Máy không nhả được hộp này.')
  assert.equal(blockedText(failed.state, 1), 'Máy không nhả được hộp này. 1 hộp phía trên phải chờ hộp này được xử lý xong.', 'not "after removing it": it cannot be removed here')
  assert.equal(lockedNextStep(false), 'Kiểm tra ngăn tại máy, xem đơn liên quan và báo quản trị viên.')
  assert.doesNotMatch(lockedNextStep(true), /báo quản trị viên/)
  assert.equal(held.state.kind, 'reserved')
  assert.equal(boxStatusText(held.head), 'Đang giữ')
  assert.equal(empty.state.kind, 'empty')
  assert.equal(columnSaleText(empty), 'Ngăn trống, cần nạp hộp.')
  assert.equal(columnSaleText(inactive), 'Không bán: ngăn đang ngừng hoạt động.')
  assert.deepEqual(mapOverview([failed, held, empty, inactive]), { slots: 4, selling: 0, idle: 0, reserved: 1, blocked: 1, empty: 1, inactive: 1 })
})

test('columns: tall slots draw at most N cells; over-capacity never shows negative free places', () => {
  const slots = [slot('big', 'C1', 40), slot('over', 'C2', 2)]
  const items = [...Array.from({ length: 20 }, (_, n) => box('big', { loadedAt: `2026-11-10T00:${String(n).padStart(2, '0')}:00Z` })), box('over'), box('over'), box('over')]
  const [big, over] = buildColumns(slots, items, {}, { maxCells: 12 })
  assert.equal(big.visibleBoxes.length, 11, 'one cell becomes "+N hộp"')
  assert.equal(big.hiddenBoxes, 9)
  assert.equal(big.visibleBoxes[0], big.head, 'the head is always drawn')
  assert.equal(big.emptyCells, 0)
  assert.equal(big.hiddenFree, 20)
  assert.equal(over.free, 0)
  assert.equal(over.emptyCells, 0)
  const [small] = buildColumns([slot('s', 'D1', 30)], [box('s')], {}, { maxCells: 12 })
  assert.equal(small.emptyCells, 11)
  assert.equal(small.hiddenFree, 18)
})

test('a ready head sells only with the machine and the slot ACTIVE and something sellable for the server', () => {
  const slots = [slot('s1', 'A1'), slot('s2', 'A2')]
  const items = [box('s1'), box('s2')]
  const [maintenance] = buildColumns(slots, items, {}, { machineStatus: 'MAINTENANCE' })
  assert.equal(maintenance.selling, false)
  assert.equal(columnSaleText(maintenance), 'Không bán: máy đang bảo trì; hộp đáy còn hạn, bán lại khi máy hoạt động.')
  assert.equal(headLabel(maintenance), 'Hộp đáy · chưa bán')
  assert.match(boxDescription(maintenance.head, 1, maintenance), /^Vị trí 1 \(đáy\), /)
  const [, noneSellable] = buildColumns(slots, items, { s2: { ok: true, summary: { occupiedCount: 1, headStatus: 'AVAILABLE', sellableCount: 0 } } }, { machineStatus: 'ACTIVE' })
  assert.equal(noneSellable.selling, false)
  assert.doesNotMatch(columnSaleText(noneSellable), /Đang bán/)
  const active = buildColumns(slots, items, {}, { machineStatus: 'ACTIVE' })
  assert.equal(headLabel(active[0]), 'Hộp đáy · bán tiếp theo')
  assert.deepEqual(mapOverview([maintenance, noneSellable, active[0]]), { slots: 3, selling: 1, idle: 2, reserved: 0, blocked: 0, empty: 0, inactive: 0 })
  assert.equal(overviewText(mapOverview([maintenance, active[0]])), '2 ngăn · 1 đang bán · 1 sẵn sàng nhưng chưa bán · 0 đang chặn · 0 đang giữ · 0 trống')
})

test('remove errors: 409/404 become Vietnamese and ask for a reload; others pass through', () => {
  assert.deepEqual([describeRemoveError(new ApiError(409, 'Inventory item is not removable')).error.message, describeRemoveError(new ApiError(409, 'x')).stale], [REMOVE_STALE, true])
  assert.equal(describeRemoveError(new ApiError(404, 'Inventory item not found')).error.message, REMOVE_GONE)
  const server = new ApiError(500, 'boom')
  assert.deepEqual(describeRemoveError(server), { error: server, stale: false })
})

test('summaries run at most N at a time and keep their order; failures stay per item', async () => {
  let running = 0, peak = 0
  const results = await settleLimited([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 3, async n => {
    running += 1; peak = Math.max(peak, running)
    await new Promise(resolve => setTimeout(resolve, 5 + (n % 3)))
    running -= 1
    if (n === 4) throw new Error('four')
    return n * 10
  })
  assert.equal(peak, 3)
  assert.deepEqual(results.map(result => result.status === 'fulfilled' ? result.value : result.reason.message), [10, 20, 30, 'four', 50, 60, 70, 80, 90, 100])
  assert.deepEqual(await settleLimited([], 6, async () => 1), [])
})

test('summary: failure marks the column only; disagreement with the box list is flagged', () => {
  const slots = [slot('s1', 'A1'), slot('s2', 'A2')]
  const items = [box('s1', { status: 'EXPIRED' }), box('s2')]
  const summaries = {
    s1: { ok: true, summary: { occupiedCount: 1, headStatus: 'EXPIRED', headExpired: true, sellableCount: 0 } },
    s2: { ok: false, error: new Error('500') },
  }
  const [a1, a2] = buildColumns(slots, items, summaries)
  assert.equal(a1.outOfSync, false)
  assert.equal(a1.summary.sellableCount, 0)
  assert.equal(a2.summaryFailed, true)
  const [changed] = buildColumns(slots, items, { s1: { ok: true, summary: { occupiedCount: 2, headStatus: 'EXPIRED' } } })
  assert.equal(changed.outOfSync, true)
  const [emptyOk] = buildColumns([slot('e', 'E1')], [], { e: { ok: true, summary: { occupiedCount: 0, headStatus: null } } })
  assert.equal(emptyOk.outOfSync, false)
})

test('loadMachineMap on the mock: expired head blocks B1, failed dispense and held heads on the maintenance machine', async () => {
  let token = null
  const fetcher = createMockFetcher(parseSelection('all'), { getSearch: () => '', now: () => Date.now(), realFetch: async () => { throw new Error('no network') } })
  configureClient({ baseUrl: '', fetcher, getToken: () => token, onUnauthorized: () => {} })
  token = (await authApi.login({ email: MOCK_ACCOUNTS.staff, password: MOCK_PASSWORDS.staff })).accessToken

  const map = await loadMachineMap(MACHINE)
  assert.equal(map.incomplete, false)
  const columns = mapColumns(map)
  assert.deepEqual(columns.map(column => [column.slot.slotCode, column.occupied, column.state.kind]), [['A1', 8, 'ready'], ['A2', 6, 'ready'], ['B1', 2, 'blocked']])
  assert.ok(columns.every(column => !column.outOfSync && !column.summaryFailed), 'summary head agrees with the box list')
  const b1 = columns[2]
  assert.deepEqual(b1.state, { kind: 'blocked', reason: 'expired', removable: true })

  // Removing the expired head: the next box is expired too, so B1 stays blocked with one box.
  await inventoryApi.remove(b1.head.id, 'Hộp hết hạn')
  const reloaded = await loadMachineMap(MACHINE)
  const after = mapColumns(reloaded)
  assert.equal(after[2].occupied, 1)
  assert.equal(after[2].state.kind, 'blocked')

  const maintenance = await loadMachineMap('20000000-0000-0000-0000-000000000002')
  const [m1, m2] = mapColumns(maintenance)
  assert.deepEqual(m1.state, { kind: 'blocked', reason: 'dispenseFailed', removable: false })
  assert.equal(m1.summary.headStatus, 'DISPENSE_FAILED')
  assert.equal(m2.state.kind, 'reserved')
  // Their history matches (FE 4.4): RESERVE then ADJUSTMENT to DISPENSE_FAILED; RESERVE for the held box.
  const failedHistory = await inventoryApi.history({ inventoryItemId: m1.head.id })
  assert.deepEqual(failedHistory.content.map(row => [row.type, row.statusBefore ?? null, row.statusAfter]), [['ADJUSTMENT', 'RESERVED', 'DISPENSE_FAILED'], ['RESERVE', 'AVAILABLE', 'RESERVED'], ['LOAD', null, 'AVAILABLE']])
  assert.deepEqual((await inventoryApi.history({ inventoryItemId: m2.head.id })).content.map(row => row.type), ['RESERVE', 'LOAD'])
  // Their orders exist (history "Mở đơn hàng" opens them): a failed dispense and a paid order still holding A2's box.
  const failedOrder = await ordersApi.get(failedHistory.content[0].referenceId)
  assert.equal(failedOrder.status, 'DISPENSE_FAILED')
  assert.equal(failedOrder.machineId, '20000000-0000-0000-0000-000000000002')
  assert.equal(failedOrder.items[0].allocations[0].inventoryItemId, m1.head.id)
  assert.equal(failedHistory.content[0].reason, 'DISPENSE_TIMEOUT')
  const heldRef = (await inventoryApi.history({ inventoryItemId: m2.head.id })).content[0].referenceId
  const heldOrder = await ordersApi.get(heldRef)
  assert.equal(heldOrder.status, 'PAID')
  assert.equal(heldOrder.items[0].allocations[0].status, 'RESERVED')
  assert.equal(heldOrder.items[0].allocations[0].inventoryItemId, m2.head.id)
  // RESERVE and LOAD rows carry no reason, like the backend.
  assert.ok(failedHistory.content.filter(row => row.type !== 'ADJUSTMENT').every(row => row.reason == null))
  // The remove API refuses the failed dispense, as the locked button says.
  await assert.rejects(inventoryApi.remove(m1.head.id, 'Thử'), error => error.status === 409)

  await assert.rejects(loadMachineMap('20000000-0000-0000-0000-0000000000ff'), error => error.status === 404)
})
