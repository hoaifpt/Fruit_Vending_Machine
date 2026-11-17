// Inventory flows (batches, direct load, removal, map, history, restock work orders, near-expiry discount) against the
// REAL backend. Every record is created on a machine of its own (E2E-INV-…) with its own products and batches, so the
// stock of M1 used by the customer suite is never touched; M1 is only read. The discount setting is global: tests that
// change it restore the previous value at once (finally).
//
//   npx playwright test -c playwright.real.config.ts e2e-real/inventory.spec.ts
//
// Each case checks both sides: the UI (Vietnamese text beside the field or a general message, money/time format, no
// console error, no white page) and the API (status, fieldErrors on the right field, unknown fields refused, no stack
// trace / class / SQL in the body). Case table: e2e-real/cases/inventory.md.
import { test, expect } from '@playwright/test'
import type { APIRequestContext, APIResponse, Page } from '@playwright/test'
import { API, MACHINE_ID, apiAs, dataOf, errorOf, loginAs, uniq } from './real.ts'

// Tests run one by one (workers 1) but independently: a failing case does not stop the others. The fixture is made
// again when Playwright restarts the worker after a failure.

// ---------- helpers

const DAY = 86_400_000
const iso = (ms: number) => new Date(ms).toISOString()
const VN = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
/** `09/11/2026 13:05` in Vietnam time, the format the screens must show. */
const vnTime = (instant: string) => VN.format(new Date(instant)).replace(', ', ' ')
/** Today 23:00 in Vietnam time, as an instant (a batch expiring "today"). */
function todayVn2300(): number {
  const vnDate = new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10)
  return Date.parse(`${vnDate}T23:00:00+07:00`)
}

