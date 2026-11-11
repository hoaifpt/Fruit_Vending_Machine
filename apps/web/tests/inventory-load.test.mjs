// FE 4.3 load / remove Sheets: limits shown before sending, checks as typed, request bodies limited to the contract,
// and Vietnamese wording of backend refusals under the right field (backend English and mock Vietnamese messages).
import test from 'node:test'
import assert from 'node:assert/strict'
import { ApiError, configureClient } from '../src/api/client.ts'
import { authApi, inventoryApi } from '../src/api/resources.ts'
import { createMockFetcher, parseSelection } from '../src/api/mock/fetcher.ts'
import { MOCK_ACCOUNTS, MOCK_PASSWORDS } from '../src/api/mock/seed.ts'
import { ValidationError, describeFormFailure } from '../src/admin/form-error.ts'
import { REMOVE_GONE, REMOVE_STALE } from '../src/admin/inventory-map.ts'
import {
  LOAD_MAX_PER_REQUEST, LOAD_TEXT, NEW_LOAD, QUANTITY_INVALID, QUANTITY_REQUIRED, QUANTITY_SEPARATOR, QUANTITY_TOO_MANY, QUICK_REASONS, REASON_MAX, REASON_REQUIRED,
  REASON_TOO_LONG, batchRemaining, describeLoadError, describeRemoveFailure, fitConflictText, loadBody, loadLoadableBatches, loadMax, parseBoxCount,
  quantityHint, quantityProblem, reasonProblem, removeBody, roomLines, selectionProblems, validateLoad,
} from '../src/admin/inventory-load.ts'

const BATCH = '50000000-0000-0000-0000-000000000001'
const SLOT = '30000000-0000-0000-0000-000000000003'
const MACHINE = '20000000-0000-0000-0000-000000000001'
const NOW = Date.parse('2026-11-11T03:00:00Z')
const room = { slotCode: 'B1', free: 8, capacity: 10, batchCode: 'SEED-MIXED-01', declared: 20, loaded: 8 }
const machine = { id: MACHINE, name: 'Máy 1', code: 'M1', status: 'ACTIVE' }
const slot = { id: SLOT, machineId: MACHINE, slotCode: 'B1', capacity: 10, status: 'ACTIVE' }
const batch = { id: BATCH, batchCode: 'SEED-MIXED-01', productName: 'Mixed', quantity: 20, expiresAt: '2026-12-01T00:00:00Z' }
const filled = { ...NEW_LOAD, machineId: MACHINE, slotId: SLOT, batchId: BATCH, quantity: '5' }
const fieldsOf = error => (assert.ok(error instanceof ValidationError, `expected ValidationError, got ${error}`), error.fieldErrors)

test('room: the maximum is the smallest of free places, what the batch can take and 1000 per request', () => {
  assert.equal(batchRemaining(room), 12)
  assert.equal(batchRemaining({ declared: 20 }), undefined, 'unknown while the loaded count is missing')
  assert.deepEqual(loadMax(room), { max: 8, by: 'slot' })
  assert.deepEqual(loadMax({ ...room, loaded: 17 }), { max: 3, by: 'batch' })
  assert.deepEqual(loadMax({}), { max: LOAD_MAX_PER_REQUEST, by: 'request' })
  assert.deepEqual(loadMax({ free: -2 }), { max: 0, by: 'slot' }, 'over-full legacy slot never gives a negative maximum')
  assert.deepEqual(roomLines(room), {
    slot: 'Ngăn B1: còn trống 8/10 chỗ',
    batch: 'Lô SEED-MIXED-01: còn nạp được 12 hộp (đã nạp 8/20)',
    max: 'Nạp được tối đa 8 hộp lần này (theo chỗ trống của ngăn).',
  })
  assert.equal(roomLines({}).max, '', 'nothing known: no maximum line')
})

