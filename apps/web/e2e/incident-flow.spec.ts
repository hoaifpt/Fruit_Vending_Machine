// FE 8.3 on the mock of the real API (backend #74, #72): a customer report (public form P1 at /report/{token}, opened
// from the kiosk QR) is listed at once in "Phản ánh của khách" and, when the order was paid and not served, in W-12
// "Cần hoàn tiền" (CUSTOMER_REPORT candidate with the masked contact and the INCIDENT work order). Recording the refund
// from there resolves the report. Also: the report detail (escaped description, full contact for ADMIN, review /
// resolve / reject), the INCIDENT work order lists its reports, STAFF only see the reports of work orders given to them
// (masked contact, read only), screenshots + axe.
// The mock store lives in the page: the customer form and the admin screens are reached by in-app navigation (no reload).
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { ACCOUNTS, auditScreen, loginAs, THEMES, typeLogin, useThemeChoice } from './support.ts'

const id = (prefix: string, n: number) => `${prefix}-0000-0000-0000-${String(n).padStart(12, '0')}`
const ORDER_FAILED = id('90000000', 8)
const HOUR = 3_600_000
/** Seed order codes (src/api/mock/seed.ts): `ORD-<UTC date of creation>-<n>`, order n created n×3 hours before the mock started. */
const dateAgo = (ms: number) => new Date(Date.now() - ms).toISOString().slice(0, 10).replaceAll('-', '')
const FAILED_CODE = () => `ORD-${dateAgo(24 * HOUR)}-00000008`
const FORM = '/report/mock-report-token-dev-machine-01'
const REPORT_CODE = /RPT-\d{8}-[A-Z0-9]{4}/

const reportTable = (page: Page) => page.getByRole('table', { name: 'Phản ánh của khách' })
const candidateTable = (page: Page) => page.getByRole('table', { name: 'Các khoản thanh toán cần hoàn tiền' })

/** Same-document navigation (the router listens to popstate), so the in-memory mock keeps the reports. */
async function go(page: Page, path: string) {
  await page.evaluate(to => { window.history.pushState(null, '', to); window.dispatchEvent(new PopStateEvent('popstate')) }, path)
  await expect(page).toHaveURL(path)
}

