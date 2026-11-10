import test from 'node:test'
import assert from 'node:assert/strict'
import { ApiError, configureClient } from '../src/api/client.ts'
import { CHECK_FIELDS, ValidationError, describeFormFailure } from '../src/admin/form-error.ts'
import { authApi, machinesApi } from '../src/api/resources.ts'
import { createMockFetcher, parseSelection } from '../src/api/mock/fetcher.ts'
import { MOCK_ACCOUNTS, MOCK_PASSWORDS } from '../src/api/mock/seed.ts'
import {
  CODE_TAKEN, MACHINE_SORT, NEW_MACHINE, THRESHOLD_ORDER, UNKNOWN_FIELD, createMachineBody, describeSaveError, lastContact, machineListQuery,
  parseThreshold, readMachineFilters, saleState, translateFieldError, validateMachine,
} from '../src/admin/machines.ts'

const values = (patch = {}) => ({ ...NEW_MACHINE, code: ' fv-hcm-001 ', name: '  Máy sảnh A ', location: ' Tòa A, tầng trệt ', ...patch })
const at = '2026-11-09T06:05:00Z'

test('URL filters: only contract values reach the API, sort falls back to createdAt,desc', () => {
  const filters = readMachineFilters(new URLSearchParams('status=MAINTENANCE&search=%20campus%20&sort=location,desc&page=3'))
  assert.deepEqual(filters, { status: 'MAINTENANCE', search: 'campus', sort: { field: 'location', direction: 'desc' }, page: 3 })
  assert.deepEqual(machineListQuery(filters, 20), { page: 3, size: 20, status: 'MAINTENANCE', search: 'campus', sort: 'location,desc' })

  const junk = readMachineFilters(new URLSearchParams('status=ONLINE&sort=lastSeenAt,desc&page=-2'))
  assert.deepEqual(junk, { status: '', search: '', sort: { field: 'createdAt', direction: 'desc' }, page: 0 })
  assert.deepEqual(machineListQuery(junk, 20), { page: 0, size: 20, status: undefined, search: undefined, sort: 'createdAt,desc' })
  assert.equal(readMachineFilters(new URLSearchParams(`search=${'a'.repeat(250)}`)).search.length, 200)
  assert.deepEqual(MACHINE_SORT.fields, ['id', 'code', 'name', 'location', 'status', 'createdAt', 'updatedAt'])
})

test('sale state: only ACTIVE sells; INACTIVE/MAINTENANCE say why and what to do next, per role', () => {
  const base = { lastSeenAt: null, createdAt: at, updatedAt: at }
  const active = saleState({ ...base, status: 'ACTIVE' }, true)
  assert.equal(active.selling, true)
  assert.equal(active.next, '')
  assert.equal(active.summary, 'Đang mở bán (kiosk nhận đơn khi có hàng).')

  const fresh = saleState({ ...base, status: 'INACTIVE' }, true)
  assert.deepEqual([fresh.selling, fresh.reason], [false, 'new'])
  assert.match(fresh.summary, /^Ngừng bán: mới đăng ký/)
  assert.match(fresh.next, /khóa kiosk/)
  assert.match(saleState({ ...base, status: 'INACTIVE' }, false).next, /Quản trị viên/)

  const turnedOff = saleState({ ...base, status: 'INACTIVE', updatedAt: '2026-11-10T01:00:00Z' }, true)
  assert.deepEqual([turnedOff.selling, turnedOff.reason], [false, 'inactive'])
  assert.match(turnedOff.summary, /^Ngừng bán: quản trị viên đang để máy tắt/)
  assert.equal(turnedOff.next, 'Bật Hoạt động trong chi tiết máy khi máy sẵn sàng.')
  assert.equal(saleState({ ...base, status: 'INACTIVE', lastSeenAt: at }, true).reason, 'inactive', 'a machine that has connected is not "new"')

  const maintenance = saleState({ ...base, status: 'MAINTENANCE' }, false)
  assert.deepEqual([maintenance.selling, maintenance.reason], [false, 'maintenance'])
  assert.match(maintenance.summary, /bảo trì/)
  assert.match(maintenance.next, /quản trị viên/)
})

