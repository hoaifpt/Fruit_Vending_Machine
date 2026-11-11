import test from 'node:test'
import assert from 'node:assert/strict'
import { ApiError, configureClient } from '../src/api/client.ts'
import { CHECK_FIELDS, ValidationError, describeFormFailure } from '../src/admin/form-error.ts'
import { authApi, kioskCredentialsApi, machinesApi, productsApi, slotsApi } from '../src/api/resources.ts'
import { createMockFetcher, parseSelection } from '../src/api/mock/fetcher.ts'
import { MOCK_ACCOUNTS, MOCK_PASSWORDS } from '../src/api/mock/seed.ts'
import { NEW_MACHINE, UNKNOWN_FIELD, createMachineBody } from '../src/admin/machines.ts'
import {
  KEY_CHANGED, KEY_GONE, KEY_NOT_RETURNED, KEY_RACE, MACHINE_GONE, MACHINE_STATUS_ACTIONS, MALFORMED, PREFIX_RETRY, SLOT_CODE_TAKEN, SLOT_CONFLICT, SLOT_GONE, SLOT_SORT,
  STATUS_CONFLICT, createSlotBody, describeKeyError, describeSlotError, describeSlotStatusError, describeStatusError, hasActiveKey, issuePrompt, issuedKey, keyLeaveQuestion, maskedKey,
  missingForSale, parseCapacity, readDetailTab, readSlotFilters, readiness, slotListQuery, statusTargets, tabSearch, updateSlotBody, validateSlot,
  visibleTabs,
} from '../src/admin/machine-detail.ts'

const slot = (patch = {}) => ({ slotCode: ' a1 ', capacity: ' 6 ', ...patch })

test('tabs in the URL: unknown or not-allowed tab opens the overview; STAFF never gets the kiosk keys tab', () => {
  // FE 6.4 added "Cảm biến & Sự kiện" (MACHINE_READ, so STAFF too) right after the overview.
  assert.deepEqual(visibleTabs(true), ['overview', 'sensors', 'slots', 'kiosk'])
  assert.deepEqual(visibleTabs(false), ['overview', 'sensors', 'slots'])
  assert.equal(readDetailTab(new URLSearchParams('tab=sensors'), false), 'sensors')
  assert.equal(tabSearch('sensors'), '?tab=sensors')
  assert.equal(readDetailTab(new URLSearchParams('tab=slots'), false), 'slots')
  assert.equal(readDetailTab(new URLSearchParams('tab=kiosk'), true), 'kiosk')
  assert.equal(readDetailTab(new URLSearchParams('tab=kiosk'), false), 'overview')
  assert.equal(readDetailTab(new URLSearchParams('tab=history'), true), 'overview')
  assert.equal(readDetailTab(new URLSearchParams(''), true), 'overview')
  assert.equal(tabSearch('overview'), '')
  assert.equal(tabSearch('slots'), '?tab=slots', 'filters and page of another tab do not carry over')
})

test('slot list: only contract values reach GET /machines/{id}/slots, default sort slotCode,asc', () => {
  const filters = readSlotFilters(new URLSearchParams('tab=slots&slotStatus=ERROR&sort=capacity,desc&page=2'))
  assert.deepEqual(filters, { status: 'ERROR', sort: { field: 'capacity', direction: 'desc' }, page: 2 })
  assert.deepEqual(slotListQuery(filters, 20), { page: 2, size: 20, status: 'ERROR', sort: 'capacity,desc' })
  const junk = readSlotFilters(new URLSearchParams('slotStatus=FULL&sort=productName,asc&page=x'))
  assert.deepEqual(slotListQuery(junk, 20), { page: 0, size: 20, status: undefined, sort: 'slotCode,asc' })
  assert.equal(SLOT_SORT.fallback, 'slotCode,asc')
})

test('capacity: whole positive number of boxes up to 2147483647, never rounded', () => {
  assert.deepEqual(parseCapacity(' 6 '), { ok: true, value: 6 })
  assert.deepEqual(parseCapacity('2147483647'), { ok: true, value: 2147483647 })
  for (const raw of ['', '0', '-1', '6.0', '6,5', '1e3', 'sáu', '2147483648']) assert.equal(parseCapacity(raw).ok, false, raw)
  assert.match(parseCapacity('0').message, /lớn hơn 0/)
  assert.match(parseCapacity('6.5').message, /số nguyên/)
})

