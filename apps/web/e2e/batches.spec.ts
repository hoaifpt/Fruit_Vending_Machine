// I1 Lô hàng (issue FE 4.1) on the mock API. Done criterion: an expiry before the manufacture time is blocked as soon
// as it is typed (error under Hạn dùng, nothing sent). Also: loaded / declared for each batch, create with a taken code
// (409) under Mã lô, no edit or delete, filter and sort in the URL, 403 and server error states, STAFF may create;
// screenshots + axe at 1440/768/390.
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { auditScreen, loginAs, THEMES, useThemeChoice } from './support.ts'

const table = (page: Page) => page.getByRole('table', { name: 'Danh sách lô hàng' })
const row = (page: Page, code: string) => table(page).getByRole('row').filter({ hasText: code })
const ready = (page: Page) => expect(row(page, 'SEED-MIXED-01')).toContainText('8 / 20 hộp')
const deleteOrEdit = (page: Page) => page.getByRole('button', { name: /xóa|xoá|delete|remove|sửa/i }).filter({ hasNotText: /bộ lọc/i })
const BEFORE_MANUFACTURE = 'Hạn dùng phải sau thời điểm sản xuất. Chọn ngày giờ muộn hơn ngày sản xuất.'

/** `<input type="datetime-local">` value `days` from now, Vietnam time (the browser runs in Asia/Ho_Chi_Minh). */
function local(days: number, time = '08:00') {
  const date = new Date(Date.now() + days * 86_400_000 + 7 * 3_600_000)
  return `${date.toISOString().slice(0, 10)}T${time}`
}

async function openCreate(page: Page) {
  await page.getByRole('button', { name: 'Tạo lô hàng' }).click()
  const sheet = page.getByRole('dialog', { name: 'Tạo lô hàng' })
  await expect(sheet).toBeVisible()
  return sheet
}

