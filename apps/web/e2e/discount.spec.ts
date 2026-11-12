// Near-expiry discount (issue FE 7.5, screens K1, T1, I2) on the mock API; fields from the DRAFT
// api-contract/drafts/pricing-discount.yaml (backend 4.1). Done criterion: "35.000 ₫ hiện 17.500 ₫ kèm giá gốc gạch;
// định dạng tiền thống nhất". The mock plays the proposed backend rule (50% off within 24 h of expiry): the kiosk's
// watermelon boxes are near expiry (25.000 → 12.500 ₫) and seed order 13 sold a 35.000 ₫ mixed fruit box at 17.500 ₫.
// Orders and boxes without discount keep showing the plain price. Screenshots + axe at 1440/768/390 (admin) and
// 1280×800 (kiosk).
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { auditScreen, loginAs, THEMES, useThemeChoice } from './support.ts'

const MACHINE_1 = '20000000-0000-0000-0000-000000000001'
const ORDER_DISCOUNTED = '90000000-0000-0000-0000-000000000013'
const ORDER_PLAIN = '90000000-0000-0000-0000-000000000001'
const KIOSK = [{ name: '1280x800', width: 1280, height: 800 }]
const QR_TIMEOUT = 20_000

const card = (page: Page, name: string) => page.locator('.buy-product').filter({ hasText: name })
const lines = (page: Page) => page.getByRole('table', { name: 'Sản phẩm của đơn' })
const column = (page: Page, code: string) => page.locator(`[data-slot-column="${code}"]`)

