// FE 8.2: public customer report form (P1) on a 390px phone, no account, mock of the real API (backend #74):
// /report/{reportToken}[?order=]. The machine comes from the token; required fields per type (contact for money and
// quality, consent always), a wrong or rotated token, the rate limit with Retry-After, and screenshots + axe in light
// and dark.
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { auditScreen, useThemeChoice } from './support.ts'

const PHONE = { name: '390', width: 390, height: 844 } as const
test.use({ viewport: { width: PHONE.width, height: PHONE.height }, hasTouch: true })

/** Seed token of DEV-MACHINE-01 (seedReportToken in src/api/mock/customer-reports.ts). */
const FORM = '/report/mock-report-token-dev-machine-01'
/** Seed order codes (src/api/mock/seed.ts): `ORD-<UTC date of creation>-<n>`, created hours before the mock started. */
const dateAgo = (ms: number) => new Date(Date.now() - ms).toISOString().slice(0, 10).replaceAll('-', '')
const HOUR = 3_600_000
const ORDER_OF_MACHINE_1 = () => `ORD-${dateAgo(24 * HOUR)}-00000008`

const radio = (page: Page, label: RegExp) => page.getByRole('radio', { name: label })
const orderInput = (page: Page) => page.getByRole('textbox', { name: /^Mã đơn/ })
const descriptionInput = (page: Page) => page.getByRole('textbox', { name: /^Mô tả/ })
const phoneInput = (page: Page) => page.getByRole('textbox', { name: /^Số điện thoại/ })
const consent = (page: Page) => page.getByRole('checkbox', { name: /Tôi đồng ý/ })
const submit = (page: Page) => page.getByRole('button', { name: /Gửi báo cáo|Đang gửi|Gửi lại sau/ })
const calls = (page: Page) => page.evaluate(() => (window as unknown as { __fvMock: { requests: (p: string) => { method: string }[] } }).__fvMock.requests('/public/report-forms').filter(call => call.method === 'POST').length)

async function noHorizontalScroll(page: Page) {
  const size = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }))
  expect(size.scroll).toBeLessThanOrEqual(size.client)
}

test('Khách quét QR của máy, gửi báo cáo kèm ảnh trên điện thoại 390px không cần tài khoản', async ({ page }) => {
  await page.goto(`${FORM}?order=${ORDER_OF_MACHINE_1().toLowerCase()}&scenario=slow`)
  await expect(page.getByRole('heading', { level: 1, name: 'Báo sự cố' })).toBeVisible({ timeout: 10_000 })
  await expect(page.locator('p', { hasText: 'Máy:' })).toContainText('DEV-MACHINE-01')
  await expect(radio(page, /Đã trả tiền nhưng không nhận hàng/)).toBeChecked()
  await expect(orderInput(page)).toHaveValue(ORDER_OF_MACHINE_1())

  await descriptionInput(page).fill('Đã quét mã và trả tiền nhưng cửa không mở.')
  await phoneInput(page).fill('0912 345 678')
  await page.locator('#incident-photo').setInputFiles({ name: 'hop-trai-cay.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==', 'base64') })
  await expect(page.getByRole('img', { name: /Ảnh đã chọn 1: hop-trai-cay.png/ })).toBeVisible()
  await consent(page).check()
  await noHorizontalScroll(page)

  await submit(page).tap()
  await expect(page.getByRole('button', { name: 'Đang gửi…' })).toBeDisabled()
  await expect(page.getByRole('heading', { level: 1, name: 'Đã gửi báo cáo' })).toBeFocused({ timeout: 15_000 })
  await expect(page.getByText(/^Cảm ơn bạn\. Mã báo cáo của bạn là RPT-\d{8}-[A-Z0-9]{4}\.$/)).toBeVisible()
  await noHorizontalScroll(page)
  expect(await calls(page)).toBe(1)

  await page.getByRole('button', { name: 'Gửi báo cáo khác' }).click()
  await expect(orderInput(page)).toHaveValue('')
  await expect(consent(page)).not.toBeChecked()
})

