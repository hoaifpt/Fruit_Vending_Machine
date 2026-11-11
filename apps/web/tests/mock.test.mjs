import test from 'node:test'
import assert from 'node:assert/strict'
import { ApiError, api, configureClient, request } from '../src/api/client.ts'
import { authApi, batchesApi, dispenseCommandsApi, inventoryApi, kioskCredentialsApi, machinesApi, ordersApi, paymentsApi, productsApi, slotsApi, usersApi, webhookLogsApi } from '../src/api/resources.ts'
import { parseToken } from '../src/api/session.ts'
import { ROLE_PERMISSIONS } from '../src/admin/permissions.ts'
import { createKioskApi } from '../src/kiosk/api.ts'
import { createMockFetcher, groupOf, isMockEnabled, parseSelection } from '../src/api/mock/fetcher.ts'
import { installMock } from '../src/api/mock/index.ts'
import { parseScenario, readScenario, SCENARIO_STORAGE_KEY } from '../src/api/mock/scenario.ts'
import { MOCK_ACCOUNTS, MOCK_PASSWORDS } from '../src/api/mock/seed.ts'
import { jsonResponse } from './helpers.mjs'

const MACHINE_ID = '20000000-0000-0000-0000-000000000001'
const SLOT_ID = '30000000-0000-0000-0000-000000000001'
const PRODUCT_ID = '40000000-0000-0000-0000-000000000001'
const EXPIRED_MANGO_ID = '40000000-0000-0000-0000-000000000004'
const KEY = 'any-kiosk-key'

function memoryStorage() {
  const values = new Map()
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key), values }
}

/** Real client wired to a fresh mock, as installMock does in the browser. */
function setup({ mode = 'all', ...overrides } = {}) {
  const state = { token: null, unauthorized: 0, search: '', clock: Date.now(), realCalls: [] }
  const fetcher = createMockFetcher(parseSelection(mode), {
    getSearch: () => state.search, now: () => state.clock,
    realFetch: async url => { state.realCalls.push(String(url)); return jsonResponse(200, { data: 'from-real-network' }) },
    ...overrides,
  })
  configureClient({ baseUrl: '', fetcher, getToken: () => state.token, onUnauthorized: () => { state.unauthorized += 1 } })
  return { state, fetcher }
}

async function signIn(state, account = 'admin') {
  const { accessToken } = await authApi.login({ email: MOCK_ACCOUNTS[account], password: MOCK_PASSWORDS[account] })
  state.token = accessToken
  return accessToken
}

const failsWith = (status, check = () => true) => error => error instanceof ApiError && error.status === status && check(error)

test('success responses use the { data, timestamp } envelope', async () => {
  const { fetcher } = setup()
  const response = await fetcher('/api/v1/auth/login', { method: 'POST', body: JSON.stringify({ email: MOCK_ACCOUNTS.admin, password: MOCK_PASSWORDS.admin }) })
  const body = await response.json()
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('Content-Type'), 'application/json')
  assert.ok(Number.isFinite(Date.parse(body.timestamp)))
  assert.equal(body.data.tokenType, 'Bearer')
})

test('error responses use the ApiErrorResponse shape', async () => {
  const { fetcher } = setup()
  const response = await fetcher('/api/v1/products')
  const body = await response.json()
  assert.equal(response.status, 401)
  assert.deepEqual(Object.keys(body).sort(), ['error', 'message', 'path', 'status', 'timestamp'])
  assert.equal(body.path, '/api/v1/products')
})

test('login gives each account a token the session layer accepts, with the right role', async () => {
  const { state } = setup()
  assert.deepEqual(parseToken(await signIn(state, 'admin')).user.roles, ['ADMIN'])
  assert.deepEqual(parseToken(await signIn(state, 'staff')).user.roles, ['STAFF'])
})

test('wrong password is 401 and does not reset a session', async () => {
  const { state } = setup()
  await assert.rejects(authApi.login({ email: MOCK_ACCOUNTS.admin, password: 'wrong' }), failsWith(401))
  assert.equal(state.unauthorized, 0)
})