test('count: digits only, checked as typed against the slot then the batch, with what to do', () => {
  assert.equal(parseBoxCount(' 5 '), 5)
  for (const raw of ['5.5', '-1', 'abc', '1e3', '']) assert.equal(parseBoxCount(raw), undefined, raw)
  assert.equal(quantityProblem('', room), '', 'empty is fine while typing')
  assert.equal(quantityProblem('', room, true), QUANTITY_REQUIRED)
  assert.equal(quantityProblem('0', room), QUANTITY_INVALID)
  // A dot or a comma (decimals, thousands grouping) gets its own wording instead of the generic one.
  for (const raw of ['2,5', '5.5', '1.000', ' 3, ']) assert.equal(quantityProblem(raw, room), QUANTITY_SEPARATOR, raw)
  assert.equal(quantityProblem('-1', room), QUANTITY_INVALID)
  assert.equal(quantityProblem('abc', room), QUANTITY_INVALID)
  assert.throws(() => loadBody({ ...NEW_LOAD, batchId: 'b', slotId: 's', quantity: '1.000' }), error => fieldsOf(error).quantity === QUANTITY_SEPARATOR)
  assert.equal(quantityProblem('1001', {}), QUANTITY_TOO_MANY)
  assert.equal(quantityProblem('8', room), '')
  assert.equal(quantityProblem('9', room), 'Ngăn B1 chỉ còn trống 8 chỗ. Nhập tối đa 8 hộp hoặc chọn ngăn khác.')
  assert.equal(quantityProblem('1', { ...room, free: 0 }), 'Ngăn B1 đã đầy, không còn chỗ trống. Chọn ngăn khác hoặc rút bớt hộp trước.')
  assert.equal(quantityProblem('5', { ...room, loaded: 17 }), 'Lô SEED-MIXED-01 chỉ còn nạp được 3 hộp (đã nạp 17/20). Nhập tối đa 3 hộp hoặc chọn lô khác.')
  assert.equal(quantityProblem('5', { free: 8 }), '', 'batch figure unknown: the server checks')
})

test('selection: inactive machine, slot not ACTIVE or full, expired or exhausted batch are flagged at once', () => {
  assert.deepEqual(selectionProblems({ machine, slot, batch, room, now: NOW }), {})
  assert.deepEqual(selectionProblems({ machine: { ...machine, status: 'MAINTENANCE' }, slot, batch, room, now: NOW }), {}, 'MAINTENANCE may be loaded')
  assert.match(selectionProblems({ machine: { ...machine, status: 'INACTIVE' }, room, now: NOW }).machineId, /^Máy đang ngừng hoạt động/)
  assert.match(selectionProblems({ slot: { ...slot, status: 'ERROR' }, room, now: NOW }).slotId, /^Ngăn B1 đang báo lỗi/)
  assert.match(selectionProblems({ slot, room: { ...room, free: 0 }, now: NOW }).slotId, /^Ngăn B1 đã đầy \(10\/10 hộp\)/)
  assert.match(selectionProblems({ batch: { ...batch, expiresAt: '2026-11-10T00:00:00Z' }, room, now: NOW }).batchId, /đã hết hạn \(10\/11\/2026 07:00\)/)
  assert.match(selectionProblems({ batch, room: { ...room, loaded: 20 }, now: NOW }).batchId, /đã nạp đủ 20 hộp khai báo/)
})

test('validate and body: required choices, then exactly { batchId, slotId, quantity } as an integer', () => {
  const selection = { machine, slot, batch, room, now: NOW }
  assert.deepEqual(validateLoad(filled, selection), {})
  assert.deepEqual(Object.keys(validateLoad(NEW_LOAD, { room: {}, now: NOW })).sort(), ['batchId', 'machineId', 'quantity', 'slotId'])
  assert.equal(validateLoad({ ...NEW_LOAD }, { room: {}, now: NOW }).slotId, 'Chọn máy trước, rồi chọn ngăn.')
  assert.match(validateLoad({ ...filled, quantity: '9' }, selection).quantity, /chỉ còn trống 8 chỗ/)
  assert.deepEqual(loadBody(filled), { batchId: BATCH, slotId: SLOT, quantity: 5 })
  assert.deepEqual(Object.keys(loadBody({ ...filled, quantity: ' 12 ' })), ['batchId', 'slotId', 'quantity'], 'no machineId in the body')
  assert.throws(() => loadBody({ ...filled, quantity: '0' }), error => fieldsOf(error).quantity === QUANTITY_INVALID)
})

