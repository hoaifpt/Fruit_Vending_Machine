// T1 Chi tiết đơn (issue FE 6.1) on the mock API. Done criterion: from an order, the payment and each bowl are one click
// away. Also: timeline of a failed dispense, dispense commands (draft API of backend 3.3) with a late result, the
// "no data yet" state when the backend lacks the endpoint, 403/500 on that section only, STAFF without payment links,
// unknown order, the quick filter of the list, screenshots + axe at 1440/768/390 light and dark.
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { auditScreen, loginAs, THEMES, useThemeChoice } from './support.ts'

const MACHINE_2 = '20000000-0000-0000-0000-000000000002'
const SLOT_M2_A1 = '30000000-0000-0000-0000-000000000004'
const BOX_FAILED = '70000000-0000-0000-0000-000000000301'
const ORDER_FAILED = '93000000-0000-0000-0000-000000000001'
const PAYMENT_FAILED_ORDER = 'a3000000-0000-0000-0000-000000000001'
const ORDER_LATE = '90000000-0000-0000-0000-000000000002'
const ORDER_MIXED = '90000000-0000-0000-0000-000000000003'

const section = (page: Page, name: string) => page.getByRole('region', { name })
const boxes = (page: Page) => section(page, 'Hộp của đơn')
const commands = (page: Page) => section(page, 'Lệnh nhả hàng')
const timeline = (page: Page) => page.getByRole('list', { name: 'Các bước của đơn' })

/** Opens the failed-dispense order from the list through the quick filter (the way staff reach it). */
async function openFailedOrder(page: Page) {
  await page.goto('/admin/orders')
  await page.getByRole('button', { name: 'Cần xử lý: nhả hàng thất bại' }).click()
  await expect.poll(() => new URL(page.url()).searchParams.get('status')).toBe('DISPENSE_FAILED')
  await expect(page.getByRole('button', { name: 'Cần xử lý: nhả hàng thất bại' })).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('link', { name: /00000901$/ }).click()
  await expect(page).toHaveURL(`/admin/orders/${ORDER_FAILED}`)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/^Đơn ORD-\d{8}-00000901$/)
}