/** Production standard: an error body never shows a stack trace, a Java class/package or SQL. */
const LEAK = /Exception|\bjava\.|\borg\.(springframework|hibernate|postgresql)|\bcom\.[a-z]+\.|\bat [\w$.]+\([\w$]+\.java|stackTrace|"trace"|\bSQL\b|\bselect .* from\b|\binsert into\b|constraint \w+_(fk|pk|key|check)/i
async function bodyOf(response: APIResponse) { return response.text() }
async function expectNoLeak(response: APIResponse) {
  const text = await bodyOf(response)
  expect(text, `leak in ${response.url()}`).not.toMatch(LEAK)
}
/** Error envelope with the leak check. */
async function err(response: APIResponse, status: number) {
  await expectNoLeak(response)
  return errorOf(response, status)
}

/** Console errors and page errors of a test; failed HTTP resources (4xx/5xx answers the test provokes) are not errors. */
function watchConsole(page: Page) {
  const errors: string[] = []
  page.on('console', message => {
    if (message.type() !== 'error') return
    const text = message.text()
    if (/Failed to load resource|status of (4|5)\d\d/.test(text)) return
    errors.push(text)
  })
  page.on('pageerror', error => errors.push(`pageerror: ${error.message}`))
  return errors
}
/** Requests of `method` to an API path seen by the page (to prove a client-side check sent nothing). */
function watchRequests(page: Page, method: string, pathPart: string) {
  const seen: string[] = []
  page.on('request', request => { if (request.method() === method && request.url().includes(pathPart)) seen.push(request.url()) })
  return seen
}
async function expectNotBlank(page: Page) {
  await expect(page.locator('#admin-main')).toBeVisible()
  expect((await page.locator('#admin-main').innerText()).trim().length).toBeGreaterThan(20)
}

interface Fixture {
  u: string
  machineId: string; slotA: string; slotB: string
  emptyMachineId: string; emptySlotA: string
  p1: string; p1Name: string; p2: string; p2Name: string
  b1: string; b1Code: string; b1Expires: string
  b2: string; b2Code: string
  bToday: string; bTodayCode: string
}
let fx: Fixture
let admin: APIRequestContext, staff: APIRequestContext, anon: APIRequestContext

async function createMachine(code: string, name: string) {
  const machine = await dataOf(await admin.post(`${API}/machines`, { data: { code, name, location: 'E2E lab', minTemperature: 2, maxTemperature: 8, minHumidity: 40, maxHumidity: 80 } }), 201)
  const a = await dataOf(await admin.post(`${API}/machines/${machine.id}/slots`, { data: { slotCode: 'A', capacity: 4 } }), 201)
  const b = await dataOf(await admin.post(`${API}/machines/${machine.id}/slots`, { data: { slotCode: 'B', capacity: 5 } }), 201)
  await dataOf(await admin.patch(`${API}/machines/${machine.id}/status`, { data: { status: 'ACTIVE' } }))
  return { id: machine.id as string, slotA: a.id as string, slotB: b.id as string }
}
async function createProduct(sku: string, name: string, price: number) {
  return dataOf(await admin.post(`${API}/products`, { data: { sku, name, price } }), 201)
}
async function createBatch(ctx: APIRequestContext, batchCode: string, productId: string, expiresAt: number, quantity: number) {
  return dataOf(await ctx.post(`${API}/product-batches`, { data: { batchCode, productId, manufacturedAt: iso(Date.now() - DAY), expiresAt: iso(expiresAt), quantity } }), 201)
}
async function slotItems(machineId: string, slotId: string, status = 'AVAILABLE') {
  return (await dataOf(await admin.get(`${API}/inventory`, { params: { machineId, slotId, status, size: 100 } }))).content as any[]
}
async function summary(machineId: string, slotId: string) {
  return dataOf(await admin.get(`${API}/machines/${machineId}/slots/${slotId}/inventory/summary`))
}
/** A RESTOCK work order on the fixture machine with the given lines, assigned to the admin; started when asked. */
async function restockOrder(lines: { slotId: string; productId: string; plannedQuantity: number }[], start: boolean, machineId = fx.machineId) {
  const order = await dataOf(await admin.post(`${API}/work-orders`, { data: { type: 'RESTOCK', machineId, title: `E2E-INV restock ${uniq()}`, restockLines: lines } }), 201)
  if (start) {
    await dataOf(await admin.post(`${API}/work-orders/${order.id}/assign`, { data: { assigneeId: order.createdBy.id, version: order.version } }))
    await dataOf(await admin.post(`${API}/work-orders/${order.id}/start`, { data: {} }))
  }
  const view = await dataOf(await admin.get(`${API}/work-orders/${order.id}/restock`))
  return { id: order.id as string, lines: view.lines as any[] }
}
/** Ends a work order so the fixture machine has no unfinished one left (cancel when not completed). */
async function cancelOrder(id: string) {
  const order = await dataOf(await admin.get(`${API}/work-orders/${id}`))
  if (order.status === 'DONE' || order.status === 'CANCELLED') return
  await admin.post(`${API}/work-orders/${id}/cancel`, { data: { reason: 'E2E cleanup', version: order.version } })
}

test.beforeAll(async () => {
  admin = await apiAs('ADMIN'); staff = await apiAs('STAFF'); anon = await apiAs('PUBLIC')
  const u = uniq()
  const machine = await createMachine(`E2E-INV-${u}`, `E2E INV ${u}`)
  const empty = await createMachine(`E2E-INV-${u}-EMPTY`, `E2E INV trống ${u}`)
  const p1 = await createProduct(`E2E-INV-${u}-TAO`, `E2E Táo ${u}`, 35000)
  const p2 = await createProduct(`E2E-INV-${u}-CAM`, `E2E Cam ${u}`, 20000)
  const b1 = await createBatch(admin, `E2E-INV-${u}-B1`, p1.id, Date.now() + 3 * DAY, 20)
  const b2 = await createBatch(admin, `E2E-INV-${u}-B2`, p2.id, Date.now() + 2 * DAY, 20)
  const bToday = await createBatch(admin, `E2E-INV-${u}-TODAY`, p1.id, todayVn2300(), 5)
  // slot A starts with one box of B1 (Táo, +3 days), so every case finds a column of one product
  await dataOf(await admin.post(`${API}/inventory/load`, { data: { batchId: b1.id, slotId: machine.slotA, quantity: 1 } }), 201)
  fx = {
    u, machineId: machine.id, slotA: machine.slotA, slotB: machine.slotB, emptyMachineId: empty.id, emptySlotA: empty.slotA,
    p1: p1.id, p1Name: p1.name, p2: p2.id, p2Name: p2.name,
    b1: b1.id, b1Code: b1.batchCode, b1Expires: b1.expiresAt, b2: b2.id, b2Code: b2.batchCode, bToday: bToday.id, bTodayCode: bToday.batchCode,
  }
})
test.afterAll(async () => { await admin?.dispose(); await staff?.dispose(); await anon?.dispose() })

// =====================================================================================================================
// Batches (lô hàng)
// =====================================================================================================================

test('INV-01 BE: tạo lô đúng (STAFF) → 201, mã in hoa, createdBy là người gọi, không có trường tồn kho', async () => {
  const code = `e2e-inv-${fx.u}-ok1`
  const response = await staff.post(`${API}/product-batches`, { data: { batchCode: `  ${code}  `, productId: fx.p1, manufacturedAt: iso(Date.now() - DAY), expiresAt: iso(Date.now() + 2 * DAY), quantity: 3 } })
  const batch = await dataOf(response, 201)
  expect(batch.batchCode).toBe(code.toUpperCase())
  expect(batch.createdBy).toBeTruthy()
  expect(batch).not.toHaveProperty('availableQuantity')
  expect(response.headers()['cache-control'] ?? '').toContain('no-store')
})

test('INV-02 BE: lô có hạn dùng ở quá khứ / hạn trước ngày sản xuất → 400', async () => {
  const past = await err(await staff.post(`${API}/product-batches`, { data: { batchCode: `E2E-INV-${fx.u}-PAST`, productId: fx.p1, manufacturedAt: iso(Date.now() - 5 * DAY), expiresAt: iso(Date.now() - DAY), quantity: 5 } }), 400)
  expect(past.message).toMatch(/expired/i)
  const before = await err(await staff.post(`${API}/product-batches`, { data: { batchCode: `E2E-INV-${fx.u}-INV`, productId: fx.p1, manufacturedAt: iso(Date.now() + 3 * DAY), expiresAt: iso(Date.now() + 2 * DAY), quantity: 5 } }), 400)
  expect(before.message).toMatch(/after/i)
})

test('INV-03 BE: số lượng lô 0 / âm / quá int32 / chuỗi / thập phân → 400, quantity đúng field', async () => {
  const base = { productId: fx.p1, manufacturedAt: iso(Date.now() - DAY), expiresAt: iso(Date.now() + 2 * DAY) }
  for (const quantity of [0, -1]) {
    const body = await err(await staff.post(`${API}/product-batches`, { data: { ...base, batchCode: `E2E-INV-${fx.u}-Q${quantity}`, quantity } }), 400)
    expect(Object.keys(body.fieldErrors ?? {})).toEqual(['quantity'])
  }
  for (const quantity of [2147483648, '5', 1.5]) {
    await err(await staff.post(`${API}/product-batches`, { data: { ...base, batchCode: `E2E-INV-${fx.u}-QX`, quantity } }), 400)
  }
})

test('INV-04 BE: mã lô trùng (khác hoa thường) → 409', async () => {
  const body = await err(await staff.post(`${API}/product-batches`, { data: { batchCode: fx.b1Code.toLowerCase(), productId: fx.p1, manufacturedAt: iso(Date.now() - DAY), expiresAt: iso(Date.now() + 2 * DAY), quantity: 1 } }), 409)
  expect(body.message).toMatch(/already in use/i)
})

test('INV-05 BE: tạo lô cho sản phẩm INACTIVE → 409; sản phẩm không tồn tại → 404', async () => {
  const product = await createProduct(`E2E-INV-${fx.u}-OFF`, `E2E Ổi ngừng ${fx.u}`, 15000)
  await dataOf(await admin.patch(`${API}/products/${product.id}/status`, { data: { status: 'INACTIVE' } }))
  const body = await err(await staff.post(`${API}/product-batches`, { data: { batchCode: `E2E-INV-${fx.u}-OFFB`, productId: product.id, manufacturedAt: iso(Date.now() - DAY), expiresAt: iso(Date.now() + 2 * DAY), quantity: 1 } }), 409)
  expect(body.message).toMatch(/ACTIVE/)
  await err(await staff.post(`${API}/product-batches`, { data: { batchCode: `E2E-INV-${fx.u}-NOP`, productId: '00000000-0000-0000-0000-000000000000', manufacturedAt: iso(Date.now() - DAY), expiresAt: iso(Date.now() + 2 * DAY), quantity: 1 } }), 404)
})

test('INV-06 BE: tạo lô có field lạ / giờ thiếu offset / JSON hỏng → 400; không có PUT/DELETE', async () => {
  const base = { batchCode: `E2E-INV-${fx.u}-X`, productId: fx.p1, manufacturedAt: iso(Date.now() - DAY), expiresAt: iso(Date.now() + 2 * DAY), quantity: 1 }
  await err(await staff.post(`${API}/product-batches`, { data: { ...base, createdBy: '00000000-0000-0000-0000-000000000000' } }), 400)
  await err(await staff.post(`${API}/product-batches`, { data: { ...base, manufacturedAt: '2026-11-10T08:00:00' } }), 400)
  await err(await staff.post(`${API}/product-batches`, { data: '{"batchCode":', headers: { 'content-type': 'application/json' } }), 400)
  const del = await admin.delete(`${API}/product-batches/${fx.b1}`)
  expect([405, 403, 404]).toContain(del.status())
  await expectNoLeak(del)
})

test('INV-30 FE: tạo lô qua giao diện (STAFF) → thông báo thành công, mã in hoa, giờ dd/MM/yyyy HH:mm', async ({ page }) => {
  const console = watchConsole(page)
  await loginAs(page, 'STAFF')
  await page.goto('/admin/batches')
  await page.getByRole('button', { name: 'Tạo lô hàng' }).click()
  const sheet = page.getByRole('dialog')
  await sheet.getByLabel('Sản phẩm').selectOption(fx.p1)
  const code = `e2e-inv-${fx.u}-ui1`
  await sheet.getByLabel('Mã lô').fill(code)
  await sheet.getByLabel('Sản xuất lúc').fill('2026-11-16T08:00')
  await sheet.getByLabel('Hạn dùng').fill('2026-12-20T09:30')
  await sheet.getByLabel('Số lượng khai báo (hộp)').fill('12')
  await sheet.getByRole('button', { name: 'Tạo lô' }).click()
  await expect(page.getByText('Đã tạo lô hàng')).toBeVisible()
  const row = page.getByRole('row').filter({ hasText: code.toUpperCase() })
  await expect(row).toBeVisible()
  await expect(row).toContainText('20/12/2026 09:30')
  await expect(row).toContainText('16/11/2026 08:00')
  await expect(row).toContainText('0 / 12 hộp')
  await expect(row).toContainText('Chưa nạp hộp nào vào ngăn.')
  expect(console).toEqual([])
})

test('INV-31 FE: hạn dùng quá khứ và số lượng 0 bị chặn cạnh ô, không gửi request', async ({ page }) => {
  const console = watchConsole(page)
  await loginAs(page, 'STAFF')
  const posts = watchRequests(page, 'POST', '/product-batches')
  await page.goto('/admin/batches')
  await page.getByRole('button', { name: 'Tạo lô hàng' }).click()
  const sheet = page.getByRole('dialog')
  await sheet.getByLabel('Sản phẩm').selectOption(fx.p1)
  await sheet.getByLabel('Mã lô').fill(`E2E-INV-${fx.u}-UIPAST`)
  await sheet.getByLabel('Sản xuất lúc').fill('2026-10-01T08:00')
  await sheet.getByLabel('Hạn dùng').fill('2026-10-05T08:00')
  await expect(sheet.getByText('Hạn dùng đã qua. Lô hết hạn không tạo được; chọn ngày giờ trong tương lai.', { exact: true })).toBeVisible()
  await sheet.getByLabel('Số lượng khai báo (hộp)').fill('0')
  await sheet.getByRole('button', { name: 'Tạo lô' }).click()
  await expect(sheet.getByText('Số lượng khai báo phải là số nguyên từ 1 đến 2.147.483.647 hộp.')).toBeVisible()
  await expect(sheet.getByLabel('Hạn dùng')).toHaveAttribute('aria-invalid', 'true')
  await sheet.getByLabel('Số lượng khai báo (hộp)').fill('-3')
  await sheet.getByRole('button', { name: 'Tạo lô' }).click()
  await expect(sheet.getByLabel('Số lượng khai báo (hộp)')).toHaveAttribute('aria-invalid', 'true')
  expect(posts).toEqual([])
  expect(console).toEqual([])
})

test('INV-32 FE: mã lô trùng → 409 hiện “Mã lô này đã tồn tại” dưới ô Mã lô', async ({ page }) => {
  const console = watchConsole(page)
  await loginAs(page, 'STAFF')
  await page.goto('/admin/batches')
  await page.getByRole('button', { name: 'Tạo lô hàng' }).click()
  const sheet = page.getByRole('dialog')
  await sheet.getByLabel('Sản phẩm').selectOption(fx.p1)
  await sheet.getByLabel('Mã lô').fill(fx.b1Code.toLowerCase())
  await sheet.getByLabel('Sản xuất lúc').fill('2026-11-16T08:00')
  await sheet.getByLabel('Hạn dùng').fill('2026-12-20T09:30')
  await sheet.getByLabel('Số lượng khai báo (hộp)').fill('3')
  const answer = page.waitForResponse(response => response.url().includes('/product-batches') && response.request().method() === 'POST')
  await sheet.getByRole('button', { name: 'Tạo lô' }).click()
  expect((await answer).status()).toBe(409)
  await expect(sheet.getByText('Mã lô này đã tồn tại (không phân biệt hoa thường). Hãy nhập mã lô khác.')).toBeVisible()
  await expect(sheet.getByLabel('Mã lô')).toHaveAttribute('aria-invalid', 'true')
  expect(console).toEqual([])
})

test('INV-33 FE: sản phẩm vừa bị ngừng bán khi đang tạo lô → 409 hiện lý do dưới ô Sản phẩm', async ({ page }) => {
  const console = watchConsole(page)
  const product = await createProduct(`E2E-INV-${fx.u}-RACE`, `E2E Lê ${fx.u}`, 18000)
  await loginAs(page, 'STAFF')
  await page.goto('/admin/batches')
  await page.getByRole('button', { name: 'Tạo lô hàng' }).click()
  const sheet = page.getByRole('dialog')
  await sheet.getByLabel('Sản phẩm').selectOption(product.id)
  await sheet.getByLabel('Mã lô').fill(`E2E-INV-${fx.u}-RACEB`)
  await sheet.getByLabel('Sản xuất lúc').fill('2026-11-16T08:00')
  await sheet.getByLabel('Hạn dùng').fill('2026-12-20T09:30')
  await sheet.getByLabel('Số lượng khai báo (hộp)').fill('3')
  await dataOf(await admin.patch(`${API}/products/${product.id}/status`, { data: { status: 'INACTIVE' } }))
  await sheet.getByRole('button', { name: 'Tạo lô' }).click()
  await expect(sheet.getByText('Sản phẩm này đang ngừng bán nên không tạo lô được. Chọn sản phẩm khác hoặc nhờ quản trị viên mở bán lại.')).toBeVisible()
  expect(console).toEqual([])
})

// =====================================================================================================================
// Direct load (POST /inventory/load, ADMIN only)
// =====================================================================================================================

test('INV-07 BE: ADMIN nạp trực tiếp 2 hộp → 201, 2 hộp AVAILABLE, 2 dòng LOAD chung referenceId', async () => {
  const result = await dataOf(await admin.post(`${API}/inventory/load`, { data: { batchId: fx.b1, slotId: fx.slotA, quantity: 2 } }), 201)
  expect(result.quantity).toBe(2)
  expect(result.items).toHaveLength(2)
  for (const item of result.items) expect(item.status).toBe('AVAILABLE')
  const history = await dataOf(await admin.get(`${API}/inventory/transactions`, { params: { referenceId: result.operationId } }))
  expect(history.totalElements).toBe(2)
  for (const row of history.content) { expect(row.type).toBe('LOAD'); expect(row.statusAfter).toBe('AVAILABLE') }
})

test('INV-08 BE: STAFF nạp trực tiếp → 403; không đăng nhập → 401', async () => {
  const forbidden = await err(await staff.post(`${API}/inventory/load`, { data: { batchId: fx.b1, slotId: fx.slotB, quantity: 1 } }), 403)
  expect(forbidden.message).not.toMatch(/INVENTORY_LOAD_DIRECT|Spring|Security/)
  await err(await anon.post(`${API}/inventory/load`, { data: { batchId: fx.b1, slotId: fx.slotB, quantity: 1 } }), 401)
})

test('INV-09 BE: số lượng nạp 0 / 1001 → 400 quantity; chuỗi, field lạ, UUID sai → 400', async () => {
  for (const quantity of [0, 1001]) {
    const body = await err(await admin.post(`${API}/inventory/load`, { data: { batchId: fx.b1, slotId: fx.slotB, quantity } }), 400)
    expect(Object.keys(body.fieldErrors ?? {})).toEqual(['quantity'])
  }
  await err(await admin.post(`${API}/inventory/load`, { data: { batchId: fx.b1, slotId: fx.slotB, quantity: '1' } }), 400)
  await err(await admin.post(`${API}/inventory/load`, { data: { batchId: fx.b1, slotId: fx.slotB, quantity: 1, machineId: fx.machineId } }), 400)
  await err(await admin.post(`${API}/inventory/load`, { data: { batchId: 'abc', slotId: fx.slotB, quantity: 1 } }), 400)
})

test('INV-10 BE: vượt sức chứa ngăn → 409 SLOT_CAPACITY_EXCEEDED; vượt số khai báo lô → 409 BATCH_QUANTITY_EXCEEDED; không ghi gì', async () => {
  const before = await summary(fx.machineId, fx.slotA)
  const capacity = await err(await admin.post(`${API}/inventory/load`, { data: { batchId: fx.b1, slotId: fx.slotA, quantity: before.remainingCapacity + 1 } }), 409)
  expect(capacity.message).toMatch(/^SLOT_CAPACITY_EXCEEDED/)
  expect((await summary(fx.machineId, fx.slotA)).occupiedCount).toBe(before.occupiedCount)
  const small = await createBatch(admin, `E2E-INV-${fx.u}-SMALL`, fx.p2, Date.now() + 2 * DAY, 1)
  const batch = await err(await admin.post(`${API}/inventory/load`, { data: { batchId: small.id, slotId: fx.slotB, quantity: 2 } }), 409)
  expect(batch.message).toMatch(/^BATCH_QUANTITY_EXCEEDED/)
  expect((await dataOf(await admin.get(`${API}/inventory`, { params: { batchId: small.id } }))).totalElements).toBe(0)
})

test('INV-11 BE: nạp lô đã hết hạn → 409', async () => {
  const batches = (await dataOf(await admin.get(`${API}/product-batches`, { params: { sort: 'expiresAt,asc', size: 5 } }))).content as any[]
  const expired = batches.find(batch => Date.parse(batch.expiresAt) <= Date.now())
  test.skip(!expired, 'Không có lô hết hạn nào trong DB để thử (BE không cho tạo lô hết hạn).')
  const body = await err(await admin.post(`${API}/inventory/load`, { data: { batchId: expired.id, slotId: fx.slotB, quantity: 1 } }), 409)
  expect(body.message).toMatch(/expired/i)
})

test('INV-12 BE: nạp vào ngăn INACTIVE / ERROR → 409 (nạp trực tiếp chỉ nhận ngăn ACTIVE)', async () => {
  try {
    for (const status of ['INACTIVE', 'ERROR']) {
      await dataOf(await admin.patch(`${API}/machines/${fx.machineId}/slots/${fx.slotB}/status`, { data: { status } }))
      const body = await err(await admin.post(`${API}/inventory/load`, { data: { batchId: fx.b2, slotId: fx.slotB, quantity: 1 } }), 409)
      expect(body.message).toMatch(/Slot must be ACTIVE/i)
    }
  } finally {
    await admin.patch(`${API}/machines/${fx.machineId}/slots/${fx.slotB}/status`, { data: { status: 'ACTIVE' } })
  }
})

test('INV-13 BE: nạp lô sản phẩm khác vào ngăn đang có sản phẩm khác — ghi nhận hành vi thật', async () => {
  // slot A holds E2E Táo (INV-07). Docs do not forbid mixing for the direct load; restock lines do (BATCH_PRODUCT_MISMATCH).
  const response = await admin.post(`${API}/inventory/load`, { data: { batchId: fx.b2, slotId: fx.slotA, quantity: 1 } })
  await expectNoLeak(response)
  test.info().annotations.push({ type: 'observation', description: `BE trả ${response.status()} khi nạp sản phẩm khác vào ngăn đang có Táo (không chặn trộn sản phẩm trong một cột).` })
  expect([201, 409]).toContain(response.status())
  if (response.status() === 201) {
    // keep the column of one product for the FE tests: take the mixed box out again
    const item = (await response.json()).data.items[0]
    await dataOf(await admin.post(`${API}/inventory/${item.id}/remove`, { data: { reason: 'E2E dọn hộp trộn sản phẩm' } }))
  }
})

test('INV-14 BE: nạp lô của sản phẩm vừa chuyển INACTIVE → 409 "Product must be ACTIVE"', async () => {
  const product = await createProduct(`E2E-INV-${fx.u}-OFF2`, `E2E Mận ${fx.u}`, 25000)
  const batch = await createBatch(admin, `E2E-INV-${fx.u}-OFF2B`, product.id, Date.now() + 2 * DAY, 5)
  await dataOf(await admin.patch(`${API}/products/${product.id}/status`, { data: { status: 'INACTIVE' } }))
  const body = await err(await admin.post(`${API}/inventory/load`, { data: { batchId: batch.id, slotId: fx.slotB, quantity: 1 } }), 409)
  expect(body.message).toMatch(/Product must be ACTIVE/)
})

// =====================================================================================================================
// Remove a box
// =====================================================================================================================

test('INV-15 BE: rút hộp — lý do trống / 501 ký tự / field lạ → 400 reason; đúng → 200 REMOVED; rút lại → 409; 404; 400; 401', async () => {
  const loaded = await dataOf(await admin.post(`${API}/inventory/load`, { data: { batchId: fx.b2, slotId: fx.slotB, quantity: 1 } }), 201)
  const id = loaded.items[0].id
  const blank = await err(await staff.post(`${API}/inventory/${id}/remove`, { data: { reason: '   ' } }), 400)
  expect.soft(Object.keys(blank.fieldErrors ?? {})).toEqual(['reason'])
  const long = await err(await staff.post(`${API}/inventory/${id}/remove`, { data: { reason: 'x'.repeat(501) } }), 400)
  expect(Object.keys(long.fieldErrors ?? {})).toEqual(['reason'])
  await err(await staff.post(`${API}/inventory/${id}/remove`, { data: { reason: 'E2E', status: 'SOLD' } }), 400)
  const removed = await dataOf(await staff.post(`${API}/inventory/${id}/remove`, { data: { reason: '  E2E hộp dập  ' } }))
  expect(removed.status).toBe('REMOVED')
  expect(removed.removedAt).toBeTruthy()
  const history = await dataOf(await admin.get(`${API}/inventory/transactions`, { params: { inventoryItemId: id, type: 'REMOVE' } }))
  expect(history.content[0].reason).toBe('E2E hộp dập')
  expect(history.content[0].statusBefore).toBe('AVAILABLE')
  expect(history.content[0].statusAfter).toBe('REMOVED')
  await err(await staff.post(`${API}/inventory/${id}/remove`, { data: { reason: 'E2E lần hai' } }), 409)
  await err(await staff.post(`${API}/inventory/00000000-0000-0000-0000-000000000000/remove`, { data: { reason: 'E2E' } }), 404)
  await err(await staff.post(`${API}/inventory/abc/remove`, { data: { reason: 'E2E' } }), 400)
  await err(await anon.post(`${API}/inventory/${id}/remove`, { data: { reason: 'E2E' } }), 401)
})

// =====================================================================================================================
// Reads: map data, history filters
// =====================================================================================================================

test('INV-16 BE: lịch sử lọc theo máy/ngăn/loại/hộp; loại lạ, size 101, sort lạ → 400; ngăn sai máy → 404', async () => {
  const bySlot = await dataOf(await admin.get(`${API}/inventory/transactions`, { params: { machineId: fx.machineId, slotId: fx.slotA, type: 'LOAD', size: 100 } }))
  expect(bySlot.totalElements).toBeGreaterThanOrEqual(1)
  for (const row of bySlot.content) { expect(row.slotId).toBe(fx.slotA); expect(row.type).toBe('LOAD') }
  await err(await admin.get(`${API}/inventory/transactions`, { params: { type: 'FOO' } }), 400)
  await err(await admin.get(`${API}/inventory`, { params: { size: 101 } }), 400)
  await err(await admin.get(`${API}/inventory`, { params: { sort: 'foo,asc' } }), 400)
  await err(await admin.get(`${API}/machines/${fx.emptyMachineId}/slots/${fx.slotA}/inventory/summary`), 404)
  // M1 is read only: its map data is readable by STAFF
  if (MACHINE_ID) await dataOf(await staff.get(`${API}/machines/${MACHINE_ID}/inventory`))
})

test('INV-34 FE: sơ đồ máy E2E — cột A/B, số hộp, HSD dd/MM/yyyy HH:mm, nhãn “Giảm giá hôm nay”, báo chưa kết nối', async ({ page }) => {
  test.skip(todayVn2300() - Date.now() < 10 * 60_000, 'Quá gần nửa đêm giờ VN để có lô hết hạn hôm nay.')
  await dataOf(await admin.post(`${API}/inventory/load`, { data: { batchId: fx.bToday, slotId: fx.slotB, quantity: 1 } }), 201)
  const setting = await dataOf(await admin.get(`${API}/pricing/near-expiry-discount`))
  const console = watchConsole(page)
  await loginAs(page, 'ADMIN')
  await page.goto(`/admin/inventory?machineId=${fx.machineId}`)
  await expect(page.getByRole('heading', { name: new RegExp(`Sơ đồ ngăn · E2E INV ${fx.u}`) })).toBeVisible()
  const columnA = page.locator('[data-slot-column="A"]'), columnB = page.locator('[data-slot-column="B"]')
  await expect(columnA).toBeVisible()
  const a = await summary(fx.machineId, fx.slotA)
  await expect(columnA).toContainText(`${a.occupiedCount}/4 hộp`)
  await expect(columnA).toContainText(`HSD ${vnTime(fx.b1Expires)}`)
  await expect(page.getByText('Máy chưa từng kết nối.')).toBeVisible()
  const discounted = columnB.locator('[data-box-discount]')
  if (setting.enabled) await expect(discounted.first()).toHaveText('Giảm giá hôm nay')
  else await expect(discounted).toHaveCount(0)
  await expect(columnA.locator('[data-box-discount]')).toHaveCount(0)
  // the API agrees with the label
  const item = (await slotItems(fx.machineId, fx.slotB)).find(box => box.batchId === fx.bToday)
  expect(item.discountEligibleToday).toBe(!!setting.enabled)
  await expect(page.getByText(/Đang (bật|tắt):/)).toBeVisible()
  expect(console).toEqual([])
})

test('INV-35 FE: nạp hộp từ cột B (ADMIN) → “Đã nạp 1 hộp”, sơ đồ tăng 1', async ({ page }) => {
  const console = watchConsole(page)
  const before = await summary(fx.machineId, fx.slotB)
  await loginAs(page, 'ADMIN')
  await page.goto(`/admin/inventory?machineId=${fx.machineId}`)
  await page.getByRole('button', { name: 'Nạp hộp vào ngăn B' }).click()
  const sheet = page.getByRole('dialog')
  await sheet.getByLabel('Lô hàng').selectOption(fx.b2)
  await expect(sheet.getByText(/Ngăn B: còn trống \d+\/5 chỗ/)).toBeVisible()
  await sheet.getByLabel('Số hộp đã xếp vào ngăn').fill('1')
  const answer = page.waitForResponse(response => response.url().endsWith('/inventory/load'))
  await sheet.getByRole('button', { name: 'Nạp hộp', exact: true }).click()
  const response = await answer
  expect(response.status()).toBe(201)
  expect(Object.keys(JSON.parse(response.request().postData() ?? '{}')).sort()).toEqual(['batchId', 'quantity', 'slotId'])
  await expect(page.getByText('Đã nạp 1 hộp')).toBeVisible()
  await expect(page.locator('[data-slot-column="B"]')).toContainText(`${before.occupiedCount + 1}/5 hộp`)
  expect(console).toEqual([])
})

test('INV-36 FE: gõ số hộp vượt chỗ trống → báo ngay cạnh ô, không gửi; 1001 → giới hạn 1000; 1,5 → không dùng dấu', async ({ page }) => {
  const console = watchConsole(page)
  await loginAs(page, 'ADMIN')
  const posts = watchRequests(page, 'POST', '/inventory/load')
  await page.goto(`/admin/inventory?machineId=${fx.machineId}`)
  const free = (await summary(fx.machineId, fx.slotB)).remainingCapacity
  await page.getByRole('button', { name: 'Nạp hộp vào ngăn B' }).click()
  const sheet = page.getByRole('dialog')
  await sheet.getByLabel('Lô hàng').selectOption(fx.b2)
  await expect(sheet.getByText(new RegExp(`Ngăn B: còn trống ${free}/5 chỗ`))).toBeVisible()
  const quantity = sheet.getByLabel('Số hộp đã xếp vào ngăn')
  await quantity.fill(String(free + 1))
  await expect(sheet.getByText(`Ngăn B chỉ còn trống ${free} chỗ. Nhập tối đa ${free} hộp hoặc chọn ngăn khác.`)).toBeVisible()
  await sheet.getByRole('button', { name: 'Nạp hộp', exact: true }).click()
  await expect(quantity).toHaveAttribute('aria-invalid', 'true')
  await quantity.fill('1001')
  await expect(sheet.getByText('Mỗi lần nạp tối đa 1.000 hộp; chia thành nhiều lần nạp.')).toBeVisible()
  await quantity.fill('1,5')
  await expect(sheet.getByText('Số hộp chỉ gồm chữ số, không dùng dấu chấm hay dấu phẩy (ví dụ 5 hoặc 1000).')).toBeVisible()
  await quantity.fill('0')
  await expect(sheet.getByText('Số hộp phải là số nguyên từ 1 trở lên.')).toBeVisible()
  expect(posts).toEqual([])
  expect(console).toEqual([])
})

test('INV-37 FE: ngăn vừa bị người khác nạp đầy (409 SLOT_CAPACITY_EXCEEDED) → câu tiếng Việt dưới ô số hộp, số liệu tải lại', async ({ page }) => {
  const console = watchConsole(page)
  await loginAs(page, 'ADMIN')
  await page.goto(`/admin/inventory?machineId=${fx.machineId}`)
  const free = (await summary(fx.machineId, fx.slotB)).remainingCapacity
  test.skip(free < 2, 'Ngăn B cần ít nhất 2 chỗ trống.')
  await page.getByRole('button', { name: 'Nạp hộp vào ngăn B' }).click()
  const sheet = page.getByRole('dialog')
  await sheet.getByLabel('Lô hàng').selectOption(fx.b2)
  await expect(sheet.getByText(new RegExp(`Ngăn B: còn trống ${free}/5 chỗ`))).toBeVisible()
  await sheet.getByLabel('Số hộp đã xếp vào ngăn').fill(String(free))
  // someone else fills one place in between
  await dataOf(await admin.post(`${API}/inventory/load`, { data: { batchId: fx.b2, slotId: fx.slotB, quantity: 1 } }), 201)
  const answer = page.waitForResponse(response => response.url().endsWith('/inventory/load'))
  await sheet.getByRole('button', { name: 'Nạp hộp', exact: true }).click()
  expect((await answer).status()).toBe(409)
  await expect(sheet.getByText(new RegExp(`Ngăn B chỉ còn trống ${free - 1} chỗ \\(vừa tải lại\\), không đủ cho ${free} hộp`))).toBeVisible()
  await expect(sheet.getByText(/SLOT_CAPACITY_EXCEEDED|Slot capacity/)).toHaveCount(0)
  expect(console).toEqual([])
})

test('INV-38 FE: ngăn vừa chuyển INACTIVE khi đang nạp → 409 hiện lý do dưới ô Ngăn', async ({ page }) => {
  const console = watchConsole(page)
  await loginAs(page, 'ADMIN')
  await page.goto(`/admin/inventory?machineId=${fx.machineId}`)
  await page.getByRole('button', { name: 'Nạp hộp vào ngăn B' }).click()
  const sheet = page.getByRole('dialog')
  await sheet.getByLabel('Lô hàng').selectOption(fx.b2)
  await sheet.getByLabel('Số hộp đã xếp vào ngăn').fill('1')
  try {
    await dataOf(await admin.patch(`${API}/machines/${fx.machineId}/slots/${fx.slotB}/status`, { data: { status: 'INACTIVE' } }))
    const answer = page.waitForResponse(response => response.url().endsWith('/inventory/load'))
    await sheet.getByRole('button', { name: 'Nạp hộp', exact: true }).click()
    expect((await answer).status()).toBe(409)
    await expect(sheet.getByText(/Ngăn B (vừa ngừng hoạt động hoặc báo lỗi|đang ngừng hoạt động) nên không nạp được/).first()).toBeVisible()
    await expect(sheet.getByText(/Slot must be ACTIVE/)).toHaveCount(0)
  } finally {
    await admin.patch(`${API}/machines/${fx.machineId}/slots/${fx.slotB}/status`, { data: { status: 'ACTIVE' } })
  }
  expect(console).toEqual([])
})

test('INV-39 FE: STAFF không thấy nút “Nạp hộp” (nạp qua phiếu); sheet nạp không mở được', async ({ page }) => {
  const console = watchConsole(page)
  await loginAs(page, 'STAFF')
  await page.goto(`/admin/inventory?machineId=${fx.machineId}`)
  await expect(page.locator('[data-slot-column="A"]')).toBeVisible()
  await expect(page.getByRole('button', { name: /Nạp hộp/ })).toHaveCount(0)
  await expect(page.getByText('Nạp hộp làm qua phiếu nạp hàng được giao (mục Phiếu công việc).')).toBeVisible()
  expect(console).toEqual([])
})

test('INV-40 FE: rút hộp ở danh sách — lý do trống bị chặn; rút đúng → “Đã rút hộp”; hộp đã bị rút nơi khác → 409 câu chung', async ({ page }) => {
  const console = watchConsole(page)
  const loaded = await dataOf(await admin.post(`${API}/inventory/load`, { data: { batchId: fx.b2, slotId: fx.slotB, quantity: 2 } }), 201)
  const [first, second] = loaded.items
  await loginAs(page, 'STAFF')
  const posts = watchRequests(page, 'POST', '/remove')
  await page.goto(`/admin/inventory?view=list&machineId=${fx.machineId}&slotId=${fx.slotB}&status=AVAILABLE`)
  await expect(page.getByRole('region', { name: 'Tóm tắt ngăn' }).or(page.getByLabel('Tóm tắt ngăn'))).toBeVisible()
  const rows = page.getByRole('row').filter({ has: page.getByRole('button', { name: 'Rút hộp' }) })
  await expect(rows.first()).toBeVisible()
  // empty reason
  await rows.first().getByRole('button', { name: 'Rút hộp' }).click()
  let sheet = page.getByRole('dialog')
  await sheet.getByRole('button', { name: 'Rút hộp', exact: true }).click()
  await expect(sheet.getByText('Vui lòng nhập lý do rút hộp.')).toBeVisible()
  expect(posts).toEqual([])
  await expect(sheet.getByLabel('Lý do rút hộp')).toHaveAttribute('maxlength', '500')
  await sheet.getByRole('button', { name: 'Hộp dập, hỏng' }).click()
  const answer = page.waitForResponse(response => response.url().includes('/remove'))
  await sheet.getByRole('button', { name: 'Rút hộp', exact: true }).click()
  const response = await answer
  expect(response.status()).toBe(200)
  expect(JSON.parse(response.request().postData() ?? '{}')).toEqual({ reason: 'Hộp dập, hỏng' })
  await expect(page.getByText('Đã rút hộp')).toBeVisible()
  // stale: the next box is taken out elsewhere while the sheet is open
  await page.reload()
  const target = page.getByRole('row').filter({ has: page.getByRole('button', { name: 'Rút hộp' }) }).first()
  await target.getByRole('button', { name: 'Rút hộp' }).click()
  sheet = page.getByRole('dialog')
  await sheet.getByLabel('Lý do rút hộp').fill('E2E rút lần hai')
  const open = (await slotItems(fx.machineId, fx.slotB)).filter(item => item.id === first.id || item.id === second.id)
  for (const item of open) await admin.post(`${API}/inventory/${item.id}/remove`, { data: { reason: 'E2E rút ở tab khác' } })
  // also take out every other AVAILABLE box shown, so whichever row was opened is stale
  for (const item of await slotItems(fx.machineId, fx.slotB)) await admin.post(`${API}/inventory/${item.id}/remove`, { data: { reason: 'E2E rút ở tab khác' } })
  const stale = page.waitForResponse(response => response.url().includes('/remove') && response.request().method() === 'POST')
  await sheet.getByRole('button', { name: 'Rút hộp', exact: true }).click()
  expect((await stale).status()).toBe(409)
  await expect(page.getByText('Hộp vừa đổi trạng thái (đang giữ cho đơn hoặc đã được rút). Dữ liệu đã tải lại.')).toBeVisible()
  await expect(page.getByText(/Only AVAILABLE or EXPIRED/)).toHaveCount(0)
  expect(console).toEqual([])
})

test('INV-41 FE: lịch sử kho — lọc máy/ngăn/loại lưu trên URL, tải lại giữ nguyên; UUID sai được bỏ qua có thông báo', async ({ page }) => {
  const console = watchConsole(page)
  await loginAs(page, 'ADMIN')
  await page.goto(`/admin/inventory/history?machineId=${fx.machineId}`)
  await page.getByLabel('Ngăn', { exact: true }).selectOption(fx.slotA)
  await page.getByLabel('Loại giao dịch').selectOption('LOAD')
  await expect(page).toHaveURL(new RegExp(`slotId=${fx.slotA}`))
  await expect(page).toHaveURL(/type=LOAD/)
  await page.reload()
  await expect(page.getByLabel('Máy', { exact: true })).toHaveValue(fx.machineId)
  await expect(page.getByLabel('Ngăn', { exact: true })).toHaveValue(fx.slotA)
  await expect(page.getByLabel('Loại giao dịch')).toHaveValue('LOAD')
  const table = page.getByRole('table')
  await expect(table.getByRole('row').nth(1)).toBeVisible()
  await expect(table).toContainText('Nạp hàng')
  await expect(table).not.toContainText('Rút hộp')
  expect(await table.innerText()).toMatch(/\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}/)
  await page.goto('/admin/inventory/history?machineId=not-a-uuid&type=FOO')
  await expect(page.getByRole('note')).toContainText('Đường dẫn có bộ lọc không dùng được nên đã bỏ qua')
  await expectNotBlank(page)
  // Date range and batch filters are not offered (contract listInventoryTransactions has neither).
  await expect(page.getByLabel(/Từ ngày|Đến ngày|Lô hàng/)).toHaveCount(0)
  expect(console).toEqual([])
})

