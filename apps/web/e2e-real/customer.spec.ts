// Customer flows (kiosk purchase, public incident report) against the REAL backend. Case table: e2e-real/cases/customer.md.
//
// SAFETY: the local backend runs PAYMENT_PROVIDER=PAYOS (real payment gateway). No test calls
// POST /kiosk/orders/{id}/payments: API tests never do, and every browser context routes that URL to a local stub
// (counted, never forwarded). Cases that need a real payment are skipped with the reason.
//
// Isolation: M1 (REAL_MACHINE_ID) is only read. Orders are created on a fresh E2E machine (own slot, product, batch,
// 3 boxes, kiosk key) and cancelled at the end. The spec starts its own Vite servers for the kiosk:
//   5810: kiosk key of the E2E machine, 5811: a wrong key, 5812: the M1 key (REAL_KIOSK_KEY). Keys are never printed.
import { test, expect, request as pwRequest } from '@playwright/test'
import type { APIRequestContext, APIResponse, Page, BrowserContext } from '@playwright/test'
import { spawn, execSync } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import path from 'node:path'
import { API, KIOSK_KEY, MACHINE_ID, apiAs, dataOf, errorOf, uniq } from './real.ts'

const WEB_DIR = path.resolve(import.meta.dirname, '..')
const ADMIN_UI = process.env.REAL_BASE_URL || 'http://localhost:5800'
const KIOSK_E2E = 'http://localhost:5810'
const KIOSK_BADKEY = 'http://localhost:5811'
const KIOSK_M1 = 'http://localhost:5812'
const PAYMENTS_GLOB = '**/api/v1/kiosk/orders/*/payments'
const BOGUS_TOKEN = 'E2E-bogus-token-000000000000'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const LEAK_RE = /(Exception|\bat (com|org|java)\.|stack|trace|SQL|select |insert |hibernate|postgres|constraint)/i
const BLOCKED_PAYOS = 'Chặn: BE dùng payOS thật, không test để tránh tạo giao dịch thật'

const S = {
  admin: null as APIRequestContext | null,
  e2eKiosk: null as APIRequestContext | null,
  m1Kiosk: null as APIRequestContext | null,
  pub: null as APIRequestContext | null,
  machineId: '', machineCode: '', productId: '', productName: '', otherProductId: '', e2eKey: '',
  orders: new Set<string>(),
  vites: [] as ChildProcess[],
  paymentCallsStubbed: 0,
}

/** Asserts a JSON error envelope that leaks no stack trace, SQL or class names. */
async function cleanError(response: APIResponse, status: number) {
  const body = await errorOf(response, status)
  expect(JSON.stringify(body)).not.toMatch(LEAK_RE)
  return body
}

async function startVite(port: number, key: string) {
  const child = spawn('npx', ['vite', '--port', String(port), '--strictPort'], {
    cwd: WEB_DIR, shell: true, stdio: 'ignore', windowsHide: true,
    env: { ...process.env, VITE_KIOSK_API_KEY: key, VITE_API_MOCK: '' },
  })
  S.vites.push(child)
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    try { const r = await fetch(`http://localhost:${port}/buy`); if (r.ok) return } catch { /* not up yet */ }
    await new Promise(resolve => setTimeout(resolve, 500))
  }
  throw new Error(`vite on ${port} did not start`)
}

function stopVites() {
  for (const child of S.vites) {
    try { if (child.pid) execSync(`taskkill /pid ${child.pid} /T /F`, { stdio: 'ignore' }) } catch { /* already gone */ }
  }
  S.vites = []
}

/** Every browser context answers the payments URL locally: the real payOS endpoint is never reached from the UI. */
async function guardPayments(context: BrowserContext) {
  await context.route(PAYMENTS_GLOB, route => {
    S.paymentCallsStubbed += 1
    return route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ status: 502, error: 'Bad Gateway', message: 'E2E stub: payment provider not called' }) })
  })
}

/** Collects console errors and page errors; resource-load lines for expected 4xx are kept apart. */
function watchConsole(page: Page) {
  const errors: string[] = [], network: string[] = []
  page.on('console', msg => { if (msg.type() === 'error') (msg.text().startsWith('Failed to load resource') ? network : errors).push(msg.text()) })
  page.on('pageerror', error => errors.push(`pageerror: ${error.message}`))
  return { errors, network }
}

/** Records order ids created from the browser so afterAll can cancel them. */
function trackOrders(page: Page) {
  page.on('response', async response => {
    if (response.request().method() === 'POST' && /\/api\/v1\/kiosk\/orders$/.test(new URL(response.url()).pathname) && response.status() === 201) {
      try { const id = (await response.json()).data?.id; if (id) S.orders.add(id) } catch { /* ignore */ }
    }
  })
}

/** The countdown must match the server's expiresAt (within a few seconds), whatever the configured hold. */
async function expectCountdownMatches(page: Page, expiresAt: string) {
  const label = await page.getByRole('timer').getAttribute('aria-label')
  const match = label?.match(/Còn (\d+) phút (\d+) giây để thanh toán/)
  expect(match, 'timer label ' + label).toBeTruthy()
  const shown = Number(match![1]) * 60 + Number(match![2])
  const expected = (Date.parse(expiresAt) - Date.now()) / 1000
  expect(Math.abs(shown - expected), 'shown ' + shown + ' s, server ' + Math.round(expected) + ' s').toBeLessThan(10)
}

async function newKioskOrder(): Promise<any> {
  const order = await dataOf(await S.e2eKiosk!.post(`${API}/kiosk/orders`, { data: { productId: S.productId } }), 201)
  S.orders.add(order.id)
  return order
}

async function cancelOrder(id: string) {
  const response = await S.e2eKiosk!.post(`${API}/kiosk/orders/${id}/cancel`)
  if (response.status() === 200) S.orders.delete(id)
  return response
}

async function catalogOf(kiosk: APIRequestContext) {
  return dataOf(await kiosk.get(`${API}/kiosk/catalog`))
}

