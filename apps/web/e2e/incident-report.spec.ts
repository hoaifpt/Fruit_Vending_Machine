// FE 8.2: public incident report form (P1) on a 390px phone, no account, mock API (draft incident-reports.yaml).
// Sent from the kiosk QR link, required fields per type, an order code of another machine (MSG46), the rate limit
// (MSG48), a missing/unknown machine code, and screenshots + axe in light and dark.
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { auditScreen, useThemeChoice } from './support.ts'

const PHONE = { name: '390', width: 390, height: 844 } as const
test.use({ viewport: { width: PHONE.width, height: PHONE.height }, hasTouch: true })

/** Seed order codes (src/api/mock/seed.ts): `ORD-<UTC date of creation>-<n>`, created hours before the mock started. */
const dateAgo = (ms: number) => new Date(Date.now() - ms).toISOString().slice(0, 10).replaceAll('-', '')
const HOUR = 3_600_000
const ORDER_OF_MACHINE_1 = () => `ORD-${dateAgo(3 * HOUR)}-00000001`
const ORDER_OF_MACHINE_2 = () => `ORD-${dateAgo(2 * HOUR)}-00000901`

const radio = (page: Page, label: RegExp) => page.getByRole('radio', { name: label })
const orderInput = (page: Page) => page.getByRole('textbox', { name: /^Mã đơn/ })
const descriptionInput = (page: Page) => page.getByRole('textbox', { name: /^Mô tả/ })
const submit = (page: Page) => page.getByRole('button', { name: /Gửi báo cáo|Đang gửi/ })

async function noHorizontalScroll(page: Page) {
  const size = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }))
  expect(size.scroll).toBeLessThanOrEqual(size.client)
}

test('Khách quét QR, gửi báo cáo kèm ảnh trên điện thoại 390px không cần tài khoản', async ({ page }) => {
  await page.goto('/bao-su-co?machine=dev-machine-01&scenario=slow')
  await expect(page.getByRole('heading', { level: 1, name: 'Báo sự cố' })).toBeVisible()
  await expect(page.locator('p', { hasText: 'Máy:' })).toContainText('DEV-MACHINE-01')
  await expect(page.getByRole('textbox', { name: /^Mã máy/ })).toHaveCount(0)

  await radio(page, /Đã trả tiền nhưng không nhận hàng/).check()
  await orderInput(page).fill(ORDER_OF_MACHINE_1().toLowerCase())
  await descriptionInput(page).fill('Đã quét mã và trả tiền nhưng cửa không mở.')
  await page.getByRole('textbox', { name: /^Số điện thoại/ }).fill('0912 345 678')
  await page.locator('#incident-photo').setInputFiles({ name: 'hop-trai-cay.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==', 'base64') })
  await expect(page.getByRole('img', { name: /Ảnh đã chọn: hop-trai-cay.png/ })).toBeVisible()
  await noHorizontalScroll(page)

  await submit(page).tap()
  // Sending: the button is disabled with a spinner, a second tap does nothing.
  await expect(page.getByRole('button', { name: 'Đang gửi…' })).toBeDisabled()
  await expect(page.getByRole('heading', { level: 1, name: 'Đã gửi báo cáo' })).toBeFocused({ timeout: 15_000 })
  await expect(page.getByText(/^Cảm ơn bạn\. Mã báo cáo của bạn là INC-\d{8}-[A-Z0-9]{4}\.$/)).toBeVisible()
  await expect(page.getByText(/\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}/)).toBeVisible()
  await noHorizontalScroll(page)

  // One request only, without an Authorization header (public endpoint).
  const calls = await page.evaluate(() => (window as unknown as { __fvMock: { requests: (p: string) => unknown[] } }).__fvMock.requests('/public/incident-reports').length)
  expect(calls).toBe(1)

  await page.getByRole('button', { name: 'Gửi báo cáo khác' }).click()
  await expect(page.locator('p', { hasText: 'Máy:' })).toContainText('DEV-MACHINE-01')
  await expect(orderInput(page)).toHaveValue('')
})