test('GET /auth/me follows the draft contract', async () => {
  const { state } = setup()
  await signIn(state, 'staff')
  const me = await api.get('/auth/me')
  assert.equal(me.email, MOCK_ACCOUNTS.staff)
  assert.deepEqual(me.roles, ['STAFF'])
  assert.deepEqual([...me.permissions].sort(), ['BATCH_CREATE', 'BATCH_READ', 'INVENTORY_READ', 'INVENTORY_WRITE', 'MACHINE_READ', 'ORDER_READ', 'PRODUCT_READ'])
  // The mock reads the same table as the web (src/admin/permissions.ts), so the two cannot drift apart.
  assert.deepEqual(me.permissions, [...ROLE_PERMISSIONS.STAFF])
})

test('401 without a token reaches onUnauthorized through the real client', async () => {
  const { state } = setup()
  await assert.rejects(productsApi.list({}), failsWith(401))
  assert.equal(state.unauthorized, 1)
})

test('403 when the role is not allowed: STAFF on ADMIN endpoints', async () => {
  const { state } = setup()
  await signIn(state, 'staff')
  await assert.rejects(usersApi.list({}), failsWith(403))
  await assert.rejects(paymentsApi.list({}), failsWith(403))
  await assert.rejects(webhookLogsApi.list({}), failsWith(403))
  await assert.rejects(productsApi.create({ sku: 'X', name: 'X', price: 1 }), failsWith(403))
  await assert.doesNotReject(productsApi.list({}))
  assert.equal(state.unauthorized, 0)
})

test('400 carries the message and per-field errors; unknown fields are rejected', async () => {
  const { state } = setup()
  await signIn(state)
  await assert.rejects(productsApi.create({ sku: 'NEW', name: 'New', price: 0 }), failsWith(400, error => !!error.fieldErrors.price && error.message.length > 0))
  await assert.rejects(productsApi.create({ sku: 'NEW', name: 'New', price: 1000, status: 'ACTIVE' }), failsWith(400, error => !!error.fieldErrors.status))
})

test('409 shows the business message', async () => {
  const { state } = setup()
  await signIn(state)
  await assert.rejects(productsApi.create({ sku: 'dev-mango', name: 'Copy', price: 1000 }), failsWith(409, error => /SKU/.test(error.message)))
})

test('every endpoint the web calls has a handler', async () => {
  const { state } = setup()
  await signIn(state)
  const notImplemented = failsWith(501)
  const calls = [
    () => usersApi.list({}), () => usersApi.create({ email: 'n@freshvend.test', password: 'long-enough-password', fullName: 'N' }), () => usersApi.update('11000000-0000-0000-0000-000000000002', { fullName: 'S' }), () => usersApi.setStatus('11000000-0000-0000-0000-000000000002', 'ACTIVE'),
    () => productsApi.list({}), () => productsApi.create({ sku: 'NEW-1', name: 'N', price: 1000 }), () => productsApi.update(PRODUCT_ID, { name: 'N', price: 1000 }), () => productsApi.setStatus(PRODUCT_ID, 'ACTIVE'),
    () => machinesApi.list({}), () => machinesApi.get(MACHINE_ID), () => machinesApi.create({ code: 'M', name: 'M', location: 'L', minTemperature: 1, maxTemperature: 2, minHumidity: 1, maxHumidity: 2 }), () => machinesApi.update(MACHINE_ID, { name: 'M', location: 'L', minTemperature: 1, maxTemperature: 2, minHumidity: 1, maxHumidity: 2 }), () => machinesApi.setStatus(MACHINE_ID, 'ACTIVE'),
    () => slotsApi.list(MACHINE_ID, {}), () => slotsApi.create(MACHINE_ID, { slotCode: 'Z9', capacity: 3 }), () => slotsApi.update(MACHINE_ID, SLOT_ID, { capacity: 10 }), () => slotsApi.setStatus(MACHINE_ID, SLOT_ID, 'ACTIVE'), () => slotsApi.summary(MACHINE_ID, SLOT_ID),
    () => kioskCredentialsApi.list(MACHINE_ID), () => kioskCredentialsApi.issue(MACHINE_ID), () => kioskCredentialsApi.revoke(MACHINE_ID, '80000000-0000-0000-0000-000000000001'),
    () => batchesApi.list({}), () => batchesApi.create({ batchCode: 'B', productId: PRODUCT_ID, manufacturedAt: new Date(state.clock - 1000).toISOString(), expiresAt: new Date(state.clock + 1000).toISOString(), quantity: 1 }),
    () => inventoryApi.list({}), () => inventoryApi.history({}), () => inventoryApi.load({ batchId: '50000000-0000-0000-0000-000000000002', slotId: '30000000-0000-0000-0000-000000000002', quantity: 1 }), () => inventoryApi.remove('70000000-0000-0000-0000-000000000001', 'Hỏng'),
    () => ordersApi.list({}), () => ordersApi.get('90000000-0000-0000-0000-000000000001'), () => dispenseCommandsApi.listForOrder('90000000-0000-0000-0000-000000000001'),
    () => paymentsApi.list({}), () => paymentsApi.get('a0000000-0000-0000-0000-000000000001'),
    () => webhookLogsApi.list({}), () => webhookLogsApi.get('b0000000-0000-0000-0000-000000000001'),
  ]
  for (const call of calls) await assert.doesNotReject(call().catch(error => { if (notImplemented(error)) throw error }))
})

