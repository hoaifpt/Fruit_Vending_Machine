import test from 'node:test'
import assert from 'node:assert/strict'
import { ApiError, configureClient } from '../src/api/client.ts'
import { CHECK_FIELDS, ValidationError, describeFormFailure } from '../src/admin/form-error.ts'
import { authApi, batchesApi, inventoryApi } from '../src/api/resources.ts'
import { createMockFetcher, parseSelection } from '../src/api/mock/fetcher.ts'
import { MOCK_ACCOUNTS, MOCK_PASSWORDS } from '../src/api/mock/seed.ts'
import {
  BATCH_SORT, CODE_TAKEN, NOT_FOUND_OTHER, EXPIRY_TEXT, MANUFACTURED_REQUIRED, NEW_BATCH, PRODUCT_GONE, PRODUCT_INACTIVE, QUANTITY_TEXT, batchListQuery,
  countLoaded, createBatchBody, describeSaveError, expiryHint, expiryMin, expiryProblem, instantToLocalDateTime, loadedView,
  parseQuantity, readBatchFilters, translateFieldError, validateBatch,
} from '../src/admin/batches.ts'

const PRODUCT_ID = '40000000-0000-0000-0000-000000000001'
const INACTIVE_PRODUCT_ID = '40000000-0000-0000-0000-000000000005'
const batchId = n => `50000000-0000-0000-0000-00000000000${n}`
// 10/11/2026 12:00 in Vietnam.
const NOW = Date.parse('2026-11-10T05:00:00Z')
const values = (patch = {}) => ({
  ...NEW_BATCH, productId: PRODUCT_ID, batchCode: ' mango-20261110-01 ', manufacturedAt: '2026-11-10T08:00', expiresAt: '2026-11-12T08:00', quantity: '20', ...patch,
})

test('expiry at or before the manufacture time is reported while typing, before any submit', () => {
  assert.equal(expiryProblem('2026-11-10T08:00', '2026-11-09T08:00', NOW), EXPIRY_TEXT.beforeManufacture, 'a day before')
  assert.equal(expiryProblem('2026-11-10T08:00', '2026-11-10T08:00', NOW), EXPIRY_TEXT.beforeManufacture, 'equal is refused: strictly after')
  assert.equal(expiryProblem('2026-11-10T08:00', '2026-11-10T07:59', NOW), EXPIRY_TEXT.beforeManufacture, 'a minute before')
  assert.equal(expiryProblem('2026-11-10T08:00', '2026-11-12T08:00', NOW), '')
  // Manufacture after the expiry (the other field changed last) is the same problem, reported under Hạn dùng.
  assert.equal(expiryProblem('2026-11-13T08:00', '2026-11-12T08:00', NOW), EXPIRY_TEXT.beforeManufacture)
})

test('expiry already past is reported while typing; empty or half-typed values are not errors yet', () => {
  assert.equal(expiryProblem('2026-11-01T08:00', '2026-11-10T11:59', NOW), EXPIRY_TEXT.past, 'before now (12:00 in Vietnam)')
  assert.equal(expiryProblem('2026-11-01T08:00', '2026-11-10T12:00', NOW), EXPIRY_TEXT.past, 'exactly now is refused')
  assert.equal(expiryProblem('2026-11-01T08:00', '2026-11-10T12:01', NOW), '')
  assert.equal(expiryProblem('', '2026-11-12T08:00', NOW), '', 'no manufacture time yet: only the future rule applies')
  assert.equal(expiryProblem('2026-11-10T08:00', '', NOW), '')
  assert.equal(expiryProblem('2026-11-10T08:00', '2026-11-1', NOW), '')
})