test('Trường bắt buộc đổi theo loại sự cố, focus vào lỗi đầu tiên', async ({ page }) => {
  await page.goto('/bao-su-co?machine=DEV-MACHINE-01')
  await submit(page).click()
  await expect(page.getByText('Chọn loại sự cố.')).toBeVisible()
  await expect(radio(page, /Đã trả tiền/)).toBeFocused()

  await radio(page, /Đã trả tiền/).check()
  await expect(page.getByText('Chọn loại sự cố.')).toHaveCount(0)
  await expect(orderInput(page)).toHaveAttribute('aria-required', 'true')
  await expect(descriptionInput(page)).not.toHaveAttribute('aria-required', 'true')
  await submit(page).click()
  await expect(orderInput(page)).toBeFocused()
  await expect(orderInput(page)).toHaveAttribute('aria-invalid', 'true')
  await expect(page.getByText('Nhập mã đơn để chúng tôi kiểm tra giao dịch.')).toBeVisible()

  await radio(page, /^Khác/).check()
  await expect(orderInput(page)).not.toHaveAttribute('aria-required', 'true')
  await expect(descriptionInput(page)).toHaveAttribute('aria-required', 'true')
  await submit(page).click()
  await expect(descriptionInput(page)).toBeFocused()
  await expect(page.getByText('Mô tả ngắn vấn đề bạn gặp.', { exact: true })).toBeVisible()

  await radio(page, /Máy lỗi/).check()
  await orderInput(page).fill('ORD-123')
  await page.getByRole('textbox', { name: /^Số điện thoại/ }).fill('12345')
  await submit(page).click()
  await expect(orderInput(page)).toBeFocused()
  await expect(page.getByText('Mã đơn có dạng ORD-20261109-AB12CD34.')).toBeVisible()
  await expect(page.getByText('Số điện thoại chưa đúng, ví dụ 0912 345 678.')).toBeVisible()

  // A photo the form cannot send is refused at once, without preview.
  await page.locator('#incident-photo').setInputFiles({ name: 'hoat-hinh.gif', mimeType: 'image/gif', buffer: Buffer.from('R0lGODlhAQABAAAAACw=', 'base64') })
  await expect(page.getByText('Ảnh phải là JPG, PNG hoặc WebP.')).toBeVisible()
  await expect(page.getByRole('img', { name: /Ảnh đã chọn/ })).toHaveCount(0)
  await page.getByRole('button', { name: 'Bỏ ảnh' }).click()
  await expect(page.locator('#incident-photo')).toBeFocused()
  await expect(page.getByText('Ảnh phải là JPG, PNG hoặc WebP.')).toHaveCount(0)
  const calls = await page.evaluate(() => (window as unknown as { __fvMock: { requests: (p: string) => unknown[] } }).__fvMock.requests('/public/incident-reports').length)
  expect(calls).toBe(0)
})

test('Mã đơn của máy khác: MSG46 ngay dưới ô mã đơn, dữ liệu được giữ', async ({ page }) => {
  await page.goto('/bao-su-co?machine=DEV-MACHINE-01')
  await radio(page, /Đã trả tiền/).check()
  await orderInput(page).fill(ORDER_OF_MACHINE_2())
  await descriptionInput(page).fill('Không nhận được hộp.')
  await submit(page).click()
  await expect(orderInput(page)).toBeFocused()
  await expect(orderInput(page)).toHaveAccessibleDescription(/Không tìm thấy mã đơn của máy này\./)
  await expect(orderInput(page)).toHaveValue(ORDER_OF_MACHINE_2())
  await expect(descriptionInput(page)).toHaveValue('Không nhận được hộp.')
  await expect(radio(page, /Đã trả tiền/)).toBeChecked()
})

test('Gửi quá 5 lần trong một phút: MSG48 hiện ngay trên nút gửi, dữ liệu được giữ', async ({ page }) => {
  await page.goto('/bao-su-co?machine=DEV-MACHINE-01')
  await radio(page, /Đã trả tiền/).check()
  await orderInput(page).fill(ORDER_OF_MACHINE_2())
  for (let n = 0; n < 5; n += 1) {
    await submit(page).click()
    await expect(page.getByText('Không tìm thấy mã đơn của máy này.')).toBeVisible()
    await expect(submit(page)).toBeEnabled()
  }
  await submit(page).click()
  const alert = page.getByRole('alert')
  await expect(alert).toContainText('Bạn gửi quá nhiều báo cáo. Vui lòng thử lại sau một phút.')
  await expect(alert).toBeFocused()
  await expect(orderInput(page)).toHaveValue(ORDER_OF_MACHINE_2())
  await noHorizontalScroll(page)
})

test('Không có mã máy trong đường dẫn: nhập tay; mã máy không tồn tại báo lỗi tại ô mã máy', async ({ page }) => {
  await page.goto('/bao-su-co?machine=%3Cscript%3E')
  await expect(page.getByText('Mã máy trong đường dẫn không đọc được.')).toBeVisible()
  const machine = page.getByRole('textbox', { name: /^Mã máy/ })
  await expect(machine).toHaveValue('')
  await radio(page, /Máy lỗi/).check()
  await submit(page).click()
  await expect(machine).toBeFocused()
  await expect(page.getByText('Nhập mã máy in trên thân máy.')).toBeVisible()

  await machine.fill('fv-khong-co')
  await submit(page).click()
  await expect(machine).toBeFocused()
  await expect(machine).toHaveAccessibleDescription(/Không tìm thấy máy có mã này/)

  await machine.fill('dev-machine-02')
  await submit(page).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Đã gửi báo cáo' })).toBeVisible()
  await expect(page.getByText('DEV-MACHINE-02')).toBeVisible()
})

for (const theme of ['light', 'dark'] as const) {
  test(`Ảnh chụp, tràn ngang và axe ở 390px (${theme})`, async ({ page }, testInfo) => {
    await useThemeChoice(page, theme)
    await page.goto('/bao-su-co?machine=DEV-MACHINE-01')
    await auditScreen(page, testInfo, 'incident-report', theme, async () => { await expect(page.getByRole('heading', { level: 1, name: 'Báo sự cố' })).toBeVisible() }, [PHONE])
    // The error state too: required fields after an empty submit.
    await radio(page, /Đã trả tiền/).check()
    await submit(page).click()
    await expect(orderInput(page)).toBeFocused()
    await auditScreen(page, testInfo, 'incident-report-errors', theme, async () => { await expect(page.getByText('Nhập mã đơn để chúng tôi kiểm tra giao dịch.')).toBeVisible() }, [PHONE])
  })
}