test('slot forms: create sends slotCode (uppercased) + capacity, edit sends capacity only', () => {
  assert.deepEqual(validateSlot(slot(), 'create'), {})
  assert.deepEqual(Object.keys(validateSlot(slot({ slotCode: ' ', capacity: '0' }), 'create')).sort(), ['capacity', 'slotCode'])
  assert.ok(validateSlot(slot({ slotCode: 'x'.repeat(33) }), 'create').slotCode)
  assert.deepEqual(validateSlot(slot({ slotCode: '' }), 'edit'), {}, 'the fixed code is not checked when editing')
  assert.deepEqual(createSlotBody(slot()), { slotCode: 'A1', capacity: 6 })
  assert.deepEqual(updateSlotBody(slot({ capacity: '8' })), { capacity: 8 })
  assert.throws(() => createSlotBody(slot({ capacity: '1.5' })), ValidationError)
})

test('slot errors: every 409 on create is the taken code under the slot code field; other errors in Vietnamese', () => {
  for (const message of ['Slot code is already in use for this machine', 'Request conflicts with existing data']) {
    const described = describeSlotError(new ApiError(409, message), 'create')
    assert.deepEqual(describeFormFailure(described), { message: CHECK_FIELDS, fieldErrors: { slotCode: SLOT_CODE_TAKEN } }, message)
  }
  assert.equal(describeFormFailure(describeSlotError(new ApiError(409, 'Request conflicts with existing data'), 'edit')).message, SLOT_CONFLICT)
  assert.equal(describeSlotError(new ApiError(404, 'x'), 'create').message, MACHINE_GONE)
  assert.equal(describeSlotError(new ApiError(404, 'x'), 'edit').message, SLOT_GONE)
  assert.equal(describeSlotError(new ApiError(400, 'Unknown request field'), 'create').message, UNKNOWN_FIELD)
  assert.equal(describeSlotError(new ApiError(400, 'Request body is missing or malformed'), 'edit').message, MALFORMED)
  const fields = describeSlotError(new ApiError(400, 'Validation Failed', { slotCode: 'size must be between 1 and 32', capacity: 'must be greater than 0' }), 'create')
  assert.deepEqual(fields.fieldErrors, { slotCode: 'Tối đa 32 ký tự.', capacity: 'Sức chứa phải lớn hơn 0.' })
  const unknown = describeSlotError(new ApiError(400, 'Validation Failed', { status: 'Unknown field' }), 'create')
  assert.match(describeFormFailure(unknown).message, /status: Unknown field/)
  const server = new ApiError(500, 'boom')
  assert.equal(describeSlotError(server, 'create'), server)
  assert.equal(describeSlotStatusError(new ApiError(404, 'x')).message, SLOT_GONE)
  assert.equal(describeSlotStatusError(new ApiError(409, 'Request conflicts with existing data')).message, SLOT_CONFLICT)
})

test('readiness before ACTIVE: advice only (backend has no precondition); unknown items are not reported as missing', () => {
  const none = readiness({ activeSlots: 0, activeKey: false, canSeeKeys: true })
  assert.deepEqual(none.map(item => [item.key, item.done, item.tab]), [['slots', false, 'slots'], ['key', false, 'kiosk']])
  assert.deepEqual(missingForSale(none).map(item => item.key), ['slots', 'key'])
  const ready = readiness({ activeSlots: 2, activeKey: true, canSeeKeys: true })
  assert.deepEqual(missingForSale(ready), [])
  assert.match(ready[0].detail, /2 ngăn Hoạt động/)
  const staff = readiness({ activeSlots: 1, activeKey: false, canSeeKeys: false })
  assert.equal(staff[1].done, undefined)
  assert.match(staff[1].detail, /quản trị viên/)
  assert.deepEqual(missingForSale(staff), [])
  assert.equal(readiness({ activeSlots: undefined, activeKey: undefined, canSeeKeys: true })[0].done, undefined)
})

