import test from 'node:test'
import assert from 'node:assert/strict'
import { ApiError, configureClient } from '../src/api/client.ts'
import { authApi, inventoryApi } from '../src/api/resources.ts'
import { createMockFetcher, parseSelection } from '../src/api/mock/fetcher.ts'
import { MOCK_ACCOUNTS, MOCK_PASSWORDS } from '../src/api/mock/seed.ts'
import {
  FILTERS_REFUSED, FILTER_TARGET_GONE, ID_INPUT_TEXT, NO_FILTERS, activeHistoryFilterCount, cleanHistoryHref, describeHistoryError, eventText, historyHref,
  historyKey, historyQuery, historySearch, loadSlotCodes, nextFilters, parseIdInput, performerText, readHistoryFilters, reasonText, referenceFilterable, referenceKind, shortId,
} from '../src/admin/inventory-history.ts'

const MACHINE_1 = '20000000-0000-0000-0000-000000000001'
const MACHINE_2 = '20000000-0000-0000-0000-000000000002'
const SLOT = '30000000-0000-0000-0000-000000000004'
const BOX = '70000000-0000-0000-0000-000000000301'
const REF = '93000000-0000-0000-0000-000000000001'
const read = search => readHistoryFilters(new URLSearchParams(search))

test('every filter and the page are read from the URL; a reload of the same URL gives the same filters', () => {
  const search = `?machineId=${MACHINE_2}&slotId=${SLOT}&type=RESERVE&inventoryItemId=${BOX}&referenceId=${REF}&page=2`
  const { filters, ignored } = read(search)
  assert.deepEqual(filters, { machineId: MACHINE_2, slotId: SLOT, type: 'RESERVE', inventoryItemId: BOX, referenceId: REF, page: 2 })
  assert.deepEqual(ignored, [])
  // Written back in a fixed order and read again: nothing is lost (F5 / shared link).
  assert.equal(historySearch(filters), search)
  assert.deepEqual(read(historySearch(filters)).filters, filters)
  assert.deepEqual(read('').filters, NO_FILTERS)
  assert.equal(historySearch(NO_FILTERS), '')
})

test('ids that are not UUIDs, unknown types, bad pages and a slot without machine are ignored and reported, never sent', () => {
  const { filters, ignored } = read('?machineId=abc&slotId=xyz&type=DELETE&inventoryItemId=123&referenceId=%3Cscript%3E&page=-1')
  assert.deepEqual(filters, NO_FILTERS)
  assert.deepEqual(ignored.map(item => item.key).sort(), ['inventoryItemId', 'machineId', 'page', 'referenceId', 'slotId', 'type'])
  assert.match(ignored.find(item => item.key === 'machineId').reason, /UUID/)
  // A valid slot alone is dropped too: the slot filter belongs to a machine.
  const lone = read(`?slotId=${SLOT}`)
  assert.equal(lone.filters.slotId, '')
  assert.deepEqual(lone.ignored.map(item => item.key), ['slotId'])
  assert.match(lone.ignored[0].reason, /chọn máy/)
  // Upper case ids are accepted and normalised; page 1.5 is not a page.
  assert.equal(read(`?machineId=${MACHINE_2.toUpperCase()}`).filters.machineId, MACHINE_2)
  assert.equal(read('?page=1.5').filters.page, 0)
  // The clean link keeps only what was usable.
  assert.equal(cleanHistoryHref(read(`?machineId=${MACHINE_1}&inventoryItemId=nope&scenario=x`).filters), `/admin/inventory/history?machineId=${MACHINE_1}`)
})

test('the API query holds only contract parameters, without empty values', () => {
  const { filters } = read(`?machineId=${MACHINE_1}&type=LOAD&page=1&foo=bar&sort=createdAt,asc`)
  const query = historyQuery(filters, 20)
  assert.deepEqual(Object.keys(query).sort(), ['inventoryItemId', 'machineId', 'page', 'referenceId', 'size', 'slotId', 'type'])
  assert.deepEqual(Object.fromEntries(Object.entries(query).filter(([, value]) => value !== undefined)), { page: 1, size: 20, machineId: MACHINE_1, type: 'LOAD' })
  assert.notEqual(historyKey(filters), historyKey({ ...filters, page: 0 }))
  assert.equal(historyKey(filters), historyKey(read(`?type=LOAD&machineId=${MACHINE_1}&page=1`).filters))
})