test('expiry min follows the manufacture time (one minute later) and is never in the past; times are Vietnam time', () => {
  assert.equal(expiryMin('', NOW), undefined)
  assert.equal(expiryMin('2026-11-12T08:00', NOW), '2026-11-12T08:01')
  assert.equal(expiryMin('2026-11-01T08:00', NOW), '2026-11-10T12:01', 'old manufacture time: the minimum is the next minute from now')
  assert.equal(instantToLocalDateTime('2026-11-09T17:30:00Z'), '2026-11-10T00:30', 'UTC+7 crosses midnight')
  assert.equal(instantToLocalDateTime('nope'), '')
  assert.match(expiryHint('2026-11-12T08:00', NOW), /Sớm nhất 12\/11\/2026 08:01/)
  assert.match(expiryHint('', NOW), /sau thời điểm sản xuất/)
})

test('validation: every field, and a form with any error sends nothing', () => {
  assert.deepEqual(validateBatch(values(), NOW), {})
  const errors = validateBatch(NEW_BATCH, NOW)
  assert.deepEqual(Object.keys(errors).sort(), ['batchCode', 'expiresAt', 'manufacturedAt', 'productId', 'quantity'])
  assert.equal(errors.manufacturedAt, MANUFACTURED_REQUIRED)
  assert.equal(errors.expiresAt, EXPIRY_TEXT.required)
  assert.equal(validateBatch(values({ expiresAt: '2026-11-10T07:00' }), NOW).expiresAt, EXPIRY_TEXT.beforeManufacture)
  assert.ok(validateBatch(values({ batchCode: 'x'.repeat(65) }), NOW).batchCode)
  assert.equal(validateBatch(values({ quantity: '0' }), NOW).quantity, QUANTITY_TEXT)
  assert.throws(() => createBatchBody(values({ expiresAt: '2026-11-10T07:00' }), NOW), error => error instanceof ValidationError && error.fieldErrors.expiresAt === EXPIRY_TEXT.beforeManufacture)
})

test('quantity: whole numbers 1..2147483647, Vietnamese grouping allowed', () => {
  assert.equal(parseQuantity('20'), 20)
  assert.equal(parseQuantity(' 1.000 '), 1000)
  assert.equal(parseQuantity('2147483647'), 2147483647)
  for (const raw of ['', '0', '-1', '1,5', '1.5', '2147483648', 'abc', '1e3']) assert.equal(parseQuantity(raw), undefined, raw)
})

test('create body: exactly the five contract fields, code trimmed and uppercased, Vietnam times as UTC instants', () => {
  const body = createBatchBody(values(), NOW)
  assert.deepEqual(body, { batchCode: 'MANGO-20261110-01', productId: PRODUCT_ID, manufacturedAt: '2026-11-10T01:00:00.000Z', expiresAt: '2026-11-12T01:00:00.000Z', quantity: 20 })
  assert.deepEqual(Object.keys(body).sort(), ['batchCode', 'expiresAt', 'manufacturedAt', 'productId', 'quantity'])
})

test('URL filters: only a UUID productId and an approved sort reach the API', () => {
  const filters = readBatchFilters(new URLSearchParams(`productId=${PRODUCT_ID}&sort=expiresAt,asc&page=3`))
  assert.deepEqual(batchListQuery(filters, 20), { page: 3, size: 20, productId: PRODUCT_ID, sort: 'expiresAt,asc' })
  const junk = readBatchFilters(new URLSearchParams('productId=abc&sort=stock,desc&page=-2'))
  assert.deepEqual(batchListQuery(junk, 20), { page: 0, size: 20, productId: undefined, sort: 'createdAt,desc' })
  assert.deepEqual(BATCH_SORT.fields, ['id', 'batchCode', 'manufacturedAt', 'expiresAt', 'quantity', 'createdAt'])
})