test('status changes: every other status, ACTIVE first; 409/404/400 in Vietnamese', () => {
  assert.deepEqual(statusTargets('INACTIVE'), ['ACTIVE', 'MAINTENANCE'])
  assert.deepEqual(statusTargets('ACTIVE'), ['MAINTENANCE', 'INACTIVE'])
  assert.equal(MACHINE_STATUS_ACTIONS.ACTIVE.confirm, 'Bật bán')
  assert.equal(describeStatusError(new ApiError(409, 'Request conflicts with existing data')).message, STATUS_CONFLICT)
  assert.equal(describeStatusError(new ApiError(404, 'x')).message, MACHINE_GONE)
  assert.equal(describeStatusError(new ApiError(400, 'Unknown request field')).message, UNKNOWN_FIELD)
  assert.doesNotMatch(describeStatusError(new ApiError(400, 'Request body is missing or malformed')).message, /[Rr]equest/)
})

test('kiosk keys: masked by prefix only; issue/revoke errors in Vietnamese', () => {
  assert.equal(maskedKey('abc123def456'), 'fvk_abc123def456_••••••••')
  assert.equal(maskedKey(undefined), '—')
  assert.equal(hasActiveKey(undefined), undefined)
  assert.equal(hasActiveKey([{ status: 'REVOKED' }]), false)
  assert.equal(hasActiveKey([{ status: 'REVOKED' }, { status: 'ACTIVE' }]), true)
  assert.equal(describeKeyError(new ApiError(409, 'Could not allocate a unique credential prefix'), 'issue').message, PREFIX_RETRY)
  assert.equal(describeKeyError(new ApiError(409, 'Request conflicts with existing data'), 'issue').message, KEY_RACE)
  assert.equal(describeKeyError(new ApiError(404, 'x'), 'revoke').message, KEY_GONE)
  assert.equal(describeKeyError(new ApiError(404, 'x'), 'issue').message, MACHINE_GONE)
  // A 409 on revoke is not "not found": the key changed elsewhere.
  assert.equal(describeKeyError(new ApiError(409, 'Request conflicts with existing data'), 'revoke').message, KEY_CHANGED)
  assert.notEqual(KEY_CHANGED, KEY_GONE)
})

test('issue prompt follows the latest key list: after a reload it warns about the key a click would revoke now', () => {
  // Opened with no key in use.
  assert.deepEqual(issuePrompt(undefined, null, false), { revokes: '', changed: false, confirmLabel: 'Cấp khóa', danger: false, canConfirm: true })
  // 409 → the list reloads: no click while it loads.
  const loading = issuePrompt(undefined, null, true)
  assert.equal(loading.canConfirm, false)
  assert.equal(loading.changed, false, 'no "changed" note before the new list is in')
  // The reloaded list has a key another admin just issued: warned, red button, and the change is called out.
  const other = { credentialId: 'c-2', keyPrefix: 'other123' }
  assert.deepEqual(issuePrompt(other, null, false), {
    revokes: 'fvk_other123_••••••••', changed: true, confirmLabel: 'Cấp khóa mới và thu hồi khóa cũ', danger: true, canConfirm: true,
  })
  // Opened while that key was in use and nothing changed: the usual warning, no note.
  assert.equal(issuePrompt(other, 'c-2', false).changed, false)
  // The key in use was replaced since opening.
  assert.equal(issuePrompt({ credentialId: 'c-3', keyPrefix: 'p3' }, 'c-2', false).changed, true)
})

test('issued key: a 201 without apiKey is told apart, so the dialog can say so instead of staying silent', () => {
  assert.equal(issuedKey({ apiKey: 'fvk_abc_secret' }), 'fvk_abc_secret')
  for (const result of [{}, { apiKey: '' }, { apiKey: '   ' }, { apiKey: null }, null, undefined]) assert.equal(issuedKey(result), '', JSON.stringify(result))
  assert.match(KEY_NOT_RETURNED, /không nhận được khóa/)
  assert.match(KEY_NOT_RETURNED, /cấp lại/)
})