test('409 from the backend (English) and the mock (Vietnamese) land under the right field, with figures and next step', () => {
  const capacity = describeLoadError(new ApiError(409, 'Slot capacity exceeded'), 5, room)
  assert.equal(capacity.refresh, true)
  assert.deepEqual(capacity.conflict, { kind: 'slot', quantity: 5 })
  // Until the figures are read again, it does not claim they were.
  assert.equal(fieldsOf(capacity.error).quantity, 'Ngăn B1 không còn đủ chỗ cho 5 hộp: có thể vừa có người nạp thêm. Đang tải lại số chỗ trống…')
  for (const message of ['Số hộp vượt quá sức chứa còn lại của ngăn.', 'Slot capacity exceeded']) assert.equal(describeLoadError(new ApiError(409, message), 5, room).conflict.kind, 'slot')
  for (const message of ['Batch declared quantity exceeded', 'Số hộp vượt quá số lượng của lô.']) {
    const declared = describeLoadError(new ApiError(409, message), 5, room)
    assert.deepEqual(declared.conflict, { kind: 'batch', quantity: 5 })
    assert.match(fieldsOf(declared.error).quantity, /^Lô SEED-MIXED-01 không còn đủ hộp khai báo cho 5 hộp: .*Đang tải lại số hộp lô còn nạp được…$/)
  }
  for (const message of ['Batch is expired', 'Lô hàng đã hết hạn.']) assert.match(fieldsOf(describeLoadError(new ApiError(409, message), 5, room).error).batchId, /vừa hết hạn/)
  for (const message of ['Product must be ACTIVE', 'Sản phẩm của lô đang ngừng bán.']) assert.equal(fieldsOf(describeLoadError(new ApiError(409, message), 5, room).error).batchId, LOAD_TEXT.productInactive)
  for (const message of ['Machine must be ACTIVE or MAINTENANCE for loading', 'Máy đang ngừng hoạt động, không thể nạp hộp.']) assert.match(fieldsOf(describeLoadError(new ApiError(409, message), 5, room).error).machineId, /Ngừng hoạt động/)
  for (const message of ['Slot must be ACTIVE for loading', 'Ngăn đang không hoạt động, không thể nạp hộp.']) assert.match(fieldsOf(describeLoadError(new ApiError(409, message), 5, room).error).slotId, /^Ngăn B1 vừa ngừng/)
  const raced = describeLoadError(new ApiError(409, 'Request conflicts with existing data'), 5, room)
  assert.deepEqual([raced.error.status, raced.error.message, raced.refresh], [409, LOAD_TEXT.raced, true])
  assert.equal(describeLoadError(new ApiError(409, 'Something else'), 5, room).error.message, LOAD_TEXT.conflict)
  // The form shows a 409 field error beside the field with one general line at form level.
  assert.match(describeFormFailure(capacity.error).fieldErrors.quantity, /không còn đủ chỗ/)
})

