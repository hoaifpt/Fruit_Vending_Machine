// Orders list (ADMIN): server-side filter, sort and paging kept in the URL, plus the empty / 403 / 500 states forced
// through the mock `?scenario=`.
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { loginAs } from './support.ts'

const param = (page: Page, name: string) => new URL(page.url()).searchParams.get(name)
const pager = (page: Page) => page.getByRole('navigation', { name: 'Phân trang' })

test.beforeEach(async ({ page }) => { await loginAs(page, 'ADMIN') })

test('Đơn hàng: lọc, sắp xếp, phân trang nằm trên URL và giữ sau khi tải lại', async ({ page }) => {
  await page.goto('/admin/orders')
  await expect(pager(page)).toContainText('Trang 1 / 3')

  // Filter by status: URL updates and every row has that status.
  await page.getByLabel('Trạng thái', { exact: true }).selectOption({ label: 'Đã hủy' })
  await expect.poll(() => param(page, 'status')).toBe('CANCELLED')
  await expect(pager(page)).toContainText('Trang 1 / 1')
  const table = page.getByRole('table', { name: 'Danh sách đơn hàng' })
  const rows = table.getByRole('rowgroup').nth(1).getByRole('row')
  await expect(rows.first()).toBeVisible()
  for (const row of await rows.all()) await expect(row).toContainText('Đã hủy')
  await page.getByRole('button', { name: /Xóa bộ lọc/ }).click()
  await expect.poll(() => param(page, 'status')).toBeNull()

  // Sort by the keyboard: total amount, first press is descending.
  await page.getByRole('button', { name: /^Tổng tiền/ }).focus()
  await page.keyboard.press('Enter')
  await expect.poll(() => param(page, 'sort')).toBe('totalAmount,desc')
  await expect(page.getByRole('columnheader', { name: /Tổng tiền/ })).toHaveAttribute('aria-sort', 'descending')

  // Next page.
  await pager(page).getByRole('button', { name: 'Sau' }).click()
  await expect.poll(() => param(page, 'page')).toBe('1')
  await expect(pager(page)).toContainText('Trang 2 / 3')

  await page.reload()
  await expect(pager(page)).toContainText('Trang 2 / 3')
  await expect(page.getByRole('columnheader', { name: /Tổng tiền/ })).toHaveAttribute('aria-sort', 'descending')
})

test('Đơn hàng rỗng (?scenario=empty) có lời giải thích', async ({ page }) => {
  await page.goto('/admin/orders?scenario=empty')
  await expect(page.getByText('Không có đơn hàng phù hợp. Hãy đổi hoặc xóa bộ lọc.')).toBeVisible()
  await expect(pager(page)).toHaveCount(0)
})

test('Đơn hàng 403 (?scenario=403) giải thích quyền, không đăng xuất', async ({ page }) => {
  await page.goto('/admin/orders?scenario=403:orders')
  const alert = page.getByRole('alert').filter({ hasText: 'Không có quyền truy cập' })
  await expect(alert).toBeVisible()
  await expect(alert).toContainText('liên hệ quản trị viên')
  await expect(page).toHaveURL(/\/admin\/orders/)
})

test('Đơn hàng lỗi 500 (?scenario=error500) có nút Thử lại', async ({ page }) => {
  await page.goto('/admin/orders?scenario=error500')
  const alert = page.getByRole('alert').filter({ has: page.getByRole('button', { name: 'Thử lại' }) })
  await expect(alert).toBeVisible()
  await expect(alert).not.toHaveText('Thử lại')
})
