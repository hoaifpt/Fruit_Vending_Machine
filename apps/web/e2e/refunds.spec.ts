// T3 / W-12 Hoàn tiền (issue FE 8.1) on the mock of the real API (backend #72). Done criteria: a second refund is
// blocked with its reason, and STAFF never sees the action. Also: "Cần hoàn tiền" from GET /refunds/candidates (one
// table, oldest first, payer account), ADMIN records a refund with a reason (MSG36 toast), the paying payment of a
// duplicate pair is not offered, a 409 explained inside the dialog with focus back on the opener, entry from the order
// detail, "Đã hoàn tiền" with its totals, 403 state, screenshots + axe at 1440/768/390 light and dark. The mock store
// lives in the page: in-app navigation keeps recorded refunds, a full reload resets them.
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { auditScreen, loginAs, THEMES, useThemeChoice } from './support.ts'

const id = (prefix: string, n: number) => `${prefix}-0000-0000-0000-${String(n).padStart(12, '0')}`
const ORDER_FAILED = id('90000000', 8)
const PAY_FAILED = id('a0000000', 8)
const PAY_LATE = id('a0000000', 4)
const PAY_DUP_FIRST = id('a0000000', 1)
const PAY_DUP_LATER = id('a0000000', 99)
const ORDER_REFUNDED = id('90000000', 10)
const PAY_REFUNDED = id('a0000000', 10)

const rows = (page: Page) => page.getByRole('table', { name: 'Các khoản thanh toán cần hoàn tiền' }).locator('tbody tr')
const row = (page: Page, paymentId: string) => rows(page).filter({ has: page.locator(`a[href="/admin/payments/${paymentId}"]`) })
const dialog = (page: Page) => page.getByRole('dialog', { name: 'Ghi nhận hoàn tiền' })

