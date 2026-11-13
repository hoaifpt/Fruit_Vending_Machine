// FE 8.3 on the mock API: a customer report (public form P1, opened from the kiosk QR) shows at once in W-12 "Cần hoàn
// tiền" and opens an INCIDENT work ticket (O3). Done criterion: a "đã trả nhưng không nhận hàng" report is listed in
// "Cần hoàn tiền" right away. Also: an order still PAID is shown for checking only (no refund action), a DISPENSE_FAILED
// one keeps its refund action and is marked "Khách báo sự cố INC-…", the ticket shows the report, STAFF only see the
// INCIDENT tickets given to them (without the customer's phone), the missing-endpoint state, screenshots + axe.
// The mock store lives in the page: the customer form and the admin screens are reached by in-app navigation (no reload).
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { ACCOUNTS, auditScreen, loginAs, THEMES, typeLogin, useThemeChoice } from './support.ts'

const id = (prefix: string, n: number) => `${prefix}-0000-0000-0000-${String(n).padStart(12, '0')}`
const ORDER_PAID = id('90000000', 6)
const ORDER_FAILED = id('90000000', 8)
const HOUR = 3_600_000
/** Seed order codes (src/api/mock/seed.ts): `ORD-<UTC date of creation>-<n>`, order n created n×3 hours before the mock started. */
const dateAgo = (ms: number) => new Date(Date.now() - ms).toISOString().slice(0, 10).replaceAll('-', '')
const PAID_CODE = () => `ORD-${dateAgo(18 * HOUR)}-00000006`
const REPORT_CODE = /INC-\d{8}-[A-Z0-9]{4}/

const reportTable = (page: Page) => page.getByRole('table', { name: 'Báo cáo sự cố của khách cần kiểm tra hoàn tiền' })
const reportRow = (page: Page, code: string) => reportTable(page).locator('tbody tr').filter({ hasText: code })
const failedRow = (page: Page, orderId: string) => page.getByRole('table', { name: 'Đơn nhả hàng thất bại cần hoàn tiền' }).locator('tbody tr').filter({ has: page.locator(`a[href="/admin/orders/${orderId}"]`) })
const ticketTable = (page: Page) => page.getByRole('table', { name: 'Danh sách phiếu công việc' })
const reportPanel = (page: Page) => page.getByRole('region', { name: 'Báo cáo của khách' })

/** Same-document navigation (the router listens to popstate), so the in-memory mock keeps the reports. */
async function go(page: Page, path: string) {
  await page.evaluate(to => { window.history.pushState(null, '', to); window.dispatchEvent(new PopStateEvent('popstate')) }, path)
  await expect(page).toHaveURL(path)
}