test('INV-42 FE: sơ đồ M1 chỉ đọc — mất kết nối, ngăn bị chặn hiện lý do; lọc ngăn giữ trên URL', async ({ page }) => {
  test.skip(!MACHINE_ID, 'REAL_MACHINE_ID chưa đặt')
  const console = watchConsole(page)
  await loginAs(page, 'STAFF')
  await page.goto(`/admin/inventory?machineId=${MACHINE_ID}`)
  await expect(page.locator('[data-slot-column="A"]')).toBeVisible()
  await expect(page.getByText(/Máy mất kết nối \(OFFLINE\)|Máy chưa từng kết nối/).first()).toBeVisible()
  const slots = (await dataOf(await staff.get(`${API}/machines/${MACHINE_ID}/slots`))).content as any[]
  const a = slots.find(slot => slot.slotCode === 'A')
  await page.getByLabel('Ngăn', { exact: true }).selectOption(a.id)
  await expect(page).toHaveURL(new RegExp(`slotId=${a.id}`))
  await page.reload()
  await expect(page.locator('[data-slot-column="B"]')).toHaveCount(0)
  await expect(page.locator('[data-slot-column="A"]')).toBeVisible()
  const text = await page.locator('[data-slot-column="A"]').innerText()
  expect(text).not.toMatch(/undefined|NaN|null/)
  expect(console).toEqual([])
})