test('409 "does not fit" after the figures are read again: lower the count only when they really are too small', () => {
  const slot = { kind: 'slot', quantity: 5 }, batch = { kind: 'batch', quantity: 5 }
  assert.equal(fitConflictText(slot, { ...room, free: 2 }, 'ok'), 'Ngăn B1 chỉ còn trống 2 chỗ (vừa tải lại), không đủ cho 5 hộp. Giảm xuống 2 hộp hoặc chọn ngăn khác.')
  assert.match(fitConflictText(slot, { ...room, free: 0 }, 'ok'), /^Ngăn B1 đã đầy \(vừa tải lại\)/)
  assert.equal(fitConflictText(slot, room, 'ok'), 'Ngăn B1 vừa có thay đổi trong lúc nạp; số chỗ trống vừa tải lại vẫn đủ cho 5 hộp. Bấm Nạp hộp để thử lại.')
  assert.match(fitConflictText(slot, room, 'failed'), /Chưa tải lại được số chỗ trống; đóng biểu mẫu, bấm Tải lại trên sơ đồ rồi thử lại\.$/)
  assert.doesNotMatch(fitConflictText(slot, room, 'pending'), /đã được tải lại|vừa tải lại/)
  assert.equal(fitConflictText(batch, { ...room, loaded: 18 }, 'ok'), 'Lô SEED-MIXED-01 chỉ còn nạp được 2 hộp (vừa tải lại), không đủ cho 5 hộp. Giảm xuống 2 hộp hoặc chọn lô khác.')
  assert.match(fitConflictText(batch, { ...room, loaded: 20 }, 'ok'), /đã nạp đủ số khai báo \(vừa tải lại\)/)
  assert.match(fitConflictText(batch, { slotCode: 'B1' }, 'ok'), /Chưa tải lại được/, 'figures missing after the reload count as not read')
})

test('count hint: the range, or why nothing more fits (never "từ 1 đến 0")', () => {
  assert.equal(quantityHint({}), 'Số nguyên, ví dụ 5.')
  assert.equal(quantityHint(room), 'Số nguyên từ 1 đến 8.')
  assert.equal(quantityHint({ ...room, free: 0 }), 'Không nạp thêm được: ngăn b1 đã đầy. Chọn ngăn khác hoặc rút bớt hộp trước.')
  assert.equal(quantityHint({ ...room, loaded: 20 }), 'Không nạp thêm được: lô seed-mixed-01 đã nạp đủ số khai báo. Chọn lô khác.')
})