function reportMultipart(report: Record<string, unknown>, photos: { name: string; mimeType: string; buffer: Buffer }[] = []) {
  const multipart: Record<string, any> = { report: { name: 'report.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(report)) } }
  // Playwright multipart takes one value per key; a single photo is enough for these cases.
  if (photos[0]) multipart.photos = photos[0]
  return multipart
}

const VALID_REPORT = { type: 'MACHINE_FAULT', description: 'E2E: màn hình không phản hồi', contactName: null, contactPhone: null, contactEmail: null, consent: true, website: '' }

/** 1x1 PNG. */
const PNG_1PX = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082', 'hex')

// Not serial: one failing case must not hide the others. After a failure the worker restarts and beforeAll builds a fresh E2E machine.
test.describe.configure({ mode: 'default' })

test.describe('Customer flows on the real backend', () => {
  test.beforeAll(async () => {
    test.setTimeout(180_000)
    expect(MACHINE_ID, 'REAL_MACHINE_ID').toMatch(UUID_RE)
    expect(KIOSK_KEY.length, 'REAL_KIOSK_KEY').toBeGreaterThan(10)
    S.admin = await apiAs('ADMIN')
    S.m1Kiosk = await apiAs('KIOSK')
    S.pub = await apiAs('PUBLIC')
    const tag = uniq()
    S.machineCode = `E2E-CUS-${tag}`
    const machine = await dataOf(await S.admin.post(`${API}/machines`, { data: { code: S.machineCode, name: `E2E Khách ${tag}`, location: 'E2E lab', minTemperature: 2, maxTemperature: 8, minHumidity: 40, maxHumidity: 80 } }), 201)
    S.machineId = machine.id
    await dataOf(await S.admin.patch(`${API}/machines/${S.machineId}/status`, { data: { status: 'ACTIVE' } }))
    const slot = await dataOf(await S.admin.post(`${API}/machines/${S.machineId}/slots`, { data: { slotCode: 'A', capacity: 5 } }), 201)
    S.productName = `E2E Táo ${tag}`
    const product = await dataOf(await S.admin.post(`${API}/products`, { data: { sku: `E2E-CUS-${tag}`, name: S.productName, description: 'E2E khách hàng', price: 2000 } }), 201)
    S.productId = product.id
    const other = await dataOf(await S.admin.post(`${API}/products`, { data: { sku: `E2E-CUS-NS-${tag}`, name: `E2E Không có trên máy ${tag}`, price: 3000 } }), 201)
    S.otherProductId = other.id
    const now = Date.now()
    const batch = await dataOf(await S.admin.post(`${API}/product-batches`, { data: { batchCode: `E2E-CUS-${tag}`, productId: S.productId, manufacturedAt: new Date(now - 3_600_000).toISOString(), expiresAt: new Date(now + 3 * 86_400_000).toISOString(), quantity: 3 } }), 201)
    const load = await S.admin.post(`${API}/inventory/load`, { data: { batchId: batch.id, slotId: slot.id, quantity: 3 } })
    expect([200, 201], await load.text()).toContain(load.status())
    const credential = await dataOf(await S.admin.post(`${API}/machines/${S.machineId}/kiosk-credentials`), 201)
    S.e2eKey = credential.apiKey
    S.e2eKiosk = await pwRequest.newContext({ extraHTTPHeaders: { 'X-Kiosk-Key': S.e2eKey } })
    await Promise.all([startVite(5810, S.e2eKey), startVite(5811, 'fvk_e2ewrongkey0_' + 'x'.repeat(43)), startVite(5812, KIOSK_KEY)])
  })

  test.afterAll(async () => {
    test.setTimeout(120_000)
    for (const id of [...S.orders]) {
      const r = await cancelOrder(id)
      console.log(`cleanup cancel ${id}: ${r.status()}`)
    }
    // Leaves the E2E machine INACTIVE so no other suite sells from it.
    if (S.admin && S.machineId) await S.admin.patch(`${API}/machines/${S.machineId}/status`, { data: { status: 'INACTIVE' } })
    stopVites()
    console.log(`payments URL answered by the local stub ${S.paymentCallsStubbed} time(s); never forwarded to the backend`)
  })

  test.beforeEach(async ({ context }) => { await guardPayments(context) })

  // ---------------------------------------------------------------- Kiosk API
  test('CUS-01 GET /kiosk/me with the E2E machine key returns that machine only', async () => {
    const me = await dataOf(await S.e2eKiosk!.get(`${API}/kiosk/me`))
    expect(me).toMatchObject({ machineId: S.machineId, machineCode: S.machineCode, machineStatus: 'ACTIVE' })
    expect(JSON.stringify(me)).not.toMatch(/apiKey|keyHash|reportToken|fvk_/)
  })

  test('CUS-02 M1 key: /kiosk/me is M1, catalog accepts orders (records how many products are sellable)', async () => {
    const me = await dataOf(await S.m1Kiosk!.get(`${API}/kiosk/me`))
    expect(me.machineId).toBe(MACHINE_ID)
    const catalog = await catalogOf(S.m1Kiosk!)
    expect(catalog.machineId).toBe(MACHINE_ID)
    expect(catalog.acceptingOrders).toBe(true)
    console.log(`M1 catalog: ${catalog.products.length} product(s): ${catalog.products.map((p: any) => `${p.name}=${p.price}`).join(', ')}`)
    // Brief said M1 sells 2 products at 2.000 ₫. When the catalog is empty, every head must be unsellable (expired batch / not AVAILABLE).
    if (catalog.products.length === 0) {
      const inventory = await dataOf(await S.admin!.get(`${API}/machines/${MACHINE_ID}/inventory?size=100`))
      const inMachine = inventory.content.filter((item: any) => ['AVAILABLE', 'RESERVED', 'EXPIRED', 'DISPENSE_FAILED'].includes(item.status))
      const sellable = inMachine.filter((item: any) => item.status === 'AVAILABLE' && !item.expired && Date.parse(item.expiresAt) > Date.now() + 5 * 60_000)
      test.info().annotations.push({ type: 'data', description: `M1: ${inMachine.length} box(es) in the machine, ${sellable.length} sellable; catalog empty` })
      expect(sellable.length, 'empty catalog must mean nothing sellable').toBe(0)
    } else {
      for (const product of catalog.products) expect(Number(product.price)).toBe(2000)
    }
  })

  test('CUS-03 catalog of the E2E machine: right product, server price 2000, 3 boxes, no internal ids', async () => {
    const catalog = await catalogOf(S.e2eKiosk!)
    expect(catalog).toMatchObject({ machineId: S.machineId, acceptingOrders: true })
    expect(catalog.products).toHaveLength(1)
    const product = catalog.products[0]
    expect(product).toMatchObject({ productId: S.productId, name: S.productName, availableQuantity: 3 })
    expect(Number(product.price)).toBe(2000)
    expect(JSON.stringify(catalog)).not.toMatch(/slotId|batchId|inventoryItemId|"slotCode"/)
  })

  test('CUS-04 missing / malformed / unknown kiosk key -> 401, same body, no leak', async () => {
    const anon = await cleanError(await S.pub!.get(`${API}/kiosk/catalog`), 401)
    const malformed = await pwRequest.newContext({ extraHTTPHeaders: { 'X-Kiosk-Key': 'not-a-key' } })
    const unknown = await pwRequest.newContext({ extraHTTPHeaders: { 'X-Kiosk-Key': 'fvk_zzzzzzzzzzzz_' + 'A'.repeat(43) } })
    const truncated = await pwRequest.newContext({ extraHTTPHeaders: { 'X-Kiosk-Key': S.e2eKey.slice(0, -2) } })
    const a = await cleanError(await malformed.get(`${API}/kiosk/catalog`), 401)
    const b = await cleanError(await unknown.get(`${API}/kiosk/catalog`), 401)
    const c = await cleanError(await truncated.get(`${API}/kiosk/me`), 401)
    for (const body of [a, b, c]) expect(body.message).toBe(anon.message)
    await Promise.all([malformed.dispose(), unknown.dispose(), truncated.dispose()])
  })

  test('CUS-05 user JWT on /kiosk/** -> 403; JWT plus kiosk key -> 401; kiosk key on management API -> 401', async () => {
    await cleanError(await S.admin!.get(`${API}/kiosk/me`), 403)
    const token = (await (await S.pub!.post(`${API}/auth/login`, { data: { email: process.env.REAL_ADMIN_EMAIL, password: process.env.REAL_ADMIN_PASSWORD } })).json()).data.accessToken
    const mixed = await pwRequest.newContext({ extraHTTPHeaders: { 'X-Kiosk-Key': S.e2eKey, Authorization: `Bearer ${token}` } })
    await cleanError(await mixed.get(`${API}/kiosk/me`), 401)
    await mixed.dispose()
    await cleanError(await S.e2eKiosk!.get(`${API}/machines`), 401)
    await cleanError(await S.e2eKiosk!.get(`${API}/orders`), 401)
  })

  test('CUS-06 POST /kiosk/orders {productId} -> 201 one box at the server price; column held; cancel returns the box', async () => {
    const order = await newKioskOrder()
    expect(order.status).toBe('PENDING_PAYMENT')
    expect(order.orderCode).toMatch(/^ORD-\d{8}-[0-9A-HJKMNP-TV-Z]{8}$/)
    expect(order.items).toHaveLength(1)
    expect(order.items[0].quantity).toBe(1)
    expect(Number(order.totalAmount)).toBe(2000)
    const holdMs = Date.parse(order.expiresAt) - Date.parse(order.createdAt)
    // ORDER_RESERVATION_TTL: PT5M by default (docs); this local backend may be configured otherwise, so only bounds are checked.
    test.info().annotations.push({ type: 'config', description: `reservation hold ${Math.round(holdMs / 1000)} s` })
    console.log(`reservation hold ${Math.round(holdMs / 1000)} s`)
    expect(holdMs).toBeGreaterThan(60_000); expect(holdMs).toBeLessThanOrEqual(15 * 60_000)
    expect(order.currentPayment ?? null).toBeNull()
    // The only slot's head is RESERVED, so the column is blocked and the product leaves the catalog.
    const during = await catalogOf(S.e2eKiosk!)
    expect(during.products.find((p: any) => p.productId === S.productId), 'product hidden while its only column is held').toBeUndefined()
    const cancelled = await dataOf(await cancelOrder(order.id))
    expect(cancelled.status).toBe('CANCELLED')
    const after = await catalogOf(S.e2eKiosk!)
    expect(after.products.find((p: any) => p.productId === S.productId)?.availableQuantity).toBe(3)
  })

  test('CUS-07 cancelling twice is idempotent (200 CANCELLED, box not returned twice)', async () => {
    const order = await newKioskOrder()
    expect((await dataOf(await cancelOrder(order.id))).status).toBe('CANCELLED')
    const again = await dataOf(await S.e2eKiosk!.post(`${API}/kiosk/orders/${order.id}/cancel`))
    expect(again.status).toBe('CANCELLED')
    expect((await catalogOf(S.e2eKiosk!)).products[0].availableQuantity).toBe(3)
  })

  test('CUS-08 order body: missing productId / empty / broken JSON / not JSON -> 400 with field errors, nothing held', async () => {
    const missing = await cleanError(await S.e2eKiosk!.post(`${API}/kiosk/orders`, { data: {} }), 400)
    expect(Object.keys(missing.fieldErrors ?? {})).toContain('productId')
    await cleanError(await S.e2eKiosk!.post(`${API}/kiosk/orders`, { data: { productId: null } }), 400)
    await cleanError(await S.e2eKiosk!.post(`${API}/kiosk/orders`, { headers: { 'Content-Type': 'application/json' }, data: '{"productId": ' }), 400)
    const plain = await S.e2eKiosk!.post(`${API}/kiosk/orders`, { headers: { 'Content-Type': 'text/plain' }, data: 'productId' })
    expect([400, 415]).toContain(plain.status())
    expect(await plain.text()).not.toMatch(LEAK_RE)
    expect((await catalogOf(S.e2eKiosk!)).products[0].availableQuantity).toBe(3)
  })

  test('CUS-09 productId not a UUID -> 400; unknown UUID -> 404; product not on this machine -> 409', async () => {
    await cleanError(await S.e2eKiosk!.post(`${API}/kiosk/orders`, { data: { productId: 'tao-123' } }), 400)
    await cleanError(await S.e2eKiosk!.post(`${API}/kiosk/orders`, { data: { productId: 12345 } }), 400)
    await cleanError(await S.e2eKiosk!.post(`${API}/kiosk/orders`, { data: { productId: '00000000-0000-4000-8000-000000000000' } }), 404)
    await cleanError(await S.e2eKiosk!.post(`${API}/kiosk/orders`, { data: { productId: S.otherProductId } }), 409)
    // The E2E product is not on M1 either.
    await cleanError(await S.m1Kiosk!.post(`${API}/kiosk/orders`, { data: { productId: S.productId } }), 409)
  })

  test('CUS-10 unknown fields (quantity, price, machineId, legacy items[]) -> 400, nothing held', async () => {
    for (const extra of [{ quantity: 2 }, { price: 1 }, { machineId: MACHINE_ID }, { status: 'PAID' }]) {
      await cleanError(await S.e2eKiosk!.post(`${API}/kiosk/orders`, { data: { productId: S.productId, ...extra } }), 400)
    }
    await cleanError(await S.e2eKiosk!.post(`${API}/kiosk/orders`, { data: { items: [{ productId: S.productId, quantity: 1 }] } }), 400)
    expect((await catalogOf(S.e2eKiosk!)).products[0].availableQuantity).toBe(3)
  })

  test('CUS-11 GET own order 200; order of another machine / unknown id -> 404; cancel of another machine -> 404', async () => {
    const order = await newKioskOrder()
    const own = await dataOf(await S.e2eKiosk!.get(`${API}/kiosk/orders/${order.id}`))
    expect(own).toMatchObject({ id: order.id, status: 'PENDING_PAYMENT' })
    const foreign = await cleanError(await S.m1Kiosk!.get(`${API}/kiosk/orders/${order.id}`), 404)
    const missing = await cleanError(await S.e2eKiosk!.get(`${API}/kiosk/orders/00000000-0000-4000-8000-000000000000`), 404)
    expect(foreign.message, 'foreign and unknown look the same').toBe(missing.message)
    await cleanError(await S.m1Kiosk!.post(`${API}/kiosk/orders/${order.id}/cancel`), 404)
    const notUuid = await S.e2eKiosk!.get(`${API}/kiosk/orders/not-a-uuid`)
    expect([400, 404]).toContain(notUuid.status())
    expect(await notUuid.text()).not.toMatch(LEAK_RE)
    expect((await dataOf(await S.e2eKiosk!.get(`${API}/kiosk/orders/${order.id}`))).status, 'M1 cancel did not touch it').toBe('PENDING_PAYMENT')
    expect((await dataOf(await cancelOrder(order.id))).status).toBe('CANCELLED')
  })

  test('CUS-12 kiosk creates a payment (201) and a second call reuses the QR (200)', async () => {
    test.skip(true, BLOCKED_PAYOS)
  })
  test('CUS-13 payment for a cancelled order -> 409', async () => {
    test.skip(true, BLOCKED_PAYOS)
  })
  test('CUS-14 payment attempts per order are capped at 5 -> 409', async () => {
    test.skip(true, BLOCKED_PAYOS)
  })
  test('CUS-15 paid order on an OFFLINE machine: PAID then dispense timeout / DISPENSE_FAILED on the kiosk', async () => {
    test.skip(true, `${BLOCKED_PAYOS}; thiếu REAL_MOCK_WEBHOOK_SECRET và provider đang là PAYOS`)
  })

  test('CUS-16 webhook: inactive provider /mock -> 404; forged payOS body -> 401; not JSON -> 415; >64 KB -> 413; order unchanged', async () => {
    const order = await newKioskOrder()
    const mockBody = JSON.stringify({ paymentReference: 'MOCK-E2EFAKE1', transactionId: 'MOCK-TXN-E2E', amount: 2000, status: 'SUCCESS' })
    const mock = await S.pub!.post(`${API}/webhooks/payments/mock`, { headers: { 'Content-Type': 'application/json', 'X-Mock-Signature': 'deadbeef' }, data: mockBody })
    console.log(`webhook /mock (provider PAYOS active): ${mock.status()}`)
    expect(mock.status()).toBe(404)
    expect(await mock.text()).not.toMatch(LEAK_RE)
    const forged = { code: '00', desc: 'success', success: true, data: { orderCode: 987654321, amount: 2000, description: order.orderCode, reference: 'E2E-FAKE', transactionDateTime: '2026-11-17 14:00:00', paymentLinkId: 'e2e-fake' }, signature: 'a'.repeat(64) }
    const noSig = { ...forged, signature: undefined }
    const r1 = await S.pub!.post(`${API}/webhooks/payments/payos`, { data: forged })
    const r2 = await S.pub!.post(`${API}/webhooks/payments/payos`, { data: noSig })
    const r3 = await S.pub!.post(`${API}/webhooks/payments/payos`, { headers: { 'Content-Type': 'application/json' }, data: '{"code":"00",' })
    const r4 = await S.pub!.post(`${API}/webhooks/payments/payos`, { headers: { 'Content-Type': 'text/plain' }, data: 'hello' })
    const r5 = await S.pub!.post(`${API}/webhooks/payments/payos`, { headers: { 'Content-Type': 'application/json' }, data: JSON.stringify({ pad: 'x'.repeat(70 * 1024) }) })
    const r6 = await S.pub!.get(`${API}/webhooks/payments/payos`)
    const seen = { forged: r1.status(), noSignature: r2.status(), brokenJson: r3.status(), textPlain: r4.status(), over64k: r5.status(), get: r6.status() }
    console.log(`webhook payos statuses ${JSON.stringify(seen)}`)
    for (const r of [r1, r2, r3, r4, r5, r6]) expect(await r.text()).not.toMatch(LEAK_RE)
    expect(seen).toEqual({ forged: 401, noSignature: 401, brokenJson: 401, textPlain: 415, over64k: 413, get: expect.any(Number) })
    expect([401, 403, 405]).toContain(r6.status())
    const after = await dataOf(await S.e2eKiosk!.get(`${API}/kiosk/orders/${order.id}`))
    expect(after.status).toBe('PENDING_PAYMENT')
    expect(after.currentPayment ?? null).toBeNull()
    expect((await dataOf(await cancelOrder(order.id))).status).toBe('CANCELLED')
  })

  test('CUS-17 GET /kiosk/incident-report-link: 200 absolute URL, or 409 REPORT_LINK_NOT_CONFIGURED without leaking config', async () => {
    const response = await S.e2eKiosk!.get(`${API}/kiosk/incident-report-link`)
    console.log(`incident-report-link: ${response.status()}`)
    if (response.status() === 200) {
      const link = (await response.json()).data
      expect(link.url).toMatch(/^https?:\/\/.+\/report\/[A-Za-z0-9_-]{22,32}/)
    } else {
      const body = await cleanError(response, 409)
      expect(body.message).toMatch(/^REPORT_LINK_NOT_CONFIGURED/)
    }
  })

  test('CUS-18 rotate report token: STAFF -> 403, kiosk key -> 401, ADMIN on E2E machine -> 200 or 409 not configured', async () => {
    const staff = await apiAs('STAFF')
    await cleanError(await staff.post(`${API}/machines/${S.machineId}/report-token/rotate`), 403)
    await staff.dispose()
    await cleanError(await S.e2eKiosk!.post(`${API}/machines/${S.machineId}/report-token/rotate`), 401)
    const rotate = await S.admin!.post(`${API}/machines/${S.machineId}/report-token/rotate`)
    console.log(`rotate on E2E machine: ${rotate.status()}`)
    if (rotate.status() !== 200) expect((await cleanError(rotate, 409)).message).toMatch(/^REPORT_LINK_NOT_CONFIGURED/)
    await cleanError(await S.admin!.post(`${API}/machines/00000000-0000-4000-8000-000000000000/report-token/rotate`), 404)
  })

  // ---------------------------------------------------------------- Public report API
  test('CUS-19 public form: unknown / malformed token -> 404 without auth, no leak', async () => {
    const unknown = await cleanError(await S.pub!.get(`${API}/public/report-forms/${BOGUS_TOKEN}`), 404)
    const odd = await S.pub!.get(`${API}/public/report-forms/${encodeURIComponent("x'; drop table machines;--")}`)
    expect([400, 404]).toContain(odd.status())
    expect(await odd.text()).not.toMatch(LEAK_RE)
    // An old admin JWT in the browser must not block the public form.
    const withJwt = await S.admin!.get(`${API}/public/report-forms/${BOGUS_TOKEN}`)
    expect(withJwt.status()).toBe(404)
    expect(unknown.message).toBeTruthy()
  })

  test('CUS-20 public submit to an unknown token -> 404 (valid body), invalid body still 404 or 400, no leak', async () => {
    const valid = await S.pub!.post(`${API}/public/report-forms/${BOGUS_TOKEN}/reports`, { multipart: reportMultipart(VALID_REPORT, [{ name: 'a.png', mimeType: 'image/png', buffer: PNG_1PX }]) })
    await cleanError(valid, 404)
    const invalid = await S.pub!.post(`${API}/public/report-forms/${BOGUS_TOKEN}/reports`, { multipart: reportMultipart({ type: 'NOPE', description: 'x'.repeat(1200), contactPhone: '123', consent: false, extra: 1 }) })
    console.log(`invalid body to unknown token: ${invalid.status()}`)
    expect([400, 404]).toContain(invalid.status())
    expect(await invalid.text()).not.toMatch(LEAK_RE)
  })

  test('CUS-21 public submit over 7 MB -> 413 before anything is stored', async () => {
    const big = Buffer.alloc(7 * 1024 * 1024 + 200_000, 1)
    const response = await S.pub!.post(`${API}/public/report-forms/${BOGUS_TOKEN}/reports`, { multipart: reportMultipart(VALID_REPORT, [{ name: 'big.png', mimeType: 'image/png', buffer: big }]) })
    console.log(`>7MB submit: ${response.status()}`)
    expect(await response.text()).not.toMatch(LEAK_RE)
    expect(response.status()).toBe(413)
  })

  test('CUS-22 valid report (multipart JSON + photo) -> 201 RPT code; field rules 400; photo >2 MB / wrong format 400', async () => {
    test.skip(true, 'Chặn: PUBLIC_REPORT_BASE_URL chưa cấu hình nên POST /machines/{id}/report-token/rotate trả 409 và không có cách hợp lệ (không đọc DB) để lấy report token của máy E2E')
  })

  test('CUS-23 repeated submissions -> 429 with Retry-After (5 / minute / source)', async () => {
    const statuses: number[] = []
    let retryAfter: string | undefined
    let body = ''
    for (let i = 0; i < 8; i++) {
      const r = await S.pub!.post(`${API}/public/report-forms/${BOGUS_TOKEN}/reports`, { multipart: reportMultipart(VALID_REPORT) })
      statuses.push(r.status())
      if (r.status() === 429) { retryAfter = r.headers()['retry-after']; body = await r.text(); break }
    }
    console.log(`burst statuses ${statuses.join(',')} retry-after=${retryAfter}`)
    expect(statuses).toContain(429)
    expect(Number(retryAfter)).toBeGreaterThan(0)
    expect(body).not.toMatch(LEAK_RE)
  })

  // ---------------------------------------------------------------- Kiosk UI (Vite with a kiosk key, real backend)
  test('CUS-30 kiosk UI: catalog of the E2E machine shows the product at 2.000 ₫, machine code, Báo sự cố', async ({ page }) => {
    const log = watchConsole(page)
    await page.goto(`${KIOSK_E2E}/buy`)
    await expect(page.getByRole('heading', { name: 'Chạm để chọn sản phẩm' })).toBeVisible()
    const card = page.locator('.buy-product', { hasText: S.productName })
    await expect(card).toBeVisible()
    await expect(card.locator('.buy-price strong')).toHaveText(/^2\.000\s₫$/)
    await expect(page.locator('.buy-machine')).toContainText(`Máy ${S.machineCode}`)
    await expect(page.getByRole('button', { name: /Báo sự cố/ })).toBeVisible()
    await page.screenshot({ path: test.info().outputPath('cus-30-catalog.png') })
    expect(log.errors).toEqual([])
  })

  test('CUS-31 kiosk UI: choose -> real order, countdown and total, payment stubbed (502) -> "Cổng thanh toán đang bận"; cancel -> "chưa bị trừ tiền", box back', async ({ page }) => {
    const log = watchConsole(page)
    trackOrders(page)
    await page.goto(`${KIOSK_E2E}/buy`)
    const created = page.waitForResponse(r => r.request().method() === 'POST' && r.url().endsWith('/api/v1/kiosk/orders'))
    await page.locator('.buy-product', { hasText: S.productName }).click()
    const order = (await (await created).json()).data
    expect(order.status).toBe('PENDING_PAYMENT')
    await expect(page.getByRole('heading', { name: S.productName })).toBeVisible()
    await expect(page.locator('.buy-pay-total dd')).toHaveText(/^2\.000\s₫$/)
    await expect(page.locator('.buy-pay-code')).toContainText(order.orderCode)
    const timer = page.getByRole('timer')
    await expect(timer).toHaveText(/\d+:\d\d/)
    await expectCountdownMatches(page, order.expiresAt)
    await expect(page.getByRole('alert').filter({ hasText: 'Cổng thanh toán đang bận' })).toContainText('Bạn chưa bị trừ tiền')
    const first = await timer.locator('strong').textContent()
    await page.waitForTimeout(2_200)
    expect(await timer.locator('strong').textContent(), 'countdown moves').not.toBe(first)
    await page.screenshot({ path: test.info().outputPath('cus-31-payment-busy.png') })
    await page.getByRole('button', { name: 'Hủy đơn và chọn lại' }).click()
    await expect(page.getByRole('heading', { name: 'Hủy đơn hàng?' })).toBeVisible()
    await page.getByRole('button', { name: 'Xác nhận hủy đơn' }).click()
    await expect(page.getByRole('heading', { name: 'Đơn hàng đã hủy' })).toBeVisible()
    await expect(page.locator('.buy-not-charged')).toHaveText('Bạn chưa bị trừ tiền.')
    await expect(page.getByText('Hộp trái cây đã được trả lại máy.')).toBeVisible()
    const after = await dataOf(await S.e2eKiosk!.get(`${API}/kiosk/orders/${order.id}`))
    expect(after.status).toBe('CANCELLED')
    S.orders.delete(order.id)
    await page.getByRole('button', { name: /Về danh sách sản phẩm/ }).click()
    await expect(page.getByRole('heading', { name: 'Chạm để chọn sản phẩm' })).toBeVisible()
    expect((await catalogOf(S.e2eKiosk!)).products[0].availableQuantity).toBe(3)
    expect(S.paymentCallsStubbed).toBeGreaterThan(0)
    expect(log.errors.filter(text => !/E2E stub/.test(text))).toEqual([])
  })

  test('CUS-32 kiosk UI: QR screen with countdown (real order, payment answer stubbed locally), cancel back to catalog', async ({ page }) => {
    const log = watchConsole(page)
    trackOrders(page)
    let stubbed: any = null
    await page.route(PAYMENTS_GLOB, async route => {
      S.paymentCallsStubbed += 1
      const orderId = route.request().url().split('/orders/')[1].split('/')[0]
      const real = await dataOf(await S.e2eKiosk!.get(`${API}/kiosk/orders/${orderId}`))
      stubbed = { paymentId: '00000000-0000-4000-8000-0000000e2e00', orderId, provider: 'PAYOS', status: 'PENDING', amount: real.totalAmount, qrCode: 'E2E-STUB-QR-NOT-PAYABLE', expiresAt: real.expiresAt }
      return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ timestamp: new Date().toISOString(), message: 'stub', data: stubbed }) })
    })
    // Polls read the real order; the stubbed attempt is added so the QR stays up.
    await page.route('**/api/v1/kiosk/orders/*', async route => {
      if (route.request().method() !== 'GET') return route.continue()
      const response = await route.fetch()
      const json = await response.json()
      if (stubbed && json.data && json.data.status === 'PENDING_PAYMENT' && !json.data.currentPayment) json.data.currentPayment = stubbed
      return route.fulfill({ response, json })
    })
    await page.goto(`${KIOSK_E2E}/buy`)
    await page.locator('.buy-product', { hasText: S.productName }).click()
    await expect(page.getByRole('img', { name: /Mã QR thanh toán 2\.000\s₫/ })).toBeVisible()
    await expect(page.locator('.buy-qr-amount')).toHaveText(/Số tiền: 2\.000\s₫/)
    await expect(page.getByRole('timer')).toHaveAttribute('aria-label', /Còn \d+ phút \d+ giây để thanh toán/)
    await expectCountdownMatches(page, stubbed.expiresAt)
    await expect(page.getByText('Đang chờ xác nhận thanh toán')).toBeVisible()
    await page.screenshot({ path: test.info().outputPath('cus-32-qr.png') })
    await page.getByRole('button', { name: 'Hủy đơn và chọn lại' }).click()
    await page.getByRole('button', { name: 'Xác nhận hủy đơn' }).click()
    await expect(page.getByRole('heading', { name: 'Đơn hàng đã hủy' })).toBeVisible()
    await expect(page.getByText('Bạn chưa bị trừ tiền.')).toBeVisible()
    await page.getByRole('button', { name: /Về danh sách sản phẩm/ }).click()
    await expect(page.locator('.buy-product', { hasText: S.productName })).toBeVisible()
    for (const id of [...S.orders]) { const o = await dataOf(await S.e2eKiosk!.get(`${API}/kiosk/orders/${id}`)); if (o.status === 'CANCELLED') S.orders.delete(id) }
    expect(log.errors).toEqual([])
  })

  test('CUS-33 kiosk UI with a wrong key: "Máy chưa được cấu hình", no catalog, no technical code', async ({ page }) => {
    const log = watchConsole(page)
    await page.goto(`${KIOSK_BADKEY}/buy`)
    await expect(page.getByRole('heading', { name: 'Máy chưa được cấu hình' })).toBeVisible()
    await expect(page.locator('main')).not.toContainText(/401|Unauthorized|fvk_|X-Kiosk-Key/)
    await expect(page.locator('.buy-product')).toHaveCount(0)
    await page.screenshot({ path: test.info().outputPath('cus-33-unconfigured.png') })
    console.log(`expected network console lines: ${log.network.length}`)
    expect(log.errors).toEqual([])
  })

  test('CUS-34 kiosk UI with the backend unreachable: "Máy đang mất kết nối"; lost while choosing -> order not created message', async ({ page }) => {
    const log = watchConsole(page)
    await page.route('**/api/v1/**', route => route.abort('connectionrefused'))
    await page.goto(`${KIOSK_E2E}/buy`)
    await expect(page.getByRole('heading', { name: 'Máy đang mất kết nối' })).toBeVisible()
    await expect(page.getByText('Bạn chưa bị trừ tiền.', { exact: false })).toBeVisible()
    await page.screenshot({ path: test.info().outputPath('cus-34-offline.png') })
    await page.unroute('**/api/v1/**')
    // Recovers by itself (retry every 15 s).
    await expect(page.getByRole('heading', { name: 'Chạm để chọn sản phẩm' })).toBeVisible({ timeout: 25_000 })
    await page.route('**/api/v1/kiosk/orders', route => route.abort('connectionreset'))
    await page.locator('.buy-product', { hasText: S.productName }).click()
    await expect(page.getByRole('alert').filter({ hasText: 'Chưa tạo được đơn hàng do lỗi kết nối' })).toContainText('Bạn chưa bị trừ tiền')
    await expect(page.getByRole('heading', { name: 'Chạm để chọn sản phẩm' })).toBeVisible()
    expect(log.errors).toEqual([])
  })

  test('CUS-35 kiosk UI: Báo sự cố opens the dialog with the QR, or the right message when the link is not configured', async ({ page }) => {
    const log = watchConsole(page)
    await page.goto(`${KIOSK_E2E}/buy`)
    await expect(page.locator('.buy-product').first()).toBeVisible()
    const link = page.waitForResponse(r => r.url().includes('/kiosk/incident-report-link'))
    await page.locator('footer').getByRole('button', { name: /Báo sự cố/ }).click()
    const status = (await link).status()
    console.log(`incident-report-link from UI: ${status}`)
    const dialog = page.getByRole('dialog', { name: 'Báo sự cố với máy' })
    await expect(dialog).toBeVisible()
    if (status === 200) await expect(dialog.getByRole('img', { name: 'Mã QR mở trang báo sự cố của máy này' })).toBeVisible()
    else {
      await expect(dialog.getByRole('alert')).toHaveText('Máy này chưa bật trang báo sự cố. Vui lòng báo nhân viên vận hành theo số điện thoại dán trên máy.')
      await expect(dialog).not.toContainText(/REPORT_LINK_NOT_CONFIGURED|PUBLIC_REPORT_BASE_URL|409/)
      await expect(dialog.getByRole('button', { name: 'Thử lại' })).toBeVisible()
    }
    await page.screenshot({ path: test.info().outputPath('cus-35-incident-dialog.png') })
    await dialog.getByRole('button', { name: 'Đóng' }).click()
    await expect(dialog).toBeHidden()
    expect(log.errors).toEqual([])
  })

  test('CUS-36 kiosk UI on M1 (real key): shows what M1 really sells (or the sold-out screen)', async ({ page }) => {
    const log = watchConsole(page)
    const catalog = await catalogOf(S.m1Kiosk!)
    await page.goto(`${KIOSK_M1}/buy`)
    await expect(page.locator('.buy-machine')).toContainText('Máy M1')
    if (catalog.products.length === 0) {
      await expect(page.getByRole('heading', { name: 'Máy đã hết hàng' })).toBeVisible()
      await expect(page.getByText('Hiện không còn hộp trái cây nào bán được trong máy.')).toBeVisible()
    } else {
      for (const product of catalog.products) await expect(page.locator('.buy-product', { hasText: product.name }).locator('.buy-price strong')).toHaveText(/^2\.000\s₫$/)
    }
    await page.screenshot({ path: test.info().outputPath('cus-36-m1.png') })
    expect(log.errors).toEqual([])
  })

  // ---------------------------------------------------------------- Public report page (FE on 5800, real backend)
  test('CUS-37 /report without token and /report/<unknown token>: clear Vietnamese screens, no form', async ({ page }) => {
    const log = watchConsole(page)
    await page.goto(`${ADMIN_UI}/report`)
    await expect(page.getByRole('heading', { name: 'Hãy quét mã QR trên máy' })).toBeVisible()
    await page.goto(`${ADMIN_UI}/report/${BOGUS_TOKEN}`)
    const heading = page.getByRole('heading', { name: /Mã QR không còn dùng được|Hệ thống đang bận/ })
    await expect(heading).toBeVisible()
    await expect(page.locator('main')).not.toContainText(/404|Not Found|NOT_FOUND|Exception/)
    await expect(page.getByRole('button', { name: 'Gửi báo cáo' })).toHaveCount(0)
    await page.screenshot({ path: test.info().outputPath('cus-37-report-gone.png') })
    expect(log.errors).toEqual([])
  })

  test('CUS-38 report page (form info stubbed, submit to the real backend): client errors in place, 429 -> wait message, kept input', async ({ page }) => {
    const log = watchConsole(page)
    await page.route(`**/api/v1/public/report-forms/${BOGUS_TOKEN}`, route => route.request().method() === 'GET'
      ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ timestamp: new Date().toISOString(), message: 'stub', data: { machineName: 'E2E stub', machineCode: 'E2E-STUB', types: ['PAID_NOT_RECEIVED', 'PRODUCT_QUALITY', 'MACHINE_FAULT', 'OTHER'], maxPhotos: 3, maxPhotoBytes: 2 * 1024 * 1024 } }) })
      : route.continue())
    await page.goto(`${ADMIN_UI}/report/${BOGUS_TOKEN}`)
    await expect(page.getByRole('heading', { name: 'Báo sự cố' })).toBeVisible()
    const submit = page.getByRole('button', { name: 'Gửi báo cáo' })
    await submit.click()
    await expect(page.getByText('Chọn loại sự cố.')).toBeVisible()
    await page.getByRole('radio', { name: /Đã trả tiền nhưng không nhận hàng/ }).check()
    await page.getByLabel(/Số điện thoại/).fill('12345')
    await page.getByLabel(/^Mã đơn/).fill('ORD-1')
    await submit.click()
    await expect(page.getByText('Mã đơn có dạng ORD-20261109-AB12CD34.')).toBeVisible()
    await expect(page.getByText('Số điện thoại chưa đúng, ví dụ 0912 345 678 hoặc +84 912 345 678.')).toBeVisible()
    await expect(page.getByText('Bạn cần đồng ý để chúng tôi dùng thông tin này xử lý phản ánh.')).toBeVisible()
    await expect(page.getByLabel(/^Mã đơn/)).toBeFocused()
    // Photo over 2 MB and a non-image are refused before sending.
    await page.locator('input[type=file]').setInputFiles([{ name: 'big.jpg', mimeType: 'image/jpeg', buffer: Buffer.alloc(2 * 1024 * 1024 + 10, 0xff) }])
    await expect(page.locator('form')).toContainText(/2 MB/)
    await page.screenshot({ path: test.info().outputPath('cus-38-client-errors.png'), fullPage: true })
    await page.getByRole('button', { name: /Bỏ ảnh/ }).first().click()
    // Fix the form and send to the real backend (unknown token, source probably rate limited by CUS-23).
    await page.getByLabel(/^Mã đơn/).fill('ORD-20261117-ABCD2345')
    await page.getByLabel(/Số điện thoại/).fill('0912345678')
    await page.getByRole('checkbox').check()
    const sent = page.waitForResponse(r => r.request().method() === 'POST' && r.url().includes('/public/report-forms/'))
    await submit.click()
    const status = (await sent).status()
    console.log(`report submit from UI: ${status}`)
    if (status === 429) {
      await expect(page.getByText(/Bạn gửi quá nhiều báo cáo\. Vui lòng thử lại sau \d+ (giây|phút)\./)).toBeVisible()
      await expect(page.getByRole('button', { name: /Gửi lại sau \d+ giây/ })).toBeDisabled()
      await expect(page.getByLabel(/Số điện thoại/)).toHaveValue('0912345678')
    } else {
      expect(status).toBe(404)
      await expect(page.getByText(/Mã QR này không còn dùng được/).first()).toBeVisible()
    }
    await expect(page.locator('main')).not.toContainText(/Exception|NOT_FOUND|Too Many Requests|\b4\d\d\b/)
    await page.screenshot({ path: test.info().outputPath('cus-38-server-answer.png'), fullPage: true })
    expect(log.errors).toEqual([])
  })

  test('CUS-39 report page: real 429 from the backend after a burst from the same browser -> wait message, button locked, input kept', async ({ page }) => {
    const log = watchConsole(page)
    await page.route('**/api/v1/public/report-forms/' + BOGUS_TOKEN, route => route.request().method() === 'GET'
      ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ timestamp: new Date().toISOString(), message: 'stub', data: { machineName: 'E2E stub', machineCode: 'E2E-STUB', types: ['PAID_NOT_RECEIVED', 'PRODUCT_QUALITY', 'MACHINE_FAULT', 'OTHER'], maxPhotos: 3, maxPhotoBytes: 2 * 1024 * 1024 } }) })
      : route.continue())
    await page.goto(ADMIN_UI + '/report/' + BOGUS_TOKEN)
    await expect(page.getByRole('heading', { name: 'Báo sự cố' })).toBeVisible()
    // Same source as the form (through the Vite proxy): exhaust 5 / minute.
    const burst = await page.evaluate(async token => {
      const out: number[] = []
      for (let i = 0; i < 7; i++) {
        const form = new FormData()
        form.append('report', new Blob([JSON.stringify({ type: 'OTHER', description: 'E2E burst', consent: true, website: '' })], { type: 'application/json' }))
        const r = await fetch('/api/v1/public/report-forms/' + token + '/reports', { method: 'POST', body: form })
        out.push(r.status)
        if (r.status === 429) break
      }
      return out
    }, BOGUS_TOKEN)
    console.log('browser burst statuses ' + burst.join(','))
    expect(burst).toContain(429)
    await page.getByRole('radio', { name: 'Máy lỗi' }).check()
    await page.getByLabel(/^Mô tả/).fill('E2E: máy không nhận tiền')
    await page.getByRole('checkbox').check()
    const sent = page.waitForResponse(r => r.request().method() === 'POST' && r.url().includes('/public/report-forms/'))
    await page.getByRole('button', { name: 'Gửi báo cáo' }).click()
    const response = await sent
    expect(response.status()).toBe(429)
    console.log('Retry-After from UI submit: ' + response.headers()['retry-after'])
    await expect(page.getByText(/Bạn gửi quá nhiều báo cáo\. Vui lòng thử lại sau \d+ (giây|phút)\./)).toBeVisible()
    await expect(page.getByRole('button', { name: /Gửi lại sau \d+ giây/ })).toBeDisabled()
    await expect(page.getByLabel(/^Mô tả/)).toHaveValue('E2E: máy không nhận tiền')
    await expect(page.locator('main')).not.toContainText(/Too Many Requests|429/)
    await page.screenshot({ path: test.info().outputPath('cus-39-rate-limited.png'), fullPage: true })
    expect(log.errors).toEqual([])
  })
})
