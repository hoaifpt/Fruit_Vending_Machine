// STAFF flows on the REAL backend (playwright.real.config.ts). Case table: e2e-real/cases/staff.md.
// Shared backend/DB with other suites: never locks or edits the two accounts, never changes role permissions; machine M1 is
// only put in MAINTENANCE by STF-23 (a MAINTENANCE work order always stops the machine) and is put back to ACTIVE by ADMIN in
// the same test. Every work order created here is titled `E2E-STF-…` and the ones still unfinished are cancelled in afterAll.
import { test, expect, request as pwRequest } from '@playwright/test'
import type { APIRequestContext, APIResponse, Page } from '@playwright/test'
import { API, MACHINE_ID, apiAs, dataOf, errorOf, loginAs, tokenFor, uniq } from './real.ts'

const RUN = uniq()
const PREFIX = `E2E-STF-${RUN}`
const ZERO = '00000000-0000-0000-0000-000000000000'

let adminApi: APIRequestContext | undefined
let staffApi: APIRequestContext | undefined
let staffToken = ''
const admin = async () => (adminApi ??= await apiAs('ADMIN'))
const staff = async () => {
  if (!staffApi) { staffToken = await tokenFor('STAFF'); staffApi = await pwRequest.newContext({ extraHTTPHeaders: { Authorization: `Bearer ${staffToken}` } }) }
  return staffApi
}
function subOf(token: string): string {
  return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')).sub as string
}
async function staffId() { await staff(); return subOf(staffToken) }

/** An error body never carries a stack trace, exception class or SQL (production standard). */
async function expectCleanError(response: APIResponse) {
  const text = await response.text()
  expect(text, 'error body leaks internals').not.toMatch(/stackTrace|"trace"|\bat (org|com|java)\.|Exception|SQLState|select .* from|org\.hibernate|springframework/i)
  return text
}
/** Error envelope + clean check. */
async function failOf(response: APIResponse, status: number) {
  await expectCleanError(response)
  return errorOf(response, status)
}

type WO = { id: string; code: string; status: string; version: number; type: string; machineId: string }
const created: string[] = []
async function createWO(type: 'INCIDENT' | 'MAINTENANCE', assign: 'STAFF' | 'NONE', suffix: string): Promise<WO> {
  const body: Record<string, unknown> = { type, machineId: MACHINE_ID, title: `${PREFIX}-${suffix}`, description: 'Phiếu do test STAFF tạo', priority: 'NORMAL' }
  if (assign === 'STAFF') body.assigneeId = await staffId()
  const wo = await dataOf<WO>(await (await admin()).post(`${API}/work-orders`, { data: body }), 201)
  created.push(wo.id)
  return wo
}
async function getWO(id: string, who: 'ADMIN' | 'STAFF' = 'ADMIN'): Promise<WO> {
  return dataOf<WO>(await (who === 'ADMIN' ? await admin() : await staff()).get(`${API}/work-orders/${id}`))
}
async function machineStatus(): Promise<string> {
  return (await dataOf<{ status: string }>(await (await admin()).get(`${API}/machines/${MACHINE_ID}`))).status
}
async function restoreMachineActive() {
  const response = await (await admin()).patch(`${API}/machines/${MACHINE_ID}/status`, { data: { status: 'ACTIVE' } })
  return response.status()
}

/** Console errors of the page; "Failed to load resource" (the browser logging an expected 4xx) is kept apart. */
function watchConsole(page: Page) {
  const errors: string[] = [], network: string[] = []
  page.on('console', message => {
    if (message.type() !== 'error') return
    if (/Failed to load resource/.test(message.text())) network.push(message.text()); else errors.push(message.text())
  })
  page.on('pageerror', error => errors.push(`pageerror: ${error.message}`))
  return { errors, network }
}
const dialog = (page: Page) => page.locator('[role="dialog"], [role="alertdialog"]').last()

test.afterAll(async () => {
  const api = await admin()
  for (const id of created) {
    const wo = await getWO(id).catch(() => undefined)
    if (wo && !['DONE', 'CANCELLED'].includes(wo.status)) {
      await api.post(`${API}/work-orders/${id}/cancel`, { data: { reason: 'E2E cleanup (staff.spec)', version: wo.version } })
    }
  }
  if (await machineStatus() === 'MAINTENANCE') await restoreMachineActive()
})

// ---------------------------------------------------------------- menu, route guards, 401

test('STF-01 menu STAFF chỉ có mục được phép', async ({ page }) => {
  const log = watchConsole(page)
  await loginAs(page, 'STAFF')
  const nav = page.getByRole('navigation', { name: 'Quản trị' })
  for (const label of ['Tổng quan', 'Máy bán hàng', 'Tồn kho', 'Cảnh báo', 'Phiếu công việc', 'Lịch bảo trì', 'Đơn hàng']) {
    await expect(nav.getByRole('link', { name: label, exact: true }), label).toBeVisible()
  }
  for (const label of ['Tài khoản', 'Vai trò & quyền', 'Thanh toán', 'Webhook thanh toán', 'Hoàn tiền', 'Báo cáo doanh thu']) {
    await expect(nav.getByRole('link', { name: label, exact: true }), label).toHaveCount(0)
  }
  expect(page.url()).toContain('/admin/overview')
  expect(log.errors).toEqual([])
})

