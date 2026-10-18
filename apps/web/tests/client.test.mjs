import test from 'node:test'
import assert from 'node:assert/strict'
import { ApiError, api, buildUrl, configureClient } from '../src/api/client.ts'
import { productsApi, slotsApi } from '../src/api/resources.ts'
import { jsonResponse } from './helpers.mjs'

function setup(handler, extra = {}) {
  const calls = []
  configureClient({ baseUrl: 'http://api.test', getToken: () => 'tok', onUnauthorized: () => {}, ...extra, fetcher: async (url, init) => { calls.push({ url, init }); return handler(url, init) } })
  return calls
}

test('builds /api/v1 URLs from the configured base and drops empty query values', () => {
  assert.equal(buildUrl('/products', { page: 0, size: 20, search: '', status: undefined, sort: 'name,asc', expired: false }, 'http://x'), 'http://x/api/v1/products?page=0&size=20&sort=name%2Casc&expired=false')
})

test('unwraps the data envelope and sends the Bearer token', async () => {
  const calls = setup(() => jsonResponse(200, { timestamp: 't', message: 'ok', data: { content: [], page: 0, size: 20, totalElements: 0, totalPages: 0 } }))
  const page = await productsApi.list({ page: 0, size: 20, status: 'ACTIVE' })
  assert.deepEqual(page, { content: [], page: 0, size: 20, totalElements: 0, totalPages: 0 })
  assert.equal(calls[0].url, 'http://api.test/api/v1/products?page=0&size=20&status=ACTIVE')
  assert.equal(calls[0].init.headers.Authorization, 'Bearer tok')
})

test('sends JSON bodies exactly as given and no body for body-less POSTs', async () => {
  const calls = setup(() => jsonResponse(200, { data: {} }))
  await slotsApi.update('m1', 's1', { capacity: 8 })
  await api.post('/machines/m1/kiosk-credentials')
  assert.equal(calls[0].init.body, '{"capacity":8}')
  assert.equal(calls[0].init.headers['Content-Type'], 'application/json')
  assert.equal(calls[1].init.body, undefined)
  assert.equal(calls[1].init.headers['Content-Type'], undefined)
})

test('400 with fieldErrors exposes them per field', async () => {
  setup(() => jsonResponse(400, { status: 400, message: 'Validation failed', fieldErrors: { price: 'must be greater than 0' } }))
  await assert.rejects(productsApi.create({ sku: 'A', name: 'A', price: 0 }), error => error instanceof ApiError && error.status === 400 && error.fieldErrors.price === 'must be greater than 0')
})

test('409 shows the business message; 403 and 404 use fixed text; 5xx never leaks details', async () => {
  setup(() => jsonResponse(409, { message: 'Cannot disable the last active ADMIN' }))
  await assert.rejects(api.get('/x'), /last active ADMIN/)
  setup(() => jsonResponse(403, { message: 'secret internal detail' }))
  await assert.rejects(api.get('/x'), error => error.status === 403 && /không có quyền/.test(error.message) && !/secret/.test(error.message))
  setup(() => jsonResponse(404, { message: 'detail' }))
  await assert.rejects(api.get('/x'), /Không tìm thấy/)
  setup(() => new Response('<html>stack trace at com.example</html>', { status: 500 }))
  await assert.rejects(api.get('/x'), error => error.status === 500 && !/stack|com\.example|html/i.test(error.message))
})

test('401 on an authenticated request calls onUnauthorized once', async () => {
  let count = 0
  setup(() => jsonResponse(401, { message: 'expired' }), { onUnauthorized: () => { count += 1 } })
  await assert.rejects(api.get('/products'), error => error.status === 401)
  assert.equal(count, 1)
})

test('network failure becomes a generic ApiError with status 0', async () => {
  configureClient({ baseUrl: '', fetcher: async () => { throw new TypeError('fetch failed http://secret-host') } })
  await assert.rejects(api.get('/x'), error => error.status === 0 && !/secret-host/.test(error.message))
})