test('Trường bắt buộc đổi theo loại sự cố, focus vào lỗi đầu tiên; không gửi gì khi còn lỗi', async ({ page }) => {
  await page.goto(FORM)
  await submit(page).click()
  await expect(page.getByText('Chọn loại sự cố.')).toBeVisible()
  await expect(radio(page, /Đã trả tiền/)).toBeFocused()

  await radio(page, /Đã trả tiền/).check()
  await expect(orderInput(page)).toHaveAttribute('aria-required', 'true')
  await expect(descriptionInput(page)).not.toHaveAttribute('aria-required', 'true')
  await submit(page).click()
  await expect(orderInput(page)).toBeFocused()
  await expect(page.getByText('Nhập mã đơn để chúng tôi kiểm tra giao dịch.')).toBeVisible()
  await expect(page.getByText('Để lại số điện thoại hoặc email để chúng tôi liên hệ lại.')).toBeVisible()
  await expect(page.getByText('Bạn cần đồng ý để chúng tôi dùng thông tin này xử lý phản ánh.')).toBeVisible()

  await radio(page, /^Khác/).check()
  await expect(descriptionInput(page)).toHaveAttribute('aria-required', 'true')
  await submit(page).click()
  await expect(descriptionInput(page)).toBeFocused()

  // A photo the form cannot send is refused at once, without preview.
  await page.locator('#incident-photo').setInputFiles({ name: 'hoat-hinh.gif', mimeType: 'image/gif', buffer: Buffer.from('R0lGODlhAQABAAAAACw=', 'base64') })
  await expect(page.getByText('Ảnh phải là JPG hoặc PNG.')).toBeVisible()
  await page.getByRole('button', { name: /^Bỏ ảnh 1/ }).click()
  await expect(page.locator('#incident-photo')).toBeFocused()
  expect(await calls(page)).toBe(0)
})

test('Mã QR sai hoặc đã đổi: trang giải thích cách quét lại, không có form', async ({ page }) => {
  await page.goto('/report/ma-qr-da-doi-0000000000')
  await expect(page.getByRole('heading', { level: 1, name: 'Mã QR không còn dùng được' })).toBeFocused({ timeout: 10_000 })
  await expect(page.getByRole('button', { name: /Gửi báo cáo/ })).toHaveCount(0)
  await page.goto('/bao-su-co')
  await expect(page.getByRole('heading', { level: 1, name: 'Hãy quét mã QR trên máy' })).toBeVisible()
})

test('Gửi quá 5 lần trong một phút: thông báo thời gian chờ, nút gửi tạm khóa, dữ liệu được giữ', async ({ page }) => {
  await page.goto(FORM)
  await radio(page, /Máy lỗi/).check()
  await descriptionInput(page).fill('Màn hình đen.')
  await consent(page).check()
  for (let n = 0; n < 5; n += 1) {
    await submit(page).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Đã gửi báo cáo' })).toBeVisible()
    await page.getByRole('button', { name: 'Gửi báo cáo khác' }).click()
    await radio(page, /Máy lỗi/).check()
    await descriptionInput(page).fill('Màn hình đen.')
    await consent(page).check()
  }
  await submit(page).click()
  const alert = page.getByRole('alert')
  await expect(alert).toContainText(/Bạn gửi quá nhiều báo cáo\. Vui lòng thử lại sau \d+ giây\./)
  await expect(alert).toBeFocused()
  await expect(page.getByRole('button', { name: /Gửi lại sau \d+ giây/ })).toBeDisabled()
  await expect(descriptionInput(page)).toHaveValue('Màn hình đen.')
  await noHorizontalScroll(page)
})

for (const theme of ['light', 'dark'] as const) {
  test(`Ảnh chụp, tràn ngang và axe ở 390px (${theme})`, async ({ page }, testInfo) => {
    await useThemeChoice(page, theme)
    await page.goto(FORM)
    await auditScreen(page, testInfo, 'incident-report', theme, async () => { await expect(page.getByRole('heading', { level: 1, name: 'Báo sự cố' })).toBeVisible() }, [PHONE])
    await radio(page, /Đã trả tiền/).check()
    await submit(page).click()
    await expect(orderInput(page)).toBeFocused()
    await auditScreen(page, testInfo, 'incident-report-errors', theme, async () => { await expect(page.getByText('Nhập mã đơn để chúng tôi kiểm tra giao dịch.')).toBeVisible() }, [PHONE])
  })
}