test('parses VITE_API_MOCK: all, a list of groups, or off', () => {
  assert.equal(parseSelection('all').all, true)
  assert.deepEqual(parseSelection(' Auth , orders ').groups, ['auth', 'orders'])
  assert.deepEqual(parseSelection('orders,nope').unknown, ['nope'])
  assert.equal(isMockEnabled(parseSelection('')), false)
  assert.equal(isMockEnabled(parseSelection(undefined)), false)
  assert.equal(isMockEnabled(parseSelection('nope')), false)
})

test('classifies each path into its group', () => {
  assert.equal(groupOf('/machines/m1/slots/s1/inventory/summary'), 'slots')
  assert.equal(groupOf('/machines/m1/kiosk-credentials'), 'kiosk-credentials')
  assert.equal(groupOf('/machines/m1'), 'machines')
  assert.equal(groupOf('/product-batches'), 'batches')
  assert.equal(groupOf('/payment-webhook-logs/l1'), 'webhook-logs')
  assert.equal(groupOf('/kiosk/orders'), 'kiosk')
  assert.equal(groupOf('/telemetry'), null)
})

test('groups that are off pass through to the real fetch, groups that are on never do', async () => {
  const { state } = setup({ mode: 'auth,orders' })
  await signIn(state)
  assert.equal((await ordersApi.list({})).totalElements, 47) // 45 of machine 1 + 2 behind the held / failed heads of machine 2
  assert.equal(state.realCalls.length, 0)
  assert.equal(await productsApi.list({ page: 0 }), 'from-real-network')
  assert.deepEqual(state.realCalls, ['/api/v1/products?page=0'])
})

test('with all, an endpoint without a handler is 501 in the error shape and stays off the network', async () => {
  const { state, fetcher } = setup()
  await signIn(state)
  const response = await fetcher('/api/v1/telemetry')
  assert.equal(response.status, 501)
  assert.equal((await response.json()).status, 501)
  await assert.rejects(request('GET', '/telemetry'), failsWith(501))
  assert.equal(state.realCalls.length, 0)
})

test('with a group list, unknown endpoints pass through but an unhandled route in an enabled group is 501', async () => {
  const { state } = setup({ mode: 'orders,auth' })
  await signIn(state)
  assert.equal(await request('GET', '/telemetry'), 'from-real-network')
  await assert.rejects(request('DELETE', '/orders/o1'), failsWith(501))
})