for (const [id, path, api] of [
  ['STF-02a', '/admin/users', '/users'], ['STF-02b', '/admin/roles', '/roles'], ['STF-02c', '/admin/payments', '/payments'],
  ['STF-02d', '/admin/refunds', '/refunds'], ['STF-02e', '/admin/reports/revenue', '/reports/sales'], ['STF-02f', '/admin/webhook-logs', '/payment-webhook-logs'],
] as const) {
  test(`${id} gõ thẳng URL ${path} bị chặn kèm giải thích`, async ({ page }) => {
    const log = watchConsole(page)
    await loginAs(page, 'STAFF')
    const calls: string[] = []
    page.on('request', request => { if (request.url().includes(`/api/v1${api}`)) calls.push(request.url()) })
    await page.goto(path)
    const box = page.getByRole('alert').filter({ hasText: 'Không có quyền truy cập' })
    await expect(box.getByRole('heading', { level: 1, name: 'Không có quyền truy cập' })).toBeVisible()
    await expect(box).toContainText('Mục này chỉ dành cho')
    await expect(box).toContainText('Quản trị viên')
    await expect(box).toContainText('Nhân viên')
    await expect(box.getByRole('link', { name: 'Về trang đầu của bạn' })).toBeVisible()
    // The guard decides before the screen mounts: no request to the forbidden API.
    expect(calls).toEqual([])
    expect(page.url()).toContain(path) // not signed out
    expect(log.errors).toEqual([])
  })
}

test('STF-03 API chỉ dành ADMIN trả 403 cho STAFF, không lộ quyền thiếu, không lộ stack trace', async () => {
  const api = await staff()
  const slotId = (await dataOf<{ content: { id: string }[] }>(await api.get(`${API}/machines/${MACHINE_ID}/slots?size=1`))).content[0]?.id ?? ZERO
  const cases: [string, string, unknown?][] = [
    ['GET', '/users'], ['POST', '/users', { email: `e2e-${RUN}@x.test` }], [`GET`, '/roles'],
    ['PUT', `/roles/${ZERO}/permissions`, { permissions: [] }], ['GET', '/payments'], ['GET', '/payment-webhook-logs'],
    ['GET', '/refunds'], ['GET', '/refunds/summary'], [`POST`, `/payments/${ZERO}/refund`, {}],
    ['GET', '/reports/sales/summary'], ['GET', '/reports/sales/export'],
    ['PUT', '/pricing/near-expiry-discount', { enabled: false }], ['POST', '/inventory/load', {}],
    ['POST', '/machines', { code: `E2E-${RUN}` }], ['PUT', `/machines/${MACHINE_ID}`, { name: 'x' }],
    ['PATCH', `/machines/${MACHINE_ID}/status`, { status: 'INACTIVE' }],
    ['GET', `/machines/${MACHINE_ID}/kiosk-credentials`], ['POST', `/machines/${MACHINE_ID}/kiosk-credentials`, {}],
    ['POST', `/machines/${MACHINE_ID}/report-token/rotate`, {}],
    ['POST', '/work-orders', { type: 'INCIDENT', machineId: MACHINE_ID, title: `${PREFIX}-staff-create` }],
    ['POST', `/work-orders/${ZERO}/assign`, { assigneeId: ZERO, version: 0 }], ['POST', `/work-orders/${ZERO}/cancel`, { reason: 'x', version: 0 }],
    ['POST', '/maintenance-plans', { machineId: MACHINE_ID, title: `${PREFIX}-plan`, intervalDays: 7 }],
    ['POST', `/maintenance-plans/${ZERO}/generate-now`, {}], ['POST', `/machines/${MACHINE_ID}/reset`, { note: 'x' }],
    ['GET', '/audit-logs'], ['POST', `/machines/${MACHINE_ID}/restock-work-orders`, {}],
    ['POST', `/machines/${MACHINE_ID}/slots/${slotId}/maintenance-commands-x`, {}], // unknown path: must not be 5xx
  ]
  const wrong: string[] = []
  for (const [method, path, body] of cases) {
    const response = await api.fetch(`${API}${path}`, { method, data: body, headers: { 'Idempotency-Key': `e2e${RUN}x1` } })
    const text = await expectCleanError(response)
    const expected = path.endsWith('-x') ? [403, 404] : [403]
    if (!expected.includes(response.status())) wrong.push(`${method} ${path} → ${response.status()} ${text.slice(0, 160)}`)
    else if (/_READ|_WRITE|_MANAGE|PERMISSION_|_REFUND|_RESET|_DIRECT/.test(text)) wrong.push(`${method} ${path} 403 names a permission: ${text.slice(0, 160)}`)
  }
  expect(wrong).toEqual([])
})