/** The customer sends a report on the public form (reached as from the kiosk QR); returns the report code. */
async function sendReport(page: Page, query: string, fill: () => Promise<void>) {
  if (new URL(page.url()).pathname.startsWith('/report')) await go(page, '/')
  await go(page, `${FORM}${query}`)
  await expect(page.getByRole('heading', { level: 1, name: 'Báo sự cố' })).toBeVisible({ timeout: 10_000 })
  await fill()
  await page.getByRole('checkbox', { name: /Tôi đồng ý/ }).check()
  await page.getByRole('button', { name: 'Gửi báo cáo' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Đã gửi báo cáo' })).toBeVisible({ timeout: 15_000 })
  const text = await page.getByText(/^Cảm ơn bạn\. Mã báo cáo của bạn là /).innerText()
  return text.match(REPORT_CODE)![0]
}

async function switchInPlace(page: Page, role: 'ADMIN' | 'STAFF') {
  await page.getByRole('button', { name: /^Tài khoản: / }).click()
  await page.getByRole('menuitem', { name: 'Đăng xuất' }).click()
  await expect(page).toHaveURL(/\/login/)
  await typeLogin(page, ACCOUNTS[role].email, ACCOUNTS[role].password)
  await page.waitForURL(url => url.pathname.startsWith('/admin/'))
  await expect(page.locator('#admin-main')).toBeVisible()
}

test('Tiêu chí xong: phản ánh "đã trả nhưng không nhận hàng" hiện ngay trong "Cần hoàn tiền", hoàn tiền xong thì phản ánh được giải quyết', async ({ page }) => {
  await loginAs(page, 'ADMIN')
  await go(page, '/admin/refunds?type=CUSTOMER_REPORT')
  await expect(page.getByText('Không có khoản nào khớp bộ lọc. Hãy đổi hoặc xóa bộ lọc.')).toBeVisible()

  const code = await sendReport(page, `?order=${FAILED_CODE()}`, async () => {
    await expect(page.getByRole('radio', { name: /Đã trả tiền nhưng không nhận hàng/ })).toBeChecked()
    await page.getByRole('textbox', { name: /^Mô tả/ }).fill('Đã trả tiền nhưng cửa không mở <b>gấp</b>')
    await page.getByRole('textbox', { name: /^Số điện thoại/ }).fill('0912 345 678')
  })

  // "Cần hoàn tiền": the order's case, the report (masked) and its INCIDENT work order.
  await go(page, '/admin/refunds?type=CUSTOMER_REPORT')
  const row = candidateTable(page).locator('tbody tr').filter({ hasText: FAILED_CODE() })
  await expect(row).toHaveCount(1)
  await expect(row).toContainText(`Phản ánh ${code}`)
  await expect(row.getByRole('link', { name: /^Phiếu WO-/ })).toBeVisible()

  // The report detail: escaped description, full contact for ADMIN, refund link with the work order.
  await row.getByRole('link', { name: `Mở phản ánh ${code}` }).click()
  await expect(page.getByRole('heading', { level: 1, name: `Phản ánh ${code}` })).toBeVisible()
  await expect(page.getByText('Đã trả tiền nhưng cửa không mở <b>gấp</b>')).toBeVisible()
  await expect(page.locator('#admin-main b')).toHaveCount(0)
  await expect(page.getByText('0912345678')).toBeVisible()
  await expect(page.getByText('Cần hoàn tiền', { exact: true })).toBeVisible()
  await page.getByRole('link', { name: `Ghi nhận hoàn tiền cho đơn ${FAILED_CODE()}` }).click()
  await expect(page).toHaveURL(new RegExp(`/admin/refunds\\?orderId=${ORDER_FAILED}&workOrderId=`))
  await page.getByRole('button', { name: /^Ghi nhận hoàn tiền thanh toán/ }).click()
  const dialog = page.getByRole('dialog', { name: 'Ghi nhận hoàn tiền' })
  await expect(dialog.getByRole('radio', { name: /Nhả hàng thất bại/ })).toBeChecked()
  await dialog.getByRole('textbox', { name: /Mã giao dịch chuyển khoản/ }).fill('FT26317000000001')
  await dialog.getByRole('button', { name: 'Ghi nhận hoàn tiền' }).click()
  await expect(dialog).toBeHidden()

  await go(page, '/admin/customer-reports')
  const reportRow = reportTable(page).locator('tbody tr').filter({ hasText: code })
  await expect(reportRow).toContainText('Đã giải quyết')
  await expect(reportRow).toContainText('Đã hoàn tiền')
  await expect(reportRow).toContainText('091****678')
})

test('Nhận xử lý rồi từ chối phản ánh; phiếu INCIDENT liệt kê phản ánh của nó; không có nút xóa', async ({ page }) => {
  await loginAs(page, 'ADMIN')
  const code = await sendReport(page, '', async () => {
    await page.getByRole('radio', { name: /^Khác/ }).check()
    await page.getByRole('textbox', { name: /^Mô tả/ }).fill('Quảng cáo không liên quan')
  })
  await go(page, '/admin/customer-reports')
  await reportTable(page).getByRole('link', { name: `Mở phản ánh ${code}` }).click()
  await page.getByRole('button', { name: 'Nhận xử lý' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Nhận xử lý' }).click()
  await expect(page.getByText('Đang xử lý').first()).toBeVisible()
  await page.getByRole('button', { name: 'Từ chối' }).click()
  const reject = page.getByRole('dialog', { name: `Từ chối phản ánh ${code}` })
  await reject.getByRole('radio', { name: 'Tin rác' }).check()
  await reject.getByRole('button', { name: 'Từ chối' }).click()
  await expect(page.getByText('Đã từ chối: tin rác.')).toBeVisible()
  await expect(page.getByRole('button', { name: /Giải quyết|Từ chối|Nhận xử lý/ })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /xóa|xoá|delete/i })).toHaveCount(0)
  await page.getByRole('link', { name: /^WO-/ }).first().click()
  await expect(page.getByRole('region', { name: 'Phản ánh của khách' })).toContainText(code)
})

test('STAFF chỉ thấy phản ánh thuộc phiếu được giao cho mình, liên hệ bị che, không có thao tác', async ({ page }) => {
  await loginAs(page, 'ADMIN')
  const mine = await sendReport(page, '', async () => {
    await page.getByRole('radio', { name: /Máy lỗi/ }).check()
    await page.getByRole('textbox', { name: /^Mô tả/ }).fill('Màn hình đen, không chạm được')
    await page.getByRole('textbox', { name: /^Số điện thoại/ }).fill('0987654321')
  })
  await go(page, '/admin/customer-reports')
  await reportTable(page).getByRole('link', { name: `Mở phản ánh ${mine}` }).click()
  await page.getByRole('link', { name: /^WO-/ }).first().click()
  await page.getByRole('button', { name: /^Phân công/ }).click()
  const assign = page.getByRole('dialog', { name: 'Phân công phiếu' })
  await assign.getByLabel('Nhân viên phụ trách').selectOption({ label: 'Nhân viên vận hành (staff@freshvend.test)' })
  await assign.getByRole('button', { name: 'Phân công' }).click()
  await expect(assign).toBeHidden()
  const notMine = await sendReport(page, `?order=${FAILED_CODE()}`, async () => {
    await page.getByRole('textbox', { name: /^Số điện thoại/ }).fill('0912345678')
  })

  await switchInPlace(page, 'STAFF')
  await expect(page.getByRole('navigation').getByRole('link', { name: 'Hoàn tiền' })).toHaveCount(0)
  await page.getByRole('navigation').getByRole('link', { name: 'Phản ánh của khách' }).first().click()
  await expect(reportTable(page).locator('tbody tr')).toHaveCount(1)
  await expect(reportTable(page)).not.toContainText(notMine)
  await reportTable(page).getByRole('link', { name: `Mở phản ánh ${mine}` }).click()
  await expect(page.getByText('Màn hình đen, không chạm được')).toBeVisible()
  await expect(page.getByText('0987654321')).toHaveCount(0)
  await expect(page.getByText('098****321')).toBeVisible()
  await expect(page.getByRole('button', { name: /Giải quyết|Từ chối|Nhận xử lý/ })).toHaveCount(0)
})

for (const theme of THEMES) {
  test(`Ảnh + axe: customer-reports, customer-report-detail, refunds-candidates (${theme})`, async ({ page }, testInfo) => {
    await useThemeChoice(page, theme)
    await loginAs(page, 'ADMIN')
    const code = await sendReport(page, `?order=${FAILED_CODE()}`, async () => {
      await page.getByRole('textbox', { name: /^Mô tả/ }).fill('Đã quét mã và trả tiền nhưng không có hộp nào rơi xuống.')
      await page.getByRole('textbox', { name: /^Số điện thoại/ }).fill('0912345678')
    })
    await go(page, '/admin/customer-reports')
    await auditScreen(page, testInfo, 'customer-reports', theme, () => expect(reportTable(page).locator('tbody tr').filter({ hasText: code })).toHaveCount(1))
    await reportTable(page).getByRole('link', { name: `Mở phản ánh ${code}` }).click()
    await auditScreen(page, testInfo, 'customer-report-detail', theme, () => expect(page.getByRole('heading', { level: 1, name: `Phản ánh ${code}` })).toBeVisible())
    await go(page, '/admin/refunds')
    await auditScreen(page, testInfo, 'refunds-candidates', theme, () => expect(candidateTable(page)).toContainText(`Phản ánh ${code}`))
  })
}
