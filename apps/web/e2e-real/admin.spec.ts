// ADMIN flows on the REAL backend (playwright.real.config.ts). Each test checks both sides: the FE (blocked before
// sending, or the server's 400/409 shown with the fields marked; generic Vietnamese text for 401/403/404/5xx; no blank
// page, no console error) and the BE (status code, fieldErrors, no stack trace / class / SQL in the body).
// Case table: e2e-real/cases/admin.md. Records created here start with E2E-. Never touches admin/staff accounts,
// machine M1 or the STAFF/ADMIN permission sets (the one role write is rejected before saving and restored if not).
//
//   PW_OUTPUT=<dir> npx playwright test -c playwright.real.config.ts e2e-real/admin.spec.ts
import { test, expect } from '@playwright/test'
import type { APIRequestContext, APIResponse, Page } from '@playwright/test'
import { ACCOUNTS, API, MACHINE_ID, apiAs, dataOf, errorOf, loginAs, uniq } from './real.ts'

// Not serial: a failing case must not stop the others. Cases that need a record create it through the API when an
// earlier case did not (ensure* helpers), so each one also runs alone with --grep.

const ADMIN_ROLE_ID = '10000000-0000-0000-0000-000000000001'
const NIL = '00000000-0000-0000-0000-000000000000'
/** Things a production error body must never contain. */
const LEAK = /exception|java\.|org\.springframework|com\.fruitmachine|hibernate|jdbc|sqlstate|\bselect\b.+\bfrom\b|stack ?trace|"trace"\s*:/i

let admin: APIRequestContext
let staff: APIRequestContext
let anon: APIRequestContext
/** Shared fixtures created once (all E2E-). */
const run = uniq()
const fx = {
  userEmail: `e2e-adm-${run.toLowerCase()}@freshvend.test`,
  userPassword: 'E2E-Passw0rd-long',
  userName: `E2E-Nhan vien ${run}`,
  userId: '',
  sku: `E2E-SKU-${run}`,
  productName: `E2E-Hop xoai ${run}`,
  productId: '',
  machineCode: `E2E-ADM-${run}`,
  machineName: `E2E-May ${run}`,
  machineId: '',
  planTitle: `E2E-Lich ${run}`,
}

test.beforeAll(async () => {
  admin = await apiAs('ADMIN')
  staff = await apiAs('STAFF')
  anon = await apiAs('PUBLIC')
})
test.afterAll(async () => {
  // Leave the E2E machine harmless: never ACTIVE, keys revoked (no deletes exist in the API).
  if (fx.machineId) {
    const keys = await admin.get(`${API}/machines/${fx.machineId}/kiosk-credentials`)
    if (keys.ok()) for (const key of (await keys.json()).data ?? []) {
      if (key.status === 'ACTIVE' && key.credentialId) await admin.post(`${API}/machines/${fx.machineId}/kiosk-credentials/${key.credentialId}/revoke`)
    }
  }
  await Promise.all([admin?.dispose(), staff?.dispose(), anon?.dispose()])
})

/** Error envelope of `response` with `status`, checked for leaks; message and fieldErrors returned. */
async function rejected(response: APIResponse, status: number) {
  const body = await errorOf(response, status)
  const raw = JSON.stringify(body)
  expect(raw, 'error body must not leak internals').not.toMatch(LEAK)
  expect(Object.keys(body)).not.toContain('trace')
  expect(Object.keys(body)).not.toContain('exception')
  return body
}

/** Collects console errors and uncaught page errors (expected 4xx "Failed to load resource" lines are ignored). */
function watch(page: Page) {
  const problems: string[] = []
  page.on('pageerror', error => problems.push(`pageerror: ${error.message}`))
  page.on('console', message => {
    if (message.type() === 'error' && !/Failed to load resource/i.test(message.text())) problems.push(`console: ${message.text()}`)
  })
  return {
    problems,
    /** The page still renders the admin shell or the login form (never blank). */
    async notBlank() { await expect(page.locator('body')).not.toBeEmpty(); await expect(page.locator('#root')).not.toBeEmpty() },
    check() { expect.soft(problems, 'no console errors').toEqual([]) },
  }
}

/** Counts requests matching method + path suffix (to prove the form stopped before sending). */
function countRequests(page: Page, method: string, pathRe: RegExp) {
  const hits: string[] = []
  page.on('request', request => { if (request.method() === method && pathRe.test(new URL(request.url()).pathname)) hits.push(request.url()) })
  return hits
}

async function ensureUser() {
  if (fx.userId) return fx.userId
  const user = await dataOf(await admin.post(`${API}/users`, { data: { email: fx.userEmail, password: fx.userPassword, fullName: fx.userName } }), 201)
  fx.userId = user.id
  return fx.userId
}

async function ensureProduct() {
  if (fx.productId) return fx.productId
  const product = await dataOf(await admin.post(`${API}/products`, { data: { sku: fx.sku, name: fx.productName, price: 35000 } }), 201)
  fx.productId = product.id
  return fx.productId
}

async function ensureMachine() {
  if (fx.machineId) return fx.machineId
  const created = await dataOf(await admin.post(`${API}/machines`, { data: {
    code: fx.machineCode, name: fx.machineName, location: 'E2E lab', minTemperature: 2, maxTemperature: 8, minHumidity: 40, maxHumidity: 80,
  } }), 201)
  fx.machineId = created.id
  return fx.machineId
}

// ------------------------------------------------------------------ Đăng nhập