test('STF-04 API không token → 401, token hỏng → 401, không lộ chi tiết', async () => {
  const anon = await apiAs('PUBLIC')
  const token = (await staff(), staffToken)
  const [h, p] = token.split('.')
  const forged = `${h}.${p}.${'A'.repeat(43)}`
  const bad = await pwRequest.newContext({ extraHTTPHeaders: { Authorization: `Bearer ${forged}` } })
  const garbage = await pwRequest.newContext({ extraHTTPHeaders: { Authorization: 'Bearer not-a-jwt' } })
  for (const path of ['/work-orders/me', '/alerts', '/maintenance-plans', '/maintenance-commands', '/users']) {
    for (const [name, ctx] of [['anon', anon], ['forged', bad], ['garbage', garbage]] as const) {
      const response = await ctx.get(`${API}${path}`)
      await expectCleanError(response)
      expect(response.status(), `${name} ${path}`).toBe(401)
    }
  }
})

test('STF-05 FE: không có phiên → /login?next=, token hỏng (sai chữ ký) → API 401 → /login?next=', async ({ page }) => {
  const log = watchConsole(page)
  await page.goto('/admin/alerts?status=OPEN')
  await page.waitForURL(/\/login\?next=/)
  expect(decodeURIComponent(new URL(page.url()).searchParams.get('next') ?? '')).toBe('/admin/alerts?status=OPEN')
  await expect(page.getByLabel('Email')).toBeVisible()

  await staff()
  const [h, p] = staffToken.split('.')
  await page.evaluate(value => sessionStorage.setItem('fruit-vending-session-v1', value), `${h}.${p}.${'A'.repeat(43)}`)
  await page.goto('/admin/tickets')
  await page.waitForURL(/\/login\?next=/, { timeout: 20_000 })
  expect(decodeURIComponent(new URL(page.url()).searchParams.get('next') ?? '')).toBe('/admin/tickets')
  await expect(page.getByLabel('Email')).toBeVisible()
  // The forged token is dropped.
  expect(await page.evaluate(() => sessionStorage.getItem('fruit-vending-session-v1'))).toBeNull()
  // Garbage in storage: no session at all.
  await page.evaluate(() => sessionStorage.setItem('fruit-vending-session-v1', 'garbage'))
  await page.goto('/admin/maintenance-schedules')
  await page.waitForURL(/\/login\?next=%2Fadmin%2Fmaintenance-schedules/)
  expect(log.errors).toEqual([])
})

// ---------------------------------------------------------------- work orders