test('changing the machine clears the slot; other changes keep it; any filter change goes back to page 0', () => {
  const current = { ...NO_FILTERS, machineId: MACHINE_2, slotId: SLOT, type: 'RESERVE', page: 3 }
  assert.deepEqual(nextFilters(current, { machineId: MACHINE_1 }), { ...current, machineId: MACHINE_1, slotId: '', page: 0 })
  assert.deepEqual(nextFilters(current, { machineId: '' }), { ...current, machineId: '', slotId: '', page: 0 })
  assert.deepEqual(nextFilters(current, { type: 'SALE' }), { ...current, type: 'SALE', page: 0 })
  assert.deepEqual(nextFilters(current, { machineId: MACHINE_2 }), { ...current, page: 0 }, 'same machine keeps the slot')
  assert.deepEqual(nextFilters(current, { page: 4 }), { ...current, page: 4 })
  // A row link sets machine and slot together.
  assert.equal(historyHref(NO_FILTERS, { machineId: MACHINE_2, slotId: SLOT }), `/admin/inventory/history?machineId=${MACHINE_2}&slotId=${SLOT}`)
  assert.equal(historyHref(current, { ...NO_FILTERS }), '/admin/inventory/history')
  assert.equal(activeHistoryFilterCount(current), 3)
})

test('typed ids: full UUIDs (any case, braces, spaces) pass; anything else is a friendly error', () => {
  assert.deepEqual(parseIdInput(`  {${BOX.toUpperCase()}} `), { ok: true, value: BOX })
  assert.deepEqual(parseIdInput(''), { ok: true, value: '' })
  assert.deepEqual(parseIdInput('…00000301'), { ok: false, error: ID_INPUT_TEXT })
  assert.deepEqual(parseIdInput(BOX.slice(0, 30)), { ok: false, error: ID_INPUT_TEXT })
})

test('row wording: reference kind, event, reason and who did it', () => {
  assert.equal(referenceKind({ type: 'LOAD', referenceId: REF }), 'load')
  for (const type of ['RESERVE', 'SALE', 'RETURN']) assert.equal(referenceKind({ type, referenceId: REF }), 'order', type)
  assert.equal(referenceKind({ type: 'ADJUSTMENT', referenceId: REF, statusBefore: 'RESERVED', statusAfter: 'DISPENSE_FAILED' }), 'order')
  assert.equal(referenceKind({ type: 'ADJUSTMENT', referenceId: REF, statusBefore: 'AVAILABLE', statusAfter: 'EXPIRED' }), 'other')
  assert.equal(referenceKind({ type: 'REMOVE' }), undefined)
  // The backend gives every removal its own random reference: shown, but not a filter (it matches that row only).
  assert.equal(referenceKind({ type: 'REMOVE', referenceId: REF }), 'remove')
  assert.equal(referenceFilterable('remove'), false)
  for (const kind of ['load', 'order', 'other']) assert.equal(referenceFilterable(kind), true, kind)
  assert.equal(referenceFilterable(undefined), false)

  assert.match(eventText({ type: 'ADJUSTMENT', statusBefore: 'RESERVED', statusAfter: 'DISPENSE_FAILED' }), /không nhả được/)
  assert.match(eventText({ type: 'RESERVE' }), /giữ/)
  assert.equal(reasonText('TIMEOUT'), reasonText('DISPENSE_TIMEOUT'))
  assert.equal(reasonText('RESERVATION_EXPIRED'), 'Hết thời gian giữ chỗ')
  assert.equal(reasonText('  Hộp móp  '), 'Hộp móp')
  assert.equal(reasonText(null), '')

  const staff = '10000000-0000-0000-0000-000000000002'
  assert.equal(performerText({ type: 'RESERVE' }, {}), 'Hệ thống')
  assert.equal(performerText({ type: 'REMOVE' }, {}), '')
  assert.equal(performerText({ type: 'LOAD', performedBy: staff }, { [staff]: 'Nhân viên A' }), 'Nhân viên A')
  assert.equal(performerText({ type: 'LOAD', performedBy: staff }, { [staff]: 'Nhân viên A' }, staff), 'Bạn')
  assert.equal(performerText({ type: 'LOAD', performedBy: staff }, {}), 'Tài khoản …00000002')
  assert.equal(shortId(BOX), '…00000301')
  assert.equal(shortId(undefined), '—')
})