test('pages, filters and sorts orders on the server side', async () => {
  const { state } = setup()
  await signIn(state)
  const first = await ordersApi.list({ page: 0, size: 20 })
  assert.deepEqual([first.content.length, first.page, first.size, first.totalElements, first.totalPages], [20, 0, 20, 47, 3])
  const last = await ordersApi.list({ page: 2, size: 20 })
  assert.equal(last.content.length, 7)
  assert.equal(new Set([...first.content, ...last.content].map(row => row.id)).size, 27)
  assert.equal((await ordersApi.list({ page: 9, size: 20 })).content.length, 0)
  const completed = await ordersApi.list({ status: 'COMPLETED', size: 100 })
  assert.ok(completed.totalElements > 0 && completed.content.every(row => row.status === 'COMPLETED'))
  const sorted = (await ordersApi.list({ sort: 'totalAmount,desc', size: 100 })).content.map(row => row.totalAmount)
  assert.deepEqual(sorted, [...sorted].sort((a, b) => b - a))
  const newest = await ordersApi.list({ size: 1 })
  assert.ok(newest.content[0].createdAt >= first.content[1].createdAt)
})

test('rejects page, size and sort values the backend rejects', async () => {
  const { state } = setup()
  await signIn(state)
  await assert.rejects(ordersApi.list({ size: 101 }), failsWith(400, error => !!error.fieldErrors.size))
  await assert.rejects(ordersApi.list({ page: -1 }), failsWith(400, error => !!error.fieldErrors.page))
  await assert.rejects(ordersApi.list({ sort: 'password,asc' }), failsWith(400, error => !!error.fieldErrors.sort))
})

test('filters by search, date range and requiresAttention', async () => {
  const { state } = setup()
  await signIn(state)
  assert.deepEqual((await productsApi.list({ search: 'MANGO' })).content.map(row => row.sku), ['DEV-MANGO'])
  const all = (await ordersApi.list({ size: 100 })).content
  const from = all[9].createdAt, to = all[4].createdAt
  const windowed = await ordersApi.list({ createdFrom: from, createdTo: to, size: 100 })
  assert.equal(windowed.totalElements, 5) // from is inclusive, to is exclusive
  const attention = await paymentsApi.list({ requiresAttention: true, size: 100 })
  assert.ok(attention.totalElements >= 3)
  assert.ok(attention.content.every(row => row.status === 'SUCCESS'))
})

test('list and detail payloads keep secrets and raw payloads where the contract says', async () => {
  const { state } = setup()
  await signIn(state)
  const user = (await usersApi.list({})).content[0]
  assert.equal(user.password, undefined)
  const credential = (await kioskCredentialsApi.list(MACHINE_ID))[0]
  assert.equal(credential.apiKey, undefined)
  const logs = (await webhookLogsApi.list({ size: 100 })).content
  assert.ok(logs.every(row => !('rawPayload' in row) && !('rawBody' in row)))
  const markup = await webhookLogsApi.get('b0000000-0000-0000-0000-000000000010')
  assert.match(markup.rawBody, /<script>/)
  assert.equal(markup.rawPayload, null)
})

test('writes update the store and show up on later reads', async () => {
  const { state } = setup()
  await signIn(state)
  const product = await productsApi.create({ sku: 'kiwi-1', name: 'Kiwi', price: 45000 })
  assert.equal(product.sku, 'KIWI-1')
  assert.equal(product.status, 'ACTIVE')
  assert.equal((await productsApi.list({ search: 'kiwi' })).totalElements, 1)
  await productsApi.setStatus(product.id, 'INACTIVE')
  assert.equal((await productsApi.list({ search: 'kiwi', status: 'INACTIVE' })).totalElements, 1)
  const loaded = await inventoryApi.load({ batchId: '50000000-0000-0000-0000-000000000001', slotId: SLOT_ID, quantity: 2 })
  assert.equal(loaded.items.length, 2)
  assert.equal((await inventoryApi.history({ referenceId: loaded.operationId })).totalElements, 2)
  await assert.rejects(inventoryApi.load({ batchId: '50000000-0000-0000-0000-000000000001', slotId: SLOT_ID, quantity: 1 }), failsWith(409, error => /sức chứa/.test(error.message)))
})