test('sale state ignores connectivity: last contact is separate text in Asia/Ho_Chi_Minh, never an online/offline guess', () => {
  assert.equal(saleState({ status: 'ACTIVE', lastSeenAt: null, createdAt: at, updatedAt: at }, true).selling, true)
  assert.equal(lastContact({ lastSeenAt: null }), 'Chưa từng kết nối')
  assert.equal(lastContact({ lastSeenAt: at }), '09/11/2026 13:05')
})

test('threshold input: plain or comma decimals, ≤ 2 decimals, within bounds, never rounded', () => {
  assert.deepEqual(parseThreshold('2', -100, 100), { ok: true, value: 2 })
  assert.deepEqual(parseThreshold(' -2,5 ', -100, 100), { ok: true, value: -2.5 })
  assert.deepEqual(parseThreshold('8.25', -100, 100), { ok: true, value: 8.25 })
  assert.deepEqual(parseThreshold('−4', -100, 100), { ok: true, value: -4 })
  assert.deepEqual(parseThreshold('-0', -100, 100), { ok: true, value: 0 })
  assert.equal(parseThreshold('', 0, 100).ok, false)
  assert.match(parseThreshold('abc', 0, 100).message, /Chỉ nhập số/)
  assert.match(parseThreshold('1e2', 0, 100).message, /Chỉ nhập số/)
  assert.match(parseThreshold('2,555', 0, 100).message, /2 chữ số thập phân/)
  assert.match(parseThreshold('101', 0, 100).message, /từ 0 đến 100/)
  assert.match(parseThreshold('-1', 0, 100).message, /từ 0 đến 100/)
})

test('validation: required fields, limits, and each minimum strictly below its maximum', () => {
  assert.deepEqual(validateMachine(values()), {})
  const errors = validateMachine(values({ code: ' ', name: '', location: '  ', maxHumidity: 'x' }))
  assert.deepEqual(Object.keys(errors).sort(), ['code', 'location', 'maxHumidity', 'name'])
  assert.ok(validateMachine(values({ code: 'x'.repeat(65) })).code)
  assert.ok(validateMachine(values({ name: 'x'.repeat(201) })).name)
  assert.ok(validateMachine(values({ location: 'x'.repeat(501) })).location)
  assert.deepEqual(validateMachine(values({ location: 'x'.repeat(500) })), {})
  assert.deepEqual(validateMachine(values({ minTemperature: '8', maxTemperature: '8', minHumidity: '90', maxHumidity: '80' })),
    { minTemperature: 'Phải nhỏ hơn nhiệt độ tối đa.', minHumidity: 'Phải nhỏ hơn độ ẩm tối đa.' })
  assert.match(validateMachine(values({ minTemperature: '-101' })).minTemperature, /-100 đến 100/)
})

test('create body: exactly the seven contract fields, code trimmed and uppercased, no status', () => {
  const body = createMachineBody(values({ minTemperature: '1,5', maxHumidity: '85.25' }))
  assert.deepEqual(body, { code: 'FV-HCM-001', name: 'Máy sảnh A', location: 'Tòa A, tầng trệt', minTemperature: 1.5, maxTemperature: 8, minHumidity: 40, maxHumidity: 85.25 })
  assert.equal('status' in body, false)
  assert.throws(() => createMachineBody(values({ minTemperature: '9' })), ValidationError)
})