// =====================================================================================================================
// Restock work orders
// =====================================================================================================================

test('INV-17 BE: gợi ý nạp hàng — ADMIN 200 đủ trường; STAFF 403; máy không tồn tại 404', async () => {
  const data = await dataOf(await admin.get(`${API}/machines/${fx.machineId}/restock-suggestions`))
  expect(data.slots).toHaveLength(2)
  for (const slot of data.slots) {
    for (const key of ['physicalCount', 'sellableCount', 'expiredCount', 'expiringTodayCount', 'suggestedAction', 'suggestedLoadQuantity']) expect(slot).toHaveProperty(key)
  }
  await err(await staff.get(`${API}/machines/${fx.machineId}/restock-suggestions`), 403)
  await err(await admin.get(`${API}/machines/00000000-0000-0000-0000-000000000000/restock-suggestions`), 404)
})

test('INV-18 BE: tạo phiếu từ gợi ý — máy trống → 409 NOTHING_TO_RESTOCK; máy có hàng → 201 có dòng', async () => {
  const nothing = await err(await admin.post(`${API}/machines/${fx.emptyMachineId}/restock-work-orders`, { data: { fromSuggestions: true, title: `E2E-INV nothing ${fx.u}` } }), 409)
  expect(nothing.message).toMatch(/^NOTHING_TO_RESTOCK/)
  // slot B with a single sellable box (≤ LOW_STOCK threshold 2) and a known product needs a LOAD
  for (const item of await slotItems(fx.machineId, fx.slotB)) await admin.post(`${API}/inventory/${item.id}/remove`, { data: { reason: 'E2E chuẩn bị gợi ý' } })
  await dataOf(await admin.post(`${API}/inventory/load`, { data: { batchId: fx.b2, slotId: fx.slotB, quantity: 1 } }), 201)
  const order = await dataOf(await admin.post(`${API}/machines/${fx.machineId}/restock-work-orders`, { data: { fromSuggestions: true, title: `E2E-INV gợi ý ${fx.u}` } }), 201)
  const view = await dataOf(await admin.get(`${API}/work-orders/${order.id}/restock`))
  expect(view.lines.length).toBeGreaterThanOrEqual(1)
  await err(await admin.post(`${API}/machines/${fx.machineId}/restock-work-orders`, { data: { fromSuggestions: true, foo: 1 } }), 400)
  await cancelOrder(order.id)
})