test('loaded / declared: text, state and next step', () => {
  assert.deepEqual(loadedView(0, 20), { text: '0 / 20 hộp', state: 'none', detail: 'Chưa nạp hộp nào vào ngăn.', percent: 0 })
  assert.deepEqual(loadedView(8, 20), { text: '8 / 20 hộp', state: 'partial', detail: 'Còn nạp được 12 hộp.', percent: 40 })
  assert.equal(loadedView(20, 20).state, 'full')
  assert.equal(loadedView(1000, 1500).text, '1.000 / 1.500 hộp')
  assert.equal(loadedView(2, 5, true).detail, 'Lô đã hết hạn, không nạp thêm được.', 'an expired batch never offers more loading')
  assert.equal(loadedView(2, 5, true).text, '2 / 5 hộp')
  assert.equal(loadedView(25, 20).percent, 100, 'legacy data above the declared quantity does not overflow the bar')
})

test('save errors: taken code under Mã lô, inactive or missing product under Sản phẩm, date rules under Hạn dùng', () => {
  for (const message of ['Batch code is already in use', 'Request conflicts with existing data', 'Mã lô này đã tồn tại.']) {
    const described = describeSaveError(new ApiError(409, message))
    assert.deepEqual(described.fieldErrors, { batchCode: CODE_TAKEN }, message)
    assert.deepEqual(describeFormFailure(described), { message: CHECK_FIELDS, fieldErrors: { batchCode: CODE_TAKEN } })
  }
  assert.deepEqual(describeSaveError(new ApiError(409, 'Product must be ACTIVE to create a batch')).fieldErrors, { productId: PRODUCT_INACTIVE })
  assert.deepEqual(describeSaveError(new ApiError(409, 'Sản phẩm đang ngừng bán, không thể tạo lô.')).fieldErrors, { productId: PRODUCT_INACTIVE })
  assert.deepEqual(describeSaveError(new ApiError(404, 'Product not found')).fieldErrors, { productId: PRODUCT_GONE })
  const otherMissing = describeSaveError(new ApiError(404, 'Creator not found'))
  assert.ok(otherMissing instanceof ApiError && !(otherMissing instanceof ValidationError))
  assert.equal(otherMissing.message, NOT_FOUND_OTHER)
  assert.deepEqual(describeFormFailure(otherMissing), { message: NOT_FOUND_OTHER })
  assert.deepEqual(describeSaveError(new ApiError(400, 'Expiration must be after preparation time')).fieldErrors, { expiresAt: EXPIRY_TEXT.beforeManufacture })
  assert.deepEqual(describeSaveError(new ApiError(400, 'Batch must not already be expired')).fieldErrors, { expiresAt: EXPIRY_TEXT.past })
  assert.deepEqual(describeSaveError(new ApiError(400, 'Validation Failed', { batchCode: 'must not be blank', quantity: 'must be greater than 0' })).fieldErrors,
    { batchCode: 'Không được để trống.', quantity: QUANTITY_TEXT })
  const unknown = describeSaveError(new ApiError(400, 'Validation Failed', { createdBy: 'Unknown field' }))
  assert.ok(unknown instanceof ApiError)
  assert.match(unknown.message, /createdBy/)
  const forbidden = new ApiError(403, 'Access denied')
  assert.equal(describeSaveError(forbidden), forbidden)
  assert.equal(translateFieldError('batchCode', 'size must be between 1 and 64'), 'Tối đa 64 ký tự.')
})