test('list errors: 403 → no access, 400/404 → filter problem with clear, others generic', () => {
  assert.deepEqual(describeHistoryError(new ApiError(403, 'Access denied')), { kind: 'forbidden' })
  assert.deepEqual(describeHistoryError(new ApiError(400, 'Invalid parameters')), { kind: 'filters', message: FILTERS_REFUSED })
  assert.deepEqual(describeHistoryError(new ApiError(404, 'Inventory item not found')), { kind: 'notFound', message: FILTER_TARGET_GONE })
  assert.deepEqual(describeHistoryError(new ApiError(500, 'boom')), { kind: 'other' })
  assert.deepEqual(describeHistoryError(new ApiError(401, 'expired')), { kind: 'other' })
  assert.deepEqual(describeHistoryError(new TypeError('Failed to fetch')), { kind: 'other' })
})

test('mock: machine 02 history has the RESERVE and ADJUSTMENT rows of the held / failed heads, filterable by box and order', async () => {
  let token = null
  const fetcher = createMockFetcher(parseSelection('all'), { getSearch: () => '', now: () => Date.now(), realFetch: async () => { throw new Error('no network') } })
  configureClient({ baseUrl: '', fetcher, getToken: () => token, onUnauthorized: () => {} })
  token = (await authApi.login({ email: MOCK_ACCOUNTS.staff, password: MOCK_PASSWORDS.staff })).accessToken
  {
    const all = await inventoryApi.history(historyQuery(read(`?machineId=${MACHINE_2}`).filters, 100))
    const types = new Set(all.content.map(row => row.type))
    assert.ok(types.has('RESERVE') && types.has('ADJUSTMENT'), [...types].join(','))
    const adjustment = all.content.find(row => row.type === 'ADJUSTMENT')
    assert.equal(adjustment.statusBefore, 'RESERVED')
    assert.equal(adjustment.statusAfter, 'DISPENSE_FAILED')
    assert.equal(referenceKind(adjustment), 'order')
    const box = await inventoryApi.history(historyQuery(read(`?inventoryItemId=${adjustment.inventoryItemId}`).filters, 20))
    assert.deepEqual(box.content.map(row => row.type), ['ADJUSTMENT', 'RESERVE', 'LOAD'], 'newest first')
    const order = await inventoryApi.history(historyQuery(read(`?referenceId=${adjustment.referenceId}`).filters, 20))
    assert.deepEqual(order.content.map(row => row.type).sort(), ['ADJUSTMENT', 'RESERVE'])
    // Removing a box writes REMOVE with a fresh reference of its own, like InventoryService.remove.
    const removable = (await inventoryApi.list({ machineId: MACHINE_1, status: 'AVAILABLE', page: 0, size: 1 })).content[0]
    await inventoryApi.remove(removable.id, 'Hộp móp')
    const removed = (await inventoryApi.history(historyQuery(read(`?inventoryItemId=${removable.id}&type=REMOVE`).filters, 20))).content
    assert.equal(removed.length, 1)
    assert.match(removed[0].referenceId, /^[0-9a-f-]{36}$/)
    assert.equal(referenceKind(removed[0]), 'remove')
    const byReference = await inventoryApi.history(historyQuery(read(`?referenceId=${removed[0].referenceId}`).filters, 20))
    assert.deepEqual(byReference.content.map(row => row.id), [removed[0].id], 'the removal reference matches that row only')
    const codes = await loadSlotCodes([MACHINE_2, MACHINE_2, ''])
    assert.equal(codes[adjustment.slotId], 'A1')
  }
})