test('INV-19 BE: dòng nạp — âm/vượt sức chứa → 400 plannedQuantity; sản phẩm lạ 404; INACTIVE 409; ngăn máy khác 400; trùng 409; field lạ 400; STAFF 403', async () => {
  const order = await restockOrder([{ slotId: fx.slotA, productId: fx.p1, plannedQuantity: 1 }], false)
  try {
    const url = `${API}/work-orders/${order.id}/restock-lines`
    const negative = await err(await admin.post(url, { data: { slotId: fx.slotB, productId: fx.p2, plannedQuantity: -1 } }), 400)
    const over = await err(await admin.post(url, { data: { slotId: fx.slotB, productId: fx.p2, plannedQuantity: 6 } }), 400)
    await err(await admin.post(url, { data: { slotId: fx.slotB, productId: '00000000-0000-0000-0000-000000000000', plannedQuantity: 1 } }), 404)
    const off = await createProduct(`E2E-INV-${fx.u}-OFF3`, `E2E Xoài ngừng ${fx.u}`, 30000)
    await dataOf(await admin.patch(`${API}/products/${off.id}/status`, { data: { status: 'INACTIVE' } }))
    expect((await err(await admin.post(url, { data: { slotId: fx.slotB, productId: off.id, plannedQuantity: 1 } }), 409)).message).toMatch(/^PRODUCT_INACTIVE/)
    await err(await admin.post(url, { data: { slotId: fx.emptySlotA, productId: fx.p2, plannedQuantity: 1 } }), 400)
    expect((await err(await admin.post(url, { data: { slotId: fx.slotA, productId: fx.p1, plannedQuantity: 2 } }), 409)).message).toMatch(/^DUPLICATE_LINE/)
    await err(await admin.post(url, { data: { slotId: fx.slotB, productId: fx.p2, plannedQuantity: 1, loadedQuantity: 1 } }), 400)
    await err(await staff.post(url, { data: { slotId: fx.slotB, productId: fx.p2, plannedQuantity: 1 } }), 403)
    // the field of the error must be the request field, not a Java method/parameter path
    expect.soft(Object.keys(negative.fieldErrors ?? {}), 'fieldErrors key of plannedQuantity -1').toEqual(['plannedQuantity'])
    expect.soft(Object.keys(over.fieldErrors ?? {}), 'fieldErrors of plannedQuantity > capacity').toEqual(['plannedQuantity'])
  } finally { await cancelOrder(order.id) }
})