test.describe('Hoàn tiền (Quản trị viên)', () => {
  test.beforeEach(async ({ page }) => { await loginAs(page, 'ADMIN') })

  test('ghi nhận một lần; lần 2 bị chặn có lý do', async ({ page }) => {
    await page.getByRole('navigation').getByRole('link', { name: 'Hoàn tiền' }).first().click()
    await expect(page).toHaveURL('/admin/refunds')
    await expect(page.getByRole('button', { name: 'Cần hoàn tiền' })).toHaveAttribute('aria-pressed', 'true')
    const failed = row(page, PAY_FAILED)
    await expect(failed).toHaveCount(1)
    await expect(failed).toContainText('Nhả hàng thất bại')
    const orderCode = (await failed.getByRole('link').first().textContent())!.trim()
    await failed.getByRole('button', { name: /^Ghi nhận hoàn tiền đơn/ }).click()

    const box = dialog(page)
    await expect(box).toBeVisible()
    await expect(box.getByRole('radio', { name: /Nhả hàng thất bại/ })).toBeChecked()
    await expect(box).toContainText('Số tiền cần hoàn')
    await expect(box).toContainText('₫')
    // Required field: the error is beside the field and focus lands on it.
    await box.getByRole('button', { name: 'Ghi nhận hoàn tiền' }).click()
    const ref = box.getByLabel('Mã giao dịch chuyển khoản')
    await expect(ref).toBeFocused()
    await expect(ref).toHaveAttribute('aria-invalid', 'true')
    await expect(box).toContainText('Nhập mã giao dịch của lần chuyển khoản hoàn tiền cho khách.')
    await ref.fill('FT26316000000777')
    await box.getByLabel(/^Ghi chú/).fill('Vietcombank, chủ tài khoản Nguyễn Văn A')
    await box.getByRole('button', { name: 'Ghi nhận hoàn tiền' }).click()

    await expect(box).toBeHidden()
    await expect(page.getByText('Đã ghi nhận hoàn tiền', { exact: true })).toBeVisible()
    await expect(page.getByText(`Thanh toán của đơn ${orderCode} đã được đánh dấu hoàn tiền.`)).toBeVisible()
    await expect(row(page, PAY_FAILED)).toHaveCount(0)

    // "Đã hoàn tiền": the record and the totals, no button.
    await page.getByRole('button', { name: 'Đã hoàn tiền' }).click()
    await expect.poll(() => new URL(page.url()).searchParams.get('view')).toBe('refunded')
    await expect(page.getByRole('region', { name: /^Tổng hoàn tiền/ })).toContainText('Nhả hàng thất bại')
    const done = page.getByRole('table', { name: 'Các lần hoàn tiền đã ghi nhận' }).locator('tbody tr').filter({ hasText: 'FT26316000000777' })
    await expect(done).toHaveCount(1)
    await expect(done.getByRole('button', { name: /Ghi nhận hoàn tiền/ })).toHaveCount(0)

    // Second time through the payment detail: it shows the refund, and the refund screen says why nothing more can be done.
    await done.getByRole('link', { name: /^Mở thanh toán/ }).click()
    await expect(page.locator('[data-refund-entry]')).toContainText('Khoản này đã được hoàn tiền')
    await expect(page.getByText('FT26316000000777')).toBeVisible()
    await page.getByRole('link', { name: 'Mở màn Hoàn tiền của đơn' }).click()
    await expect(page).toHaveURL(`/admin/refunds?orderId=${ORDER_FAILED}`)
    const reason = page.locator('[data-refund-blocked="refunded"]')
    await expect(reason).toContainText(/Đã hoàn tiền lúc \d{2}\/\d{2}\/\d{4} \d{2}:\d{2}, mã CK FT26316000000777/)
    await expect(reason).toContainText('Không ghi nhận lần nữa')
    await expect(page.getByRole('main').getByRole('button', { name: /^Ghi nhận hoàn tiền/ })).toHaveCount(0)
  })

  test('đơn đã hoàn từ trước: không có nút, hiện thời điểm và mã chuyển khoản', async ({ page }) => {
    await page.goto(`/admin/refunds?orderId=${ORDER_REFUNDED}`)
    const reason = page.locator('[data-refund-blocked="refunded"]')
    await expect(reason).toContainText(/^Đã hoàn tiền lúc \d{2}\/\d{2}\/\d{4} \d{2}:\d{2}, mã CK FT26310000000001, người ghi nhận /)
    await expect(page.getByRole('main').getByRole('button', { name: /^Ghi nhận hoàn tiền/ })).toHaveCount(0)
    await expect(page.getByRole('main')).toContainText('Đơn này không còn khoản nào cần hoàn tiền.')
    await expect(page.locator(`a[href="/admin/payments/${PAY_REFUNDED}"]`)).toBeVisible()
  })

  test('thanh toán trùng: chỉ khoản đến sau nằm trong danh sách; lý do “Thanh toán trùng”', async ({ page }) => {
    await page.goto('/admin/refunds')
    await expect(row(page, PAY_DUP_FIRST)).toHaveCount(0)
    await expect(row(page, PAY_DUP_LATER)).toContainText('Thanh toán trùng')
    await row(page, PAY_DUP_LATER).getByRole('button', { name: /^Ghi nhận hoàn tiền đơn/ }).click()
    await expect(dialog(page).getByRole('radio', { name: /Thanh toán trùng/ })).toBeChecked()
    await expect(dialog(page)).toContainText('Trạng thái đơn giữ nguyên')
    await dialog(page).getByRole('button', { name: 'Hủy' }).click()
    await expect(dialog(page)).toBeHidden()
  })

  test('409: hộp thoại giữ nguyên, giải thích bằng tiếng Việt, tải lại; đóng thì focus về nút mở', async ({ page }) => {
    await page.goto(`/admin/refunds?scenario=409:/payments/${PAY_LATE}/refund`)
    const opener = row(page, PAY_LATE).getByRole('button', { name: /^Ghi nhận hoàn tiền đơn/ })
    await opener.click()
    const box = dialog(page)
    await expect(box.getByRole('radio', { name: /Thanh toán muộn \(đơn đã hủy\)/ })).toBeChecked()
    await box.getByLabel('Mã giao dịch chuyển khoản').fill('FT-LATE-0001')
    await box.getByRole('button', { name: 'Ghi nhận hoàn tiền' }).click()
    const alert = box.getByRole('alert')
    await expect(alert).toContainText('Không ghi nhận được vì trạng thái đơn hoặc thanh toán vừa thay đổi')
    await expect(alert).toBeFocused()
    await expect(box).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(box).toBeHidden()
    await expect(opener).toBeFocused()
    await page.goto('/admin/refunds?scenario=none')
  })

  test('lối vào từ chi tiết đơn nhả hàng thất bại', async ({ page }) => {
    await page.goto(`/admin/orders/${ORDER_FAILED}`)
    await page.getByRole('region', { name: 'Cần xử lý' }).getByRole('link', { name: 'Ghi nhận hoàn tiền' }).click()
    await expect(page).toHaveURL(`/admin/refunds?orderId=${ORDER_FAILED}`)
    await page.getByRole('main').getByRole('button', { name: /^Ghi nhận hoàn tiền thanh toán/ }).click()
    await expect(dialog(page).getByRole('radio', { name: /Nhả hàng thất bại/ })).toBeChecked()
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Xem tất cả trường hợp cần hoàn tiền' }).click()
    await expect(page).toHaveURL('/admin/refunds')
    await expect(rows(page).first()).toBeVisible()
  })

  test('403 từ API: một khối giải thích, không có danh sách', async ({ page }) => {
    await page.goto('/admin/refunds?scenario=403:refunds')
    await expect(page.getByRole('heading', { name: 'Không có quyền truy cập' })).toHaveCount(1)
    await expect(page.getByRole('table')).toHaveCount(0)
    await page.goto('/admin/refunds?scenario=none')
  })
})