test('mock: loaded count is totalElements of /inventory?batchId (all statuses), creating and loading change it', async () => {
  let token = null
  const fetcher = createMockFetcher(parseSelection('all'), { getSearch: () => '', now: () => Date.now(), realFetch: async () => { throw new Error('no network') } })
  configureClient({ baseUrl: '', fetcher, getToken: () => token, onUnauthorized: () => {} })
  token = (await authApi.login({ email: MOCK_ACCOUNTS.staff, password: MOCK_PASSWORDS.staff })).accessToken

  const counts = await countLoaded([batchId(1), batchId(2), batchId(4), '50000000-0000-0000-0000-0000000000ff'])
  assert.deepEqual(counts[batchId(1)], { ok: true, loaded: 8 })
  assert.deepEqual(counts[batchId(2)], { ok: true, loaded: 7 }, 'loaded into two slots')
  assert.deepEqual(counts[batchId(4)], { ok: true, loaded: 2 }, 'expired batch keeps its figure')
  assert.deepEqual(counts['50000000-0000-0000-0000-0000000000ff'], { ok: true, loaded: 0 }, 'unknown batch filter is an empty page')

  // STAFF creates a batch (BATCH_CREATE); the server refuses an expiry before manufacture and a taken code.
  const later = Date.now() + 3 * 86_400_000
  const local = offset => instantToLocalDateTime(later + offset)
  const body = createBatchBody(values({ batchCode: 'fm4-test-01', manufacturedAt: local(-86_400_000), expiresAt: local(0), quantity: '3' }), Date.now())
  const created = await batchesApi.create(body)
  assert.equal(created.batchCode, 'FM4-TEST-01')
  assert.deepEqual((await countLoaded([created.id]))[created.id], { ok: true, loaded: 0 })
  await assert.rejects(batchesApi.create(body), error => describeSaveError(error).fieldErrors?.batchCode === CODE_TAKEN)
  await assert.rejects(batchesApi.create({ ...body, batchCode: 'FM4-TEST-02', expiresAt: body.manufacturedAt }), error => error.status === 400 && !!describeSaveError(error).fieldErrors?.expiresAt)
  await assert.rejects(batchesApi.create({ ...body, batchCode: 'FM4-TEST-03', productId: INACTIVE_PRODUCT_ID }), error => describeSaveError(error).fieldErrors?.productId === PRODUCT_INACTIVE)
  // Order of ProductBatchService.createBatch: taken code (409) before product (404 / 409 INACTIVE) before dates, which
  // come as a 400 without field errors.
  await assert.rejects(batchesApi.create({ ...body, productId: INACTIVE_PRODUCT_ID, expiresAt: body.manufacturedAt }), error => error.status === 409 && describeSaveError(error).fieldErrors?.batchCode === CODE_TAKEN)
  await assert.rejects(batchesApi.create({ ...body, batchCode: 'FM4-TEST-04', productId: '40000000-0000-0000-0000-0000000000ff', expiresAt: body.manufacturedAt }), error => error.status === 404)
  await assert.rejects(batchesApi.create({ ...body, batchCode: 'FM4-TEST-05', productId: INACTIVE_PRODUCT_ID, expiresAt: body.manufacturedAt }), error => error.status === 409 && describeSaveError(error).fieldErrors?.productId === PRODUCT_INACTIVE)
  await assert.rejects(batchesApi.create({ ...body, batchCode: 'FM4-TEST-06', expiresAt: body.manufacturedAt }), error => error.status === 400 && !Object.keys(error.fieldErrors).length)

  await inventoryApi.load({ batchId: created.id, slotId: '30000000-0000-0000-0000-000000000002', quantity: 2 })
  assert.deepEqual((await countLoaded([created.id]))[created.id], { ok: true, loaded: 2 })
  assert.equal(loadedView(2, created.quantity).text, '2 / 3 hộp')

  // One batch failing does not hide the other: the request for batch 2 answers 500, batch 1 still gets its figure.
  configureClient({ fetcher: async (input, init) => String(input).includes(`batchId=${batchId(2)}`)
    ? new Response(JSON.stringify({ status: 500, error: 'Internal Server Error', message: 'An unexpected error occurred', path: '/api/v1/inventory', timestamp: new Date().toISOString() }), { status: 500, headers: { 'Content-Type': 'application/json' } })
    : fetcher(input, init) })
  const mixed = await countLoaded([batchId(1), batchId(2)])
  assert.deepEqual(mixed[batchId(1)], { ok: true, loaded: 8 })
  assert.equal(mixed[batchId(2)].ok, false)
  assert.equal(mixed[batchId(2)].error.status, 500)
  configureClient({ fetcher })
})
