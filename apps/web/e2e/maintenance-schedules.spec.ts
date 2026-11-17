// O5 Lịch bảo trì (issue FE 7.3) on the mock of the real API (/maintenance-plans, backend #70). Done criterion: right
// after creating a plan its next due day is visible (previewed while typing, then the server's value on the new row), and a
// plan already within its lead days gets its work order at once. Also: due labels, links to the machine and the current work
// order, edit with the version, deactivate / activate with confirmation (no delete), generate now, STAFF read only,
// 409 / 400 / 403 / missing endpoint / error / empty, screenshots + axe at 1440/768/390 light and dark.
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { auditScreen, loginAs, THEMES, useThemeChoice } from './support.ts'

const id = (prefix: string, n: number) => `${prefix}-0000-0000-0000-${String(n).padStart(12, '0')}`
const MACHINE_1 = id('20000000', 1)
const PLAN_TICKET = id('61000000', 5)
const TITLES = {
  1: 'Vệ sinh khay nhả hàng',
  2: 'Kiểm tra cảm biến nhiệt độ và độ ẩm',
  3: 'Kiểm tra gioăng cửa và khay nước ngưng',
  4: 'Vệ sinh tổng thể khoang lạnh',
} as const

/** Today in Vietnam plus `days`, as the input value (YYYY-MM-DD) and as shown (dd/mm/yyyy). */
function vnDay(days = 0) {
  const iso = new Date(Date.now() + 7 * 3_600_000 + days * 86_400_000).toISOString().slice(0, 10)
  const [y, m, d] = iso.split('-')
  return { input: iso, shown: `${d}/${m}/${y}` }
}

const table = (page: Page) => page.getByRole('table', { name: /Danh sách lịch bảo trì/ })
const rows = (page: Page) => table(page).locator('tbody tr')
const row = (page: Page, title: string) => rows(page).filter({ hasText: title })
async function switchTo(page: Page, role: 'ADMIN' | 'STAFF') {
  await page.evaluate(() => sessionStorage.clear())
  await loginAs(page, role)
}