test('mock: product → machine → 2 slots → key (shown once) → ACTIVE, with the backend rules and messages', async () => {
  let token = null
  const fetcher = createMockFetcher(parseSelection('all'), { getSearch: () => '', now: () => Date.now(), realFetch: async () => { throw new Error('no network') } })
  configureClient({ baseUrl: '', fetcher, getToken: () => token, onUnauthorized: () => {} })
  token = (await authApi.login({ email: MOCK_ACCOUNTS.admin, password: MOCK_PASSWORDS.admin })).accessToken

  await productsApi.create({ sku: 'FLOW-1', name: 'Xoài cắt', price: 35000 })
  const machine = await machinesApi.create(createMachineBody({ ...NEW_MACHINE, code: 'flow-01', name: 'Máy luồng', location: 'Tòa C' }))
  assert.equal(machine.status, 'INACTIVE')
  assert.equal((await slotsApi.list(machine.id, { status: 'ACTIVE', size: 1 })).totalElements, 0)

  const a1 = await slotsApi.create(machine.id, createSlotBody(slot()))
  assert.deepEqual([a1.slotCode, a1.capacity, a1.status], ['A1', 6, 'ACTIVE'])
  await assert.rejects(slotsApi.create(machine.id, createSlotBody(slot({ slotCode: 'A1 ' }))), error => {
    assert.equal(error.status, 409)
    assert.equal(error.message, 'Slot code is already in use for this machine', 'English, as the backend sends it')
    return describeSlotError(error, 'create').fieldErrors.slotCode === SLOT_CODE_TAKEN
  })
  await assert.rejects(slotsApi.create(machine.id, { slotCode: 'A9', capacity: 6, status: 'ACTIVE' }), error => error.status === 400)
  await slotsApi.create(machine.id, createSlotBody(slot({ slotCode: 'a2', capacity: '4' })))
  assert.equal((await slotsApi.list(machine.id, { status: 'ACTIVE', size: 1 })).totalElements, 2)
  const updated = await slotsApi.update(machine.id, a1.id, updateSlotBody(slot({ capacity: '8' })))
  assert.equal(updated.capacity, 8)
  await assert.rejects(slotsApi.update(machine.id, '00000000-0000-0000-0000-000000000000', { capacity: 2 }), error => error.status === 404)

  assert.deepEqual(await kioskCredentialsApi.list(machine.id), [])
  const issued = await kioskCredentialsApi.issue(machine.id)
  assert.match(issued.apiKey, /^fvk_/)
  const listed = await kioskCredentialsApi.list(machine.id)
  assert.equal(listed.length, 1)
  assert.equal('apiKey' in listed[0], false, 'the key is never returned again')
  assert.equal(hasActiveKey(listed), true)
  // Rotation revokes the key in use; at most one ACTIVE.
  const second = await kioskCredentialsApi.issue(machine.id)
  const history = await kioskCredentialsApi.list(machine.id)
  assert.deepEqual(history.map(row => row.status).sort(), ['ACTIVE', 'REVOKED'])
  const revoked = await kioskCredentialsApi.revoke(machine.id, second.credentialId)
  assert.equal(revoked.status, 'REVOKED')
  assert.equal(hasActiveKey(await kioskCredentialsApi.list(machine.id)), false)
  await assert.rejects(kioskCredentialsApi.revoke(machine.id, '00000000-0000-0000-0000-000000000000'), error => error.status === 404)
  await kioskCredentialsApi.issue(machine.id)

  const active = await machinesApi.setStatus(machine.id, 'ACTIVE')
  assert.equal(active.status, 'ACTIVE')

  token = (await authApi.login({ email: MOCK_ACCOUNTS.staff, password: MOCK_PASSWORDS.staff })).accessToken
  assert.equal((await slotsApi.list(machine.id, {})).totalElements, 2, 'STAFF reads slots')
  await assert.rejects(slotsApi.create(machine.id, { slotCode: 'B1', capacity: 2 }), error => error.status === 403)
  await assert.rejects(kioskCredentialsApi.list(machine.id), error => error.status === 403)
  await assert.rejects(machinesApi.setStatus(machine.id, 'INACTIVE'), error => error.status === 403)
})

test('leaving the screen asks first while a kiosk key is being issued or shown, never otherwise', () => {
  assert.equal(keyLeaveQuestion(false, false), null)
  assert.match(keyLeaveQuestion(true, false), /Đang cấp khóa kiosk/)
  assert.match(keyLeaveQuestion(false, true), /chỉ hiện lần này/)
  assert.equal(keyLeaveQuestion(true, true), keyLeaveQuestion(false, true))
})