test.describe('Đăng nhập', () => {
  test('ADM-01 đăng nhập đúng tài khoản ADMIN vào trang quản trị', async ({ page }) => {
    const w = watch(page)
    await loginAs(page, 'ADMIN')
    await expect(page).toHaveURL(/\/admin\//)
    await expect(page.getByRole('navigation').getByRole('link', { name: 'Tài khoản' })).toBeVisible()
    const login = await dataOf((await anon.post(`${API}/auth/login`, { data: ACCOUNTS.ADMIN })))
    expect(login.accessToken).toBeTruthy()
    expect(JSON.stringify(login)).not.toContain(ACCOUNTS.ADMIN.password)
    w.check()
  })

  test('ADM-02 sai mật khẩu: FE báo câu chung, BE 401 không lộ email có tồn tại', async ({ page }) => {
    const w = watch(page)
    await page.goto('/login')
    await page.getByLabel('Email').fill(ACCOUNTS.ADMIN.email)
    await page.locator('#login-password').fill('sai-mat-khau-E2E-123')
    await page.keyboard.press('Enter')
    await expect(page.getByRole('alert')).toContainText('Email hoặc mật khẩu không đúng')
    await expect(page.locator('#login-password')).toHaveAttribute('aria-invalid', 'true')
    await expect(page).toHaveURL(/\/login/)
    const wrong = await rejected(await anon.post(`${API}/auth/login`, { data: { email: ACCOUNTS.ADMIN.email, password: 'sai-mat-khau-E2E-123' } }), 401)
    const unknown = await rejected(await anon.post(`${API}/auth/login`, { data: { email: `e2e-none-${run.toLowerCase()}@freshvend.test`, password: 'sai-mat-khau-E2E-123' } }), 401)
    expect(wrong.message).toBe(unknown.message)
    w.check()
  })

  test('ADM-03 email sai định dạng: FE chặn trước khi gửi, BE 400 fieldErrors.email', async ({ page }) => {
    const w = watch(page)
    await page.goto('/login')
    const sent = countRequests(page, 'POST', /\/auth\/login$/)
    await page.getByLabel('Email').fill('khong-phai-email')
    await page.locator('#login-password').fill('bat-ky-123456')
    await page.keyboard.press('Enter')
    await expect(page.getByText('Email chưa đúng định dạng')).toBeVisible()
    await expect(page.getByLabel('Email')).toHaveAttribute('aria-invalid', 'true')
    expect(sent).toHaveLength(0)
    const body = await rejected(await anon.post(`${API}/auth/login`, { data: { email: 'khong-phai-email', password: 'x' } }), 400)
    expect(Object.keys(body.fieldErrors ?? {})).toEqual(['email'])
    w.check()
  })

  test('ADM-04 để trống email và mật khẩu: FE chặn, BE 400 cả hai fieldErrors; JSON hỏng 400 chung', async ({ page }) => {
    const w = watch(page)
    await page.goto('/login')
    const sent = countRequests(page, 'POST', /\/auth\/login$/)
    await page.getByRole('button', { name: /Đăng nhập/ }).click()
    await expect(page.getByText('Vui lòng nhập email.')).toBeVisible()
    await expect(page.getByText('Vui lòng nhập mật khẩu.')).toBeVisible()
    expect(sent).toHaveLength(0)
    const body = await rejected(await anon.post(`${API}/auth/login`, { data: { email: '', password: '' } }), 400)
    expect(Object.keys(body.fieldErrors ?? {}).sort()).toEqual(['email', 'password'])
    const malformed = await rejected(await anon.post(`${API}/auth/login`, { headers: { 'content-type': 'application/json' }, data: '{"email":' }), 400)
    expect(malformed.fieldErrors).toBeUndefined()
    w.check()
  })
})

// ------------------------------------------------------------------ Quyền

test.describe('Quyền truy cập', () => {
  const ADMIN_ONLY: [string, string, unknown?][] = [
    ['GET', '/users'], ['POST', '/users', { email: 'e2e-x@freshvend.test', password: 'E2E-Passw0rd-long', fullName: 'E2E-x' }],
    ['GET', '/roles'], ['GET', '/permissions'], ['PUT', `/roles/${NIL}/permissions`, { permissions: [] }],
    ['POST', '/products', { sku: 'E2E-STAFF', name: 'E2E', price: 1000 }], ['POST', '/machines', { code: 'E2E-STAFF', name: 'E2E', location: 'x', minTemperature: 2, maxTemperature: 8, minHumidity: 40, maxHumidity: 80 }],
    ['GET', `/machines/${MACHINE_ID}/kiosk-credentials`], ['POST', `/machines/${NIL}/kiosk-credentials`],
    ['GET', '/reports/sales/summary?from=2026-11-01&to=2026-11-17'], ['GET', '/reports/sales/export?format=CSV&from=2026-11-01&to=2026-11-17'],
    ['GET', '/refunds'], ['POST', '/maintenance-plans', { machineId: NIL, title: 'E2E-staff', intervalDays: 7 }],
  ]

  test('ADM-05 STAFF gọi API chỉ dành cho ADMIN → 403, không token → 401, body sạch', async () => {
    for (const [method, path, data] of ADMIN_ONLY) {
      const staffAnswer = await staff.fetch(`${API}${path}`, { method, data })
      const forbidden = await rejected(staffAnswer, 403)
      expect(forbidden.message, `${method} ${path}`).toBe('Access denied')
      const anonAnswer = await anon.fetch(`${API}${path}`, { method, data })
      await rejected(anonAnswer, 401)
    }
    const badToken = await (await apiAs('PUBLIC')).get(`${API}/users`, { headers: { Authorization: 'Bearer abc.def.ghi' } })
    await rejected(badToken, 401)
  })

  test('ADM-06 STAFF mở /admin/users, /admin/roles, /admin/reports/revenue: FE hiện "Không có quyền truy cập"', async ({ page }) => {
    const w = watch(page)
    await loginAs(page, 'STAFF')
    for (const path of ['/admin/users', '/admin/roles', '/admin/reports/revenue', '/admin/refunds']) {
      await page.goto(path)
      await expect(page.getByRole('heading', { name: 'Không có quyền truy cập' }), path).toBeVisible()
      await w.notBlank()
    }
    await page.goto(`/admin/machines/${MACHINE_ID}`)
    await expect(page.getByRole('tab', { name: 'Ngăn' })).toBeVisible()
    await expect(page.getByRole('tab', { name: 'Khóa kiosk' })).toHaveCount(0)
    w.check()
  })

  test('ADM-07 404/400/405 của BE: thông điệp chung, FE trang máy không tồn tại không trắng', async ({ page }) => {
    const notFound = await rejected(await admin.get(`${API}/machines/${NIL}`), 404)
    expect(notFound.message).toBe('Machine not found')
    const badId = await rejected(await admin.get(`${API}/machines/not-a-uuid`), 400)
    expect(badId.message).toBe('Bad Request')
    await rejected(await admin.get(`${API}/khong-ton-tai`), 404)
    await rejected(await admin.delete(`${API}/users`), 405)
    const w = watch(page)
    await loginAs(page, 'ADMIN')
    await page.goto(`/admin/machines/${NIL}`)
    await expect(page.getByRole('heading', { name: 'Không tìm thấy máy' })).toBeVisible()
    await page.goto('/admin/khong-co-trang-nay')
    await w.notBlank()
    await expect(page.locator('#admin-main')).toBeVisible()
    w.check()
  })
})

// ------------------------------------------------------------------ Tài khoản

test.describe('Tài khoản', () => {
  test('ADM-08 tạo tài khoản STAFF hợp lệ qua FE; BE trả STAFF ACTIVE, đăng nhập được', async ({ page }) => {
    const w = watch(page)
    await loginAs(page, 'ADMIN')
    await page.goto('/admin/users')
    await page.getByRole('button', { name: 'Tạo tài khoản nhân viên' }).click()
    const sheet = page.getByRole('dialog', { name: 'Tạo tài khoản nhân viên' })
    await sheet.getByLabel('Họ tên').fill(fx.userName)
    await sheet.getByLabel('Email').fill(fx.userEmail)
    await sheet.getByLabel(/^Mật khẩu/).fill(fx.userPassword)
    await sheet.getByLabel('Điện thoại (không bắt buộc)').fill('0900000123')
    const created = page.waitForResponse(r => r.request().method() === 'POST' && r.url().endsWith('/api/v1/users'))
    await sheet.getByRole('button', { name: 'Tạo tài khoản' }).click()
    const response = await created
    expect(response.status()).toBe(201)
    expect(Object.keys(response.request().postDataJSON()).sort()).toEqual(['email', 'fullName', 'password', 'phone'])
    await expect(page.getByText('Đã tạo tài khoản nhân viên')).toBeVisible()
    await expect(sheet).toHaveCount(0)
    await expect(page.getByRole('cell', { name: fx.userName }).first()).toBeVisible()
    const user = (await response.json()).data
    fx.userId = user.id
    expect(user.roles).toEqual(['STAFF'])
    expect(user.status).toBe('ACTIVE')
    expect(JSON.stringify(user)).not.toContain(fx.userPassword)
    expect((await anon.post(`${API}/auth/login`, { data: { email: fx.userEmail, password: fx.userPassword } })).status()).toBe(200)
    w.check()
  })

  test('ADM-09 email trùng (khác hoa thường): FE đánh dấu ô Email, BE 409', async ({ page }) => {
    await ensureUser()
    const w = watch(page)
    await loginAs(page, 'ADMIN')
    await page.goto('/admin/users')
    await page.getByRole('button', { name: 'Tạo tài khoản nhân viên' }).click()
    const sheet = page.getByRole('dialog', { name: 'Tạo tài khoản nhân viên' })
    await sheet.getByLabel('Họ tên').fill('E2E-Trung email')
    await sheet.getByLabel('Email').fill(fx.userEmail.toUpperCase())
    await sheet.getByLabel(/^Mật khẩu/).fill(fx.userPassword)
    await sheet.getByRole('button', { name: 'Tạo tài khoản' }).click()
    await expect(sheet.getByText('Email này đã được dùng cho một tài khoản khác')).toBeVisible()
    await expect(sheet.getByLabel('Email')).toHaveAttribute('aria-invalid', 'true')
    const body = await rejected(await admin.post(`${API}/users`, { data: { email: fx.userEmail.toUpperCase(), password: fx.userPassword, fullName: 'E2E-dup' } }), 409)
    expect(body.message).toBe('Email is already in use')
    w.check()
  })

  test('ADM-10 email sai định dạng và field lạ (roles): FE chặn, BE 400', async ({ page }) => {
    const w = watch(page)
    await loginAs(page, 'ADMIN')
    await page.goto('/admin/users')
    const sent = countRequests(page, 'POST', /\/api\/v1\/users$/)
    await page.getByRole('button', { name: 'Tạo tài khoản nhân viên' }).click()
    const sheet = page.getByRole('dialog', { name: 'Tạo tài khoản nhân viên' })
    await sheet.getByLabel('Họ tên').fill('E2E-Sai email')
    await sheet.getByLabel('Email').fill('e2e-khong-co-a-cong')
    await sheet.getByLabel(/^Mật khẩu/).fill(fx.userPassword)
    await sheet.getByRole('button', { name: 'Tạo tài khoản' }).click()
    await expect(sheet.getByText('Email chưa đúng định dạng')).toBeVisible()
    expect(sent).toHaveLength(0)
    const invalid = await rejected(await admin.post(`${API}/users`, { data: { email: 'e2e-khong-co-a-cong', password: fx.userPassword, fullName: 'E2E-x' } }), 400)
    expect(Object.keys(invalid.fieldErrors ?? {})).toContain('email')
    await rejected(await admin.post(`${API}/users`, { data: { email: `e2e-role-${run.toLowerCase()}@freshvend.test`, password: fx.userPassword, fullName: 'E2E-role', roles: ['ADMIN'] } }), 400)
    expect((await (await admin.get(`${API}/users?size=100`)).json()).data.content.some((u: { email: string }) => u.email === `e2e-role-${run.toLowerCase()}@freshvend.test`)).toBe(false)
    w.check()
  })

  test('ADM-11 mật khẩu dưới 12 ký tự (11 ký tự) bị BE từ chối 400 với fieldErrors.password', async () => {
    // Contract: PASSWORD_MIN_LENGTH default 12. The FE leaves the minimum to the server (configurable) and its hint says 12.
    const email = `e2e-pw11-${run.toLowerCase()}@freshvend.test`
    const answer = await admin.post(`${API}/users`, { data: { email, password: 'abcdefghijk', fullName: 'E2E-pw11' } })
    const body = await rejected(answer, 400)
    expect(body.fieldErrors?.password, 'password policy error names the field').toBeTruthy()
  })

  test('ADM-12 mật khẩu quá ngắn theo cấu hình (7 ký tự): FE hiện lỗi tiếng Việt và đánh dấu ô Mật khẩu', async ({ page }) => {
    const w = watch(page)
    await loginAs(page, 'ADMIN')
    await page.goto('/admin/users')
    await page.getByRole('button', { name: 'Tạo tài khoản nhân viên' }).click()
    const sheet = page.getByRole('dialog', { name: 'Tạo tài khoản nhân viên' })
    const email = `e2e-pw7-${run.toLowerCase()}@freshvend.test`
    await sheet.getByLabel('Họ tên').fill('E2E-Mat khau ngan')
    await sheet.getByLabel('Email').fill(email)
    const password = sheet.getByLabel(/^Mật khẩu/)
    await password.fill('abcdefg')
    // The FE checks the default minimum (12) itself: nothing is sent, the Vietnamese sentence is under the field (its
    // accessible description) and the field is marked invalid; no English server text reaches the form.
    const sent = countRequests(page, 'POST', /\/api\/v1\/users$/)
    await sheet.getByRole('button', { name: 'Tạo tài khoản' }).click()
    await expect(sheet.getByText('Mật khẩu tối thiểu 12 ký tự.', { exact: true })).toBeVisible()
    await expect(password).toHaveAccessibleDescription('Mật khẩu tối thiểu 12 ký tự.')
    await expect(password).toHaveAttribute('aria-invalid', 'true')
    await expect(sheet).not.toContainText('Password must contain')
    await expect(sheet).toBeVisible()
    expect(sent, 'a password under 12 characters is not sent').toHaveLength(0)
    // The server still enforces its policy on a direct call: 7 characters → 400 with a message, nothing created.
    const short = await rejected(await admin.post(`${API}/users`, { data: { email, password: 'abcdefg', fullName: 'E2E-pw7' } }), 400)
    expect(short.message, 'policy error carries a message').toBeTruthy()
    expect(Object.keys(short.fieldErrors ?? {}), 'only a message, no field errors').toEqual([])
    expect((await (await admin.get(`${API}/users?size=100`)).json()).data.content.some((u: { email: string }) => u.email === email)).toBe(false)
    // Over 72 bytes is blocked by the FE before sending.
    await sheet.getByLabel(/^Mật khẩu/).fill('ă'.repeat(40))
    await sheet.getByRole('button', { name: 'Tạo tài khoản' }).click()
    await expect(sheet.getByText('Mật khẩu quá dài')).toBeVisible()
    expect(sent).toHaveLength(0)
    const tooLong = await rejected(await admin.post(`${API}/users`, { data: { email: `e2e-pw73-${run.toLowerCase()}@freshvend.test`, password: 'a'.repeat(73), fullName: 'E2E-pw73' } }), 400)
    expect(Object.keys(tooLong.fieldErrors ?? {})).toEqual(['password'])
    w.check()
  })

  test('ADM-13 sửa hồ sơ tài khoản E2E (họ tên, xóa SĐT); họ tên trống bị chặn; BE từ chối đổi email', async ({ page }) => {
    await ensureUser()
    const w = watch(page)
    await loginAs(page, 'ADMIN')
    await page.goto('/admin/users')
    await page.getByRole('button', { name: `Sửa ${fx.userName}` }).click()
    const sheet = page.getByRole('dialog', { name: 'Sửa tài khoản' })
    const sent = countRequests(page, 'PUT', /\/api\/v1\/users\//)
    await sheet.getByLabel('Họ tên').fill('   ')
    await sheet.getByRole('button', { name: 'Lưu thay đổi' }).click()
    await expect(sheet.getByText('Vui lòng nhập họ tên.')).toBeVisible()
    expect(sent).toHaveLength(0)
    fx.userName = `${fx.userName} (sua)`
    await sheet.getByLabel('Họ tên').fill(fx.userName)
    await sheet.getByLabel('Điện thoại').fill('')
    const saved = page.waitForResponse(r => r.request().method() === 'PUT' && r.url().includes(`/users/${fx.userId}`))
    await sheet.getByRole('button', { name: 'Lưu thay đổi' }).click()
    const response = await saved
    expect(response.status()).toBe(200)
    expect(Object.keys(response.request().postDataJSON()).sort()).toEqual(['fullName', 'phone'])
    await expect(page.getByText('Đã lưu thay đổi')).toBeVisible()
    const user = (await response.json()).data
    expect(user.fullName).toBe(fx.userName)
    expect(user.phone).toBeNull()
    await rejected(await admin.put(`${API}/users/${fx.userId}`, { data: { fullName: 'E2E-x', email: 'e2e-doi@freshvend.test' } }), 400)
    const blank = await rejected(await admin.put(`${API}/users/${fx.userId}`, { data: { fullName: '' } }), 400)
    expect(Object.keys(blank.fieldErrors ?? {})).toContain('fullName')
    await rejected(await admin.put(`${API}/users/${NIL}`, { data: { fullName: 'E2E-x' } }), 404)
    w.check()
  })

  test('ADM-14 khóa rồi mở khóa tài khoản E2E: bị khóa thì không đăng nhập được; trạng thái lạ → 400', async ({ page }) => {
    await ensureUser()
    const w = watch(page)
    await loginAs(page, 'ADMIN')
    await page.goto('/admin/users')
    await page.getByRole('button', { name: `Khóa ${fx.userName}` }).click()
    const lock = page.getByRole('alertdialog', { name: `Khóa tài khoản ${fx.userName}?` })
    await lock.getByRole('button', { name: 'Khóa', exact: true }).click()
    await expect(page.getByText('Đã chuyển sang')).toBeVisible()
    expect((await anon.post(`${API}/auth/login`, { data: { email: fx.userEmail, password: fx.userPassword } })).status()).toBe(401)
    await page.getByRole('button', { name: `Mở khóa ${fx.userName}` }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Mở khóa' }).click()
    await expect(page.getByRole('button', { name: `Khóa ${fx.userName}` })).toBeVisible()
    expect((await anon.post(`${API}/auth/login`, { data: { email: fx.userEmail, password: fx.userPassword } })).status()).toBe(200)
    await rejected(await admin.patch(`${API}/users/${fx.userId}/status`, { data: { status: 'DELETED' } }), 400)
    await rejected(await staff.patch(`${API}/users/${fx.userId}/status`, { data: { status: 'LOCKED' } }), 403)
    w.check()
  })

  test('ADM-15 không khóa được Quản trị viên cuối cùng: nút Khóa bị vô hiệu kèm lý do, không mở hộp thoại', async ({ page }) => {
    // BE side (409 "The last active administrator cannot be disabled or locked") is NOT called live: the only ADMIN is
    // the shared account that must never be locked. Verified in UserService.updateStatus.
    const w = watch(page)
    await loginAs(page, 'ADMIN')
    await page.goto('/admin/users?role=ADMIN')
    const lockButtons = page.getByRole('button', { name: /^Khóa / })
    await expect(lockButtons.first()).toBeVisible()
    const adminButton = lockButtons.first()
    await expect(adminButton).toHaveAttribute('aria-disabled', 'true')
    await expect(page.getByText('Đây là Quản trị viên đang hoạt động cuối cùng.')).toBeVisible()
    await adminButton.click({ force: true })
    await expect(page.getByRole('alertdialog')).toHaveCount(0)
    w.check()
  })
})

// ------------------------------------------------------------------ Sản phẩm

test.describe('Sản phẩm', () => {
  async function openCreate(page: Page) {
    await page.goto('/admin/products')
    await page.getByRole('button', { name: 'Thêm sản phẩm' }).click()
    return page.getByRole('dialog', { name: 'Thêm sản phẩm' })
  }

  test('ADM-16 tạo sản phẩm hợp lệ (giá 35.000): FE hiện 35.000 ₫, BE lưu 35000 ACTIVE, chỉ gửi field contract', async ({ page }) => {
    const w = watch(page)
    await loginAs(page, 'ADMIN')
    const sheet = await openCreate(page)
    await sheet.getByLabel('SKU').fill(fx.sku.toLowerCase())
    await sheet.getByLabel('Tên sản phẩm').fill(fx.productName)
    await sheet.getByLabel('Giá bán (VND)').fill('35.000')
    const created = page.waitForResponse(r => r.request().method() === 'POST' && r.url().endsWith('/api/v1/products'))
    await sheet.getByRole('button', { name: 'Thêm sản phẩm' }).click()
    const response = await created
    expect(response.status()).toBe(201)
    const sentBody = response.request().postDataJSON()
    expect(Object.keys(sentBody).every(key => ['sku', 'name', 'price', 'description', 'imageUrl'].includes(key))).toBe(true)
    expect(sentBody.price).toBe(35000)
    const product = (await response.json()).data
    fx.productId = product.id
    expect(product.sku).toBe(fx.sku)
    expect(product.status).toBe('ACTIVE')
    await page.goto(`/admin/products?search=${encodeURIComponent(fx.sku)}`)
    const row = page.getByRole('row').filter({ hasText: fx.productName })
    await expect(row).toContainText('35.000 ₫')
    w.check()
  })

  test('ADM-17 SKU trùng (chữ thường): FE đánh dấu ô SKU, BE 409', async ({ page }) => {
    await ensureProduct()
    const w = watch(page)
    await loginAs(page, 'ADMIN')
    const sheet = await openCreate(page)
    await sheet.getByLabel('SKU').fill(fx.sku.toLowerCase())
    await sheet.getByLabel('Tên sản phẩm').fill('E2E-Trung SKU')
    await sheet.getByLabel('Giá bán (VND)').fill('10000')
    await sheet.getByRole('button', { name: 'Thêm sản phẩm' }).click()
    await expect(sheet.getByText('SKU này đã được dùng')).toBeVisible()
    await expect(sheet.getByLabel('SKU')).toHaveAttribute('aria-invalid', 'true')
    await rejected(await admin.post(`${API}/products`, { data: { sku: fx.sku.toLowerCase(), name: 'E2E-dup', price: 10000 } }), 409)
    w.check()
  })

  test('ADM-18 giá âm / 0 / chữ / 3 chữ số thập phân: FE chặn từng trường hợp, BE 400', async ({ page }) => {
    const w = watch(page)
    await loginAs(page, 'ADMIN')
    const sheet = await openCreate(page)
    const sent = countRequests(page, 'POST', /\/api\/v1\/products$/)
    await sheet.getByLabel('SKU').fill(`E2E-GIA-${run}`)
    await sheet.getByLabel('Tên sản phẩm').fill('E2E-Gia sai')
    const price = sheet.getByLabel('Giá bán (VND)')
    for (const [input, text] of [['-1000', 'Giá phải lớn hơn 0 ₫.'], ['0', 'Giá phải lớn hơn 0 ₫.'], ['abc', 'Giá chưa đúng định dạng'], ['1000,123', 'tối đa 2 chữ số thập phân']] as const) {
      await price.fill(input)
      await sheet.getByRole('button', { name: 'Thêm sản phẩm' }).click()
      await expect(sheet.getByText(text), input).toBeVisible()
      await expect(price).toHaveAttribute('aria-invalid', 'true')
    }
    expect(sent).toHaveLength(0)
    for (const value of [-1, 0]) {
      const body = await rejected(await admin.post(`${API}/products`, { data: { sku: `E2E-GIA-${run}`, name: 'E2E', price: value } }), 400)
      expect(Object.keys(body.fieldErrors ?? {})).toEqual(['price'])
    }
    await rejected(await admin.post(`${API}/products`, { data: { sku: `E2E-GIA-${run}`, name: 'E2E', price: 'abc' } }), 400)
    const decimals = await rejected(await admin.post(`${API}/products`, { data: { sku: `E2E-GIA-${run}`, name: 'E2E', price: 1.234 } }), 400)
    expect(Object.keys(decimals.fieldErrors ?? {})).toEqual(['price'])
    await rejected(await admin.post(`${API}/products`, { data: { sku: `E2E-GIA-${run}`, name: 'E2E', price: 1000, status: 'INACTIVE' } }), 400)
    w.check()
  })

  test('ADM-19 tên trống / quá 200 ký tự: FE chặn (maxLength), BE 400 fieldErrors.name', async ({ page }) => {
    const w = watch(page)
    await loginAs(page, 'ADMIN')
    const sheet = await openCreate(page)
    const sent = countRequests(page, 'POST', /\/api\/v1\/products$/)
    await sheet.getByLabel('SKU').fill(`E2E-TEN-${run}`)
    await sheet.getByLabel('Giá bán (VND)').fill('10000')
    await sheet.getByLabel('Tên sản phẩm').fill('   ')
    await sheet.getByRole('button', { name: 'Thêm sản phẩm' }).click()
    await expect(sheet.getByText('Vui lòng nhập tên sản phẩm.')).toBeVisible()
    expect(sent).toHaveLength(0)
    await sheet.getByLabel('Tên sản phẩm').fill('E'.repeat(201))
    await expect(sheet.getByLabel('Tên sản phẩm')).toHaveValue('E'.repeat(200))
    const blank = await rejected(await admin.post(`${API}/products`, { data: { sku: `E2E-TEN-${run}`, name: '', price: 1000 } }), 400)
    expect(Object.keys(blank.fieldErrors ?? {})).toEqual(['name'])
    const long = await rejected(await admin.post(`${API}/products`, { data: { sku: `E2E-TEN-${run}`, name: 'E'.repeat(201), price: 1000 } }), 400)
    expect(Object.keys(long.fieldErrors ?? {})).toEqual(['name'])
    w.check()
  })

  test('ADM-20 đổi trạng thái sản phẩm E2E: Ngừng bán → Mở bán lại; trạng thái lạ → 400', async ({ page }) => {
    await ensureProduct()
    const w = watch(page)
    await loginAs(page, 'ADMIN')
    await page.goto(`/admin/products?search=${encodeURIComponent(fx.sku)}`)
    await page.getByRole('button', { name: `Ngừng bán ${fx.productName}` }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Ngừng bán' }).click()
    await expect(page.getByRole('button', { name: `Mở bán lại ${fx.productName}` })).toBeVisible()
    expect((await dataOf(await admin.get(`${API}/products/${fx.productId}`))).status).toBe('INACTIVE')
    await page.getByRole('button', { name: `Mở bán lại ${fx.productName}` }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Mở bán lại' }).click()
    await expect(page.getByRole('button', { name: `Ngừng bán ${fx.productName}` })).toBeVisible()
    expect((await dataOf(await admin.get(`${API}/products/${fx.productId}`))).status).toBe('ACTIVE')
    await rejected(await admin.patch(`${API}/products/${fx.productId}/status`, { data: { status: 'DELETED' } }), 400)
    await rejected(await staff.patch(`${API}/products/${fx.productId}/status`, { data: { status: 'INACTIVE' } }), 403)
    w.check()
  })
})

// ------------------------------------------------------------------ Máy, ngăn, khóa kiosk

test.describe('Máy bán hàng', () => {
  test('ADM-21 đăng ký máy mới E2E qua FE: trạng thái Ngừng hoạt động, ngưỡng đúng', async ({ page }) => {
    const w = watch(page)
    await loginAs(page, 'ADMIN')
    await page.goto('/admin/machines')
    await page.getByRole('button', { name: 'Đăng ký máy' }).click()
    const sheet = page.getByRole('dialog', { name: 'Đăng ký máy' })
    await sheet.getByLabel('Mã máy').fill(fx.machineCode.toLowerCase())
    await sheet.getByLabel('Tên máy').fill(fx.machineName)
    await sheet.getByLabel('Vị trí đặt máy').fill('E2E lab, tầng trệt')
    await sheet.getByLabel('Nhiệt độ tối thiểu (°C)').fill('2,5')
    const created = page.waitForResponse(r => r.request().method() === 'POST' && r.url().endsWith('/api/v1/machines'))
    await sheet.getByRole('button', { name: 'Đăng ký máy' }).click()
    const response = await created
    expect(response.status()).toBe(201)
    const machine = (await response.json()).data
    fx.machineId = machine.id
    expect(machine.code).toBe(fx.machineCode)
    expect(machine.status).toBe('INACTIVE')
    expect(machine.minTemperature).toBe(2.5)
    await expect(page.getByText('Đã đăng ký máy')).toBeVisible()
    w.check()
  })

  test('ADM-22 mã máy trùng: FE đánh dấu ô Mã máy, BE 409', async ({ page }) => {
    await ensureMachine()
    const w = watch(page)
    await loginAs(page, 'ADMIN')
    await page.goto('/admin/machines')
    await page.getByRole('button', { name: 'Đăng ký máy' }).click()
    const sheet = page.getByRole('dialog', { name: 'Đăng ký máy' })
    await sheet.getByLabel('Mã máy').fill(fx.machineCode)
    await sheet.getByLabel('Tên máy').fill('E2E-Trung ma')
    await sheet.getByLabel('Vị trí đặt máy').fill('E2E lab')
    await sheet.getByRole('button', { name: 'Đăng ký máy' }).click()
    await expect(sheet.getByText('Mã máy này đã được dùng')).toBeVisible()
    await expect(sheet.getByLabel('Mã máy')).toHaveAttribute('aria-invalid', 'true')
    const body = await rejected(await admin.post(`${API}/machines`, { data: { code: fx.machineCode.toLowerCase(), name: 'E2E', location: 'x', minTemperature: 2, maxTemperature: 8, minHumidity: 40, maxHumidity: 80 } }), 409)
    expect(body.message).toBe('Machine code is already in use')
    w.check()
  })

  test('ADM-23 ngưỡng min ≥ max (nhiệt độ, độ ẩm) và ngoài khoảng: FE chặn, BE 400', async ({ page }) => {
    const w = watch(page)
    await loginAs(page, 'ADMIN')
    await page.goto('/admin/machines')
    const sent = countRequests(page, 'POST', /\/api\/v1\/machines$/)
    await page.getByRole('button', { name: 'Đăng ký máy' }).click()
    const sheet = page.getByRole('dialog', { name: 'Đăng ký máy' })
    await sheet.getByLabel('Mã máy').fill(`E2E-NG-${run}`)
    await sheet.getByLabel('Tên máy').fill('E2E-Nguong')
    await sheet.getByLabel('Vị trí đặt máy').fill('E2E lab')
    await sheet.getByLabel('Nhiệt độ tối thiểu (°C)').fill('10')
    await sheet.getByLabel('Nhiệt độ tối đa (°C)').fill('2')
    await sheet.getByLabel('Độ ẩm tối thiểu (%)').fill('80')
    await sheet.getByLabel('Độ ẩm tối đa (%)').fill('80')
    await sheet.getByRole('button', { name: 'Đăng ký máy' }).click()
    await expect(sheet.getByText('Phải nhỏ hơn nhiệt độ tối đa.')).toBeVisible()
    await expect(sheet.getByText('Phải nhỏ hơn độ ẩm tối đa.')).toBeVisible()
    await expect(sheet.getByLabel('Nhiệt độ tối thiểu (°C)')).toHaveAttribute('aria-invalid', 'true')
    expect(sent).toHaveLength(0)
    const base = { code: `E2E-NG-${run}`, name: 'E2E', location: 'x', minTemperature: 2, maxTemperature: 8, minHumidity: 40, maxHumidity: 80 }
    const order = await rejected(await admin.post(`${API}/machines`, { data: { ...base, minTemperature: 10, maxTemperature: 2 } }), 400)
    expect(order.message).toMatch(/strictly below/)
    await rejected(await admin.post(`${API}/machines`, { data: { ...base, minHumidity: 80, maxHumidity: 80 } }), 400)
    const range = await rejected(await admin.post(`${API}/machines`, { data: { ...base, minTemperature: -101, maxHumidity: 101 } }), 400)
    expect(Object.keys(range.fieldErrors ?? {}).sort()).toEqual(['maxHumidity', 'minTemperature'])
    w.check()
  })

  test('ADM-24 đổi trạng thái máy E2E sang Bảo trì rồi Ngừng hoạt động; trạng thái lạ → 400', async ({ page }) => {
    const machineId = await ensureMachine()
    const w = watch(page)
    await loginAs(page, 'ADMIN')
    await page.goto(`/admin/machines/${machineId}`)
    await page.getByRole('button', { name: 'Chuyển sang Bảo trì' }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Chuyển sang Bảo trì' }).click()
    await expect.poll(async () => (await dataOf(await admin.get(`${API}/machines/${machineId}`))).status).toBe('MAINTENANCE')
    await expect(page.getByRole('group', { name: 'Trạng thái máy' })).toContainText('Bảo trì')
    await page.getByRole('button', { name: 'Ngừng hoạt động' }).first().click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Ngừng hoạt động' }).click()
    await expect.poll(async () => (await dataOf(await admin.get(`${API}/machines/${machineId}`))).status).toBe('INACTIVE')
    await rejected(await admin.patch(`${API}/machines/${machineId}/status`, { data: { status: 'BROKEN' } }), 400)
    await rejected(await staff.patch(`${API}/machines/${machineId}/status`, { data: { status: 'MAINTENANCE' } }), 403)
    w.check()
  })
})

test.describe('Ngăn', () => {
  async function openSlotSheet(page: Page, machineId: string) {
    await page.goto(`/admin/machines/${machineId}?tab=slots`)
    await page.getByRole('button', { name: 'Thêm ngăn' }).click()
    return page.getByRole('dialog', { name: 'Thêm ngăn' })
  }

  test('ADM-25 thêm ngăn A (gõ chữ thường) sức chứa 6: BE lưu A, ACTIVE', async ({ page }) => {
    const machineId = await ensureMachine()
    const w = watch(page)
    await loginAs(page, 'ADMIN')
    const sheet = await openSlotSheet(page, machineId)
    await sheet.getByLabel('Mã ngăn').fill('a')
    await sheet.getByLabel('Sức chứa (số hộp)').fill('6')
    const created = page.waitForResponse(r => r.request().method() === 'POST' && /\/slots$/.test(r.url()))
    await sheet.getByRole('button', { name: 'Thêm ngăn' }).click()
    const response = await created
    expect(response.status()).toBe(201)
    expect(response.request().postDataJSON()).toEqual({ slotCode: 'A', capacity: 6 })
    await expect(page.getByText('Đã thêm ngăn')).toBeVisible()
    const slots = (await dataOf(await admin.get(`${API}/machines/${machineId}/slots`))).content
    expect(slots.map((slot: { slotCode: string }) => slot.slotCode)).toContain('A')
    w.check()
  })

  test('ADM-26 mã ngăn khác A/B (C, 1, A1): FE chặn, BE 400 fieldErrors.slotCode', async ({ page }) => {
    const machineId = await ensureMachine()
    const w = watch(page)
    await loginAs(page, 'ADMIN')
    const sheet = await openSlotSheet(page, machineId)
    const sent = countRequests(page, 'POST', /\/slots$/)
    await sheet.getByLabel('Sức chứa (số hộp)').fill('6')
    for (const code of ['C', '1']) {
      await sheet.getByLabel('Mã ngăn').fill(code)
      await sheet.getByRole('button', { name: 'Thêm ngăn' }).click()
      await expect(sheet.getByText('Mã ngăn chỉ là A hoặc B'), code).toBeVisible()
      await expect(sheet.getByLabel('Mã ngăn')).toHaveAttribute('aria-invalid', 'true')
    }
    expect(sent).toHaveLength(0)
    // The field holds one character (maxLength 1): "A1" cannot be typed.
    await sheet.getByLabel('Mã ngăn').fill('A1')
    await expect(sheet.getByLabel('Mã ngăn')).toHaveValue('A')
    for (const code of ['C', 'A1', '']) {
      const body = await rejected(await admin.post(`${API}/machines/${machineId}/slots`, { data: { slotCode: code, capacity: 6 } }), 400)
      expect(Object.keys(body.fieldErrors ?? {}), code).toEqual(['slotCode'])
    }
    w.check()
  })

  test('ADM-27 trùng mã ngăn A: FE đánh dấu ô Mã ngăn, BE 409', async ({ page }) => {
    const machineId = await ensureMachine()
    const existing = (await dataOf(await admin.get(`${API}/machines/${machineId}/slots`))).content
    if (!existing.some((slot: { slotCode: string }) => slot.slotCode === 'A')) await dataOf(await admin.post(`${API}/machines/${machineId}/slots`, { data: { slotCode: 'A', capacity: 6 } }), 201)
    const w = watch(page)
    await loginAs(page, 'ADMIN')
    const sheet = await openSlotSheet(page, machineId)
    await sheet.getByLabel('Mã ngăn').fill('A')
    await sheet.getByLabel('Sức chứa (số hộp)').fill('6')
    await sheet.getByRole('button', { name: 'Thêm ngăn' }).click()
    await expect(sheet.getByText('Máy này đã có ngăn mang mã này')).toBeVisible()
    await expect(sheet.getByLabel('Mã ngăn')).toHaveAttribute('aria-invalid', 'true')
    const body = await rejected(await admin.post(`${API}/machines/${machineId}/slots`, { data: { slotCode: 'a', capacity: 6 } }), 409)
    expect(body.message).toBe('Slot code is already in use for this machine')
    w.check()
  })

  test('ADM-28 sức chứa 0 / âm / thập phân / chữ: FE chặn, BE 400', async ({ page }) => {
    const machineId = await ensureMachine()
    const w = watch(page)
    await loginAs(page, 'ADMIN')
    const sheet = await openSlotSheet(page, machineId)
    const sent = countRequests(page, 'POST', /\/slots$/)
    await sheet.getByLabel('Mã ngăn').fill('B')
    for (const [input, text] of [['0', 'Sức chứa phải lớn hơn 0.'], ['-3', 'Sức chứa là số nguyên'], ['1.5', 'Sức chứa là số nguyên'], ['sau', 'Sức chứa là số nguyên']] as const) {
      await sheet.getByLabel('Sức chứa (số hộp)').fill(input)
      await sheet.getByRole('button', { name: 'Thêm ngăn' }).click()
      await expect(sheet.getByText(text), input).toBeVisible()
    }
    expect(sent).toHaveLength(0)
    for (const capacity of [0, -3]) {
      const body = await rejected(await admin.post(`${API}/machines/${machineId}/slots`, { data: { slotCode: 'B', capacity } }), 400)
      expect(Object.keys(body.fieldErrors ?? {})).toEqual(['capacity'])
    }
    await rejected(await admin.post(`${API}/machines/${machineId}/slots`, { data: { slotCode: 'B', capacity: 1.5 } }), 400)
    await rejected(await admin.post(`${API}/machines/${machineId}/slots`, { data: { slotCode: 'B', capacity: 6, status: 'ERROR' } }), 400)
    await rejected(await staff.post(`${API}/machines/${machineId}/slots`, { data: { slotCode: 'B', capacity: 6 } }), 403)
    w.check()
  })
})

test.describe('Khóa kiosk', () => {
  test('ADM-29 cấp khóa kiosk: hiện đúng 1 lần, danh sách chỉ có tiền tố, khóa dùng được với /kiosk/me', async ({ page, context }) => {
    const machineId = await ensureMachine()
    const w = watch(page)
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await loginAs(page, 'ADMIN')
    await page.goto(`/admin/machines/${machineId}?tab=kiosk`)
    await page.getByRole('button', { name: /^Cấp khóa/ }).click()
    const dialog = page.getByRole('alertdialog')
    await dialog.getByRole('button', { name: /^Cấp khóa/ }).click()
    const field = dialog.getByLabel('Khóa kiosk')
    await expect(field).not.toHaveValue('')
    const key = await field.inputValue()
    expect(key.length).toBeGreaterThan(20)
    await dialog.getByRole('button', { name: 'Tôi đã lưu khóa, đóng' }).click()
    await expect(page.getByRole('alertdialog')).toHaveCount(0)
    await expect(page.locator('body')).not.toContainText(key)
    await page.reload()
    await expect(page.getByRole('table', { name: 'Lịch sử khóa kiosk' })).toBeVisible()
    await expect(page.locator('body')).not.toContainText(key)
    const list = await dataOf(await admin.get(`${API}/machines/${machineId}/kiosk-credentials`))
    expect(JSON.stringify(list)).not.toContain(key)
    const kiosk = await (await apiAs('PUBLIC')).get(`${API}/kiosk/me`, { headers: { 'X-Kiosk-Key': key } })
    expect((await dataOf(kiosk)).machineId).toBe(machineId)
    process.env.E2E_ADM_KIOSK_KEY = key
    w.check()
  })

  test('ADM-30 thu hồi khóa kiosk: FE xác nhận, khóa cũ bị từ chối 401, không bật lại được', async ({ page }) => {
    const machineId = await ensureMachine()
    let key = process.env.E2E_ADM_KIOSK_KEY
    if (!key) key = (await dataOf(await admin.post(`${API}/machines/${machineId}/kiosk-credentials`), 201)).apiKey as string
    expect(key, 'issued key').toBeTruthy()
    const w = watch(page)
    await loginAs(page, 'ADMIN')
    await page.goto(`/admin/machines/${machineId}?tab=kiosk`)
    await page.getByRole('button', { name: /^Thu hồi khóa/ }).first().click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Thu hồi khóa' }).click()
    await expect(page.getByText('Không còn hiệu lực').first()).toBeVisible()
    const kiosk = await (await apiAs('PUBLIC')).get(`${API}/kiosk/me`, { headers: { 'X-Kiosk-Key': key! } })
    await rejected(kiosk, 401)
    const revoked = (await dataOf(await admin.get(`${API}/machines/${machineId}/kiosk-credentials`))).find((c: { status: string }) => c.status !== 'ACTIVE')
    expect(revoked?.credentialId).toBeTruthy()
    // Contract: revoking an already REVOKED credential is idempotent (200, unchanged); it never comes back.
    const again = await dataOf(await admin.post(`${API}/machines/${machineId}/kiosk-credentials/${revoked.credentialId}/revoke`))
    expect(again.status).toBe('REVOKED')
    await rejected(await (await apiAs('PUBLIC')).get(`${API}/kiosk/me`, { headers: { 'X-Kiosk-Key': key! } }), 401)
    await rejected(await staff.post(`${API}/machines/${machineId}/kiosk-credentials/${revoked.credentialId}/revoke`), 403)
    await rejected(await admin.post(`${API}/machines/${machineId}/kiosk-credentials/${NIL}/revoke`), 404)
    w.check()
  })
})

// ------------------------------------------------------------------ Vai trò & quyền

test.describe('Vai trò & quyền', () => {
  test('ADM-31 xem ma trận quyền; ô PERMISSION_MANAGE/USER_WRITE của ADMIN bị khóa, bấm không đổi', async ({ page }) => {
    const w = watch(page)
    await loginAs(page, 'ADMIN')
    await page.goto('/admin/roles')
    await expect(page.getByRole('heading', { name: 'Vai trò & quyền' })).toBeVisible()
    const locked = page.locator('input[type="checkbox"][aria-disabled="true"]')
    await expect(locked).toHaveCount(2)
    for (const box of await locked.all()) {
      await expect(box).toBeChecked()
      await box.click({ force: true })
      await expect(box).toBeChecked()
    }
    await expect(page.getByRole('button', { name: 'Lưu thay đổi' })).toBeDisabled()
    const roles = await dataOf(await admin.get(`${API}/roles`))
    const adminRole = roles.find((role: { name: string }) => role.name === 'ADMIN')
    expect(adminRole.permissions).toEqual(expect.arrayContaining(['PERMISSION_MANAGE', 'USER_WRITE']))
    const permissions = await dataOf(await admin.get(`${API}/permissions`))
    expect(permissions.length).toBeGreaterThan(10)
    w.check()
  })

  test('ADM-32 BE: bỏ USER_WRITE khỏi ADMIN → 409; mã quyền lạ/trùng → 400 fieldErrors.permissions', async () => {
    const roles = await dataOf(await admin.get(`${API}/roles`))
    const original: string[] = roles.find((role: { name: string }) => role.name === 'ADMIN').permissions
    // Unknown / duplicate codes are checked before anything is written (RolePermissionService).
    const unknown = await rejected(await admin.put(`${API}/roles/${ADMIN_ROLE_ID}/permissions`, { data: { permissions: [...original, 'E2E_FAKE_PERMISSION'] } }), 400)
    expect(Object.keys(unknown.fieldErrors ?? {})).toEqual(['permissions'])
    const duplicate = await rejected(await admin.put(`${API}/roles/${ADMIN_ROLE_ID}/permissions`, { data: { permissions: [...original, original[0]] } }), 400)
    expect(Object.keys(duplicate.fieldErrors ?? {})).toEqual(['permissions'])
    await rejected(await admin.put(`${API}/roles/${ADMIN_ROLE_ID}/permissions`, { data: { permissions: original, extra: true } }), 400)
    await rejected(await admin.put(`${API}/roles/${NIL}/permissions`, { data: { permissions: [] } }), 404)
    // PERMISSION_MANAGE stays in the set, so even a wrongly accepted write can be undone at once.
    const withoutUserWrite = original.filter(code => code !== 'USER_WRITE')
    const answer = await admin.put(`${API}/roles/${ADMIN_ROLE_ID}/permissions`, { data: { permissions: withoutUserWrite } })
    try {
      const conflict = await rejected(answer, 409)
      expect(conflict.message).toMatch(/PERMISSION_MANAGE and USER_WRITE/)
    } finally {
      if (answer.ok()) await admin.put(`${API}/roles/${ADMIN_ROLE_ID}/permissions`, { data: { permissions: original } })
      const after = (await dataOf(await admin.get(`${API}/roles`))).find((role: { name: string }) => role.name === 'ADMIN').permissions
      expect([...after].sort()).toEqual([...original].sort())
    }
  })
})

// ------------------------------------------------------------------ Lịch bảo trì

test.describe('Lịch bảo trì', () => {
  async function maintenanceMachine() {
    const machineId = await ensureMachine()
    const machine = await dataOf(await admin.get(`${API}/machines/${machineId}`))
    if (machine.status === 'INACTIVE') await dataOf(await admin.patch(`${API}/machines/${machineId}/status`, { data: { status: 'MAINTENANCE' } }))
    return machineId
  }
  async function openCreate(page: Page) {
    await page.goto('/admin/maintenance-schedules')
    await page.getByRole('button', { name: 'Tạo lịch' }).click()
    const sheet = page.getByRole('dialog', { name: 'Tạo lịch bảo trì' })
    await expect(sheet.getByLabel('Máy').locator('option', { hasText: fx.machineCode })).toHaveCount(1)
    await sheet.getByLabel('Máy').selectOption({ label: `${fx.machineName} (${fx.machineCode})` })
    return sheet
  }

  test('ADM-33 tạo lịch bảo trì hợp lệ (chu kỳ 30, trước 1 ngày, hạn 20/12/2026) trên máy E2E', async ({ page }) => {
    const machineId = await maintenanceMachine()
    const w = watch(page)
    await loginAs(page, 'ADMIN')
    const sheet = await openCreate(page)
    await sheet.getByLabel('Tên công việc').fill(fx.planTitle)
    await sheet.getByLabel('Chu kỳ (số ngày)').fill('30')
    await sheet.getByLabel('Tạo phiếu trước (ngày)').fill('1')
    await sheet.getByLabel('Đến hạn lần đầu (không bắt buộc)').fill('2026-12-20')
    const created = page.waitForResponse(r => r.request().method() === 'POST' && r.url().endsWith('/api/v1/maintenance-plans'))
    await sheet.getByRole('button', { name: 'Tạo lịch' }).click()
    const response = await created
    expect(response.status()).toBe(201)
    const plan = (await response.json()).data
    expect(plan.machineId).toBe(machineId)
    expect(plan.nextDueDate).toBe('2026-12-20')
    await expect(page.getByText('Đã tạo lịch bảo trì')).toBeVisible()
    await expect(page.getByRole('cell', { name: fx.planTitle }).first()).toBeVisible()
    await expect(page.getByRole('row').filter({ hasText: fx.planTitle })).toContainText('20/12/2026')
    w.check()
  })

  test('ADM-34 chu kỳ 0 và 366: FE chặn; BE 400 với fieldErrors đúng tên trường intervalDays', async ({ page }) => {
    const machineId = await maintenanceMachine()
    const w = watch(page)
    await loginAs(page, 'ADMIN')
    const sheet = await openCreate(page)
    const sent = countRequests(page, 'POST', /\/maintenance-plans$/)
    await sheet.getByLabel('Tên công việc').fill('E2E-Chu ky sai')
    for (const value of ['0', '366']) {
      await sheet.getByLabel('Chu kỳ (số ngày)').fill(value)
      await sheet.getByRole('button', { name: 'Tạo lịch' }).click()
      await expect(sheet.getByText('Nhập số ngày nguyên từ 1 đến 365.'), value).toBeVisible()
      await expect(sheet.getByLabel('Chu kỳ (số ngày)')).toHaveAttribute('aria-invalid', 'true')
    }
    expect(sent).toHaveLength(0)
    for (const intervalDays of [0, 366]) {
      const body = await rejected(await admin.post(`${API}/maintenance-plans`, { data: { machineId, title: 'E2E-x', intervalDays } }), 400)
      expect(Object.keys(body.fieldErrors ?? {}), `intervalDays=${intervalDays}`).toEqual(['intervalDays'])
    }
    w.check()
  })

  test('ADM-35 tạo phiếu trước ≥ chu kỳ: FE chặn, BE 400', async ({ page }) => {
    const machineId = await maintenanceMachine()
    const w = watch(page)
    await loginAs(page, 'ADMIN')
    const sheet = await openCreate(page)
    const sent = countRequests(page, 'POST', /\/maintenance-plans$/)
    await sheet.getByLabel('Tên công việc').fill('E2E-Lead sai')
    await sheet.getByLabel('Chu kỳ (số ngày)').fill('7')
    await sheet.getByLabel('Tạo phiếu trước (ngày)').fill('7')
    await sheet.getByRole('button', { name: 'Tạo lịch' }).click()
    await expect(sheet.getByText('Số ngày tạo phiếu trước phải nhỏ hơn chu kỳ.')).toBeVisible()
    expect(sent).toHaveLength(0)
    const body = await rejected(await admin.post(`${API}/maintenance-plans`, { data: { machineId, title: 'E2E-x', intervalDays: 7, leadDays: 7 } }), 400)
    expect(body.message).toMatch(/leadDays/)
    w.check()
  })

  test('ADM-36 ngày đến hạn đầu ở quá khứ: FE chặn, BE 400', async ({ page }) => {
    const machineId = await maintenanceMachine()
    const w = watch(page)
    await loginAs(page, 'ADMIN')
    const sheet = await openCreate(page)
    const sent = countRequests(page, 'POST', /\/maintenance-plans$/)
    await sheet.getByLabel('Tên công việc').fill('E2E-Qua khu')
    await sheet.getByLabel('Chu kỳ (số ngày)').fill('7')
    await sheet.getByLabel('Đến hạn lần đầu (không bắt buộc)').fill('2026-01-01')
    await sheet.getByRole('button', { name: 'Tạo lịch' }).click()
    await expect(sheet.getByText('Chọn từ hôm nay trở đi.')).toBeVisible()
    expect(sent).toHaveLength(0)
    const body = await rejected(await admin.post(`${API}/maintenance-plans`, { data: { machineId, title: 'E2E-x', intervalDays: 7, firstDueDate: '2026-01-01' } }), 400)
    expect(body.message).toMatch(/firstDueDate/)
    await rejected(await admin.post(`${API}/maintenance-plans`, { data: { machineId: NIL, title: 'E2E-x', intervalDays: 7 } }), 404)
    await rejected(await admin.post(`${API}/maintenance-plans`, { data: { machineId, title: 'E2E-x', intervalDays: 7, unknown: 1 } }), 400)
    w.check()
  })

  test('ADM-37 sửa lịch với version cũ: BE 409 STALE_VERSION, FE báo lịch vừa bị sửa và tải lại', async ({ page }) => {
    const machineId = await maintenanceMachine()
    const plan = await dataOf(await admin.post(`${API}/maintenance-plans`, { data: { machineId, title: `E2E-Stale ${run}`, intervalDays: 14, firstDueDate: '2026-12-24' } }), 201)
    const w = watch(page)
    await loginAs(page, 'ADMIN')
    await page.goto(`/admin/maintenance-schedules?machineId=${machineId}`)
    await page.getByRole('button', { name: `Sửa lịch: E2E-Stale ${run}` }).click()
    const sheet = page.getByRole('dialog', { name: 'Sửa lịch bảo trì' })
    await expect(sheet).toBeVisible()
    // Someone else saves first.
    await dataOf(await admin.patch(`${API}/maintenance-plans/${plan.id}`, { data: { version: plan.version, title: `E2E-Stale ${run} (khac)` } }))
    await sheet.getByLabel('Tên công việc').fill(`E2E-Stale ${run} (toi)`)
    const answer = page.waitForResponse(r => r.request().method() === 'PATCH' && r.url().includes(plan.id))
    await sheet.getByRole('button', { name: 'Lưu thay đổi' }).click()
    expect((await answer).status()).toBe(409)
    await expect(page.getByText('Lịch này vừa được người khác sửa').first()).toBeVisible()
    await expect(page.getByRole('cell', { name: `E2E-Stale ${run} (khac)` }).first()).toBeVisible()
    const stale = await rejected(await admin.patch(`${API}/maintenance-plans/${plan.id}`, { data: { version: plan.version, title: 'E2E-x' } }), 409)
    expect(stale.message).toMatch(/^STALE_VERSION:/)
    const missing = await rejected(await admin.patch(`${API}/maintenance-plans/${plan.id}`, { data: { title: 'E2E-x' } }), 400)
    expect(Object.keys(missing.fieldErrors ?? {}), 'fieldErrors key is the field name').toEqual(['version'])
    w.check()
  })
})

// ------------------------------------------------------------------ Báo cáo bán hàng

test.describe('Báo cáo bán hàng', () => {
  test('ADM-38 khoảng ngày ngược: FE báo lỗi cạnh ô, không gọi báo cáo, nút xuất bị chặn; BE 400', async ({ page }) => {
    const w = watch(page)
    await loginAs(page, 'ADMIN')
    const sent = countRequests(page, 'GET', /\/reports\/sales\//)
    await page.goto('/admin/reports/revenue?from=2026-11-17&to=2026-11-01')
    await expect(page.getByText('Ngày kết thúc phải bằng hoặc sau ngày bắt đầu.').first()).toBeVisible()
    await expect(page.getByLabel('Đến ngày')).toHaveAttribute('aria-invalid', 'true')
    await expect(page.getByRole('button', { name: 'Xuất CSV' })).toBeDisabled()
    expect(sent).toHaveLength(0)
    const body = await rejected(await admin.get(`${API}/reports/sales/summary?from=2026-11-17&to=2026-11-01`), 400)
    expect(body.message).toBe('to must not be before from')
    await rejected(await admin.get(`${API}/reports/sales/export?format=CSV&from=2026-11-17&to=2026-11-01`), 400)
    w.check()
  })

  test('ADM-39 khoảng ngày > 366 ngày: FE chặn; BE 400; ngày sai định dạng / format lạ 400', async ({ page }) => {
    const w = watch(page)
    await loginAs(page, 'ADMIN')
    const sent = countRequests(page, 'GET', /\/reports\/sales\//)
    await page.goto('/admin/reports/revenue?from=2025-01-01&to=2026-11-17')
    await expect(page.getByText('Mỗi lần xem tối đa 366 ngày').first()).toBeVisible()
    await expect(page.getByLabel('Từ ngày')).toHaveAttribute('aria-invalid', 'true')
    expect(sent).toHaveLength(0)
    const body = await rejected(await admin.get(`${API}/reports/sales/summary?from=2025-01-01&to=2026-11-17`), 400)
    expect(body.message).toMatch(/366 days/)
    // 366 days exactly is allowed.
    expect((await admin.get(`${API}/reports/sales/summary?from=2025-11-17&to=2026-11-17`)).status()).toBe(200)
    await rejected(await admin.get(`${API}/reports/sales/summary?from=abc&to=2026-11-17`), 400)
    await rejected(await admin.get(`${API}/reports/sales/export?format=XLSX&from=2026-11-01&to=2026-11-17`), 400)
    await rejected(await admin.get(`${API}/reports/sales/summary?from=2026-11-01&to=2026-11-17&machineId=${NIL}`), 400)
    w.check()
  })

  test('ADM-40 xuất CSV và PDF tải được file đúng định dạng; BE trả text/csv có BOM và %PDF', async ({ page }) => {
    const w = watch(page)
    await loginAs(page, 'ADMIN')
    await page.goto('/admin/reports/revenue?from=2026-11-01&to=2026-11-17')
    await expect(page.getByRole('button', { name: 'Xuất CSV' })).toBeEnabled()
    for (const format of ['CSV', 'PDF'] as const) {
      const download = page.waitForEvent('download')
      await page.getByRole('button', { name: `Xuất ${format}` }).click()
      const file = await download
      expect(file.suggestedFilename()).toMatch(new RegExp(`^freshvend-sales_2026-11-01_2026-11-17\\.${format.toLowerCase()}$`))
      const path = await file.path()
      expect(path).toBeTruthy()
      await expect(page.getByText(`Đã tải file ${format}`)).toBeVisible()
    }
    const csv = await admin.get(`${API}/reports/sales/export?format=CSV&from=2026-11-01&to=2026-11-17`)
    expect(csv.status()).toBe(200)
    expect(csv.headers()['content-type']).toMatch(/^text\/csv/)
    expect(csv.headers()['content-disposition']).toMatch(/attachment/)
    expect(csv.headers()['cache-control']).toMatch(/no-store/)
    const bytes = await csv.body()
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
    const pdf = await admin.get(`${API}/reports/sales/export?format=PDF&from=2026-11-01&to=2026-11-17`)
    expect(pdf.headers()['content-type']).toMatch(/^application\/pdf/)
    expect((await pdf.body()).subarray(0, 5).toString()).toBe('%PDF-')
    w.check()
  })
})

// ------------------------------------------------------------------ Hoàn tiền, phản ánh (chỉ xem)

test.describe('Hoàn tiền và phản ánh (chỉ xem)', () => {
  test('ADM-41 màn Hoàn tiền tải được (bảng hoặc trạng thái rỗng), không lỗi', async ({ page }) => {
    const w = watch(page)
    await loginAs(page, 'ADMIN')
    await page.goto('/admin/refunds')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await expect(page.getByText(/Không có khoản nào cần hoàn tiền|Chưa ghi nhận lần hoàn tiền nào|Hoàn tiền/).first()).toBeVisible()
    await expect(page.getByRole('alert').filter({ hasText: /sự cố|không hợp lệ|không có quyền/i })).toHaveCount(0)
    const refunds = await dataOf(await admin.get(`${API}/refunds?size=5`))
    test.info().annotations.push({ type: 'data', description: `refunds totalElements=${refunds.totalElements}` })
    await dataOf(await admin.get(`${API}/refunds/candidates?size=5`))
    await dataOf(await admin.get(`${API}/refunds/summary`))
    w.check()
  })

  test('ADM-42 màn Phản ánh của khách tải được (bảng hoặc trạng thái rỗng), id lạ → 404 chung', async ({ page }) => {
    const w = watch(page)
    await loginAs(page, 'ADMIN')
    await page.goto('/admin/customer-reports')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await expect(page.getByRole('alert').filter({ hasText: /sự cố|không hợp lệ|không có quyền/i })).toHaveCount(0)
    const reports = await dataOf(await admin.get(`${API}/customer-reports?size=5`))
    test.info().annotations.push({ type: 'data', description: `customer reports totalElements=${reports.totalElements}` })
    await rejected(await admin.get(`${API}/customer-reports/${NIL}`), 404)
    await page.goto(`/admin/customer-reports/${NIL}`)
    await w.notBlank()
    await expect(page.locator('#admin-main')).toContainText(/Không tìm thấy/)
    w.check()
  })
})
