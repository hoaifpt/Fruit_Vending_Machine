// T2 Thanh toán + T4 Nhật ký webhook (issue FE 6.2) on the mock API. Done criterion: ADMIN finds every abnormal payment
// from one filter: "Cần xử lý" lists the late and duplicate payments (the server filter requiresAttention); an amount
// mismatch leaves the payment unchanged and has no list API (blocked by the backend), so the view says so and the
// payment detail shows it against its webhooks. Also: stored payload as text (markup not rendered), copy, links
// payment ↔ order ↔ webhook, STAFF refused, 403/500/404 states, screenshots + axe at 1440/768/390 light and dark.
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { auditScreen, loginAs, THEMES, useThemeChoice } from './support.ts'

const id = (prefix: string, n: number) => `${prefix}-0000-0000-0000-${String(n).padStart(12, '0')}`
const PAY_DUP_FIRST = id('a0000000', 1)
const PAY_LATE = id('a0000000', 4)
const PAY_DUP_LATER = id('a0000000', 99)
const PAY_MISMATCH = id('a0000000', 24)
const ORDER_LATE = id('90000000', 4)
const HOOK_MARKUP = id('b0000000', 10)
const HOOK_MISMATCH = id('b2000000', 24)
const QUICK = 'Cần xử lý: thanh toán muộn, trùng'

const section = (page: Page, name: string) => page.getByRole('region', { name })
const rows = (page: Page) => page.getByRole('table', { name: 'Thanh toán cần xử lý' }).locator('tbody tr')
const row = (page: Page, paymentId: string) => rows(page).filter({ has: page.locator(`a[href="/admin/payments/${paymentId}"]`) })

async function openAttention(page: Page) {
  await page.goto('/admin/payments')
  await page.getByRole('button', { name: QUICK }).click()
  await expect.poll(() => new URL(page.url()).searchParams.get('requiresAttention')).toBe('true')
  await expect(page.getByRole('button', { name: QUICK })).toHaveAttribute('aria-pressed', 'true')
}