test('Tiêu chí xong: tạo lịch xong thấy ngay ngày đến hạn kế tiếp; lịch trong số ngày báo trước có phiếu ngay', async ({ page }) => {
  await loginAs(page, 'ADMIN')
  await page.getByRole('navigation', { name: 'Quản trị' }).getByRole('link', { name: 'Lịch bảo trì', exact: true }).click()
  await expect(page).toHaveURL('/admin/maintenance-schedules')
  await expect(rows(page)).toHaveCount(4)
  // Next due first (server order); states in words; links to the machine and the current work order.
  await expect(rows(page).first()).toContainText(TITLES[3])
  await expect(row(page, TITLES[3])).toContainText('Quá hạn 3 ngày · phiếu đang mở')
  await expect(row(page, TITLES[3])).toContainText(vnDay(-3).shown)
  await expect(row(page, TITLES[3]).getByRole('link', { name: new RegExp(`của lịch ${TITLES[3]}`) })).toHaveAttribute('href', `/admin/tickets/${PLAN_TICKET}`)
  await expect(row(page, TITLES[3]).getByRole('link', { name: /^Máy DEV-MACHINE-02/ })).toHaveAttribute('href', /\/admin\/machines\//)
  await expect(row(page, TITLES[2])).toContainText('Sắp đến hạn · còn 2 ngày')
  await expect(row(page, TITLES[4])).toContainText('Đã tắt')

  await page.getByRole('button', { name: 'Tạo lịch' }).click()
  const sheet = page.getByRole('dialog', { name: 'Tạo lịch bảo trì' })
  await expect(sheet).toContainText('Nhập chu kỳ để xem ngày đến hạn lần đầu.')
  await sheet.getByRole('button', { name: 'Tạo lịch' }).click()
  for (const [role, name] of [['combobox', 'Máy'], ['textbox', 'Tên công việc'], ['spinbutton', 'Chu kỳ (số ngày)']] as const) await expect(sheet.getByRole(role, { name, exact: true })).toHaveAttribute('aria-invalid', 'true')
  await sheet.getByRole('combobox', { name: 'Máy', exact: true }).selectOption(MACHINE_1)
  await sheet.getByRole('textbox', { name: 'Tên công việc', exact: true }).fill('Thay lọc gió dàn lạnh')
  await sheet.getByRole('spinbutton', { name: 'Chu kỳ (số ngày)', exact: true }).fill('30')
  await expect(sheet).toContainText(`Đến hạn lần đầu: ${vnDay(30).shown} (còn 30 ngày). Phiếu bảo trì được tạo ngày ${vnDay(29).shown}.`)
  await sheet.getByLabel('Người nhận mặc định (không bắt buộc)').selectOption({ label: 'Nhân viên vận hành (staff@freshvend.test)' })
  await sheet.getByRole('button', { name: 'Tạo lịch' }).click()
  await expect(sheet).toBeHidden()
  const notice = page.getByRole('status').filter({ hasText: 'Đã tạo lịch “Thay lọc gió dàn lạnh” cho máy DEV-MACHINE-01.' })
  await expect(notice).toContainText(`Đến hạn kế tiếp: ${vnDay(30).shown}`)
  await expect(row(page, 'Thay lọc gió dàn lạnh')).toContainText('Mới tạo')
  await expect(row(page, 'Thay lọc gió dàn lạnh')).toContainText('Mỗi 30 ngày')
  await notice.getByRole('button', { name: 'Đóng thông báo' }).click()

  // Due tomorrow with one lead day: the server creates the maintenance work order at once and the notice links to it.
  await page.getByRole('button', { name: 'Tạo lịch' }).click()
  await sheet.getByRole('combobox', { name: 'Máy', exact: true }).selectOption(MACHINE_1)
  await sheet.getByRole('textbox', { name: 'Tên công việc', exact: true }).fill('Kiểm tra khóa cửa')
  await sheet.getByRole('spinbutton', { name: 'Chu kỳ (số ngày)', exact: true }).fill('10')
  await sheet.getByLabel('Đến hạn lần đầu (không bắt buộc)').fill(vnDay(1).input)
  await sheet.getByRole('button', { name: 'Tạo lịch' }).click()
  const dueNotice = page.getByRole('status').filter({ hasText: 'Đã tạo lịch “Kiểm tra khóa cửa”' })
  await expect(dueNotice).toContainText('hệ thống đã tạo phiếu')
  await dueNotice.getByRole('link', { name: 'Xem phiếu' }).click()
  await expect(page).toHaveURL(/\/admin\/tickets\/[0-9a-f-]{36}$/)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Kiểm tra khóa cửa')
})

test('ADMIN sửa (gửi version), tắt rồi bật lại có xác nhận, tạo phiếu ngay; không có xóa; bộ lọc trên URL', async ({ page }) => {
  await loginAs(page, 'ADMIN')
  await page.goto('/admin/maintenance-schedules')
  await row(page, TITLES[2]).getByRole('button', { name: `Sửa lịch: ${TITLES[2]}` }).click()
  const sheet = page.getByRole('dialog', { name: 'Sửa lịch bảo trì' })
  await expect(sheet.getByRole('combobox', { name: 'Máy', exact: true })).toBeDisabled()
  await expect(sheet.getByRole('spinbutton', { name: 'Chu kỳ (số ngày)', exact: true })).toHaveValue('14')
  await sheet.getByRole('button', { name: 'Lưu thay đổi' }).click()
  await expect(sheet.getByRole('alert')).toHaveText(/Chưa có thay đổi nào để lưu/)
  await sheet.getByLabel('Đến hạn kế tiếp').fill(vnDay(8).input)
  await sheet.getByRole('button', { name: 'Lưu thay đổi' }).click()
  await expect(sheet).toBeHidden()
  await expect(row(page, TITLES[2])).toContainText('Vừa cập nhật')
  await expect(row(page, TITLES[2])).toContainText('Còn 8 ngày')

  await row(page, TITLES[2]).getByRole('button', { name: `Tạo phiếu ngay cho lịch: ${TITLES[2]}` }).click()
  await page.getByRole('alertdialog', { name: 'Tạo phiếu bảo trì ngay?' }).getByRole('button', { name: 'Tạo phiếu' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Đã tạo phiếu bảo trì' })).toBeVisible()
  await expect(row(page, TITLES[2]).getByRole('link', { name: new RegExp(`của lịch ${TITLES[2]}`) })).toBeVisible()

  await row(page, TITLES[1]).getByRole('button', { name: `Tắt lịch: ${TITLES[1]}` }).click()
  const off = page.getByRole('alertdialog', { name: 'Tắt lịch bảo trì?' })
  await expect(off).toContainText('Lịch không bị xóa')
  await off.getByRole('button', { name: 'Tắt lịch' }).click()
  await expect(row(page, TITLES[1])).toContainText('Đã tắt')
  await row(page, TITLES[1]).getByRole('button', { name: `Bật lại lịch: ${TITLES[1]}` }).click()
  await page.getByRole('alertdialog', { name: 'Bật lại lịch bảo trì?' }).getByRole('button', { name: 'Bật lại' }).click()
  await expect(row(page, TITLES[1])).toContainText(/Còn \d+ ngày|Sắp đến hạn/)
  await expect(page.getByRole('button', { name: /xóa lịch|xoá|delete/i })).toHaveCount(0)
  await page.getByRole('combobox', { name: 'Trạng thái' }).selectOption('false')
  await expect(page).toHaveURL(/active=false/)
  await expect(rows(page)).toHaveCount(1)
  await expect(rows(page).first()).toContainText(TITLES[4])
})

test('STAFF chỉ xem: không có nút tạo, sửa, tắt, tạo phiếu', async ({ page }) => {
  await loginAs(page, 'STAFF')
  await page.getByRole('navigation', { name: 'Quản trị' }).getByRole('link', { name: 'Lịch bảo trì', exact: true }).click()
  await expect(rows(page)).toHaveCount(4)
  await expect(page.getByRole('button', { name: 'Tạo lịch' })).toHaveCount(0)
  await expect(table(page).getByRole('columnheader', { name: 'Thao tác' })).toHaveCount(0)
  await expect(table(page).getByRole('button', { name: /^(Sửa|Tắt|Bật lại|Tạo phiếu)/ })).toHaveCount(0)
})

test('409 đóng hộp thoại và giải thích; 400 đánh dấu ô; 403, chưa có API, lỗi máy chủ, rỗng, không khớp bộ lọc', async ({ page }) => {
  await loginAs(page, 'ADMIN')
  await page.goto('/admin/maintenance-schedules?scenario=409')
  await row(page, TITLES[1]).getByRole('button', { name: `Tắt lịch: ${TITLES[1]}` }).click()
  const off = page.getByRole('alertdialog', { name: 'Tắt lịch bảo trì?' })
  await off.getByRole('button', { name: 'Tắt lịch' }).click()
  await expect(off).toBeHidden()
  await expect(page.getByText(/Danh sách đã được tải lại/)).toBeVisible()
  await page.goto('/admin/maintenance-schedules?scenario=400')
  await page.getByRole('button', { name: 'Tạo lịch' }).click()
  const sheet = page.getByRole('dialog', { name: 'Tạo lịch bảo trì' })
  await sheet.getByRole('combobox', { name: 'Máy', exact: true }).selectOption(MACHINE_1)
  await sheet.getByRole('textbox', { name: 'Tên công việc', exact: true }).fill('Thử lỗi')
  await sheet.getByRole('spinbutton', { name: 'Chu kỳ (số ngày)', exact: true }).fill('7')
  await sheet.getByRole('button', { name: 'Tạo lịch' }).click()
  await expect(sheet.getByRole('combobox', { name: 'Máy', exact: true })).toHaveAttribute('aria-invalid', 'true')
  await expect(sheet.getByRole('alert')).toHaveText('Vui lòng kiểm tra các trường được đánh dấu.')
  await sheet.getByRole('button', { name: 'Hủy' }).click()
  await page.goto('/admin/maintenance-schedules?scenario=403:maintenance-schedules')
  await expect(page.getByRole('heading', { name: 'Không có quyền truy cập' })).toBeVisible()
  await page.goto('/admin/maintenance-schedules?scenario=missing:maintenance-schedules')
  await expect(page.getByRole('status').filter({ hasText: 'Chưa có dữ liệu lịch bảo trì' })).toBeVisible()
  await page.goto('/admin/maintenance-schedules?scenario=error500:maintenance-schedules')
  await expect(page.getByRole('button', { name: 'Thử lại' })).toBeVisible()
  await page.goto('/admin/maintenance-schedules?scenario=empty')
  await expect(page.getByText(/Chưa có lịch bảo trì nào. Bấm “Tạo lịch”/)).toBeVisible()
  await page.goto(`/admin/maintenance-schedules?scenario=none&active=false&machineId=${MACHINE_1}`)
  await expect(page.getByText(/Không có lịch khớp bộ lọc/)).toBeVisible()
})

for (const theme of THEMES) {
  test(`Ảnh + axe: maintenance-schedules (ADMIN), sheet, STAFF (${theme})`, async ({ page }, testInfo) => {
    await useThemeChoice(page, theme)
    await loginAs(page, 'ADMIN')
    await page.goto('/admin/maintenance-schedules')
    await auditScreen(page, testInfo, 'maintenance-schedules', theme, () => expect(rows(page)).toHaveCount(4))
    await page.getByRole('button', { name: 'Tạo lịch' }).click()
    const sheet = page.getByRole('dialog', { name: 'Tạo lịch bảo trì' })
    await sheet.getByRole('spinbutton', { name: 'Chu kỳ (số ngày)', exact: true }).fill('7')
    await auditScreen(page, testInfo, 'maintenance-schedule-sheet', theme, () => expect(sheet).toContainText('Đến hạn lần đầu:'))
    await sheet.getByRole('button', { name: 'Hủy' }).click()
    await switchTo(page, 'STAFF')
    await page.goto('/admin/maintenance-schedules')
    await auditScreen(page, testInfo, 'maintenance-schedules-staff', theme, () => expect(rows(page)).toHaveCount(4))
  })
}