test('issuing a kiosk key revokes the previous one and the old key stops working', async () => {
  const { state } = setup()
  await signIn(state)
  const first = await kioskCredentialsApi.issue(MACHINE_ID)
  assert.ok(first.apiKey)
  await assert.doesNotReject(createKioskApi(first.apiKey).me())
  await kioskCredentialsApi.issue(MACHINE_ID)
  await assert.rejects(createKioskApi(first.apiKey).me(), failsWith(401))
})

test('kiosk: identity and catalog use the machine key, expired heads are not sold', async () => {
  setup()
  await assert.rejects(createKioskApi('').me(), failsWith(401))
  const kiosk = createKioskApi(KEY)
  assert.equal((await kiosk.me()).data.machineCode, 'DEV-MACHINE-01')
  const catalog = (await kiosk.catalog()).data
  assert.equal(catalog.acceptingOrders, true)
  const ids = catalog.products.map(product => product.productId)
  assert.ok(ids.includes(PRODUCT_ID))
  assert.ok(!ids.includes(EXPIRED_MANGO_ID))
  assert.equal(catalog.products.find(product => product.productId === PRODUCT_ID).availableQuantity, 8)
})

test('kiosk: buying flows from order to QR to paid to completed, on the server clock', async () => {
  const { state } = setup({ autoPayMs: 10_000, dispenseMs: 4_000 })
  const kiosk = createKioskApi(KEY)
  const order = await kiosk.createOrder(PRODUCT_ID)
  assert.equal(order.status, 201)
  assert.equal(order.data.status, 'PENDING_PAYMENT')
  assert.equal(order.data.totalAmount, 35000)
  assert.equal(order.data.currentPayment, null)
  assert.ok(order.serverTime)

  const payment = await kiosk.createPayment(order.data.id)
  assert.equal(payment.status, 201)
  assert.match(payment.data.qrCode, /\|35000$/)
  assert.ok(!payment.data.qrCode.startsWith('MOCK-QR|'), 'that prefix makes the page call a real webhook outside the client')
  assert.equal((await kiosk.createPayment(order.data.id)).status, 200)

  state.clock += 10_000
  assert.equal((await kiosk.getOrder(order.data.id)).data.status, 'PAID')
  state.clock += 4_000
  assert.equal((await kiosk.getOrder(order.data.id)).data.status, 'COMPLETED')
  await assert.rejects(kiosk.cancelOrder(order.data.id), failsWith(409))

  await signIn(state)
  const detail = await ordersApi.get(order.data.id)
  assert.equal(detail.items[0].allocations[0].status, 'DISPENSED')
  assert.equal(detail.payments[0].status, 'SUCCESS')
})

test('kiosk: cancelling releases the reserved head and is idempotent', async () => {
  setup()
  const kiosk = createKioskApi(KEY)
  const { data: order } = await kiosk.createOrder(PRODUCT_ID)
  assert.equal((await kiosk.catalog()).data.products.some(product => product.productId === PRODUCT_ID), false, 'a reserved head blocks its slot')
  assert.equal((await kiosk.cancelOrder(order.id)).data.status, 'CANCELLED')
  assert.equal((await kiosk.cancelOrder(order.id)).status, 200)
  assert.equal((await kiosk.catalog()).data.products.some(product => product.productId === PRODUCT_ID), true)
})

test('kiosk: an unpaid order is released when its reservation expires', async () => {
  const { state } = setup({ autoPayMs: 10 ** 9 })
  const kiosk = createKioskApi(KEY)
  const { data: order } = await kiosk.createOrder(PRODUCT_ID)
  state.clock += 5 * 60_000
  assert.equal((await kiosk.getOrder(order.id)).data.status, 'CANCELLED')
})

test('kiosk: a product that cannot be sold is 409, an unknown one 404', async () => {
  setup()
  const kiosk = createKioskApi(KEY)
  await assert.rejects(kiosk.createOrder(EXPIRED_MANGO_ID), failsWith(409))
  await assert.rejects(kiosk.createOrder('40000000-0000-0000-0000-00000000ffff'), failsWith(404))
})