test.describe('Chi tiết đơn (Quản trị viên)', () => {
  test.beforeEach(async ({ page }) => { await loginAs(page, 'ADMIN') })

  test('Tiêu chí xong: từ đơn sang thanh toán, ngăn và hộp bằng một cú bấm', async ({ page }) => {
    await openFailedOrder(page)

    // Payment: one click.
    await section(page, 'Thanh toán').getByRole('link', { name: /^Mở thanh toán MOCK/ }).click()
    await expect(page).toHaveURL(`/admin/payments/${PAYMENT_FAILED_ORDER}`)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Thanh toán MOCK')
    await page.goBack()
    await expect(page).toHaveURL(`/admin/orders/${ORDER_FAILED}`)

    // Slot of the bowl: one click to that slot on the inventory map.
    await boxes(page).getByRole('link', { name: 'Mở trên sơ đồ ngăn A1' }).click()
    await expect(page).toHaveURL(`/admin/inventory?machineId=${MACHINE_2}&slotId=${SLOT_M2_A1}`)
    await expect(page.locator('[data-slot-column]')).toHaveCount(1)
    await expect(page.locator('[data-slot-column="A1"]')).toContainText('Đang chặn ngăn')
    await page.goBack()

    // The bowl itself: one click to its history.
    await boxes(page).getByRole('link', { name: /^Lịch sử hộp …00000301$/ }).click()
    await expect(page).toHaveURL(`/admin/inventory/history?inventoryItemId=${BOX_FAILED}`)
    await expect(page.getByLabel('Mã hộp', { exact: true })).toHaveValue(BOX_FAILED)
    await expect(page.getByRole('table', { name: 'Lịch sử kho, mới nhất ở trên' }).locator('tbody tr')).toHaveCount(3)
  })

  test('Dòng thời gian, cần xử lý và lệnh nhả hàng của đơn nhả lỗi (quá thời gian)', async ({ page }) => {
    await page.goto(`/admin/orders/${ORDER_FAILED}`)
    const steps = timeline(page).getByRole('listitem')
    await expect(steps).toHaveCount(3)
    await expect(steps.nth(0)).toContainText('Tạo đơn')
    await expect(steps.nth(1)).toContainText('Đã thanh toán')
    await expect(steps.nth(2)).toContainText('Nhả hàng thất bại')
    await expect(steps.nth(2)).toContainText('không báo kết quả trong 60 giây')
    await expect(steps.nth(2)).toHaveAttribute('data-state', 'failed')
    await expect(steps.nth(0).locator('time')).toHaveText(/^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/)

    const attention = section(page, 'Cần xử lý')
    await expect(attention).toContainText('hoàn tiền thủ công')
    await expect(attention.getByRole('link', { name: 'Mở thanh toán' })).toHaveAttribute('href', `/admin/payments/${PAYMENT_FAILED_ORDER}`)

    const row = commands(page).locator('tbody tr')
    await expect(row).toHaveCount(1)
    await expect(row).toContainText(/D-[0-9A-F]{16}/)
    await expect(row).toContainText('Quá thời gian')
    await expect(boxes(page).locator('tbody tr')).toContainText('Quá thời gian')
    await expect(page.getByText('Tổng tiền', { exact: true }).locator('xpath=following-sibling::dd[1]')).toHaveText('30.000 ₫')
    await expect(page.getByRole('button', { name: /Hủy|Sửa|Xóa/ })).toHaveCount(0)
  })

  test('Kết quả đến muộn được giải thích; đơn hoàn tất không có mục cần xử lý', async ({ page }) => {
    await page.goto(`/admin/orders/${ORDER_LATE}`)
    await expect(timeline(page).getByRole('listitem')).toHaveCount(4)
    await expect(timeline(page)).toContainText('kết quả đến muộn')
    await expect(commands(page).locator('tbody tr')).toContainText('Kết quả đến muộn: máy báo nhả xong sau 75 giây')
    await expect(section(page, 'Cần xử lý')).toHaveCount(0)
  })

  test('Đơn hoàn tất nhưng có 1 hộp nhả lỗi: dòng thời gian và Cần xử lý báo rõ', async ({ page }) => {
    await page.goto(`/admin/orders/${ORDER_MIXED}`)
    await expect(page.getByRole('heading', { level: 1 })).toContainText('00000003')
    const steps = timeline(page).getByRole('listitem')
    await expect(steps).toHaveCount(4)
    await expect(steps.nth(2)).toHaveAttribute('data-state', 'failed')
    await expect(steps.nth(2)).toContainText('Nhả hàng có hộp lỗi')
    await expect(steps.nth(2)).toContainText('Máy đã nhả 1/2 hộp')
    await expect(steps.nth(3)).toContainText('hộp nhả lỗi vẫn cần xử lý')
    const attention = section(page, 'Cần xử lý')
    await expect(attention).toContainText('1 hộp của đơn nhả lỗi')
    await expect(attention.getByRole('link', { name: 'Mở thanh toán' })).toBeVisible()
    await expect(commands(page).locator('tbody tr')).toHaveCount(2)
    await expect(boxes(page).locator('tbody tr').first()).toContainText('Thất bại')
  })

  test('Backend chưa có API lệnh (?scenario=missing:dispense-commands): báo chưa có dữ liệu, phần còn lại vẫn chạy', async ({ page }) => {
    await page.goto(`/admin/orders/${ORDER_FAILED}?scenario=missing:dispense-commands`)
    await expect(commands(page).getByRole('status')).toContainText('Chưa có dữ liệu lệnh nhả hàng')
    await expect(commands(page).getByRole('table')).toHaveCount(0)
    await expect(commands(page)).not.toContainText('Mỗi hộp đã trả tiền có một lệnh')
    await expect(boxes(page).getByRole('link', { name: 'Mở trên sơ đồ ngăn A1' })).toBeVisible()
    await expect(boxes(page).getByRole('columnheader', { name: 'Lệnh nhả hàng' })).toHaveCount(0)
    await expect(timeline(page).getByRole('listitem').nth(2)).toContainText('Nhả hàng thất bại')
    await expect(page.getByRole('alert')).toHaveCount(0)
  })

  test('Lỗi 403 / 500 chỉ ở phần lệnh nhả hàng; đơn chưa thanh toán không gọi API lệnh', async ({ page }) => {
    await page.goto(`/admin/orders/${ORDER_FAILED}?scenario=403:dispense-commands`)
    await expect(commands(page).getByRole('alert')).toContainText('Không có quyền truy cập')
    await expect(section(page, 'Thanh toán').getByRole('link', { name: /^Mở thanh toán/ })).toBeVisible()

    await page.goto(`/admin/orders/${ORDER_FAILED}?scenario=error500:dispense-commands`)
    await expect(commands(page).getByRole('button', { name: 'Thử lại' })).toBeVisible()
    await expect(boxes(page).locator('tbody tr')).toHaveCount(1)

    await page.goto('/admin/orders/90000000-0000-0000-0000-000000000005?scenario=none')
    await expect(commands(page)).toContainText('lệnh chỉ được tạo khi đơn đã thanh toán')
    await expect(timeline(page).locator('[aria-current="step"]')).toContainText('Chờ thanh toán')
  })

  test('Đơn không tồn tại, 403 và lỗi 500 của chính đơn', async ({ page }) => {
    await page.goto('/admin/orders/90000000-0000-0000-0000-999999999999')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Không tìm thấy đơn')
    await expect(page.getByRole('alert').getByRole('link', { name: 'Về danh sách đơn hàng' })).toBeVisible()

    await page.goto(`/admin/orders/${ORDER_FAILED}?scenario=403:orders`)
    await expect(page.getByRole('alert').filter({ hasText: 'Không có quyền truy cập' })).toBeVisible()
    await expect(page).toHaveURL(/\/admin\/orders\//)

    await page.goto(`/admin/orders/${ORDER_FAILED}?scenario=error500:orders`)
    await expect(page.getByRole('alert').getByRole('button', { name: 'Thử lại' })).toBeVisible()
  })

  test('Bàn phím: Tab tới link thanh toán rồi Enter mở đúng thanh toán', async ({ page }) => {
    await page.goto(`/admin/orders/${ORDER_FAILED}`)
    const link = section(page, 'Thanh toán').getByRole('link', { name: /^Mở thanh toán/ })
    await link.focus()
    await expect(link).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(`/admin/payments/${PAYMENT_FAILED_ORDER}`)
  })
})

test('Nhân viên: không có link thanh toán (kèm giải thích), vẫn sang ngăn và hộp bằng một cú bấm', async ({ page }) => {
  await loginAs(page, 'STAFF')
  await page.goto(`/admin/orders/${ORDER_FAILED}`)
  const payments = section(page, 'Thanh toán')
  await expect(payments).toContainText('chỉ Quản trị viên xem được')
  await expect(payments.getByRole('link')).toHaveCount(0)
  await expect(section(page, 'Cần xử lý').getByRole('link')).toHaveCount(0)
  await boxes(page).getByRole('link', { name: 'Mở trên sơ đồ ngăn A1' }).click()
  await expect(page).toHaveURL(`/admin/inventory?machineId=${MACHINE_2}&slotId=${SLOT_M2_A1}`)
})

for (const theme of THEMES) {
  test(`Ảnh + axe: order-detail (${theme})`, async ({ page }, testInfo) => {
    await useThemeChoice(page, theme)
    await loginAs(page, 'ADMIN')
    await page.goto(`/admin/orders/${ORDER_FAILED}`)
    await auditScreen(page, testInfo, 'order-detail', theme, () => expect(commands(page).locator('tbody tr')).toHaveCount(1))
  })
}
