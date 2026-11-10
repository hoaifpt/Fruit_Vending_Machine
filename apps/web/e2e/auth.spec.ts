// Sign-in and permission flows on the mock API: keyboard login for ADMIN and STAFF, wrong password, STAFF guard (nav and
// typed ADMIN URL), and a session that expires (401) then returns to the same page after signing in again.
import { expect, test } from '@playwright/test'
import { ACCOUNTS, loginAs, typeLogin } from './support.ts'

const ADMIN_ONLY = ['Tài khoản', 'Vai trò & quyền', 'Thanh toán', 'Webhook thanh toán']
const SHARED = ['Máy bán hàng', 'Sản phẩm', 'Lô hàng', 'Tồn kho', 'Đơn hàng']

test('ADMIN đăng nhập bằng bàn phím và thấy đủ menu', async ({ page }) => {
  await loginAs(page, 'ADMIN')
  await expect(page).toHaveURL(/\/admin\/machines$/)
  const nav = page.getByRole('navigation', { name: 'Quản trị' })
  for (const label of [...SHARED, ...ADMIN_ONLY]) await expect(nav.getByRole('link', { name: label, exact: true })).toBeVisible()
})

test('STAFF không thấy mục ADMIN, gõ URL ADMIN thì gặp 403 và vẫn đăng nhập', async ({ page }) => {
  await loginAs(page, 'STAFF')
  const nav = page.getByRole('navigation', { name: 'Quản trị' })
  for (const label of SHARED) await expect(nav.getByRole('link', { name: label, exact: true })).toBeVisible()
  for (const label of ADMIN_ONLY) await expect(nav.getByRole('link', { name: label, exact: true })).toHaveCount(0)

  for (const url of ['/admin/users', '/admin/payments', '/admin/webhook-logs']) {
    await page.goto(url)
    await expect(page.getByRole('heading', { level: 1, name: 'Không có quyền truy cập' })).toBeVisible()
    await expect(page.getByText('Mục này chỉ dành cho')).toBeVisible()
    await expect(page.getByRole('link', { name: 'Về trang đầu của bạn' })).toBeVisible()
    await expect(page).toHaveURL(url)
  }
  // The next step works with the keyboard.
  await page.getByRole('link', { name: 'Về trang đầu của bạn' }).focus()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/admin\/machines$/)
})

test('Sai mật khẩu hiện thông báo role=alert, ô mật khẩu aria-invalid đến khi sửa, ở lại trang đăng nhập', async ({ page }) => {
  await page.goto('/login')
  await typeLogin(page, ACCOUNTS.ADMIN.email, 'sai-mat-khau')
  const alert = page.getByRole('alert')
  await expect(alert).toBeVisible()
  await expect(alert).not.toHaveText('')
  await expect(page).toHaveURL(/\/login$/)
  const password = page.locator('#login-password')
  await expect(password).toBeFocused()
  await expect(password).toHaveAttribute('aria-invalid', 'true')
  await expect(password).toHaveAttribute('aria-describedby', /login-form-error/)
  await page.keyboard.type('x')
  await expect(password).not.toHaveAttribute('aria-invalid', 'true')
})

test('Trang đăng nhập: chữ tiếng Việt và thứ tự Tab theo thứ tự trên màn hình', async ({ page }) => {
  await page.goto('/login')
  await expect(page.getByText('Dành cho quản trị viên và nhân viên')).toBeVisible()
  await expect(page.getByText(/admin và staff/)).toHaveCount(0)
  // Email has focus on load (keyboard login); the link and theme button above the form come before it in Tab order.
  await expect(page.getByLabel('Email')).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(page.getByRole('button', { name: /Dùng giao diện/ })).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(page.getByRole('link', { name: /Về trang giới thiệu/ })).toBeFocused()
  const order: string[] = []
  for (let step = 0; step < 6; step += 1) {
    order.push(await page.evaluate(() => {
      const element = document.activeElement as HTMLElement
      return element.id || element.getAttribute('aria-label') || (element.textContent ?? '').replace(/\s+/g, ' ').trim()
    }))
    await page.keyboard.press('Tab')
  }
  expect(order).toEqual(['← Về trang giới thiệu', 'Dùng giao diện tối', 'login-email', 'login-password', 'Hiện mật khẩu', 'Đăng nhập'])
})

test('STAFF đăng nhập với next là màn ADMIN thì về màn đầu của mình, không gặp 403', async ({ page }) => {
  await page.goto('/login?next=%2Fadmin%2Fpayments%3Fstatus%3DSUCCESS')
  await typeLogin(page, ACCOUNTS.STAFF.email, ACCOUNTS.STAFF.password)
  await page.waitForURL(url => url.pathname === '/admin/machines')
  await expect(page.getByRole('heading', { name: 'Không có quyền truy cập' })).toHaveCount(0)
})

test('Bỏ trống thì báo lỗi ngay tại ô, không gửi yêu cầu', async ({ page }) => {
  await page.goto('/login')
  await expect(page.getByLabel('Email')).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.getByLabel('Email')).toHaveAttribute('aria-invalid', 'true')
  await expect(page.getByLabel('Email')).toBeFocused()
})

test('401 (?scenario=expire) về đăng nhập rồi quay lại đúng trang', async ({ page }) => {
  await loginAs(page, 'ADMIN')
  await page.goto('/admin/orders?status=PAID&scenario=expire')
  await page.waitForURL(url => url.pathname === '/login')
  const next = new URL(page.url()).searchParams.get('next') ?? ''
  expect(next).toContain('/admin/orders')
  await expect(page.getByText('Phiên đăng nhập đã hết hạn hoặc bạn chưa đăng nhập.')).toBeVisible()

  await typeLogin(page, ACCOUNTS.ADMIN.email, ACCOUNTS.ADMIN.password)
  await page.waitForURL(url => url.pathname === '/admin/orders')
  expect(new URL(page.url()).searchParams.get('status')).toBe('PAID')
  await expect(page.getByRole('navigation', { name: 'Phân trang' })).toBeVisible()
})