test.describe('màn Lô hàng (Quản trị viên)', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, 'ADMIN')
    await page.goto('/admin/batches')
    await ready(page)
  })

  test('Mỗi lô hiện đã nạp / khai báo; không có nút sửa hay xóa', async ({ page }) => {
    await expect(row(page, 'SEED-WATERMELON-01')).toContainText('7 / 20 hộp')
    await expect(row(page, 'SEED-WATERMELON-01')).toContainText('Còn nạp được 13 hộp.')
    await expect(row(page, 'SEED-MANGO-EXPIRED')).toContainText('2 / 5 hộp')
    await expect(row(page, 'SEED-MANGO-EXPIRED')).toContainText('Đã hết hạn')
    await expect(row(page, 'SEED-MANGO-EXPIRED')).toContainText('Lô đã hết hạn, không nạp thêm được.')
    await expect(deleteOrEdit(page)).toHaveCount(0)
    await openCreate(page)
    await expect(deleteOrEdit(page)).toHaveCount(0)
  })

  test('Hạn dùng trước ngày sản xuất bị chặn ngay khi nhập, không gửi khi bấm Tạo lô', async ({ page }) => {
    const sheet = await openCreate(page)
    await sheet.getByLabel('Sản phẩm').selectOption({ label: 'Mixed fruit bowl (DEV-MIXED-FRUIT)' })
    await sheet.getByLabel('Mã lô').fill('fm4-e2e-early')
    await sheet.getByLabel('Số lượng khai báo (hộp)').fill('5')
    const made = sheet.getByLabel('Sản xuất lúc')
    const expires = sheet.getByLabel('Hạn dùng')
    await made.fill(local(3))
    await expect(expires).toHaveAttribute('min', local(3, '08:01'))
    // Typing an expiry a day before the manufacture time: reported at once, before any submit.
    await expires.fill(local(2))
    await expect(expires).toHaveAttribute('aria-invalid', 'true')
    await expect(expires).toHaveAccessibleDescription(BEFORE_MANUFACTURE)
    await expect(sheet.getByRole('alert')).toHaveCount(0)
    // Also read out by screen readers without moving focus.
    await expect(sheet.locator('[aria-live="polite"]')).toHaveText(`Hạn dùng: ${BEFORE_MANUFACTURE}`)
    // Equal is refused too (strictly after).
    await expires.fill(local(3))
    await expect(expires).toHaveAccessibleDescription(BEFORE_MANUFACTURE)
    // Submitting with the error sends nothing: the sheet stays, the batch is not created.
    await sheet.getByRole('button', { name: 'Tạo lô' }).click()
    await expect(expires).toBeFocused()
    await expect(sheet.getByRole('alert')).toHaveText('Vui lòng kiểm tra các trường được đánh dấu.')
    // A valid expiry clears it; moving the manufacture time past it brings it back under Hạn dùng.
    await expires.fill(local(5))
    await expect(expires).not.toHaveAttribute('aria-invalid', 'true')
    await made.fill(local(6))
    await expect(expires).toHaveAccessibleDescription(BEFORE_MANUFACTURE)
    await page.keyboard.press('Escape')
    await expect(sheet).toHaveCount(0)
    await expect(row(page, 'FM4-E2E-EARLY')).toHaveCount(0)
  })

  test('Lỗi bắt buộc của Hạn dùng còn nguyên khi đổi ngày sản xuất mà hạn dùng vẫn trống', async ({ page }) => {
    const sheet = await openCreate(page)
    await sheet.getByRole('button', { name: 'Tạo lô' }).click()
    const expires = sheet.getByLabel('Hạn dùng')
    await expect(expires).toHaveAccessibleDescription('Vui lòng chọn hạn dùng.')
    await sheet.getByLabel('Sản xuất lúc').fill(local(1))
    await expect(expires).toHaveAttribute('aria-invalid', 'true')
    await expect(expires).toHaveAccessibleDescription('Vui lòng chọn hạn dùng.')
  })

  test('Tạo lô: mã chuyển in hoa, hiện 0 / khai báo; mã trùng (409) báo dưới ô Mã lô', async ({ page }) => {
    const sheet = await openCreate(page)
    await sheet.getByLabel('Sản phẩm').selectOption({ label: 'Mixed fruit bowl (DEV-MIXED-FRUIT)' })
    await sheet.getByLabel('Mã lô').fill('seed-mixed-01')
    await sheet.getByLabel('Sản xuất lúc').fill(local(0, '06:00'))
    await sheet.getByLabel('Hạn dùng').fill(local(2))
    await sheet.getByLabel('Số lượng khai báo (hộp)').fill('12')
    await sheet.getByRole('button', { name: 'Tạo lô' }).click()
    const code = sheet.getByLabel('Mã lô')
    await expect(code).toHaveAccessibleDescription('Mã lô này đã tồn tại (không phân biệt hoa thường). Hãy nhập mã lô khác.')
    await expect(code).toBeFocused()

    await code.fill('fm4-e2e-01')
    await sheet.getByRole('button', { name: 'Tạo lô' }).click()
    await expect(sheet).toHaveCount(0)
    await expect(row(page, 'FM4-E2E-01')).toContainText('0 / 12 hộp')
    await expect(row(page, 'FM4-E2E-01')).toContainText('Chưa nạp hộp nào vào ngăn.')
    await expect(page.getByRole('button', { name: 'Tạo lô hàng' })).toBeFocused()
  })

  test('Bộ lọc sản phẩm và sắp xếp nằm trên URL; rỗng theo lọc có nút xóa bộ lọc', async ({ page }) => {
    await page.getByLabel('Sản phẩm').selectOption({ label: 'Watermelon bowl (DEV-WATERMELON)' })
    await page.waitForURL(/productId=40000000-0000-0000-0000-000000000002/)
    await expect(row(page, 'SEED-WATERMELON-01')).toBeVisible()
    await expect(row(page, 'SEED-MIXED-01')).toHaveCount(0)
    await page.getByLabel('Sản phẩm').selectOption({ label: 'Guava bowl (DEV-GUAVA)' })
    await expect(page.getByText(/Không có lô nào của Guava bowl/)).toBeVisible()
    await page.getByRole('button', { name: /Xóa bộ lọc/ }).first().click()
    await page.waitForURL(url => !url.search.includes('productId='))
    await ready(page)
    await table(page).getByRole('button', { name: /^Hạn dùng/ }).click()
    await page.waitForURL(/sort=expiresAt%2Casc|sort=expiresAt,asc/)
    await expect(table(page).getByRole('columnheader', { name: /Hạn dùng/ })).toHaveAttribute('aria-sort', 'ascending')
    await expect(table(page).getByRole('row').nth(1)).toContainText('SEED-MANGO-EXPIRED')
  })

  test('API trả 403: chỉ còn lời giải thích, ẩn nút tạo và bộ lọc', async ({ page }) => {
    await page.goto('/admin/batches?scenario=403:batches')
    await expect(page.getByRole('heading', { name: 'Không có quyền truy cập' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Tạo lô hàng' })).toHaveCount(0)
    await expect(page.getByRole('group', { name: 'Bộ lọc' })).toHaveCount(0)
    await page.goto('/admin/batches?scenario=none')
  })

  test('Không có quyền xem tồn kho: vẫn hiện số khai báo kèm giải thích', async ({ page }) => {
    await page.goto('/admin/batches?scenario=403:inventory')
    await expect(row(page, 'SEED-MIXED-01')).toContainText('Khai báo 20 hộp')
    await expect(row(page, 'SEED-MIXED-01')).toContainText('Không có quyền xem tồn kho')
    await page.goto('/admin/batches?scenario=none')
  })

  test('Lỗi máy chủ khi tải: thông báo và nút Thử lại', async ({ page }) => {
    await page.goto('/admin/batches?scenario=error500:batches')
    await expect(page.getByRole('button', { name: 'Thử lại' })).toBeVisible()
    await page.goto('/admin/batches?scenario=none')
    await ready(page)
  })
})

test('Nhân viên tạo được lô; không có nút sửa hay xóa', async ({ page }) => {
  await loginAs(page, 'STAFF')
  await page.goto('/admin/batches')
  await ready(page)
  await expect(page.getByRole('button', { name: 'Tạo lô hàng' })).toBeVisible()
  await expect(deleteOrEdit(page)).toHaveCount(0)
})

for (const theme of THEMES) {
  test(`Ảnh + axe: batches (${theme})`, async ({ page }, testInfo) => {
    await useThemeChoice(page, theme)
    await loginAs(page, 'ADMIN')
    await page.goto('/admin/batches')
    await auditScreen(page, testInfo, 'batches', theme, () => ready(page))
  })

  test(`Ảnh + axe: batches-form (${theme})`, async ({ page }, testInfo) => {
    await useThemeChoice(page, theme)
    await loginAs(page, 'ADMIN')
    await page.goto('/admin/batches')
    await ready(page)
    const sheet = await openCreate(page)
    await sheet.getByLabel('Sản xuất lúc').fill(local(3))
    await sheet.getByLabel('Hạn dùng').fill(local(2))
    await auditScreen(page, testInfo, 'batches-form', theme, () => expect(sheet.getByLabel('Hạn dùng')).toHaveAttribute('aria-invalid', 'true'))
  })
}