test('INV-20 BE: số lượng kế hoạch 0 — ghi nhận hành vi (tài liệu cho 0–1000, FE chặn < 1)', async () => {
  const order = await restockOrder([{ slotId: fx.slotA, productId: fx.p1, plannedQuantity: 1 }], false)
  try {
    const response = await admin.post(`${API}/work-orders/${order.id}/restock-lines`, { data: { slotId: fx.slotB, productId: fx.p2, plannedQuantity: 0 } })
    await expectNoLeak(response)
    test.info().annotations.push({ type: 'observation', description: `POST restock-lines plannedQuantity 0 → ${response.status()}` })
    expect([201, 400]).toContain(response.status())
  } finally { await cancelOrder(order.id) }
})

test('INV-21 BE: nạp theo dòng khi phiếu chưa IN_PROGRESS → 409 WORK_ORDER_NOT_IN_PROGRESS', async () => {
  const order = await restockOrder([{ slotId: fx.slotB, productId: fx.p2, plannedQuantity: 1 }], false)
  try {
    const body = await err(await admin.post(`${API}/work-orders/${order.id}/restock-lines/${order.lines[0].id}/loads`, { data: { batchId: fx.b2, quantity: 1 } }), 409)
    expect(body.message).toMatch(/^WORK_ORDER_NOT_IN_PROGRESS/)
  } finally { await cancelOrder(order.id) }
})