test('kiosk: order and payment calls cannot touch another machine\'s order', async () => {
  const { state } = setup()
  await signIn(state)
  const kiosk = createKioskApi(KEY)
  const { data: order } = await kiosk.createOrder(PRODUCT_ID)
  await machinesApi.setStatus('20000000-0000-0000-0000-000000000002', 'ACTIVE')
  const other = await kioskCredentialsApi.issue('20000000-0000-0000-0000-000000000002')
  await assert.rejects(createKioskApi(other.apiKey).getOrder(order.id), failsWith(404))
})

test('scenario empty clears lists but not single records', async () => {
  const { state } = setup()
  await signIn(state)
  state.search = '?scenario=empty'
  assert.deepEqual(await ordersApi.list({ page: 0, size: 20 }), { content: [], page: 0, size: 20, totalElements: 0, totalPages: 0 })
  assert.deepEqual(await kioskCredentialsApi.list(MACHINE_ID), [])
  assert.equal((await machinesApi.get(MACHINE_ID)).id, MACHINE_ID)
  assert.deepEqual((await createKioskApi(KEY).catalog()).data.products, [])
})

test('scenario slow delays the response and honours the abort signal', async () => {
  const { state } = setup({ slowMs: 60 })
  await signIn(state)
  state.search = '?scenario=slow'
  const started = performance.now()
  await ordersApi.list({})
  assert.ok(performance.now() - started >= 50)
  const controller = new AbortController()
  const pending = ordersApi.list({}, controller.signal)
  controller.abort()
  await assert.rejects(pending, error => error.name === 'AbortError')
})

test('scenario error500 is generic and network is status 0', async () => {
  const { state } = setup()
  await signIn(state)
  state.search = '?scenario=error500'
  await assert.rejects(ordersApi.list({}), failsWith(500, error => /sự cố/.test(error.message)))
  state.search = '?scenario=network'
  await assert.rejects(ordersApi.list({}), failsWith(0))
})

test('scenarios 401 and 403 go through the real client handling', async () => {
  const { state } = setup()
  await signIn(state)
  state.search = '?scenario=401'
  await assert.rejects(ordersApi.list({}), failsWith(401))
  assert.equal(state.unauthorized, 1)
  state.search = '?scenario=403'
  await assert.rejects(ordersApi.list({}), failsWith(403))
  assert.equal(state.unauthorized, 1)
})

test('scenario expire rejects the old session once; signing in again works, also after a reload', async () => {
  const storage = memoryStorage()
  const { state } = setup({ storage })
  await signIn(state, 'staff')
  state.clock += 5_000
  state.search = '?scenario=expire'
  await assert.rejects(ordersApi.list({}), failsWith(401))
  await assert.rejects(productsApi.list({}), failsWith(401))
  assert.equal(state.unauthorized, 2)
  state.clock += 5_000
  state.search = '?next=%2Fadmin%2Forders'
  await signIn(state, 'staff')
  state.search = '?scenario=expire'
  await assert.doesNotReject(ordersApi.list({}))
  // A full reload creates a new mock fetcher; the start time comes back from storage.
  const reloaded = setup({ storage })
  reloaded.state.clock = state.clock
  reloaded.state.token = state.token
  reloaded.state.search = '?page=2'
  await assert.doesNotReject(ordersApi.list({}))
  reloaded.state.search = '?scenario=none'
  await assert.doesNotReject(ordersApi.list({}))
})

test('scenario expire: signing in again within the same second as the expiry still works', async () => {
  const { state } = setup({ storage: memoryStorage() })
  state.clock = Math.floor(Date.now() / 1000) * 1000 + 100
  await signIn(state, 'admin')
  const oldToken = state.token
  state.clock += 200
  state.search = '?scenario=expire'
  await assert.rejects(ordersApi.list({}), failsWith(401))
  state.clock += 200 // still the same whole second as the old token's `iat`
  state.search = '?next=%2Fadmin%2Forders'
  await signIn(state, 'admin')
  state.search = '?scenario=expire'
  await assert.doesNotReject(ordersApi.list({}))
  state.token = oldToken
  await assert.rejects(ordersApi.list({}), failsWith(401))
})