test.describe('Thanh toán và webhook (Quản trị viên)', () => {
  test.beforeEach(async ({ page }) => { await loginAs(page, 'ADMIN') })

  test('Tiêu chí xong: một bộ lọc "Cần xử lý" cho mọi thanh toán bất thường', async ({ page }) => {
    await openAttention(page)
    // Late payment + both payments of the duplicate, and nothing else.
    await expect(rows(page)).toHaveCount(3)
    await expect(row(page, PAY_DUP_LATER)).toContainText('Trùng khoản')
    await expect(row(page, PAY_DUP_LATER)).toContainText('Khoản đến sau: cần hoàn')
    await expect(row(page, PAY_DUP_FIRST)).toContainText('Trùng khoản')
    await expect(row(page, PAY_DUP_FIRST)).not.toContainText('cần hoàn')
    await expect(row(page, PAY_LATE)).toContainText('Cần đối soát')
    // Mismatches: said where they are, not silently missing.
    const help = section(page, 'Cần xử lý: tiền đã về nhưng phải hoàn cho khách')
    await expect(help).toContainText('Lệch số tiền không có trong danh sách này')
    await expect(help).toContainText('Chỉ xem được ở mục “Đối chiếu webhook” trong chi tiết từng thanh toán')
    await expect(help.getByRole('link')).toHaveCount(0)

    // The lone row is the late payment: the detail reads the order and says so, one click to the order.
    await row(page, PAY_LATE).getByRole('link', { name: /^Mở thanh toán/ }).click()
    await expect(page).toHaveURL(`/admin/payments/${PAY_LATE}`)
    await expect(section(page, 'Cần xử lý')).toContainText('Thanh toán đến muộn')
    await expect(section(page, 'Đơn hàng')).toContainText('Đã hủy')
    await section(page, 'Đơn hàng').getByRole('link', { name: /^Mở đơn ORD-/ }).click()
    await expect(page).toHaveURL(`/admin/orders/${ORDER_LATE}`)
    await page.goBack()
    await page.goBack()
    await expect(page).toHaveURL(/requiresAttention=true/)

    // The duplicate paid later is the refund candidate; its twin is one click away.
    await row(page, PAY_DUP_LATER).getByRole('link', { name: /^Mở thanh toán/ }).click()
    await expect(section(page, 'Cần xử lý')).toContainText('khoản cần hoàn')
    await section(page, 'Đơn hàng').getByRole('link', { name: /^Mở thanh toán MOCK …00000001$/ }).click()
    await expect(page).toHaveURL(`/admin/payments/${PAY_DUP_FIRST}`)
    await expect(section(page, 'Cần xử lý')).toContainText('Khoản này đến trước')
    await expect(section(page, 'Cần xử lý')).not.toContainText('khoản này đến sau')

    // Off again: the whole list, URL cleaned.
    await page.goto('/admin/payments?requiresAttention=true')
    await page.getByRole('button', { name: QUICK }).click()
    await expect(page.getByRole('button', { name: QUICK })).toHaveAttribute('aria-pressed', 'false')
    await expect(page).toHaveURL('/admin/payments')
    await expect(page.getByRole('table', { name: 'Danh sách thanh toán' }).locator('tbody tr')).toHaveCount(20)
  })

  test('Lệch số tiền: chi tiết thanh toán đối chiếu từng webhook, một cú bấm tới payload', async ({ page }) => {
    await page.goto(`/admin/payments/${PAY_MISMATCH}`)
    await expect(section(page, 'Cần xử lý')).toContainText('Lệch số tiền')
    const hooks = section(page, 'Đối chiếu webhook')
    const mismatch = hooks.locator('tbody tr').filter({ hasText: 'Lệch số tiền' })
    await expect(mismatch).toHaveCount(1)
    await expect(mismatch).toContainText('1.000 ₫')
    await expect(section(page, 'Thông tin thanh toán')).toContainText('Hết hạn')
    await mismatch.getByRole('link', { name: /^Mở webhook nhận lúc/ }).click()
    await expect(page).toHaveURL(`/admin/webhook-logs/${HOOK_MISMATCH}`)
    await expect(section(page, 'Thông tin lần gọi')).toContainText('1.000 ₫')
    await expect(page.locator('pre[data-payload]')).toContainText('"amount":1000')
  })

  test('Payload đã lưu: dạng chữ, không chạy mã; sao chép; xuống dòng cho dễ đọc', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    let dialogs = 0
    page.on('dialog', dialog => { dialogs += 1; void dialog.dismiss() })
    await page.goto(`/admin/webhook-logs/${HOOK_MARKUP}`)
    const pre = page.locator('pre[data-payload]')
    await expect(page.getByRole('heading', { name: 'Nội dung nguyên văn (không phải JSON)' })).toBeVisible()
    await expect(pre).toHaveText("<script>alert('webhook 10')</script> not json")
    await expect(page.locator('#admin-main script')).toHaveCount(0)
    await expect(section(page, 'Thông tin lần gọi')).toContainText('Bị từ chối')
    expect(dialogs).toBe(0)

    await page.goto(`/admin/webhook-logs/${id('b0000000', 1)}`)
    await expect(page.getByRole('heading', { name: 'Nội dung (payload) đã lưu' })).toBeVisible()
    await expect(page.getByText('thứ tự khóa và khoảng trắng có thể khác bản gốc')).toBeVisible()
    await expect(section(page, 'Thông tin lần gọi')).toContainText('Chữ ký hợp lệ; kết quả xử lý xem ở thanh toán tương ứng.')
    await expect(pre).toHaveAttribute('data-payload', 'stored')
    const verbatim = await pre.textContent()
    expect(verbatim).toMatch(/^\{"paymentReference":"MOCKREF000001","transactionId":"TXN00000001","amount":\d+,"status":"SUCCESS"\}$/)
    await page.getByRole('button', { name: 'Sao chép nội dung' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Đã sao chép nội dung.' })).toHaveCount(1)
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(verbatim)
    // The confirmation clears after a few seconds, so the next copy is announced again.
    await expect(page.getByRole('status').filter({ hasText: 'Đã sao chép nội dung.' })).toHaveCount(0, { timeout: 8000 })
    await page.getByRole('button', { name: 'Xuống dòng cho dễ đọc' }).click()
    await expect(pre).toHaveAttribute('data-payload', 'formatted')
    await expect(pre).toContainText('"amount": ')
    // Scrollable by keyboard.
    await pre.focus()
    await expect(pre).toBeFocused()
    await expect(page.getByRole('button', { name: /Xóa|Gửi lại|Sửa/ })).toHaveCount(0)
  })

  test('Thanh toán → mọi webhook cùng mã tham chiếu → chi tiết, bộ lọc giữ trên URL', async ({ page }) => {
    await page.goto(`/admin/payments/${PAY_DUP_FIRST}`)
    await expect(section(page, 'Đối chiếu webhook').locator('tbody tr')).toHaveCount(1)
    await expect(section(page, 'Đối chiếu webhook')).toContainText('Khớp')
    await section(page, 'Đối chiếu webhook').getByRole('link', { name: 'Mở trong nhật ký webhook' }).click()
    await expect(page).toHaveURL('/admin/webhook-logs?reference=MOCKREF000001')
    await expect(page.getByLabel('Mã tham chiếu')).toHaveValue('MOCKREF000001')
    const list = page.getByRole('table', { name: 'Nhật ký webhook thanh toán, mới nhất ở trên' }).locator('tbody tr')
    await expect(list).toHaveCount(1)
    await page.getByLabel('Xác thực').selectOption('false')
    await expect(page).toHaveURL(/verified=false/)
    await expect(page.getByText('Chưa có lần gọi nào với mã tham chiếu này')).toBeVisible()
    await page.goto('/admin/webhook-logs?verified=false')
    await expect(list.first()).toContainText('Bị từ chối')
  })

  test('403, lỗi 500, không tìm thấy, và rỗng', async ({ page }) => {
    await page.goto('/admin/payments?requiresAttention=true&scenario=403:payments')
    await expect(page.getByRole('alert').filter({ hasText: 'Không có quyền truy cập' })).toBeVisible()
    await expect(section(page, 'Cần xử lý: tiền đã về nhưng phải hoàn cho khách')).toHaveCount(0)
    await expect(page.getByLabel('Trạng thái')).toHaveCount(0)
    await page.goto(`/admin/payments/${PAY_LATE}?scenario=error500:payments`)
    await expect(page.getByRole('alert').getByRole('button', { name: 'Thử lại' })).toBeVisible()
    await page.goto(`/admin/webhook-logs/${HOOK_MARKUP}?scenario=403:webhook-logs`)
    await expect(page.getByRole('alert').filter({ hasText: 'Không có quyền truy cập' })).toBeVisible()
    // Only the webhooks section fails on the payment detail.
    await page.goto(`/admin/payments/${PAY_LATE}?scenario=error500:webhook-logs`)
    await expect(section(page, 'Đối chiếu webhook').getByRole('button', { name: 'Thử lại' })).toBeVisible()
    await expect(section(page, 'Cần xử lý')).toContainText('Thanh toán đến muộn')
    await page.goto('/admin/payments?requiresAttention=true&scenario=empty:payments')
    await expect(page.getByText('Không có thanh toán muộn hoặc trùng nào khớp bộ lọc')).toBeVisible()

    await page.goto('/admin/payments/a0000000-0000-0000-0000-999999999999?scenario=none')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Không tìm thấy thanh toán')
    await page.goto('/admin/webhook-logs/b0000000-0000-0000-0000-999999999999')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Không tìm thấy webhook')
  })
})

test('Nhân viên: không vào được thanh toán và webhook (giải thích quyền, không đăng xuất)', async ({ page }) => {
  await loginAs(page, 'STAFF')
  for (const url of [`/admin/payments?requiresAttention=true`, `/admin/payments/${PAY_LATE}`, `/admin/webhook-logs/${HOOK_MARKUP}`]) {
    await page.goto(url)
    await expect(page.getByRole('heading', { name: 'Không có quyền truy cập' })).toBeVisible()
    await expect(page.locator('pre[data-payload]')).toHaveCount(0)
    await expect(page.locator('#admin-main')).toBeVisible()
  }
})

for (const theme of THEMES) {
  test(`Ảnh + axe: payments-attention, payment-detail, webhook-detail (${theme})`, async ({ page }, testInfo) => {
    await useThemeChoice(page, theme)
    await loginAs(page, 'ADMIN')
    await page.goto('/admin/payments?requiresAttention=true')
    await auditScreen(page, testInfo, 'payments-attention', theme, () => expect(rows(page)).toHaveCount(3))
    await page.goto(`/admin/payments/${PAY_MISMATCH}`)
    await auditScreen(page, testInfo, 'payment-detail', theme, () => expect(section(page, 'Đối chiếu webhook').locator('tbody tr').first()).toBeVisible())
    await page.goto(`/admin/webhook-logs/${HOOK_MISMATCH}`)
    await auditScreen(page, testInfo, 'webhook-detail', theme, () => expect(page.locator('pre[data-payload]')).toBeVisible())
  })
}