/** The customer sends a report on the public form (reached as from the kiosk QR); returns the report code. */
async function sendReport(page: Page, query: string, fill?: () => Promise<void>) {
  // A second report starts on a fresh form, as a new scan of the QR would (leave the page first).
  if (new URL(page.url()).pathname === '/bao-su-co') await go(page, '/')
  await go(page, `/bao-su-co?${query}`)
  await expect(page.getByRole('heading', { level: 1, name: 'Báo sự cố' })).toBeVisible()
  if (fill) await fill()
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

test('Tiêu chí xong: báo cáo "đã trả nhưng không nhận hàng" hiện ngay trong "Cần hoàn tiền" và mở phiếu INCIDENT', async ({ page }) => {
  await loginAs(page, 'ADMIN')
  await page.getByRole('navigation').getByRole('link', { name: 'Hoàn tiền' }).first().click()
  await expect(page.getByRole('heading', { level: 2, name: 'Khách báo sự cố về đơn đã trả tiền' })).toBeVisible()
  await expect(page.getByText('Không có báo cáo nào của khách đang chờ kiểm tra hoàn tiền.')).toBeVisible()
  const failedCode = (await failedRow(page, ORDER_FAILED).getByRole('link').first().innerText()).trim()

  // 1. An order still PAID: the QR of the failed-dispense screen pre-fills the type and the order code.
  const paidCode = PAID_CODE()
  const paidReport = await sendReport(page, `machine=DEV-MACHINE-01&order=${paidCode}`, async () => {
    await expect(page.getByRole('radio', { name: /Đã trả tiền nhưng không nhận hàng/ })).toBeChecked()
    await expect(page.getByRole('textbox', { name: /^Mã đơn/ })).toHaveValue(paidCode)
    await page.getByRole('textbox', { name: /^Số điện thoại/ }).fill('0912 345 678')
    await page.getByRole('textbox', { name: /^Mô tả/ }).fill('Đã trả tiền nhưng cửa không mở <b>gấp</b>')
  })
  await go(page, '/admin/refunds')
  const paidRow = reportRow(page, paidReport)
  await expect(paidRow).toHaveCount(1)
  await expect(paidRow).toContainText(paidCode)
  await expect(paidRow).toContainText('Đã trả tiền nhưng không nhận hàng')
  await expect(paidRow).toContainText('Đơn chưa ở trạng thái nhả thất bại; kiểm tra máy trước.')
  await expect(paidRow.getByRole('button')).toHaveCount(0)
  await expect(paidRow.getByRole('link', { name: `Mở đơn ${paidCode}` })).toHaveAttribute('href', `/admin/orders/${ORDER_PAID}`)

  // 2. A DISPENSE_FAILED order: refundable as usual, and its row in "Đơn nhả hàng thất bại" is marked.
  const failedReport = await sendReport(page, 'machine=DEV-MACHINE-01', async () => {
    await page.getByRole('radio', { name: /Đã trả tiền nhưng không nhận hàng/ }).check()
    await page.getByRole('textbox', { name: /^Mã đơn/ }).fill(failedCode)
  })
  await go(page, '/admin/refunds')
  await expect(reportRow(page, failedReport).getByRole('button', { name: /^Ghi nhận hoàn tiền đơn/ })).toBeVisible()
  const mark = failedRow(page, ORDER_FAILED).getByRole('link', { name: `Khách báo sự cố ${failedReport}` })
  await expect(mark).toBeVisible()

  // 3. The INCIDENT ticket carries the report (admin sees the phone; customer text shown as text).
  await reportRow(page, paidReport).getByRole('link', { name: `${paidReport}, mở phiếu sự cố` }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Sự cố: Đã trả tiền nhưng không nhận hàng · máy DEV-MACHINE-01' })).toBeVisible()
  const panel = reportPanel(page)
  await expect(panel).toContainText(paidReport)
  await expect(panel).toContainText('Đã trả tiền nhưng không nhận hàng')
  await expect(panel).toContainText('Đã trả tiền nhưng cửa không mở <b>gấp</b>')
  await expect(panel.locator('b')).toHaveCount(0)
  await expect(panel.getByRole('link', { name: '0912345678' })).toHaveAttribute('href', 'tel:0912345678')
  await expect(panel.getByRole('link', { name: `Mở đơn ${paidCode}` })).toBeVisible()
  await expect(panel.getByRole('link', { name: 'Mở hoàn tiền của đơn' })).toHaveAttribute('href', `/admin/refunds?orderId=${ORDER_PAID}`)
  await expect(page.getByRole('region', { name: 'Tiến trình' })).toContainText('Hệ thống')
  await expect(page.getByRole('button', { name: /^Phân công/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /xóa|xoá|delete/i })).toHaveCount(0)

  // 4. The ticket list filters by "Sự cố"; there is no way to create an INCIDENT ticket by hand.
  await page.getByRole('link', { name: '← Danh sách phiếu công việc' }).click()
  await page.getByLabel('Loại', { exact: true }).selectOption({ label: 'Sự cố' })
  await expect(page).toHaveURL(/type=INCIDENT/)
  await expect(ticketTable(page).locator('tbody tr')).toHaveCount(2)
  await expect(ticketTable(page)).toContainText(`Sự cố · từ báo cáo ${paidReport}`)
  await page.getByRole('button', { name: 'Tạo phiếu' }).click()
  const create = page.getByRole('dialog', { name: 'Tạo phiếu công việc' })
  await expect(create.getByLabel('Loại phiếu').locator('option')).toHaveText(['Chọn loại…', 'Nạp hàng', 'Bảo trì'])
})

test('STAFF chỉ thấy phiếu INCIDENT được giao cho mình, không thấy số điện thoại của khách', async ({ page }) => {
  await loginAs(page, 'ADMIN')
  const mine = await sendReport(page, 'machine=DEV-MACHINE-01', async () => {
    await page.getByRole('radio', { name: /Máy lỗi/ }).check()
    await page.getByRole('textbox', { name: /^Mô tả/ }).fill('Màn hình đen, không chạm được')
    await page.getByRole('textbox', { name: /^Số điện thoại/ }).fill('0987654321')
  })
  const notMine = await sendReport(page, 'machine=DEV-MACHINE-02', async () => {
    await page.getByRole('radio', { name: /^Khác/ }).check()
    await page.getByRole('textbox', { name: /^Mô tả/ }).fill('Khay lấy hàng bẩn')
  })
  await go(page, '/admin/tickets?type=INCIDENT')
  const rows = ticketTable(page).locator('tbody tr')
  await expect(rows).toHaveCount(2)
  await rows.filter({ hasText: mine }).getByRole('button', { name: /^Phân công/ }).click()
  const assign = page.getByRole('dialog', { name: 'Phân công phiếu' })
  await assign.getByLabel('Nhân viên phụ trách').selectOption({ label: 'Nhân viên vận hành (staff@freshvend.test)' })
  await assign.getByRole('button', { name: 'Phân công' }).click()
  await expect(assign).toBeHidden()
  await expect(rows.filter({ hasText: mine })).toContainText('Đã phân công')

  await switchInPlace(page, 'STAFF')
  await expect(page.getByRole('navigation').getByRole('link', { name: 'Hoàn tiền' })).toHaveCount(0)
  await go(page, '/admin/tickets?type=INCIDENT')
  await expect(rows).toHaveCount(1)
  await expect(rows).toContainText(mine)
  await expect(ticketTable(page)).not.toContainText(notMine)
  await rows.getByRole('link').first().click()
  const panel = reportPanel(page)
  await expect(panel).toContainText('Màn hình đen, không chạm được')
  await expect(panel).toContainText('Máy lỗi')
  await expect(panel).not.toContainText('0987654321')
  await expect(panel.getByText('Số điện thoại')).toHaveCount(0)
  await expect(page.getByRole('button', { name: /^Bắt đầu/ })).toBeVisible()
})

test('W-12 khi máy chủ chưa có danh sách báo cáo: các mục khác vẫn chạy', async ({ page }) => {
  await loginAs(page, 'ADMIN', '?scenario=missing:incident-reports')
  await page.getByRole('navigation').getByRole('link', { name: 'Hoàn tiền' }).first().click()
  await expect(page.getByText(/^Chưa có dữ liệu báo cáo của khách/)).toBeVisible()
  await expect(failedRow(page, ORDER_FAILED)).toHaveCount(1)
})

for (const theme of THEMES) {
  test(`Ảnh + axe: refunds-reports, ticket-incident (${theme})`, async ({ page }, testInfo) => {
    await useThemeChoice(page, theme)
    await loginAs(page, 'ADMIN')
    const code = await sendReport(page, `machine=DEV-MACHINE-01&order=${PAID_CODE()}`, async () => {
      await page.getByRole('textbox', { name: /^Mô tả/ }).fill('Đã quét mã và trả tiền nhưng không có hộp nào rơi xuống.')
    })
    await go(page, '/admin/refunds')
    await auditScreen(page, testInfo, 'refunds-reports', theme, () => expect(reportRow(page, code)).toHaveCount(1))
    await reportRow(page, code).getByRole('link', { name: `${code}, mở phiếu sự cố` }).click()
    await auditScreen(page, testInfo, 'ticket-incident', theme, () => expect(reportPanel(page)).toBeVisible())
  })
}