test('mock enforces roles: STAFF gets 403 on ADMIN-only endpoints', async () => {
  const { state } = setup()
  await signIn(state, 'staff')
  await assert.rejects(paymentsApi.list({}), failsWith(403))
  await assert.doesNotReject(ordersApi.list({}))
})

test('scenarios 400 and 409 hit writes only and leave the page loadable; only 400 carries fieldErrors', async () => {
  const { state } = setup()
  await signIn(state)
  for (const status of [400, 409]) {
    state.search = `?scenario=${status}`
    await assert.doesNotReject(productsApi.list({}))
  }
  state.search = '?scenario=400'
  await assert.rejects(productsApi.create({ sku: 'A', name: 'A', price: 1000 }), failsWith(400, error => error.message.length > 0 && !!error.fieldErrors.sku))
  // GlobalExceptionHandler.handleConflict: business message only, no fieldErrors.
  state.search = '?scenario=409'
  await assert.rejects(productsApi.create({ sku: 'A', name: 'A', price: 1000 }), failsWith(409, error => error.message.length > 0 && Object.keys(error.fieldErrors).length === 0))
})

test('error bodies follow GlobalExceptionHandler: fieldErrors only when present, "Validation Failed" for 400 with fields', async () => {
  const { state, fetcher } = setup()
  await signIn(state)
  const post = (body) => fetcher('/api/v1/products', { method: 'POST', headers: { Authorization: `Bearer ${state.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  state.search = '?scenario=409'
  const conflict = await (await post({ sku: 'A', name: 'A', price: 1000 })).json()
  assert.equal(conflict.status, 409)
  assert.equal(conflict.error, 'Conflict')
  assert.equal('fieldErrors' in conflict, false)
  state.search = '?scenario=400'
  const invalid = await (await post({ sku: 'A', name: 'A', price: 1000 })).json()
  assert.equal(invalid.error, 'Validation Failed')
  assert.deepEqual(Object.keys(invalid.fieldErrors), ['sku'])
  state.search = ''
  const duplicate = await (await post({ sku: 'dev-mango', name: 'Copy', price: 1000 })).json()
  assert.equal(duplicate.status, 409)
  assert.equal('fieldErrors' in duplicate, false)
})

test('targeted scenarios only affect the named group or path, on any method', async () => {
  const { state } = setup()
  await signIn(state)
  state.search = '?scenario=403:orders,payments'
  await assert.rejects(ordersApi.list({}), failsWith(403))
  await assert.rejects(paymentsApi.list({}), failsWith(403))
  await assert.doesNotReject(productsApi.list({}))
  state.search = '?scenario=409:/inventory/load'
  await assert.rejects(inventoryApi.load({ batchId: 'b', slotId: 's', quantity: 1 }), failsWith(409))
  await assert.doesNotReject(inventoryApi.list({}))
  state.search = '?scenario=400:/products'
  await assert.rejects(productsApi.list({}), failsWith(400))
})

test('a carried-over scenario leaves login working; one in the login URL applies to it', async () => {
  const storage = memoryStorage()
  const { state } = setup({ storage })
  state.search = '?scenario=401'
  await assert.rejects(authApi.login({ email: MOCK_ACCOUNTS.admin, password: MOCK_PASSWORDS.admin }), failsWith(401))
  state.search = '?next=%2Fadmin'
  await assert.doesNotReject(authApi.login({ email: MOCK_ACCOUNTS.admin, password: MOCK_PASSWORDS.admin }))
})

test('scenario survives navigation via storage until cleared', () => {
  const storage = memoryStorage()
  assert.equal(readScenario('?scenario=403', storage).name, '403')
  assert.equal(storage.values.get(SCENARIO_STORAGE_KEY), '403')
  const carried = readScenario('?page=2', storage)
  assert.equal(carried.name, '403')
  assert.equal(carried.explicit, false)
  assert.equal(readScenario('?scenario=none', storage), null)
  assert.equal(readScenario('', storage), null)
  assert.equal(readScenario('?scenario=403', null).name, '403')
})

test('parseScenario handles targets and rejects unknown names', () => {
  assert.deepEqual(parseScenario('403:orders, /inventory/load'), { name: '403', targets: ['orders', '/inventory/load'], explicit: false })
  assert.equal(parseScenario('nope'), null)
  assert.equal(parseScenario(''), null)
})

test('the pending scenario keeps the QR unpaid', async () => {
  const { state } = setup({ autoPayMs: 1000 })
  state.search = '?scenario=pending'
  const kiosk = createKioskApi(KEY)
  const { data: order } = await kiosk.createOrder(PRODUCT_ID)
  await kiosk.createPayment(order.id)
  state.clock += 60_000
  const polled = (await kiosk.getOrder(order.id)).data
  assert.equal(polled.status, 'PENDING_PAYMENT')
  assert.equal(polled.currentPayment.status, 'PENDING')
})

test('installMock plugs into the client once, logs it, and stays off when empty', async t => {
  const info = t.mock.method(console, 'info', () => {})
  const warn = t.mock.method(console, 'warn', () => {})
  let realCalls = 0
  configureClient({ fetcher: async () => { realCalls += 1; return jsonResponse(200, { data: 'real' }) } })
  assert.equal(installMock(''), null)
  assert.equal(installMock(undefined), null)
  assert.equal(info.mock.callCount(), 0)
  assert.equal(await request('GET', '/products'), 'real')

  assert.equal(installMock('all,nope', { latencyMs: 0 }).all, true)
  assert.equal(info.mock.callCount(), 1)
  assert.equal(warn.mock.callCount(), 1)
  configureClient({ getToken: () => null, onUnauthorized: () => {} })
  await assert.rejects(request('GET', '/products'), failsWith(401))
  assert.equal(realCalls, 1)
})

/** An unsigned token shaped like the backend's (JwtService: sub, email, roles as ROLE_*), for an account the mock store lacks. */
function realBackendToken({ sub = '99999999-0000-0000-0000-000000000001', roles = ['ROLE_ADMIN'], exp = Math.floor(Date.now() / 1000) + 900 } = {}) {
  const part = value => Buffer.from(JSON.stringify(value)).toString('base64url')
  return `${part({ alg: 'HS256', typ: 'JWT' })}.${part({ sub, email: 'real.admin@freshvend.vn', roles, iat: Math.floor(Date.now() / 1000), exp })}.signature`
}

test('one mocked group with the real sign-in: a real token is served by role instead of signing the user out', async () => {
  const { fetcher, state } = setup({ mode: 'roles' })
  const call = (path, token) => fetcher(`/api/v1${path}`, { headers: { Authorization: `Bearer ${token}` } })
  const admin = await call('/roles', realBackendToken())
  assert.equal(admin.status, 200)
  assert.ok((await admin.json()).data.some(role => role.name === 'ADMIN'))
  // The mock's role table still decides: a real STAFF token is refused like on the backend, not signed out.
  assert.equal((await call('/roles', realBackendToken({ roles: ['ROLE_STAFF'] }))).status, 403)
  // Expired, or no roles claim: still 401.
  assert.equal((await call('/roles', realBackendToken({ exp: Math.floor(Date.now() / 1000) - 10 }))).status, 401)
  const noRoles = `${realBackendToken().split('.')[0]}.${Buffer.from(JSON.stringify({ sub: 'x', exp: Math.floor(Date.now() / 1000) + 900 })).toString('base64url')}.s`
  assert.equal((await call('/roles', noRoles)).status, 401)
  // Groups that are not mocked still go to the real network.
  await call('/products', realBackendToken())
  assert.deepEqual(state.realCalls, ['/api/v1/products'])
})

test('with auth mocked, an account missing from the mock store is still refused', async () => {
  for (const mode of ['all', 'auth,roles']) {
    const { fetcher } = setup({ mode })
    const response = await fetcher('/api/v1/roles', { headers: { Authorization: `Bearer ${realBackendToken()}` } })
    assert.equal(response.status, 401, mode)
  }
})
