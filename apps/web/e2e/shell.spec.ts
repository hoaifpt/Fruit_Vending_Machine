// Admin shell on the mock API: focus after navigation (no ring around the content region, rings on real controls),
// the Ctrl+K palette ranking by Vietnamese label, and 400/409 in a form dialog (business message kept for 409).
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { loginAs } from './support.ts'

test.beforeEach(async ({ page }) => { await loginAs(page, 'ADMIN') })

test('Sau khi chuyển màn, vùng nội dung nhận focus nhưng không có viền; nút thật vẫn có viền focus', async ({ page }) => {
  await page.goto('/admin/orders')
  await expect(page.getByRole('navigation', { name: 'Phân trang' })).toBeVisible()
  const main = page.locator('#admin-main')
  await page.getByRole('navigation', { name: 'Quản trị' }).getByRole('link', { name: 'Sản phẩm', exact: true }).focus()
  await page.keyboard.press('Enter')
  await page.waitForURL(/\/admin\/products$/)
  await expect(main).toBeFocused()
  expect(await main.evaluate(element => getComputedStyle(element).outlineStyle)).toBe('none')
  // Keyboard focus on a real button is still clearly visible.
  await expect(page.getByRole('button', { name: 'Thêm sản phẩm' })).toBeVisible()
  await main.focus()
  await page.keyboard.press('Tab')
  const outline = await page.evaluate(() => {
    const style = getComputedStyle(document.activeElement as Element)
    return { tag: (document.activeElement as Element).tagName, style: style.outlineStyle, width: parseFloat(style.outlineWidth) }
  })
  expect(outline.style, `${outline.tag} không có viền focus`).not.toBe('none')
  expect(outline.width).toBeGreaterThanOrEqual(2)
})

test('Ctrl+K: gõ "thanh" rồi Enter mở Thanh toán; gõ không dấu vẫn tìm được', async ({ page }) => {
  await page.goto('/admin/orders')
  await expect(page.getByRole('navigation', { name: 'Phân trang' })).toBeVisible()
  await page.keyboard.press('Control+k')
  const input = page.getByPlaceholder('Nhập tên màn hình hoặc thao tác…')
  await expect(input).toBeFocused()
  await input.fill('thanh')
  await expect(page.getByRole('option').first()).toHaveText('Thanh toán')
  await expect(page.getByRole('option', { name: 'Tồn kho' })).toHaveCount(0)
  await page.keyboard.press('Enter')
  await page.waitForURL(/\/admin\/payments$/)

  await page.keyboard.press('Control+k')
  await page.getByPlaceholder('Nhập tên màn hình hoặc thao tác…').fill('may ban')
  await expect(page.getByRole('option').first()).toHaveText('Máy bán hàng')
  await page.keyboard.press('Enter')
  await page.waitForURL(/\/admin\/machines$/)
})

async function submitNewUser(page: Page, scenario: string) {
  await page.goto(`/admin/users?scenario=${scenario}`)
  await page.getByRole('button', { name: 'Tạo tài khoản nhân viên' }).click()
  const dialog = page.getByRole('dialog', { name: 'Tạo tài khoản nhân viên' })
  await dialog.getByLabel('Họ tên').fill('Nhân viên Mới')
  await dialog.getByLabel('Email').fill('moi@freshvend.test')
  await dialog.getByLabel('Mật khẩu').fill('mat-khau-tam-thoi')
  await dialog.getByRole('button', { name: 'Tạo tài khoản' }).click()
  return dialog
}

test('409 khi tạo tài khoản hiện thông điệp nghiệp vụ, không thay bằng câu chung', async ({ page }) => {
  const dialog = await submitNewUser(page, '409')
  await expect(dialog.getByRole('alert')).toHaveText('Thao tác xung đột với trạng thái hiện tại của dữ liệu.')
  await expect(dialog.getByText('Vui lòng kiểm tra các trường được đánh dấu.')).toHaveCount(0)
  await expect(dialog.getByLabel('Email')).not.toHaveAttribute('aria-invalid', 'true')
})

test('400 khi tạo tài khoản: lỗi tại ô (không phải role=alert) và một câu chung cấp form', async ({ page }) => {
  const dialog = await submitNewUser(page, '400')
  await expect(dialog.getByRole('alert')).toHaveText('Vui lòng kiểm tra các trường được đánh dấu.')
  // The mock marks the first submitted field: linked by aria-describedby, not announced as a second alert.
  const field = dialog.locator('[aria-invalid="true"]')
  await expect(field).toHaveCount(1)
  await expect(field).toHaveAccessibleDescription('Giá trị không hợp lệ (mô phỏng).')
  await expect(dialog.getByRole('alert')).toHaveCount(1)
})