test('batches offered: earliest expiry first, expired skipped across pages, capped', async () => {
  const pages = []
  const day = 86_400_000
  // 250 batches by expiry: the first 120 already expired.
  const all = Array.from({ length: 250 }, (_, index) => ({ id: `b${index}`, batchCode: `B${index}`, quantity: 5, expiresAt: new Date(NOW + (index - 120) * day).toISOString() }))
  configureClient({ baseUrl: '', getToken: () => 't', onUnauthorized: () => {}, fetcher: async url => {
    const query = new URL(String(url), 'http://x').searchParams
    pages.push(`${query.get('page')}|${query.get('sort')}`)
    const page = Number(query.get('page')), size = Number(query.get('size'))
    const content = all.slice(page * size, page * size + size)
    return new Response(JSON.stringify({ data: { content, page, size, totalElements: all.length, totalPages: Math.ceil(all.length / size) }, timestamp: '' }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  } })
  const result = await loadLoadableBatches(NOW)
  assert.deepEqual(pages, ['0|expiresAt,asc', '1|expiresAt,asc', '2|expiresAt,asc'])
  assert.equal(result.batches.length, 100)
  assert.equal(result.batches[0].id, 'b121', 'first loadable = earliest expiry still ahead')
  assert.equal(result.truncated, true)
  all.length = 150
  pages.length = 0
  const short = await loadLoadableBatches(NOW)
  assert.deepEqual([short.batches.length, short.truncated, pages.length], [29, false, 2])
})

test('404/400/other errors of the load', () => {
  assert.equal(fieldsOf(describeLoadError(new ApiError(404, 'Product batch not found'), 5, room).error).batchId, LOAD_TEXT.batchGone)
  assert.equal(fieldsOf(describeLoadError(new ApiError(404, 'Machine slot not found'), 5, room).error).slotId, LOAD_TEXT.slotGone)
  assert.equal(fieldsOf(describeLoadError(new ApiError(404, 'Không tìm thấy ngăn.'), 5, room).error).slotId, LOAD_TEXT.slotGone)
  assert.equal(fieldsOf(describeLoadError(new ApiError(404, 'Product not found'), 5, room).error).batchId, LOAD_TEXT.productGone)
  assert.equal(describeLoadError(new ApiError(404, 'Actor not found'), 5, room).error.message, LOAD_TEXT.notFound)
  assert.equal(fieldsOf(describeLoadError(new ApiError(400, 'Validation failed', { quantity: 'must be less than or equal to 1000' }), 5, room).error).quantity, QUANTITY_TOO_MANY)
  assert.equal(describeLoadError(new ApiError(400, 'Validation failed', { machineId: 'Unknown request field' }), 5, room).error.message, LOAD_TEXT.badRequest)
  assert.equal(describeLoadError(new ApiError(400, 'Request body is missing or malformed'), 5, room).error.message, LOAD_TEXT.badRequest)
  for (const status of [401, 403, 500]) {
    const error = new ApiError(status, 'x')
    assert.deepEqual(describeLoadError(error, 5, room), { error, refresh: false })
  }
})

test('remove: reason required, trimmed, at most 500; quick reasons fit; body is exactly { reason }', () => {
  assert.equal(reasonProblem('   '), REASON_REQUIRED)
  assert.equal(reasonProblem('x'.repeat(REASON_MAX)), '')
  assert.equal(reasonProblem(` ${'x'.repeat(REASON_MAX)} `), '', 'outer spaces are stripped like the backend')
  assert.equal(reasonProblem('x'.repeat(REASON_MAX + 1)), REASON_TOO_LONG)
  assert.deepEqual(removeBody('  Hộp hết hạn '), { reason: 'Hộp hết hạn' })
  assert.throws(() => removeBody(''), error => fieldsOf(error).reason === REASON_REQUIRED)
  for (const text of QUICK_REASONS) {
    assert.equal(reasonProblem(text), '')
    assert.doesNotMatch(text, /rút hộp/i, 'quick reasons never read like the submit button')
  }
  assert.equal(describeRemoveFailure(new ApiError(409, 'Only AVAILABLE or EXPIRED items may be removed; other states require reconciliation')).error.message, REMOVE_STALE)
  assert.equal(describeRemoveFailure(new ApiError(404, 'Inventory item not found')).error.message, REMOVE_GONE)
  assert.equal(fieldsOf(describeRemoveFailure(new ApiError(400, 'Validation failed', { reason: 'size must be between 1 and 500' })).error).reason, REASON_TOO_LONG)
  assert.equal(fieldsOf(describeRemoveFailure(new ApiError(400, 'Validation failed', { reason: 'must not be blank' })).error).reason, REASON_REQUIRED)
  assert.equal(describeRemoveFailure(new ApiError(400, 'Request body is missing or malformed')).stale, false)
})

test('mock: load through the API, then the 409 scenario on /inventory/load answers with the contract example', async () => {
  const state = { token: null, search: '' }
  configureClient({ baseUrl: '', fetcher: createMockFetcher(parseSelection('all'), { getSearch: () => state.search }), getToken: () => state.token, onUnauthorized: () => {} })
  state.token = (await authApi.login({ email: MOCK_ACCOUNTS.staff, password: MOCK_PASSWORDS.staff })).accessToken
  const result = await inventoryApi.load(loadBody(filled))
  assert.equal(result.quantity, 5)
  // B1 had 2 boxes: 7/10 now, so 4 more do not fit (real capacity check of the mock).
  await assert.rejects(inventoryApi.load({ batchId: BATCH, slotId: SLOT, quantity: 4 }), error => {
    const { conflict } = describeLoadError(error, 4, room)
    return error.status === 409 && /chỉ còn trống 3 chỗ \(vừa tải lại\)/.test(fitConflictText(conflict, { ...room, free: 3 }, 'ok'))
  })
  state.search = '?scenario=409:/inventory/load'
  await assert.rejects(inventoryApi.load(loadBody(filled)), error => error.status === 409 && error.message === 'Slot capacity exceeded')
})