test.describe('Hoàn tiền (Nhân viên)', () => {
  test('STAFF không thấy menu, nút hay lối vào; mở thẳng URL bị 403', async ({ page }) => {
    await loginAs(page, 'STAFF')
    await expect(page.getByRole('link', { name: 'Hoàn tiền' })).toHaveCount(0)
    await page.goto(`/admin/orders/${ORDER_FAILED}`)
    await expect(page.getByRole('region', { name: 'Cần xử lý' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Ghi nhận hoàn tiền' })).toHaveCount(0)
    await page.goto('/admin/refunds')
    await expect(page.getByRole('heading', { name: 'Không có quyền truy cập' })).toBeVisible()
    await expect(page.getByRole('button', { name: /Ghi nhận hoàn tiền/ })).toHaveCount(0)
    await expect(page.getByRole('table')).toHaveCount(0)
  })
})

for (const theme of THEMES) {
  test(`Ảnh + axe: refunds-pending, refunds-dialog, refunds-refunded (${theme})`, async ({ page }, testInfo) => {
    await useThemeChoice(page, theme)
    await loginAs(page, 'ADMIN')
    await page.goto('/admin/refunds')
    await auditScreen(page, testInfo, 'refunds-pending', theme, () => expect(row(page, PAY_LATE)).toHaveCount(1))
    await page.setViewportSize({ width: 1440, height: 900 })
    await row(page, PAY_FAILED).getByRole('button').click()
    await auditScreen(page, testInfo, 'refunds-dialog', theme, () => expect(dialog(page).getByLabel('Mã giao dịch chuyển khoản')).toBeVisible())
    await page.keyboard.press('Escape')
    await page.goto('/admin/refunds?view=refunded')
    await auditScreen(page, testInfo, 'refunds-refunded', theme, () => expect(page.getByRole('table', { name: 'Các lần hoàn tiền đã ghi nhận' }).locator('tbody tr').first()).toBeVisible())
  })
}
