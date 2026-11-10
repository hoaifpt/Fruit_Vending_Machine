import test from 'node:test'
import assert from 'node:assert/strict'
import { ApiError, configureClient } from '../src/api/client.ts'
import { CHECK_FIELDS, ValidationError, describeFormFailure } from '../src/admin/form-error.ts'
import { authApi, productsApi } from '../src/api/resources.ts'
import { createMockFetcher, parseSelection } from '../src/api/mock/fetcher.ts'
import { MOCK_ACCOUNTS, MOCK_PASSWORDS } from '../src/api/mock/seed.ts'
import {
  PRICE_TEXT, PRODUCT_SORT, SKU_TAKEN, createProductBody, describeSaveError, formatPrice, parsePriceInput, priceInputValue,
  productListQuery, readProductFilters, statusAction, translateFieldError, updateProductBody, validateProduct,
} from '../src/admin/products.ts'

const values = (patch = {}) => ({ sku: ' mango-box-001 ', name: '  Hộp xoài  ', description: '', price: '35000', imageUrl: '', ...patch })
const problem = raw => { const result = parsePriceInput(raw); return result.ok ? result.value : result.problem }

test('price input: plain, Vietnamese thousands and decimal notations give the exact value', () => {
  assert.equal(problem('35000'), 35000)
  assert.equal(problem('35.000'), 35000)
  assert.equal(problem('1.234.567'), 1234567)
  assert.equal(problem('1.234.567,89'), 1234567.89)
  assert.equal(problem('35000,5'), 35000.5)
  assert.equal(problem('35000.25'), 35000.25)
  assert.equal(problem('35.00'), 35)
  assert.equal(problem(' 35 000 ₫ '), 35000)
  assert.equal(problem('0,01'), 0.01)
  assert.equal(problem('9999999999,99'), 9999999999.99)
})

test('price input: ≤ 0, wrong format, too many decimals and too large are refused with a reason', () => {
  assert.equal(problem(''), 'empty')
  assert.equal(problem('   '), 'empty')
  assert.equal(problem('0'), 'notPositive')
  assert.equal(problem('0,00'), 'notPositive')
  assert.equal(problem('-5'), 'notPositive')
  assert.equal(problem('-35.000'), 'notPositive')
  assert.equal(problem('abc'), 'format')
  assert.equal(problem('35k'), 'format')
  assert.equal(problem('1e5'), 'format')
  assert.equal(problem('35,000.5'), 'format')
  assert.equal(problem('35000,123'), 'decimals')
  assert.equal(problem('10000000000'), 'tooLarge')
  const result = parsePriceInput('0')
  assert.equal(result.ok, false)
  assert.equal(result.message, PRICE_TEXT.notPositive)
})

test('price display is VND with dot grouping and keeps up to 2 decimals; the input value reads back the same', () => {
  assert.equal(formatPrice(35000).replace(/\s/g, ' '), '35.000 ₫')
  assert.equal(formatPrice(35000.5).replace(/\s/g, ' '), '35.000,5 ₫')
  assert.equal(formatPrice(undefined), '—')
  for (const value of [35000, 35000.5, 1234567.89, 0.01]) {
    const result = parsePriceInput(priceInputValue(value))
    assert.equal(result.ok && result.value, value)
  }
  assert.equal(priceInputValue(35000), '35.000')
})

test('URL filters: only contract values reach the API, sort falls back to createdAt,desc', () => {
  const filters = readProductFilters(new URLSearchParams('status=ACTIVE&search=%20xoai%20&sort=price,desc&page=2'))
  assert.deepEqual(filters, { status: 'ACTIVE', search: 'xoai', sort: { field: 'price', direction: 'desc' }, page: 2 })
  assert.deepEqual(productListQuery(filters, 20), { page: 2, size: 20, status: 'ACTIVE', search: 'xoai', sort: 'price,desc' })

  const junk = readProductFilters(new URLSearchParams('status=DELETED&sort=stock,asc&page=-1'))
  assert.deepEqual(junk, { status: '', search: '', sort: { field: 'createdAt', direction: 'desc' }, page: 0 })
  assert.deepEqual(productListQuery(junk, 20), { page: 0, size: 20, status: undefined, search: undefined, sort: 'createdAt,desc' })
  assert.equal(readProductFilters(new URLSearchParams(`search=${'a'.repeat(250)}`)).search.length, 200)
  assert.deepEqual(PRODUCT_SORT.fields, ['id', 'sku', 'name', 'price', 'status', 'createdAt', 'updatedAt'])
})

test('validation: SKU only on create, name required, price rules, image length', () => {
  assert.deepEqual(validateProduct(values(), 'create'), {})
  const errors = validateProduct(values({ sku: ' ', name: '', price: '0', imageUrl: 'x'.repeat(2049) }), 'create')
  assert.deepEqual(Object.keys(errors).sort(), ['imageUrl', 'name', 'price', 'sku'])
  assert.equal(errors.price, PRICE_TEXT.notPositive)
  assert.deepEqual(validateProduct(values({ sku: '' }), 'edit'), {}, 'the SKU is not checked (nor sent) when editing')
  assert.ok(validateProduct(values({ sku: 'x'.repeat(65) }), 'create').sku)
  assert.ok(validateProduct(values({ name: 'x'.repeat(201) }), 'create').name)
})