test.describe('Kiosk K1 (1280×800)', () => {
  test.use({ viewport: { width: 1280, height: 800 }, colorScheme: 'light' })

  test('Thẻ hộp cận hạn: giá sau giảm nổi bật, giá gốc gạch có nhãn đọc, nhãn -50% bằng chữ; thanh toán đúng giá sau giảm', async ({ page }, testInfo) => {
    await page.goto('/buy?scenario=pending')
    await expect(page.getByRole('heading', { level: 1, name: 'Chạm để chọn sản phẩm' })).toBeVisible()
    const discounted = card(page, 'Watermelon bowl')
    await auditScreen(page, testInfo, 'kiosk-discount', 'light', () => expect(discounted.locator('s')).toBeVisible(), KIOSK)

    // The one <strong> is the price to pay; the struck original is announced as "Giá gốc"; the tag is text, not colour.
    await expect(discounted.locator('strong')).toHaveText('12.500 ₫')
    await expect(discounted.locator('s')).toHaveText('Giá gốc 25.000 ₫')
    await expect(discounted.locator('.buy-discount-tag')).toHaveText('-50% giảm giá hộp cận hạn')
    await expect(discounted.locator('.buy-discount-tag')).toBeVisible()
    // A fresh box is unchanged: no strike, no tag.
    const fresh = card(page, 'Mixed fruit bowl')
    await expect(fresh.locator('strong')).toHaveText('35.000 ₫')
    await expect(fresh.locator('s, .buy-discount-tag')).toHaveCount(0)

    await discounted.click()
    await expect(page.getByRole('img', { name: /Mã QR thanh toán/ })).toBeVisible({ timeout: QR_TIMEOUT })
    await expect(page.locator('.buy-pay-total dd')).toHaveText('12.500 ₫')
    await expect(page.locator('.buy-qr-amount strong')).toHaveText('12.500 ₫')
    await expect(page.locator('.buy-pay-discount')).toContainText('Giảm giá hộp cận hạn: đã giảm 12.500 ₫, giá gốc 25.000 ₫')
    await expect(page.locator('.buy-pay-discount s')).toHaveText('25.000 ₫')
    await page.getByRole('button', { name: 'Hủy đơn và chọn lại' }).click()
    await page.getByRole('button', { name: 'Xác nhận hủy đơn' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Đơn hàng đã hủy' })).toBeVisible()
  })

  test('Hộp không giảm giá: màn thanh toán không có dòng giảm giá', async ({ page }) => {
    await page.goto('/buy?scenario=pending')
    await card(page, 'Mixed fruit bowl').click()
    await expect(page.getByRole('img', { name: /Mã QR thanh toán/ })).toBeVisible({ timeout: QR_TIMEOUT })
    await expect(page.locator('.buy-pay-total dd')).toHaveText('35.000 ₫')
    await expect(page.locator('.buy-pay-discount')).toHaveCount(0)
  })
})

test.describe('Quản trị (1440)', () => {
  test.beforeEach(async ({ page }) => { await loginAs(page, 'ADMIN') })

  test('T1 tiêu chí xong: dòng 35.000 ₫ hiện 17.500 ₫ kèm giá gốc gạch, tiền giảm, thành tiền và tổng giảm của đơn', async ({ page }) => {
    await page.goto(`/admin/orders/${ORDER_DISCOUNTED}`)
    const row = lines(page).locator('tbody tr')
    await expect(row).toHaveCount(1)
    await expect(lines(page).getByRole('columnheader', { name: 'Tiền giảm' })).toBeVisible()
    const unit = row.locator('[data-price-discounted]')
    await expect(unit).toContainText('17.500 ₫')
    await expect(unit.locator('s')).toHaveText('Giá gốc 35.000 ₫')
    await expect(unit).toContainText('-50%')
    // Đơn giá | Tiền giảm | Thành tiền
    await expect(row.locator('td').nth(-2)).toHaveText('17.500 ₫')
    await expect(row.locator('td').last()).toHaveText('17.500 ₫')
    await expect(page.getByText('Tổng giảm của đơn: 17.500 ₫.')).toBeVisible()
    const info = page.getByRole('region', { name: 'Thông tin đơn' })
    await expect(info).toContainText('Giá gốc35.000 ₫')
    await expect(info).toContainText('Giảm giá cận hạn17.500 ₫-50%')
    await expect(info).toContainText('Tổng tiền17.500 ₫')
  })

  test('T1 đơn không giảm giá hiển thị như cũ; danh sách đơn ghi số tiền đã giảm', async ({ page }) => {
    await page.goto(`/admin/orders/${ORDER_PLAIN}`)
    await expect(lines(page).locator('tbody tr')).toHaveCount(1)
    await expect(lines(page).getByRole('columnheader', { name: 'Tiền giảm' })).toHaveCount(0)
    await expect(lines(page).locator('s, [data-price-discounted]')).toHaveCount(0)
    await expect(page.getByText(/Tổng giảm của đơn/)).toHaveCount(0)

    await page.goto('/admin/orders?search=00000013')
    const listRow = page.getByRole('table', { name: 'Danh sách đơn hàng' }).locator('tbody tr')
    await expect(listRow).toHaveCount(1)
    await expect(listRow).toContainText('17.500 ₫Đã giảm 17.500 ₫')
  })

  test('I2: hộp cận hạn có nhãn -50% và giá bán kèm giá gốc gạch; hộp còn hạn xa giữ chỗ nhãn trống', async ({ page }) => {
    await page.goto(`/admin/inventory?machineId=${MACHINE_1}`)
    await expect(column(page, 'B1')).toContainText('Đang chặn ngăn')
    const tags = column(page, 'A2').locator('[data-discount-slot]')
    await expect(tags).toHaveCount(6)
    for (const tag of await tags.all()) await expect(tag).toHaveText('-50%')
    const price = column(page, 'A2').locator('[data-box-price]').first()
    await expect(price).toContainText('12.500 ₫')
    await expect(price.locator('s')).toHaveText('25.000 ₫')
    // Screen readers get the discount in words with the box description.
    await expect(column(page, 'A2').locator('li[data-head] .sr-only').first()).toContainText('giảm giá hộp cận hạn: Giá 12.500 ₫, giá gốc 25.000 ₫, giảm 50%')
    await expect(column(page, 'A1').locator('[data-discount-slot]').first()).toHaveText('')
    await expect(column(page, 'A1').locator('[data-box-price]')).toHaveCount(0)

    await page.getByRole('button', { name: 'Danh sách hộp' }).click()
    const table = page.getByRole('table', { name: 'Danh sách hộp' })
    await expect(table.getByRole('columnheader', { name: 'Giá bán' })).toBeVisible()
    await expect(table.locator('[data-price-discounted]').first()).toContainText('12.500 ₫Giá gốc 25.000 ₫-50%')
  })
})

for (const theme of THEMES) {
  test(`Ảnh + axe: order-discount, inventory-discount (${theme})`, async ({ page }, testInfo) => {
    await useThemeChoice(page, theme)
    await loginAs(page, 'ADMIN')
    await page.goto(`/admin/orders/${ORDER_DISCOUNTED}`)
    await auditScreen(page, testInfo, 'order-discount', theme, () => expect(lines(page).locator('[data-price-discounted]')).toBeVisible())
    await page.goto(`/admin/inventory?machineId=${MACHINE_1}`)
    await auditScreen(page, testInfo, 'inventory-discount', theme, () => expect(column(page, 'A2').locator('[data-box-price]').first()).toBeVisible())
  })
}