test('INV-22 BE: phiếu IN_PROGRESS — lô khác sản phẩm 409 BATCH_PRODUCT_MISMATCH; lô hết hạn trong 5 phút 409 BATCH_EXPIRED; hạn ngược 409 EXPIRY_INVERSION rồi xác nhận 201; sửa dòng đã nạp 409; số lượng 0 → 400 quantity', async () => {
  const order = await restockOrder([{ slotId: fx.slotA, productId: fx.p1, plannedQuantity: 1 }], true)
  try {
    const line = order.lines[0]
    const loads = `${API}/work-orders/${order.id}/restock-lines/${line.id}/loads`
    expect((await err(await admin.post(loads, { data: { batchId: fx.b2, quantity: 1 } }), 409)).message).toMatch(/^BATCH_PRODUCT_MISMATCH/)
    const soon = await createBatch(admin, `E2E-INV-${fx.u}-SOON`, fx.p1, Date.now() + 3 * 60_000, 5)
    expect((await err(await admin.post(loads, { data: { batchId: soon.id, quantity: 1 } }), 409)).message).toMatch(/^BATCH_EXPIRED/)
    // slot A holds Táo of B1 (+3 days): a Táo batch expiring sooner is an inversion
    const early = await createBatch(admin, `E2E-INV-${fx.u}-EARLY`, fx.p1, Date.now() + DAY, 5)
    expect((await summary(fx.machineId, fx.slotA)).remainingCapacity, 'slot A needs a free place').toBeGreaterThan(0)
    const inversion = await err(await admin.post(loads, { data: { batchId: early.id, quantity: 1 } }), 409)
    expect(inversion.message).toMatch(/^EXPIRY_INVERSION/)
    const loaded = await dataOf(await admin.post(loads, { data: { batchId: early.id, quantity: 1, acknowledgeExpiryInversion: true } }), 201)
    expect(loaded.loaded).toBe(1)
    expect((await err(await admin.patch(`${API}/work-orders/${order.id}/restock-lines/${line.id}`, { data: { plannedQuantity: 2 } }), 409)).message).toMatch(/^LINE_ALREADY_LOADED/)
    const zero = await err(await admin.post(loads, { data: { batchId: fx.b1, quantity: 0 } }), 400)
    expect.soft(Object.keys(zero.fieldErrors ?? {}), 'fieldErrors key of quantity 0').toEqual(['quantity'])
  } finally { await cancelOrder(order.id) }
})

test('INV-23 BE: hoàn tất phiếu lệch kế hoạch thiếu lý do → 409 RESTOCK_VARIANCE_REASON_REQUIRED; lý do trống → 400 đúng field; có lý do → DONE', async () => {
  const order = await restockOrder([{ slotId: fx.slotB, productId: fx.p2, plannedQuantity: 2 }], true)
  try {
    const line = order.lines[0]
    await dataOf(await admin.post(`${API}/work-orders/${order.id}/restock-lines/${line.id}/loads`, { data: { batchId: fx.b2, quantity: 1 } }), 201)
    const url = `${API}/work-orders/${order.id}/complete`
    const missing = await err(await admin.post(url, { data: { resultNote: 'E2E nạp thiếu' } }), 409)
    expect(missing.message).toMatch(/^RESTOCK_VARIANCE_REASON_REQUIRED/)
    const blank = await err(await admin.post(url, { data: { resultNote: 'E2E', lineVariances: [{ lineId: line.id, reason: '   ' }] } }), 400)
    await err(await admin.post(url, { data: { resultNote: 'E2E', version: 1 } }), 400)
    const done = await dataOf(await admin.post(url, { data: { resultNote: 'E2E nạp thiếu 1', lineVariances: [{ lineId: line.id, reason: 'E2E lô còn 1 hộp' }] } }))
    expect(done.status).toBe('DONE')
    expect.soft(Object.keys(blank.fieldErrors ?? {}), 'fieldErrors key of a blank variance reason').toEqual(['lineVariances[0].reason'])
  } finally {
    await cancelOrder(order.id)
    await admin.patch(`${API}/machines/${fx.machineId}/status`, { data: { status: 'ACTIVE' } })
  }
})

test('INV-24 BE: lệnh bảo trì (mở cổng nạp / rút hộp) khi máy OFFLINE → 409 MACHINE_OFFLINE, không lộ chi tiết', async () => {
  const order = await restockOrder([{ slotId: fx.slotA, productId: fx.p1, plannedQuantity: 1 }], true)
  try {
    for (const [operation, extra] of [['OPEN_REFILL', {}], ['REMOVE_ITEM', { reason: 'EXPIRED' }], ['EMPTY_COLUMN', { reason: 'RESTOCK' }]] as const) {
      const response = await admin.post(`${API}/machines/${fx.machineId}/slots/${fx.slotA}/maintenance-commands`, {
        data: { operation, workOrderId: order.id, ...extra }, headers: { 'Idempotency-Key': `E2E-${fx.u}-${operation}`.slice(0, 64) },
      })
      const body = await err(response, 409)
      expect(body.message).toMatch(/^MACHINE_OFFLINE/)
    }
  } finally {
    await cancelOrder(order.id)
    await admin.patch(`${API}/machines/${fx.machineId}/status`, { data: { status: 'ACTIVE' } })
  }
})

test('INV-43 FE: tạo phiếu nạp từ gợi ý — máy có hàng tạo được; máy trống hiện câu NOTHING_TO_RESTOCK tiếng Việt', async ({ page }) => {
  const console = watchConsole(page)
  await loginAs(page, 'ADMIN')
  await page.goto('/admin/tickets')
  await page.getByRole('button', { name: 'Tạo phiếu' }).click()
  let sheet = page.getByRole('dialog')
  await sheet.getByLabel('Loại phiếu').selectOption('RESTOCK')
  await sheet.getByLabel('Máy').selectOption(fx.emptyMachineId)
  await expect(sheet.getByText(/Không có ngăn nào cần nạp/)).toBeVisible()
  await sheet.getByRole('button', { name: 'Tạo phiếu' }).click()
  await expect(sheet.getByText('Máy không có ngăn nào cần nạp theo gợi ý (các ngăn còn đủ hàng hoặc chưa biết sản phẩm). Không có phiếu nào được tạo.')).toBeVisible()
  await expect(sheet.getByText(/NOTHING_TO_RESTOCK/)).toHaveCount(0)
  await sheet.getByRole('button', { name: 'Hủy' }).click()
  await page.getByRole('button', { name: 'Tạo phiếu' }).click()
  sheet = page.getByRole('dialog')
  await sheet.getByLabel('Loại phiếu').selectOption('RESTOCK')
  await sheet.getByLabel('Máy').selectOption(fx.machineId)
  await expect(sheet.getByText(`Gợi ý nạp hàng của máy E2E-INV-${fx.u}`)).toBeVisible()
  await sheet.getByLabel('Tiêu đề (không bắt buộc)').fill(`E2E-INV UI gợi ý ${fx.u}`)
  const answer = page.waitForResponse(response => response.url().includes('/restock-work-orders'))
  await sheet.getByRole('button', { name: 'Tạo phiếu' }).click()
  const response = await answer
  expect(response.status()).toBe(201)
  await expect(page.getByText('Đã tạo phiếu công việc')).toBeVisible()
  await cancelOrder((await response.json()).data.id)
  expect(console).toEqual([])
})

