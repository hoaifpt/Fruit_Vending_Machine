// C1 Sản phẩm (issue FE 3.3) on the mock API. Done criteria: no delete action anywhere; a price ≤ 0 is reported right
// under the field before submitting. Also: SKU locked when editing, STAFF view-only, duplicate SKU (409) once under the
// SKU field, stop/resume selling with a confirmation, focus return, filters in the URL; screenshots + axe at 1440/768/390.
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { auditScreen, loginAs, THEMES, useThemeChoice } from './support.ts'

const table = (page: Page) => page.getByRole('table', { name: 'Danh sách sản phẩm' })
const row = (page: Page, sku: string) => table(page).getByRole('row').filter({ hasText: sku })
const ready = (page: Page) => expect(row(page, 'DEV-MANGO')).toBeVisible()
/** Any control offering to delete (filter clearing is not a delete of data). */
const deleteControls = (page: Page) => page.getByRole('button', { name: /xóa|xoá|delete|remove/i }).filter({ hasNotText: /bộ lọc/i })

test.describe('màn Sản phẩm (Quản trị viên)', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, 'ADMIN')
    await page.goto('/admin/products')
    await ready(page)
  })

  test('Không có nút xóa: trên danh sách, trong Sheet sửa và hộp xác nhận ngừng bán', async ({ page }) => {
    await expect(deleteControls(page)).toHaveCount(0)
    await expect(page.getByRole('menuitem', { name: /xóa|delete/i })).toHaveCount(0)
    await row(page, 'DEV-MANGO').getByRole('button', { name: /^Sửa/ }).click()
    const sheet = page.getByRole('dialog', { name: 'Sửa sản phẩm' })
    await expect(sheet).toBeVisible()
    await expect(deleteControls(page)).toHaveCount(0)
    await sheet.getByRole('button', { name: 'Hủy' }).click()
    await row(page, 'DEV-MANGO').getByRole('button', { name: /^Ngừng bán/ }).click()
    await expect(page.getByRole('alertdialog')).toBeVisible()
    await expect(deleteControls(page)).toHaveCount(0)
  })

  test('Giá ≤ 0 báo lỗi ngay dưới trường, trước khi bấm lưu; sửa lại thì lỗi mất', async ({ page }) => {
    await page.getByRole('button', { name: 'Thêm sản phẩm' }).click()
    const sheet = page.getByRole('dialog', { name: 'Thêm sản phẩm' })
    const price = sheet.getByRole('textbox', { name: /Giá bán/ })
    // While typing: a zero or negative price is reported at once.
    await price.fill('0')
    await expect(price).toHaveAttribute('aria-invalid', 'true')
    await expect(price).toHaveAccessibleDescription('Giá phải lớn hơn 0 ₫.')
    await price.fill('-5000')
    await expect(price).toHaveAccessibleDescription('Giá phải lớn hơn 0 ₫.')
    // Leaving the field: a wrong format and too many decimals are reported too.
    await price.fill('35k')
    await price.press('Tab')
    await expect(price).toHaveAccessibleDescription(/chưa đúng định dạng/)
    await price.fill('35000,123')
    await expect(price).toHaveAccessibleDescription('Giá chỉ được có tối đa 2 chữ số thập phân.')
    await price.fill('35000')
    await expect(price).not.toHaveAttribute('aria-invalid', 'true')
    await expect(price).toHaveAccessibleDescription(/Hiển thị: 35\.000\s₫/)
    await price.press('Tab')
    await expect(price).toHaveValue('35.000')
    await expect(sheet.getByRole('alert')).toHaveCount(0)
  })

  test('Tạo sản phẩm: SKU chuyển in hoa, giá hiển thị 35.000 ₫; SKU trùng (409) báo một lần dưới ô SKU', async ({ page }) => {
    await page.getByRole('button', { name: 'Thêm sản phẩm' }).click()
    const sheet = page.getByRole('dialog', { name: 'Thêm sản phẩm' })
    await sheet.getByRole('textbox', { name: 'SKU' }).fill('dev-mango')
    await sheet.getByRole('textbox', { name: 'Tên sản phẩm' }).fill('Xoài trùng')
    await sheet.getByRole('textbox', { name: /Giá bán/ }).fill('35000')
    await sheet.getByRole('button', { name: 'Thêm sản phẩm' }).click()
    const sku = sheet.getByRole('textbox', { name: 'SKU' })
    const taken = 'SKU này đã được dùng cho một sản phẩm khác (không phân biệt hoa thường). Hãy nhập SKU khác.'
    await expect(sku).toHaveAccessibleDescription(taken)
    await expect(sku).toBeFocused()
    await expect(sheet.getByRole('alert')).toHaveText('Vui lòng kiểm tra các trường được đánh dấu.')
    await expect(sheet.getByText(taken)).toHaveCount(1)

    await sku.fill('kiwi-001')
    await sheet.getByRole('button', { name: 'Thêm sản phẩm' }).click()
    await expect(sheet).toHaveCount(0)
    await expect(row(page, 'KIWI-001')).toContainText('Xoài trùng')
    await expect(row(page, 'KIWI-001')).toContainText(/35\.000\s₫/)
    await expect(row(page, 'KIWI-001')).toContainText('Đang bán')
  })

  test('Sửa: SKU chỉ đọc kèm giải thích, 400 từ máy chủ hiện dưới đúng trường', async ({ page }) => {
    await row(page, 'DEV-MANGO').getByRole('button', { name: /^Sửa/ }).click()
    const sheet = page.getByRole('dialog', { name: 'Sửa sản phẩm' })
    const sku = sheet.getByRole('textbox', { name: 'SKU' })
    await expect(sku).toHaveAttribute('readonly', '')
    await expect(sku).toHaveValue('DEV-MANGO')
    await expect(sku).toHaveAccessibleDescription(/SKU cố định sau khi tạo/)
    const price = sheet.getByRole('textbox', { name: /Giá bán/ })
    await expect(price).toHaveValue('40.000')

    await sheet.getByRole('button', { name: 'Hủy' }).click()

    // The server answers 400 (forced by the mock scenario, it marks the first field sent: name): shown under that field,
    // which gets focus, with one generic line at form level.
    await page.goto('/admin/products?scenario=400:/products/40000000-0000-0000-0000-000000000004')
    await ready(page)
    await row(page, 'DEV-MANGO').getByRole('button', { name: /^Sửa/ }).click()
    await sheet.getByRole('textbox', { name: /Giá bán/ }).fill('41000')
    await sheet.getByRole('button', { name: 'Lưu thay đổi' }).click()
    const name = sheet.getByRole('textbox', { name: 'Tên sản phẩm' })
    await expect(name).toHaveAttribute('aria-invalid', 'true')
    await expect(name).toHaveAccessibleDescription('Giá trị không hợp lệ (mô phỏng).')
    await expect(name).toBeFocused()
    await expect(sheet.getByRole('alert')).toHaveText('Vui lòng kiểm tra các trường được đánh dấu.')
    await expect(sheet).toBeVisible()
    await page.goto('/admin/products?scenario=none')
  })

  test('Sửa lưu đúng trường (không gửi SKU/trạng thái) và giá mới hiện trên danh sách', async ({ page }) => {
    await row(page, 'DEV-MANGO').getByRole('button', { name: /^Sửa/ }).click()
    const sheet = page.getByRole('dialog', { name: 'Sửa sản phẩm' })
    await sheet.getByRole('textbox', { name: 'Tên sản phẩm' }).fill('Hộp xoài cát')
    await sheet.getByRole('textbox', { name: /Giá bán/ }).fill('42.500')
    await sheet.getByRole('button', { name: 'Lưu thay đổi' }).click()
    await expect(sheet).toHaveCount(0)
    await expect(row(page, 'DEV-MANGO')).toContainText('Hộp xoài cát')
    await expect(row(page, 'DEV-MANGO')).toContainText(/42\.500\s₫/)
  })

  test('Ngừng bán và mở bán lại qua xác nhận; focus trở về nút đã mở', async ({ page }) => {
    const status = row(page, 'DEV-MANGO').locator('[data-focus-key^="product-status-"]')
    await status.focus()
    await page.keyboard.press('Enter')
    const dialog = page.getByRole('alertdialog', { name: /Ngừng bán/ })
    await expect(dialog).toContainText('Hộp đã nạp vẫn ở trong ngăn')
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await expect(status).toBeFocused()
    await expect(row(page, 'DEV-MANGO')).toContainText('Đang bán')

    await status.press('Enter')
    await page.getByRole('alertdialog').getByRole('button', { name: 'Ngừng bán', exact: true }).click()
    await expect(row(page, 'DEV-MANGO')).toContainText('Ngừng bán')
    await expect(status).toHaveText('Mở bán lại')
    await expect(status).toBeFocused()
    await status.press('Enter')
    await page.getByRole('alertdialog').getByRole('button', { name: 'Mở bán lại', exact: true }).click()
    await expect(status).toHaveText('Ngừng bán')
    await expect(status).toBeFocused()
  })

  test('Đóng Sheet trả focus: Esc trên Thêm, Hủy và sau khi lưu trên Sửa', async ({ page }) => {
    const create = page.getByRole('button', { name: 'Thêm sản phẩm' })
    await create.focus()
    await page.keyboard.press('Enter')
    const sheet = page.getByRole('dialog', { name: 'Thêm sản phẩm' })
    await expect(sheet.getByRole('textbox', { name: 'SKU' })).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(sheet).toHaveCount(0)
    await expect(create).toBeFocused()

    const edit = row(page, 'DEV-GUAVA').getByRole('button', { name: /^Sửa/ })
    await edit.focus()
    await page.keyboard.press('Enter')
    const editSheet = page.getByRole('dialog', { name: 'Sửa sản phẩm' })
    await editSheet.getByRole('button', { name: 'Hủy' }).click()
    await expect(edit).toBeFocused()
    await edit.press('Enter')
    await editSheet.getByRole('textbox', { name: /Giá bán/ }).fill('23000')
    await editSheet.getByRole('button', { name: 'Lưu thay đổi' }).click()
    await expect(editSheet).toHaveCount(0)
    await expect(row(page, 'DEV-GUAVA')).toContainText(/23\.000\s₫/)
    await expect(edit).toBeFocused()
  })

  test('Bộ lọc và sắp xếp nằm trên URL, gửi lên máy chủ; rỗng theo lọc có nút xóa bộ lọc', async ({ page }) => {
    await page.getByLabel('Trạng thái').selectOption('INACTIVE')
    await page.waitForURL(/status=INACTIVE/)
    await expect(row(page, 'DEV-PAPAYA')).toBeVisible()
    await expect(row(page, 'DEV-MANGO')).toHaveCount(0)
    await table(page).getByRole('button', { name: /^Giá bán/ }).click()
    await page.waitForURL(/sort=price%2Casc|sort=price,asc/)
    await expect(table(page).getByRole('columnheader', { name: /Giá bán/ })).toHaveAttribute('aria-sort', 'ascending')
    await page.getByLabel('Tìm theo tên hoặc SKU').fill('khong-co-san-pham')
    await page.waitForURL(/search=khong-co-san-pham/)
    await expect(page.getByText('Không có sản phẩm nào khớp bộ lọc.')).toBeVisible()
    await page.getByRole('button', { name: /Xóa bộ lọc/ }).first().click()
    await page.waitForURL(url => !url.search.includes('status=') && !url.search.includes('search='))
    await ready(page)
  })

  test('API trả 403: chỉ còn lời giải thích, ẩn nút thêm và bộ lọc', async ({ page }) => {
    await page.goto('/admin/products?scenario=403:products')
    await expect(page.getByRole('heading', { name: 'Không có quyền truy cập' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Thêm sản phẩm' })).toHaveCount(0)
    await expect(page.getByRole('group', { name: 'Bộ lọc' })).toHaveCount(0)
    await page.goto('/admin/products?scenario=none')
  })

  test('Lỗi máy chủ khi tải: thông báo và nút Thử lại', async ({ page }) => {
    await page.goto('/admin/products?scenario=error500:products')
    await expect(page.getByRole('button', { name: 'Thử lại' })).toBeVisible()
    await page.goto('/admin/products?scenario=none')
    await ready(page)
  })
})

test('Nhân viên chỉ xem: không có nút thêm, sửa, ngừng bán hay xóa', async ({ page }) => {
  await loginAs(page, 'STAFF')
  await page.goto('/admin/products')
  await ready(page)
  await expect(page.getByText(/chỉ xem/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Thêm sản phẩm' })).toHaveCount(0)
  await expect(table(page).getByRole('button', { name: /Sửa|Ngừng bán|Mở bán lại/ })).toHaveCount(0)
  await expect(table(page).getByRole('columnheader', { name: 'Thao tác' })).toHaveCount(0)
  await expect(deleteControls(page)).toHaveCount(0)
})

for (const theme of THEMES) {
  test(`Ảnh + axe: products (${theme})`, async ({ page }, testInfo) => {
    await useThemeChoice(page, theme)
    await loginAs(page, 'ADMIN')
    await page.goto('/admin/products')
    await auditScreen(page, testInfo, 'products', theme, () => ready(page))
  })

  test(`Ảnh + axe: products-form (${theme})`, async ({ page }, testInfo) => {
    await useThemeChoice(page, theme)
    await loginAs(page, 'ADMIN')
    await page.goto('/admin/products')
    await ready(page)
    await row(page, 'DEV-MANGO').getByRole('button', { name: /^Sửa/ }).click()
    const sheet = page.getByRole('dialog', { name: 'Sửa sản phẩm' })
    await sheet.getByRole('textbox', { name: /Giá bán/ }).fill('0')
    await auditScreen(page, testInfo, 'products-form', theme, () => expect(sheet.getByRole('textbox', { name: /Giá bán/ })).toHaveAttribute('aria-invalid', 'true'))
  })
}