test('save errors: every 409 of POST /machines is the taken code, in Vietnamese, once under the code field', () => {
  for (const message of ['Machine code is already in use', 'Request conflicts with existing data']) {
    const described = describeSaveError(new ApiError(409, message))
    assert.ok(described instanceof ValidationError, message)
    assert.deepEqual(describeFormFailure(described), { message: CHECK_FIELDS, fieldErrors: { code: CODE_TAKEN } })
  }
  const server = new ApiError(500, 'boom')
  assert.equal(describeSaveError(server), server)

  const invalid = describeSaveError(new ApiError(400, 'Validation Failed', { name: 'must not be blank', location: 'size must be between 1 and 500', minHumidity: 'must be greater than or equal to 0', maxTemperature: 'must be less than or equal to 100' }))
  assert.deepEqual(invalid.fieldErrors, { name: 'Không được để trống.', location: 'Tối đa 500 ký tự.', minHumidity: 'Phải lớn hơn hoặc bằng 0.', maxTemperature: 'Phải nhỏ hơn hoặc bằng 100.' })
  assert.equal(translateFieldError('numeric value out of bounds (<3 digits>.<2 digits> expected)'), 'Tối đa 2 chữ số thập phân.')

  const order = describeSaveError(new ApiError(400, 'Minimum environmental thresholds must be strictly below maximum thresholds'))
  assert.ok(order instanceof ApiError)
  assert.equal(order.message, THRESHOLD_ORDER)

  const extra = describeSaveError(new ApiError(400, 'Unknown request field'))
  assert.ok(extra instanceof ApiError)
  assert.equal(extra.message, UNKNOWN_FIELD)
  assert.deepEqual(describeFormFailure(extra), { message: UNKNOWN_FIELD })
  const other = new ApiError(400, 'Something else')
  assert.equal(describeSaveError(other), other)

  const unknown = describeSaveError(new ApiError(400, 'Validation Failed', { status: 'Unknown field' }))
  assert.ok(unknown instanceof ApiError)
  assert.match(describeFormFailure(unknown).message, /status: Unknown field/)
  assert.equal(describeFormFailure(unknown).fieldErrors, undefined)
})

test('mock /machines follows the contract: filters, sort, registration INACTIVE, 409 duplicate code, staff read-only', async () => {
  let token = null
  const fetcher = createMockFetcher(parseSelection('all'), { getSearch: () => '', now: () => Date.now(), realFetch: async () => { throw new Error('no network') } })
  configureClient({ baseUrl: '', fetcher, getToken: () => token, onUnauthorized: () => {} })
  token = (await authApi.login({ email: MOCK_ACCOUNTS.admin, password: MOCK_PASSWORDS.admin })).accessToken
  const all = await machinesApi.list({ size: 100 })
  assert.deepEqual(new Set(all.content.map(row => row.status)), new Set(['ACTIVE', 'INACTIVE', 'MAINTENANCE']), 'the seed shows every status')
  assert.deepEqual((await machinesApi.list({ status: 'MAINTENANCE' })).content.map(row => row.code), ['DEV-MACHINE-02'])
  assert.deepEqual((await machinesApi.list({ search: 'warehouse' })).content.map(row => row.code), ['DEV-MACHINE-03'])
  const codes = (await machinesApi.list({ sort: 'code,desc', size: 100 })).content.map(row => row.code)
  assert.deepEqual(codes, [...codes].sort().reverse())

  await assert.rejects(machinesApi.create(createMachineBody(values({ code: 'dev-machine-01' }))), error => {
    const described = describeSaveError(error)
    return error.status === 409 && described instanceof ValidationError && described.fieldErrors.code === CODE_TAKEN
  })
  await assert.rejects(machinesApi.create({ ...createMachineBody(values({ code: 'NEW-1' })), location: 'x'.repeat(501) }), error => error.status === 400 && !!error.fieldErrors.location)
  await assert.rejects(machinesApi.create({ ...createMachineBody(values({ code: 'NEW-1' })), status: 'ACTIVE' }), error => error.status === 400)
  // min ≥ max passes bean validation and is refused by the service: a plain 400 without field errors, as the backend does.
  await assert.rejects(machinesApi.create({ ...createMachineBody(values({ code: 'NEW-2' })), minHumidity: 80, maxHumidity: 80 }), error => {
    const described = describeSaveError(error)
    return error.status === 400 && Object.keys(error.fieldErrors).length === 0 && described instanceof ApiError && described.message === THRESHOLD_ORDER
  })
  const created = await machinesApi.create(createMachineBody(values({ code: 'fv-fm3-01', location: 'x'.repeat(500) })))
  assert.equal(created.code, 'FV-FM3-01')
  assert.equal(created.status, 'INACTIVE')
  assert.equal(created.lastSeenAt, null)
  assert.equal(saleState(created, true).reason, 'new')

  token = (await authApi.login({ email: MOCK_ACCOUNTS.staff, password: MOCK_PASSWORDS.staff })).accessToken
  await assert.doesNotReject(machinesApi.list({}))
  await assert.rejects(machinesApi.create(createMachineBody(values({ code: 'STAFF-1' }))), error => error.status === 403)
})