test('create body: exactly the contract fields, SKU trimmed and uppercased, optional fields only when given', () => {
  assert.deepEqual(createProductBody(values()), { sku: 'MANGO-BOX-001', name: 'Hộp xoài', price: 35000 })
  assert.deepEqual(createProductBody(values({ description: ' Xoài cát ', imageUrl: ' https://x.test/a.jpg ', price: '35.000,5' })),
    { sku: 'MANGO-BOX-001', name: 'Hộp xoài', price: 35000.5, description: 'Xoài cát', imageUrl: 'https://x.test/a.jpg' })
  assert.throws(() => createProductBody(values({ price: '-1' })), ValidationError)
})

test('update body: never SKU or status; empty optional fields are sent as null (PUT replaces)', () => {
  const body = updateProductBody(values({ price: '40.000' }))
  assert.deepEqual(body, { name: 'Hộp xoài', description: null, price: 40000, imageUrl: null })
  assert.equal('sku' in body, false)
  assert.equal('status' in body, false)
})

test('status action: stop selling an active product, sell an inactive one again (contract enum)', () => {
  assert.deepEqual(statusAction('ACTIVE'), { next: 'INACTIVE', label: 'Ngừng bán' })
  assert.deepEqual(statusAction('INACTIVE'), { next: 'ACTIVE', label: 'Mở bán lại' })
})

test('save errors: duplicate SKU once under the SKU field; 400 field errors in Vietnamese under their fields', () => {
  const duplicate = describeSaveError(new ApiError(409, 'SKU is already in use'))
  assert.ok(duplicate instanceof ValidationError)
  assert.deepEqual(duplicate.fieldErrors, { sku: SKU_TAKEN })
  assert.deepEqual(describeFormFailure(duplicate), { message: CHECK_FIELDS, fieldErrors: { sku: SKU_TAKEN } })

  const other = new ApiError(409, 'Database conflict')
  assert.equal(describeSaveError(other), other, 'another conflict keeps its own message')
  const server = new ApiError(500, 'boom')
  assert.equal(describeSaveError(server), server)

  const invalid = describeSaveError(new ApiError(400, 'Validation Failed', { price: 'must be greater than 0', name: 'must not be blank' }))
  assert.deepEqual(invalid.fieldErrors, { price: PRICE_TEXT.notPositive, name: 'Không được để trống.' })

  const unknown = describeSaveError(new ApiError(400, 'Validation Failed', { status: 'Unknown field' }))
  assert.ok(unknown instanceof ApiError)
  assert.match(describeFormFailure(unknown).message, /status: Unknown field/)
  assert.equal(describeFormFailure(unknown).fieldErrors, undefined)
  assert.equal(translateFieldError('name', 'size must be between 1 and 200'), 'Tối đa 200 ký tự.')
  assert.equal(translateFieldError('price', 'numeric value out of bounds (<10 digits>.<2 digits> expected)'), 'Giá tối đa 10 chữ số phần nguyên và 2 chữ số thập phân.')
})

test('mock /products follows the contract: search on name/SKU only, 409 duplicate SKU, status enum, staff read-only', async () => {
  let token = null
  const fetcher = createMockFetcher(parseSelection('all'), { getSearch: () => '', now: () => Date.now(), realFetch: async () => { throw new Error('no network') } })
  configureClient({ baseUrl: '', fetcher, getToken: () => token, onUnauthorized: () => {} })
  token = (await authApi.login({ email: MOCK_ACCOUNTS.admin, password: MOCK_PASSWORDS.admin })).accessToken
  const all = await productsApi.list({ size: 100 })
  assert.ok(all.content.some(row => row.status === 'ACTIVE') && all.content.some(row => row.status === 'INACTIVE'))
  assert.equal((await productsApi.list({ search: 'Development sample' })).totalElements, 0, 'description is not searched')
  assert.deepEqual((await productsApi.list({ search: 'dev-guava' })).content.map(row => row.sku), ['DEV-GUAVA'])
  const prices = (await productsApi.list({ sort: 'price,asc', size: 100 })).content.map(row => row.price)
  assert.deepEqual(prices, [...prices].sort((a, b) => a - b))

  const body = createProductBody(values({ sku: 'dev-guava' }))
  await assert.rejects(productsApi.create(body), error => {
    const described = describeSaveError(error)
    return error.status === 409 && described instanceof ValidationError && described.fieldErrors.sku === SKU_TAKEN
  })
  await assert.rejects(productsApi.create({ ...body, sku: 'NEW-NAME', name: 'x'.repeat(201) }), error => error.status === 400 && !!error.fieldErrors.name)
  const created = await productsApi.create(createProductBody(values({ sku: 'kiwi-fm3', price: '45.000,5' })))
  assert.equal(created.sku, 'KIWI-FM3')
  assert.equal(created.price, 45000.5)
  const updated = await productsApi.update(created.id, updateProductBody(values({ name: 'Kiwi', price: '46000' })))
  assert.equal(updated.sku, 'KIWI-FM3')
  assert.equal(updated.price, 46000)
  assert.equal((await productsApi.setStatus(created.id, 'INACTIVE')).status, 'INACTIVE')
  assert.equal((await productsApi.setStatus(created.id, 'ACTIVE')).status, 'ACTIVE')

  token = (await authApi.login({ email: MOCK_ACCOUNTS.staff, password: MOCK_PASSWORDS.staff })).accessToken
  await assert.doesNotReject(productsApi.list({}))
  await assert.rejects(productsApi.setStatus(created.id, 'INACTIVE'), error => error.status === 403)
  await assert.rejects(productsApi.update(created.id, updateProductBody(values())), error => error.status === 403)
})