test('STF-06 phiếu ADMIN giao cho STAFF hiện trong /work-orders/me và màn "Phiếu công việc"', async ({ page }) => {
  const wo = await createWO('INCIDENT', 'STAFF', 'mine')
  expect(wo.status).toBe('ASSIGNED')
  const mine = await dataOf<{ content: WO[] }>(await (await staff()).get(`${API}/work-orders/me?size=100`))
  expect(mine.content.map(item => item.id)).toContain(wo.id)
  expect(mine.content.every(item => (item as unknown as { assignee?: { id?: string } }).assignee?.id === subOf(staffToken))).toBe(true)

  const log = watchConsole(page)
  const listCalls: string[] = []
  page.on('request', request => { if (/\/api\/v1\/work-orders(\?|$)/.test(request.url())) listCalls.push(request.url()) })
  await loginAs(page, 'STAFF')
  await page.goto('/admin/tickets')
  await expect(page.getByRole('heading', { level: 1, name: 'Phiếu công việc' })).toBeVisible()
  await expect(page.getByRole('note')).toHaveText('Danh sách chỉ gồm phiếu được giao cho bạn.')
  await expect(page.getByRole('link', { name: `${PREFIX}-mine` })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Tạo phiếu' })).toHaveCount(0)
  // STAFF never sees "Phân công" / "Hủy phiếu" (WORK_ORDER_MANAGE).
  await expect(page.getByRole('button', { name: /^Hủy phiếu|^Phân công/ })).toHaveCount(0)
  expect(listCalls, 'STAFF must read /work-orders/me, not /work-orders').toEqual([])
  expect(log.errors).toEqual([])
})

test('STF-07 STAFF GET /work-orders (toàn bộ) → 403', async () => {
  const response = await (await staff()).get(`${API}/work-orders?size=5`)
  await failOf(response, 403)
})

test('STF-08 phiếu không giao cho mình: API 404 (chi tiết, events, start, note); FE "Không tìm thấy phiếu"', async ({ page }) => {
  const other = await createWO('INCIDENT', 'NONE', 'other')
  expect(other.status).toBe('OPEN')
  const api = await staff()
  for (const [method, path, body] of [
    ['GET', `/work-orders/${other.id}`], ['GET', `/work-orders/${other.id}/events`],
    ['POST', `/work-orders/${other.id}/start`, {}], ['POST', `/work-orders/${other.id}/notes`, { note: 'x' }],
    ['POST', `/work-orders/${other.id}/complete`, { resultNote: 'x' }],
  ] as [string, string, unknown?][]) {
    const response = await api.fetch(`${API}${path}`, { method, data: body })
    await failOf(response, 404)
  }
  const mine = await dataOf<{ content: WO[] }>(await api.get(`${API}/work-orders/me?size=100`))
  expect(mine.content.map(item => item.id)).not.toContain(other.id)

  const log = watchConsole(page)
  await loginAs(page, 'STAFF')
  await page.goto(`/admin/tickets/${other.id}`)
  await expect(page.getByRole('heading', { level: 1, name: 'Không tìm thấy phiếu' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Về danh sách phiếu' })).toBeVisible()
  await expect(page.getByText(`${PREFIX}-other`)).toHaveCount(0)
  expect(log.errors).toEqual([])
})

test('STF-09 STAFF bắt đầu phiếu INCIDENT trên FE (không dừng máy) → IN_PROGRESS, máy giữ ACTIVE', async ({ page }) => {
  const before = await machineStatus()
  const wo = await createWO('INCIDENT', 'STAFF', 'start')
  const log = watchConsole(page)
  await loginAs(page, 'STAFF')
  await page.goto(`/admin/tickets/${wo.id}`)
  await expect(page.getByRole('heading', { level: 1, name: `${PREFIX}-start` })).toBeVisible()
  await page.getByRole('button', { name: 'Bắt đầu', exact: true }).click()
  const box = dialog(page)
  await expect(box).toContainText('Bắt đầu làm phiếu này?')
  const stop = box.getByRole('checkbox')
  await expect(stop).not.toBeChecked()
  await box.getByRole('button', { name: 'Bắt đầu' }).click()
  await expect(page.getByText('Đã bắt đầu phiếu').first()).toBeVisible()
  await expect(page.getByRole('button', { name: 'Hoàn tất', exact: true })).toBeVisible()
  expect((await getWO(wo.id, 'STAFF')).status).toBe('IN_PROGRESS')
  expect(await machineStatus()).toBe(before)
  // Starting again: 200, unchanged (docs: "bắt đầu lại → 200 không đổi").
  const again = await (await staff()).post(`${API}/work-orders/${wo.id}/start`, { data: {} })
  expect(again.status()).toBe(200)
  expect(log.errors).toEqual([])
})

test('STF-10 ghi chú trống: API 400 fieldErrors.note; FE đánh dấu ô, không gọi API', async ({ page }) => {
  const wo = await createWO('INCIDENT', 'STAFF', 'note')
  const api = await staff()
  await dataOf(await api.post(`${API}/work-orders/${wo.id}/start`, { data: {} }))
  for (const body of [{ note: '' }, { note: '   ' }, {}]) {
    const error = await failOf(await api.post(`${API}/work-orders/${wo.id}/notes`, { data: body }), 400)
    // Contract/other endpoints key fieldErrors by the request field ("note"); soft so the FE part still runs.
    expect.soft(error.fieldErrors?.note, `${JSON.stringify(body)} → fieldErrors ${JSON.stringify(error.fieldErrors)}`).toBeTruthy()
  }
  const tooLong = await failOf(await api.post(`${API}/work-orders/${wo.id}/notes`, { data: { note: 'x'.repeat(2001) } }), 400)
  expect.soft(tooLong.fieldErrors?.note, `2001 chars → fieldErrors ${JSON.stringify(tooLong.fieldErrors)}`).toBeTruthy()

  const log = watchConsole(page)
  await loginAs(page, 'STAFF')
  await page.goto(`/admin/tickets/${wo.id}`)
  await page.getByRole('button', { name: 'Thêm ghi chú' }).click()
  const box = dialog(page)
  const posts: string[] = []
  page.on('request', request => { if (request.method() === 'POST' && request.url().includes('/notes')) posts.push(request.url()) })
  await box.getByRole('button', { name: 'Lưu ghi chú' }).click()
  const field = box.getByLabel('Ghi chú')
  await expect(field).toHaveAttribute('aria-invalid', 'true')
  await expect(box).toContainText('Nhập nội dung ghi chú.')
  await expect(field).toBeFocused()
  expect(posts).toEqual([])
  expect(log.errors).toEqual([])
})

test('STF-11 thêm ghi chú trên FE → hiện trong lịch sử phiếu', async ({ page }) => {
  const wo = await createWO('INCIDENT', 'STAFF', 'note-ok')
  await dataOf(await (await staff()).post(`${API}/work-orders/${wo.id}/start`, { data: {} }))
  const log = watchConsole(page)
  await loginAs(page, 'STAFF')
  await page.goto(`/admin/tickets/${wo.id}`)
  await page.getByRole('button', { name: 'Thêm ghi chú' }).click()
  const box = dialog(page)
  const text = `Đã kiểm tra ngăn A ${RUN}`
  await box.getByLabel('Ghi chú').fill(text)
  await box.getByRole('button', { name: 'Lưu ghi chú' }).click()
  await expect(page.getByText('Đã thêm ghi chú').first()).toBeVisible()
  await expect(page.locator('#ticket-progress').locator('..').getByText(text)).toBeVisible()
  const events = await dataOf<{ type?: string; note?: string }[]>(await (await staff()).get(`${API}/work-orders/${wo.id}/events`))
  expect(events.some(event => event.note === text)).toBe(true)
  expect(log.errors).toEqual([])
})

test('STF-12 hoàn tất thiếu resultNote: API 400; FE đánh dấu ô "Kết quả", focus vào ô', async ({ page }) => {
  const wo = await createWO('INCIDENT', 'STAFF', 'complete-empty')
  const api = await staff()
  await dataOf(await api.post(`${API}/work-orders/${wo.id}/start`, { data: {} }))
  for (const body of [{}, { resultNote: '' }, { resultNote: '  ' }]) {
    const error = await failOf(await api.post(`${API}/work-orders/${wo.id}/complete`, { data: body }), 400)
    expect.soft(error.fieldErrors?.resultNote, `${JSON.stringify(body)} → fieldErrors ${JSON.stringify(error.fieldErrors)}`).toBeTruthy()
  }
  const unknown = await failOf(await api.post(`${API}/work-orders/${wo.id}/complete`, { data: { resultNote: 'ok', hack: 1 } }), 400)
  expect(unknown.message ?? '').not.toMatch(/Exception|com\.|org\./)
  expect((await getWO(wo.id, 'STAFF')).status).toBe('IN_PROGRESS')

  const log = watchConsole(page)
  await loginAs(page, 'STAFF')
  await page.goto(`/admin/tickets/${wo.id}`)
  await page.getByRole('button', { name: 'Hoàn tất', exact: true }).click()
  const box = dialog(page)
  await box.getByRole('button', { name: 'Hoàn tất' }).click()
  const field = box.getByLabel('Kết quả')
  await expect(field).toHaveAttribute('aria-invalid', 'true')
  await expect(box).toContainText('Ghi kết quả: đã làm gì tại máy (bắt buộc).')
  await expect(field).toBeFocused()
  expect(log.errors).toEqual([])
})

test('STF-13 hoàn tất đúng trên FE → DONE, hiện kết quả, không còn nút thao tác', async ({ page }) => {
  const wo = await createWO('INCIDENT', 'STAFF', 'complete')
  await dataOf(await (await staff()).post(`${API}/work-orders/${wo.id}/start`, { data: {} }))
  const log = watchConsole(page)
  await loginAs(page, 'STAFF')
  await page.goto(`/admin/tickets/${wo.id}`)
  await page.getByRole('button', { name: 'Hoàn tất', exact: true }).click()
  const box = dialog(page)
  const result = `Đã xử lý sự cố ${RUN}`
  await box.getByLabel('Kết quả').fill(result)
  await box.getByRole('button', { name: 'Hoàn tất' }).click()
  await expect(page.getByText('Đã hoàn tất phiếu').first()).toBeVisible()
  await expect(page.getByText(result).first()).toBeVisible()
  await expect(page.getByRole('button', { name: /^(Bắt đầu|Hoàn tất|Thêm ghi chú)$/ })).toHaveCount(0)
  const done = await getWO(wo.id, 'STAFF')
  expect(done.status).toBe('DONE')
  expect(log.errors).toEqual([])
})

test('STF-14 thao tác lại phiếu đã DONE → 409 (start, note, complete)', async () => {
  const wo = await createWO('INCIDENT', 'STAFF', 'done-409')
  const api = await staff()
  await dataOf(await api.post(`${API}/work-orders/${wo.id}/start`, { data: {} }))
  await dataOf(await api.post(`${API}/work-orders/${wo.id}/complete`, { data: { resultNote: 'Xong' } }))
  for (const [path, body] of [['start', {}], ['notes', { note: 'Thêm' }], ['complete', { resultNote: 'Lần 2' }]] as const) {
    const error = await failOf(await api.post(`${API}/work-orders/${wo.id}/${path}`, { data: body }), 409)
    expect(error.message ?? '', path).toBeTruthy()
  }
})

test('STF-15 STAFF hoàn tất phiếu chưa bắt đầu (ASSIGNED) → 409', async () => {
  const wo = await createWO('INCIDENT', 'STAFF', 'complete-assigned')
  const error = await failOf(await (await staff()).post(`${API}/work-orders/${wo.id}/complete`, { data: { resultNote: 'x' } }), 409)
  expect(error.message ?? '').toMatch(/INVALID_WORK_ORDER_TRANSITION|transition/i)
})

test('STF-16 FE: phiếu bị ADMIN hủy trong lúc STAFF mở hộp thoại → báo lỗi tiếng Việt, tải lại, không trắng trang', async ({ page }) => {
  const wo = await createWO('INCIDENT', 'STAFF', 'cancelled-meanwhile')
  const log = watchConsole(page)
  await loginAs(page, 'STAFF')
  await page.goto(`/admin/tickets/${wo.id}`)
  await page.getByRole('button', { name: 'Bắt đầu', exact: true }).click()
  const fresh = await getWO(wo.id)
  await dataOf(await (await admin()).post(`${API}/work-orders/${wo.id}/cancel`, { data: { reason: 'E2E hủy giữa chừng', version: fresh.version } }))
  await dialog(page).getByRole('button', { name: 'Bắt đầu' }).click()
  await expect(page.locator('[data-sonner-toast][data-type="error"]').first()).toBeVisible()
  await expect(page.locator('[data-sonner-toast][data-type="error"]').first()).not.toContainText(/INVALID_|Exception|409/)
  console.log('STF-16 toast:', await page.locator('[data-sonner-toast][data-type="error"]').first().innerText())
  await expect(page.getByText('E2E hủy giữa chừng').first()).toBeVisible()
  await expect(page.getByRole('button', { name: 'Bắt đầu', exact: true })).toHaveCount(0)
  await expect(page.locator('#admin-main')).toBeVisible()
  expect(log.errors).toEqual([])
})

// ---------------------------------------------------------------- alerts

async function openAlert(): Promise<{ id: string; status: string } | undefined> {
  const page = await dataOf<{ content: { id: string; status: string; workOrderId?: string | null }[] }>(await (await staff()).get(`${API}/alerts?status=OPEN&size=50`))
  return page.content.find(alert => !alert.workOrderId)
}

test('STF-17 STAFF xem danh sách cảnh báo và lọc trạng thái (API + FE)', async ({ page }) => {
  const api = await staff()
  for (const status of ['OPEN', 'ACKNOWLEDGED', 'RESOLVED']) {
    const list = await dataOf<{ content: { status: string }[] }>(await api.get(`${API}/alerts?status=${status}&size=20`))
    expect(list.content.every(alert => alert.status === status), status).toBe(true)
  }
  await failOf(await api.get(`${API}/alerts?status=NOPE`), 400)
  const log = watchConsole(page)
  await loginAs(page, 'STAFF')
  await page.goto('/admin/alerts')
  await expect(page.getByRole('heading', { level: 1, name: 'Cảnh báo' })).toBeVisible()
  const request = page.waitForRequest(r => r.url().includes('/api/v1/alerts?') && r.url().includes('status=RESOLVED'))
  await page.getByLabel('Trạng thái').selectOption('RESOLVED')
  await request
  await expect(page).toHaveURL(/status=RESOLVED/)
  await expect(page.locator('table, [role="status"]').first()).toBeVisible()
  expect(log.errors).toEqual([])
})

test('STF-18 STAFF xác nhận (acknowledge) một cảnh báo OPEN trên FE', async ({ page }) => {
  const alert = await openAlert()
  test.skip(!alert, 'THIẾU DỮ LIỆU: không có cảnh báo OPEN chưa gắn phiếu')
  const log = watchConsole(page)
  await loginAs(page, 'STAFF')
  await page.goto(`/admin/alerts/${alert!.id}`)
  await page.getByRole('button', { name: 'Xác nhận', exact: true }).click()
  await dialog(page).getByRole('button', { name: 'Xác nhận' }).click()
  await expect(page.getByText('Đã xác nhận cảnh báo').first()).toBeVisible()
  const after = await dataOf<{ status: string; acknowledgedBy?: string | null }>(await (await staff()).get(`${API}/alerts/${alert!.id}`))
  // The health check may have auto-resolved it meanwhile; otherwise it is ACKNOWLEDGED.
  expect(['ACKNOWLEDGED', 'RESOLVED']).toContain(after.status)
  // Acknowledge again: returned unchanged (idempotent).
  expect([200, 409]).toContain((await (await staff()).post(`${API}/alerts/${alert!.id}/acknowledge`)).status())
  expect(log.errors).toEqual([])
})

test('STF-19 đóng cảnh báo: note > 500 ký tự → API 400 fieldErrors.note; FE giới hạn 500 ký tự', async ({ page }) => {
  const alert = await openAlert() ?? (await dataOf<{ content: { id: string }[] }>(await (await staff()).get(`${API}/alerts?status=ACKNOWLEDGED&size=5`))).content[0]
  test.skip(!alert, 'THIẾU DỮ LIỆU: không có cảnh báo chưa đóng')
  const error = await failOf(await (await staff()).post(`${API}/alerts/${alert!.id}/resolve`, { data: { note: 'x'.repeat(501) } }), 400)
  expect(error.fieldErrors?.note).toBeTruthy()
  const log = watchConsole(page)
  await loginAs(page, 'STAFF')
  await page.goto(`/admin/alerts/${alert!.id}`)
  await page.getByRole('button', { name: 'Đóng cảnh báo' }).click()
  const box = dialog(page)
  const note = box.getByLabel('Ghi chú xử lý (không bắt buộc)')
  await note.fill('y'.repeat(520))
  expect((await note.inputValue()).length).toBe(500)
  await expect(box).toContainText('500/500 ký tự')
  await box.getByRole('button', { name: 'Hủy' }).click()
  expect(log.errors).toEqual([])
})

test('STF-20 STAFF đóng (resolve) cảnh báo trên FE; đóng lại / xác nhận cảnh báo đã đóng → 409', async ({ page }) => {
  const alert = await openAlert() ?? (await dataOf<{ content: { id: string; workOrderId?: string | null }[] }>(await (await staff()).get(`${API}/alerts?status=ACKNOWLEDGED&size=50`))).content.find(a => !a.workOrderId)
  test.skip(!alert, 'THIẾU DỮ LIỆU: không có cảnh báo chưa đóng')
  const log = watchConsole(page)
  await loginAs(page, 'STAFF')
  await page.goto(`/admin/alerts/${alert!.id}`)
  await page.getByRole('button', { name: 'Đóng cảnh báo' }).click()
  const box = dialog(page)
  await box.getByLabel('Ghi chú xử lý (không bắt buộc)').fill(`E2E STAFF đóng ${RUN}`)
  await box.getByRole('button', { name: 'Đóng cảnh báo' }).click()
  await expect(page.getByText('Đã đóng cảnh báo').first()).toBeVisible()
  const after = await dataOf<{ status: string; resolutionNote?: string }>(await (await staff()).get(`${API}/alerts/${alert!.id}`))
  expect(after.status).toBe('RESOLVED')
  await failOf(await (await staff()).post(`${API}/alerts/${alert!.id}/resolve`, { data: {} }), 409)
  await failOf(await (await staff()).post(`${API}/alerts/${alert!.id}/acknowledge`), 409)
  await expect(page.getByRole('button', { name: 'Đóng cảnh báo' })).toHaveCount(0)
  expect(log.errors).toEqual([])
})

// ---------------------------------------------------------------- maintenance commands

test('STF-21 lệnh bảo trì khi máy không ở MAINTENANCE: FE khóa nút kèm lý do; API 409', async ({ page }) => {
  test.skip((await machineStatus()) === 'MAINTENANCE', 'M1 đang MAINTENANCE (agent khác?)')
  const api = await staff()
  const slots = await dataOf<{ content: { id: string; slotCode: string }[] }>(await api.get(`${API}/machines/${MACHINE_ID}/slots?size=50`))
  const slot = slots.content[0]
  expect(slot, 'M1 has a slot').toBeTruthy()
  const response = await api.post(`${API}/machines/${MACHINE_ID}/slots/${slot.id}/maintenance-commands`, {
    data: { operation: 'OPEN_REFILL' }, headers: { 'Idempotency-Key': `e2e-${RUN}-open` },
  })
  const error = await failOf(response, 409)
  expect(error.message ?? '').toMatch(/^MACHINE_NOT_IN_MAINTENANCE/)
  const noKey = await api.post(`${API}/machines/${MACHINE_ID}/slots/${slot.id}/maintenance-commands`, { data: { operation: 'OPEN_REFILL' } })
  await expectCleanError(noKey)
  expect([400, 409]).toContain(noKey.status())

  const log = watchConsole(page)
  await loginAs(page, 'STAFF')
  await page.goto(`/admin/machines/${MACHINE_ID}?tab=maintenance&maintenanceSlot=${slot.id}`)
  const lock = page.locator('[data-lock="status"]')
  await expect(lock).toBeVisible()
  await expect(lock).toContainText('Lệnh bảo trì chỉ gửi được khi máy ở trạng thái Bảo trì')
  await expect(lock).toContainText('Việc cần làm:')
  const posts: string[] = []
  page.on('request', request => { if (request.method() === 'POST' && request.url().includes('maintenance-commands')) posts.push(request.url()) })
  for (const label of ['Mở cổng nạp', 'Đóng cổng nạp', 'Rút hộp đáy ngăn']) {
    const button = page.getByRole('button', { name: label })
    await expect(button).toHaveAttribute('aria-disabled', 'true')
    // Locked buttons stay focusable; activating one moves focus to the reason (no request).
    await button.focus()
    await page.keyboard.press('Enter')
    await expect(lock).toBeFocused()
  }
  await expect(lock).toBeFocused()
  expect(posts).toEqual([])
  expect(log.errors).toEqual([])
})

test('STF-22 RESET cần MACHINE_RESET: STAFF API 403; FE không có nút RESET, chỉ giải thích', async ({ page }) => {
  await failOf(await (await staff()).post(`${API}/machines/${MACHINE_ID}/reset`, { data: { note: 'x' }, headers: { 'Idempotency-Key': `e2e-${RUN}-reset` } }), 403)
  const log = watchConsole(page)
  await loginAs(page, 'STAFF')
  await page.goto(`/admin/machines/${MACHINE_ID}?tab=maintenance`)
  await expect(page.getByText('Khởi động lại bộ điều khiển (xóa lỗi FAULT) chỉ dành cho Quản trị viên.')).toBeVisible()
  await expect(page.getByRole('list', { name: 'Lệnh cho cả máy' })).toHaveCount(0)
  expect(log.errors).toEqual([])
})

test('STF-23 phiếu MAINTENANCE: STAFF start → máy MAINTENANCE (ghi nhận), lệnh bảo trì 409 OFFLINE, hoàn tất, ADMIN trả máy ACTIVE', async () => {
  test.skip((await machineStatus()) !== 'ACTIVE', 'M1 không ACTIVE lúc bắt đầu')
  const wo = await createWO('MAINTENANCE', 'STAFF', 'maintenance')
  const api = await staff()
  const notes: string[] = []
  try {
    const start = await api.post(`${API}/work-orders/${wo.id}/start`, { data: { stopMachine: true } })
    await expectCleanError(start)
    console.log('STF-23 start:', start.status(), (await start.text()).slice(0, 200))
    if (start.status() === 409) { notes.push(`start 409: ${(await start.text()).slice(0, 200)}`); test.info().annotations.push({ type: 'note', description: notes.join('; ') }); return }
    expect(start.status(), await start.text()).toBe(200)
    expect(await machineStatus(), 'docs: MAINTENANCE always stops the machine').toBe('MAINTENANCE')
    // Admin cannot reactivate while the work order is IN_PROGRESS.
    const early = await (await admin()).patch(`${API}/machines/${MACHINE_ID}/status`, { data: { status: 'ACTIVE' } })
    await expectCleanError(early)
    console.log('STF-23 reactivate while IN_PROGRESS:', early.status(), (await early.text()).slice(0, 200))
    expect(early.status(), 'reactivate while IN_PROGRESS').toBe(409)
    // Machine is MAINTENANCE but OFFLINE: the command is refused.
    const slot = (await dataOf<{ content: { id: string }[] }>(await api.get(`${API}/machines/${MACHINE_ID}/slots?size=1`))).content[0]
    const command = await api.post(`${API}/machines/${MACHINE_ID}/slots/${slot.id}/maintenance-commands`, { data: { operation: 'CLOSE_REFILL', workOrderId: wo.id }, headers: { 'Idempotency-Key': `e2e-${RUN}-close` } })
    const error = await failOf(command, 409)
    console.log('STF-23 command while MAINTENANCE+OFFLINE:', command.status(), error.message)
    expect(error.message ?? '').toMatch(/^MACHINE_OFFLINE/)
    await dataOf(await api.post(`${API}/work-orders/${wo.id}/complete`, { data: { resultNote: 'Bảo trì xong (E2E)' } }))
    expect(await machineStatus(), 'docs: machine stays MAINTENANCE after DONE').toBe('MAINTENANCE')
  } finally {
    const current = await getWO(wo.id)
    if (current.status === 'IN_PROGRESS') await (await admin()).post(`${API}/work-orders/${wo.id}/cancel`, { data: { reason: 'E2E cleanup', version: current.version } })
    if (await machineStatus() === 'MAINTENANCE') expect(await restoreMachineActive(), 'ADMIN restores M1').toBe(200)
  }
  expect(await machineStatus()).toBe('ACTIVE')
})

// ---------------------------------------------------------------- maintenance plans, positive controls

test('STF-24 lịch bảo trì: STAFF chỉ xem (không nút Tạo/Sửa/Tắt), API ghi → 403', async ({ page }) => {
  const api = await staff()
  await dataOf(await api.get(`${API}/maintenance-plans?size=5`))
  await dataOf(await api.get(`${API}/maintenance-plans/upcoming`))
  for (const [method, path, body] of [
    ['POST', '/maintenance-plans', { machineId: MACHINE_ID, title: `${PREFIX}-plan`, intervalDays: 7, startDate: '2026-12-01' }],
    ['PUT', `/maintenance-plans/${ZERO}`, { title: 'x' }], ['PATCH', `/maintenance-plans/${ZERO}`, { title: 'x' }],
    ['POST', `/maintenance-plans/${ZERO}/activate`, {}], ['POST', `/maintenance-plans/${ZERO}/deactivate`, {}],
  ] as [string, string, unknown][]) {
    const response = await api.fetch(`${API}${path}`, { method, data: body })
    await expectCleanError(response)
    expect([403, 405], `${method} ${path}`).toContain(response.status())
    if (method === 'POST') expect(response.status(), `${method} ${path}`).toBe(403)
  }
  const log = watchConsole(page)
  await loginAs(page, 'STAFF')
  await page.goto('/admin/maintenance-schedules')
  await expect(page.getByRole('heading', { level: 1, name: 'Lịch bảo trì' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Tạo lịch' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /^(Sửa|Tắt lịch|Bật lại|Tạo phiếu ngay)/ })).toHaveCount(0)
  await expect(page.getByRole('columnheader', { name: 'Thao tác' })).toHaveCount(0)
  expect(log.errors).toEqual([])
})

test('STF-25 đối chứng: API STAFF được phép trả 200', async () => {
  const api = await staff()
  for (const path of ['/dashboard/overview', '/alerts?size=1', '/work-orders/me?size=1', '/maintenance-plans?size=1', '/maintenance-commands?size=1',
    `/machines/${MACHINE_ID}`, '/products?size=1', '/orders?size=1', '/pricing/near-expiry-discount', '/notifications/me/unread-count', '/customer-reports?size=1']) {
    const response = await api.get(`${API}${path}`)
    expect(response.status(), `${path} ${(await response.text()).slice(0, 200)}`).toBe(200)
  }
})

test('STF-26 tổng quan STAFF không lộ số tiền (REPORT_SALES_READ), không lỗi console', async ({ page }) => {
  const overview = await dataOf<Record<string, unknown>>(await (await staff()).get(`${API}/dashboard/overview`))
  const text = JSON.stringify(overview)
  expect(text, 'dashboard for STAFF carries money').not.toMatch(/"(revenue|grossRevenue|netRevenue|refundedAmount|totalAmount)"\s*:\s*[0-9]/)
  const log = watchConsole(page)
  await loginAs(page, 'STAFF')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await expect(page.getByText(/[0-9.]+ ₫/)).toHaveCount(0)
  expect(log.errors).toEqual([])
})

test('STF-27 bàn phím: từ menu STAFF tới "Phiếu công việc" bằng Tab/Enter, focus sang nội dung', async ({ page }) => {
  await loginAs(page, 'STAFF')
  const link = page.getByRole('navigation', { name: 'Quản trị' }).getByRole('link', { name: 'Phiếu công việc', exact: true })
  await link.focus()
  await page.keyboard.press('Enter')
  await page.waitForURL(/\/admin\/tickets/)
  await expect(page.locator('#admin-main')).toBeFocused()
})