test('INV-44 FE: trang thực hiện phiếu — thêm dòng 0 bị chặn; dòng trùng → 409 tiếng Việt; máy OFFLINE khóa lệnh có lý do; đối chiếu thiếu lý do lệch bị chặn; hoàn tất', async ({ page }) => {
  const console = watchConsole(page)
  const order = await restockOrder([{ slotId: fx.slotA, productId: fx.p1, plannedQuantity: 1 }], true)
  try {
    await loginAs(page, 'ADMIN')
    await page.goto(`/admin/tickets/${order.id}/restock`)
    await expect(page.getByRole('heading', { name: /Bước \d\/\d/ })).toBeVisible()
    // plan: add a line with 0 bowls, then a duplicate of slot A / Táo
    const plan = page.getByRole('region', { name: /Kế hoạch nạp/ })
    if (!(await plan.getByRole('button', { name: 'Thêm dòng nạp' }).isVisible())) await plan.getByRole('button', { name: 'Sửa kế hoạch' }).click()
    await plan.getByRole('button', { name: 'Thêm dòng nạp' }).click()
    const adds = watchRequests(page, 'POST', '/restock-lines')
    await plan.getByRole('combobox', { name: /^Ngăn/ }).selectOption(fx.slotB)
    await plan.getByRole('combobox', { name: /^Sản phẩm/ }).selectOption(fx.p2)
    await plan.getByRole('textbox', { name: /^Số hộp dự kiến/ }).last().fill('0')
    await plan.getByRole('button', { name: 'Thêm dòng', exact: true }).click()
    await expect(plan.getByText('Số hộp phải là số nguyên từ 1 trở lên.')).toBeVisible()
    expect(adds).toEqual([])
    await plan.getByRole('combobox', { name: /^Ngăn/ }).selectOption(fx.slotA)
    await plan.getByRole('combobox', { name: /^Sản phẩm/ }).selectOption(fx.p1)
    await plan.getByRole('textbox', { name: /^Số hộp dự kiến/ }).last().fill('1')
    const dup = page.waitForResponse(response => response.url().endsWith('/restock-lines') && response.request().method() === 'POST')
    await plan.getByRole('button', { name: 'Thêm dòng', exact: true }).click()
    expect((await dup).status()).toBe(409)
    await expect(page.getByText('Ngăn này đã có dòng cho sản phẩm đó. Sửa số hộp của dòng đang có thay vì thêm dòng mới.')).toBeVisible()
    await expect(page.getByText(/DUPLICATE_LINE/)).toHaveCount(0)
    // remove step: the machine never connected, commands are locked with the reason
    await expect(page.getByText('Chưa gửi lệnh được')).toBeVisible()
    await expect(page.getByText(/Máy chưa từng kết nối nên lệnh không tới được máy\.|Máy đang mất kết nối \(OFFLINE\) nên lệnh không tới được máy\./)).toBeVisible()
    // move on without loading: reconcile needs a reason for the line (planned 1, loaded 0)
    await page.getByRole('button', { name: 'Tiếp tục: Nạp theo dòng' }).click()
    await page.getByRole('button', { name: 'Tiếp tục: Đóng cổng nạp' }).click()
    await page.getByRole('button', { name: 'Tiếp tục: Đối chiếu' }).click()
    const completes = watchRequests(page, 'POST', '/complete')
    await page.getByLabel('Kết quả nạp hàng').fill('E2E không nạp được')
    await page.getByRole('button', { name: 'Hoàn tất phiếu' }).click()
    await expect(page.getByText('Dòng này nạp khác kế hoạch: ghi lý do (ví dụ “Lô mới chỉ còn 4 hộp”).')).toBeVisible()
    expect(completes).toEqual([])
    await page.getByLabel(/Lý do lệch ngăn A/).fill('E2E máy offline, không nạp')
    const done = page.waitForResponse(response => response.url().endsWith('/complete'))
    await page.getByRole('button', { name: 'Hoàn tất phiếu' }).click()
    expect((await done).status()).toBe(200)
    await expect(page.getByRole('heading', { name: 'Phiếu đã hoàn tất' })).toBeVisible()
  } finally {
    await cancelOrder(order.id)
    await admin.patch(`${API}/machines/${fx.machineId}/status`, { data: { status: 'ACTIVE' } })
  }
  expect(console).toEqual([])
})

// =====================================================================================================================
// Near-expiry discount (global setting: always restored)
// =====================================================================================================================

test('INV-25 BE: giảm giá cận hạn — GET STAFF 200, PUBLIC 401; PUT STAFF 403; 0/91 → 400 percent; "50"/50.5/field lạ/thiếu version → 400; version cũ → 409; không đổi → 200 giữ version', async () => {
  const current = await dataOf(await admin.get(`${API}/pricing/near-expiry-discount`))
  await dataOf(await staff.get(`${API}/pricing/near-expiry-discount`))
  await err(await anon.get(`${API}/pricing/near-expiry-discount`), 401)
  const url = `${API}/pricing/near-expiry-discount`
  const base = { enabled: current.enabled, percent: current.percent, version: current.version }
  await err(await staff.put(url, { data: base }), 403)
  const zero = await err(await admin.put(url, { data: { ...base, percent: 0 } }), 400)
  const high = await err(await admin.put(url, { data: { ...base, percent: 91 } }), 400)
  for (const data of [{ ...base, percent: '50' }, { ...base, percent: 50.5 }, { ...base, foo: 1 }, { enabled: base.enabled, percent: base.percent }]) await err(await admin.put(url, { data }), 400)
  await err(await admin.put(url, { data: { ...base, percent: base.percent === 40 ? 41 : 40, version: base.version + 99 } }), 409)
  const same = await dataOf(await admin.put(url, { data: base }))
  expect(same.version).toBe(current.version)
  expect.soft(Object.keys(zero.fieldErrors ?? {}), 'fieldErrors key of percent 0').toEqual(['percent'])
  expect.soft(Object.keys(high.fieldErrors ?? {}), 'fieldErrors key of percent 91').toEqual(['percent'])
})

test('INV-45 FE: sửa giảm giá — 0 / 91 / chữ bị chặn cạnh ô không gửi; version cũ → 409 câu tiếng Việt và tải lại; STAFF không có nút sửa', async ({ page }) => {
  const console = watchConsole(page)
  await loginAs(page, 'ADMIN')
  const puts = watchRequests(page, 'PUT', '/pricing/near-expiry-discount')
  await page.goto(`/admin/inventory?machineId=${fx.machineId}`)
  await page.getByRole('button', { name: 'Sửa cài đặt' }).click()
  const sheet = page.getByRole('dialog')
  const percent = sheet.getByLabel('Mức giảm (%)')
  for (const value of ['0', '91']) {
    await percent.fill(value)
    await sheet.getByRole('button', { name: 'Lưu cài đặt' }).click()
    await expect(sheet.getByText('Nhập số nguyên từ 1 đến 90.')).toBeVisible()
  }
  // a number input does not accept letters: the value stays empty and is refused the same way
  await percent.fill('')
  await percent.pressSequentially('abc')
  await sheet.getByRole('button', { name: 'Lưu cài đặt' }).click()
  await expect(sheet.getByText('Nhập số nguyên từ 1 đến 90.')).toBeVisible()
  expect(puts).toEqual([])
  // someone else saves in between (changed then restored: same values, version + 2)
  const current = await dataOf(await admin.get(`${API}/pricing/near-expiry-discount`))
  const other = current.percent === 40 ? 41 : 40
  try {
    const bumped = await dataOf(await admin.put(`${API}/pricing/near-expiry-discount`, { data: { enabled: current.enabled, percent: other, version: current.version } }))
    await dataOf(await admin.put(`${API}/pricing/near-expiry-discount`, { data: { enabled: current.enabled, percent: current.percent, version: bumped.version } }))
  } finally {
    const now = await dataOf(await admin.get(`${API}/pricing/near-expiry-discount`))
    if (now.percent !== current.percent || now.enabled !== current.enabled) await admin.put(`${API}/pricing/near-expiry-discount`, { data: { enabled: current.enabled, percent: current.percent, version: now.version } })
  }
  await percent.fill(String(current.percent === 30 ? 31 : 30))
  const stale = page.waitForResponse(response => response.url().includes('/pricing/near-expiry-discount') && response.request().method() === 'PUT')
  await sheet.getByRole('button', { name: 'Lưu cài đặt' }).click()
  const response = await stale
  try {
    expect(response.status()).toBe(409)
    expect(Object.keys(JSON.parse(response.request().postData() ?? '{}')).sort()).toEqual(['enabled', 'percent', 'version'])
    await expect(sheet.getByText('Cài đặt giảm giá vừa được người khác thay đổi. Đã tải lại giá trị mới nhất; kiểm tra rồi lưu lại.')).toBeVisible()
  } finally {
    const now = await dataOf(await admin.get(`${API}/pricing/near-expiry-discount`))
    if (now.percent !== current.percent || now.enabled !== current.enabled) await admin.put(`${API}/pricing/near-expiry-discount`, { data: { enabled: current.enabled, percent: current.percent, version: now.version } })
  }
  await sheet.getByRole('button', { name: 'Hủy' }).click()
  expect(console).toEqual([])
  // STAFF sees the setting but cannot edit it
  await page.context().clearCookies()
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear() })
  await loginAs(page, 'STAFF')
  await page.goto(`/admin/inventory?machineId=${fx.machineId}`)
  await expect(page.getByText(/Đang (bật|tắt):/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Sửa cài đặt' })).toHaveCount(0)
})
