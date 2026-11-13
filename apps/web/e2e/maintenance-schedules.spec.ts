// O5 Lịch bảo trì (issue FE 7.3) on the mock API (draft of BE 4.5). Done criterion: right after creating a schedule the
// next due date is visible (previewed while typing, then the server's value on the new row). Also: due labels, link to
// the machine and the open ticket, edit, pause/resume with confirmation (no delete), STAFF read only, 409 / 400 / 403 /
// missing endpoint / error / empty, screenshots + axe at 1440/768/390 light and dark.
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { auditScreen, loginAs, THEMES, useThemeChoice } from './support.ts'

const id = (prefix: string, n: number) => `${prefix}-0000-0000-0000-${String(n).padStart(12, '0')}`
const MACHINE_1 = id('20000000', 1)
const OVERDUE_TICKET = id('61000000', 5)
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

const table = (page: Page) => page.getByRole('table', { name: 'Danh sách lịch bảo trì' })
const rows = (page: Page) => table(page).locator('tbody tr')
const row = (page: Page, title: string) => rows(page).filter({ hasText: title })
async function switchTo(page: Page, role: 'ADMIN' | 'STAFF') {
  await page.evaluate(() => sessionStorage.clear())
  await loginAs(page, role)
}

test('Tiêu chí xong: tạo lịch xong thấy ngay ngày đến hạn kế tiếp (xem trước khi nhập, giá trị máy chủ trên dòng mới)', async ({ page }) => {
  await loginAs(page, 'ADMIN')
  await page.getByRole('navigation', { name: 'Quản trị' }).getByRole('link', { name: 'Lịch bảo trì', exact: true }).click()
  await expect(page).toHaveURL('/admin/maintenance-schedules')
  await expect(rows(page)).toHaveCount(4)
  // Soonest due first, paused last; states in words; links to the machine and the open ticket.
  await expect(rows(page).first()).toContainText(TITLES[3])
  await expect(row(page, TITLES[3])).toContainText('Quá hạn 3 ngày')
  await expect(row(page, TITLES[3])).toContainText(vnDay(-3).shown)
  await expect(row(page, TITLES[3]).getByRole('link', { name: `Xem phiếu bảo trì của lịch ${TITLES[3]}` })).toHaveAttribute('href', `/admin/tickets/${OVERDUE_TICKET}`)
  await expect(row(page, TITLES[3]).getByRole('link', { name: /^Máy DEV-MACHINE-02/ })).toHaveAttribute('href', /\/admin\/machines\//)
  await expect(row(page, TITLES[2])).toContainText('Sắp đến hạn · còn 2 ngày')
  await expect(rows(page).last()).toContainText(TITLES[4])
  await expect(row(page, TITLES[4])).toContainText('Tạm dừng')

  await page.getByRole('button', { name: 'Tạo lịch' }).click()
  const sheet = page.getByRole('dialog', { name: 'Tạo lịch bảo trì' })
  await expect(sheet.getByLabel(/^Tính chu kỳ từ ngày/)).toHaveValue(vnDay().input)
  await expect(sheet).toContainText('Nhập chu kỳ và ngày tính chu kỳ để xem ngày đến hạn kế tiếp.')
  await sheet.getByRole('button', { name: 'Tạo lịch' }).click()
  for (const [role, name] of [['combobox', 'Máy'], ['textbox', 'Tên công việc'], ['spinbutton', 'Chu kỳ (số ngày)']] as const) await expect(sheet.getByRole(role, { name, exact: true })).toHaveAttribute('aria-invalid', 'true')
  await sheet.getByRole('combobox', { name: 'Máy', exact: true }).selectOption(MACHINE_1)
  await sheet.getByRole('textbox', { name: 'Tên công việc', exact: true }).fill('Thay lọc gió dàn lạnh')
  await sheet.getByRole('spinbutton', { name: 'Chu kỳ (số ngày)', exact: true }).fill('7')
  await expect(sheet).toContainText(`Đến hạn kế tiếp: ${vnDay(7).shown} (còn 7 ngày)`)
  await sheet.getByRole('spinbutton', { name: 'Chu kỳ (số ngày)', exact: true }).fill('30')
  await expect(sheet).toContainText(`Đến hạn kế tiếp: ${vnDay(30).shown} (còn 30 ngày)`)
  // A start date 35 days ago: +30 has passed, so one more cycle (+60 from the start = 25 days from today).
  await sheet.getByLabel(/^Tính chu kỳ từ ngày/).fill(vnDay(-35).input)
  await expect(sheet).toContainText(`Đến hạn kế tiếp: ${vnDay(25).shown}`)
  await expect(sheet).toContainText('cộng tiếp từng chu kỳ')
  await sheet.getByLabel(/^Tính chu kỳ từ ngày/).fill(vnDay().input)
  await sheet.getByLabel('Người phụ trách (không bắt buộc)').selectOption({ label: 'Nhân viên vận hành (staff@freshvend.test)' })
  await sheet.getByRole('button', { name: 'Tạo lịch' }).click()
  await expect(sheet).toBeHidden()

  const notice = page.getByRole('status').filter({ hasText: 'Đã tạo lịch “Thay lọc gió dàn lạnh” cho máy DEV-MACHINE-01.' })
  await expect(notice).toContainText(`Đến hạn kế tiếp: ${vnDay(30).shown}`)
  await expect(rows(page)).toHaveCount(5)
  await expect(row(page, 'Thay lọc gió dàn lạnh')).toContainText(vnDay(30).shown)
  await expect(row(page, 'Thay lọc gió dàn lạnh')).toContainText('Mới tạo')
  await expect(row(page, 'Thay lọc gió dàn lạnh')).toContainText('Mỗi 30 ngày')
  await expect(row(page, 'Thay lọc gió dàn lạnh')).toContainText('Nhân viên vận hành')
  await notice.getByRole('button', { name: 'Đóng thông báo' }).click()
  await expect(notice).toHaveCount(0)

  // Due today: the server opens the maintenance ticket at once and the notice links to it.
  await page.getByRole('button', { name: 'Tạo lịch' }).click()
  await sheet.getByRole('combobox', { name: 'Máy', exact: true }).selectOption(MACHINE_1)
  await sheet.getByRole('textbox', { name: 'Tên công việc', exact: true }).fill('Kiểm tra khóa cửa')
  await sheet.getByRole('spinbutton', { name: 'Chu kỳ (số ngày)', exact: true }).fill('10')
  await sheet.getByLabel(/^Tính chu kỳ từ ngày/).fill(vnDay(-10).input)
  await expect(sheet).toContainText(`Đến hạn kế tiếp: ${vnDay().shown} (đến hạn hôm nay)`)
  await sheet.getByRole('button', { name: 'Tạo lịch' }).click()
  await expect(sheet).toBeHidden()
  const dueNotice = page.getByRole('status').filter({ hasText: 'Đã tạo lịch “Kiểm tra khóa cửa”' })
  await expect(dueNotice).toContainText('đã mở phiếu bảo trì')
  await expect(row(page, 'Kiểm tra khóa cửa')).toContainText('Chưa phân công')
  await dueNotice.getByRole('link', { name: 'Xem phiếu' }).click()
  await expect(page).toHaveURL(/\/admin\/tickets\/[0-9a-f-]{36}$/)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Kiểm tra khóa cửa · máy DEV-MACHINE-01')
})

test('ADMIN sửa chu kỳ (xem trước + giá trị máy chủ), tạm dừng rồi bật lại có xác nhận; không có xóa', async ({ page }) => {
  await loginAs(page, 'ADMIN')
  await page.goto('/admin/maintenance-schedules')
  await row(page, TITLES[2]).getByRole('button', { name: `Sửa lịch: ${TITLES[2]}` }).click()
  const sheet = page.getByRole('dialog', { name: 'Sửa lịch bảo trì' })
  await expect(sheet.getByRole('combobox', { name: 'Máy', exact: true })).toBeDisabled()
  await expect(sheet.getByRole('spinbutton', { name: 'Chu kỳ (số ngày)', exact: true })).toHaveValue('14')
  await expect(sheet).toContainText(`Đến hạn kế tiếp: ${vnDay(2).shown}`)
  await sheet.getByRole('button', { name: 'Lưu thay đổi' }).click()
  await expect(sheet.getByRole('alert')).toHaveText(/Chưa có thay đổi nào để lưu/)
  // Start was 12 days ago: +20 = 8 days from today.
  await sheet.getByRole('spinbutton', { name: 'Chu kỳ (số ngày)', exact: true }).fill('20')
  await expect(sheet).toContainText(`Đến hạn kế tiếp: ${vnDay(8).shown} (còn 8 ngày)`)
  await sheet.getByRole('button', { name: 'Lưu thay đổi' }).click()
  await expect(sheet).toBeHidden()
  await expect(page.getByRole('status').filter({ hasText: `Đã lưu lịch “${TITLES[2]}”` })).toContainText(`Đến hạn kế tiếp: ${vnDay(8).shown}`)
  await expect(row(page, TITLES[2])).toContainText('Vừa cập nhật')
  await expect(row(page, TITLES[2])).toContainText('Mỗi 20 ngày')
  await expect(row(page, TITLES[2])).toContainText('Còn 8 ngày')

  await row(page, TITLES[1]).getByRole('button', { name: `Tạm dừng lịch: ${TITLES[1]}` }).click()
  const pause = page.getByRole('alertdialog', { name: 'Tạm dừng lịch bảo trì?' })
  await expect(pause).toContainText('Lịch không bị xóa')
  await pause.getByRole('button', { name: 'Tạm dừng' }).click()
  await expect(pause).toBeHidden()
  await expect(row(page, TITLES[1])).toContainText('Tạm dừng')
  await expect(row(page, TITLES[1]).getByRole('button', { name: `Bật lại lịch: ${TITLES[1]}` })).toBeFocused()
  await row(page, TITLES[1]).getByRole('button', { name: `Bật lại lịch: ${TITLES[1]}` }).click()
  const resume = page.getByRole('alertdialog', { name: 'Bật lại lịch bảo trì?' })
  await resume.getByRole('button', { name: 'Bật lại' }).click()
  await expect(resume).toBeHidden()
  await expect(row(page, TITLES[1])).toContainText(/Còn \d+ ngày|Sắp đến hạn/)
  await expect(page.getByRole('button', { name: /xóa lịch|xoá|delete/i })).toHaveCount(0)

  // Filters on the URL.
  await page.getByRole('combobox', { name: 'Trạng thái' }).selectOption('false')
  await expect(page).toHaveURL(/active=false/)
  await expect(rows(page)).toHaveCount(1)
  await expect(rows(page).first()).toContainText(TITLES[4])
})

test('STAFF chỉ xem: không có nút tạo, sửa, tạm dừng', async ({ page }) => {
  await loginAs(page, 'STAFF')
  await page.getByRole('navigation', { name: 'Quản trị' }).getByRole('link', { name: 'Lịch bảo trì', exact: true }).click()
  await expect(rows(page)).toHaveCount(4)
  await expect(page.getByRole('button', { name: 'Tạo lịch' })).toHaveCount(0)
  await expect(table(page).getByRole('columnheader', { name: 'Thao tác' })).toHaveCount(0)
  await expect(table(page).getByRole('button', { name: /^(Sửa|Tạm dừng|Bật lại)/ })).toHaveCount(0)
})

test('409 đóng hộp thoại và giải thích; 400 đánh dấu ô; 403, chưa có API, lỗi máy chủ, rỗng, không khớp bộ lọc', async ({ page }) => {
  await loginAs(page, 'ADMIN')
  await page.goto('/admin/maintenance-schedules?scenario=409')
  await row(page, TITLES[1]).getByRole('button', { name: `Tạm dừng lịch: ${TITLES[1]}` }).click()
  const pause = page.getByRole('alertdialog', { name: 'Tạm dừng lịch bảo trì?' })
  await pause.getByRole('button', { name: 'Tạm dừng' }).click()
  await expect(pause).toBeHidden()
  await expect(page.getByText(/đã được tạm dừng trước đó.*Danh sách đã được tải lại/)).toBeVisible()
  await expect(page.getByText('Đã tạm dừng lịch')).toHaveCount(0)

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
  await expect(page.getByRole('button', { name: 'Tạo lịch' })).toHaveCount(0)
  await page.goto('/admin/maintenance-schedules?scenario=missing:maintenance-schedules')
  await expect(page.getByRole('status').filter({ hasText: 'Chưa có dữ liệu lịch bảo trì: máy chủ chưa cung cấp chức năng lịch bảo trì.' })).toBeVisible()
  await expect(page.getByRole('table')).toHaveCount(0)
  await page.goto('/admin/maintenance-schedules?scenario=error500:maintenance-schedules')
  await expect(page.getByRole('button', { name: 'Thử lại' })).toBeVisible()
  await page.goto('/admin/maintenance-schedules?scenario=empty')
  await expect(page.getByText(/Chưa có lịch bảo trì nào. Bấm “Tạo lịch”/)).toBeVisible()
  await page.goto(`/admin/maintenance-schedules?scenario=none&active=false&machineId=${MACHINE_1}`)
  await expect(page.getByText(/Không có lịch khớp bộ lọc/)).toBeVisible()
  await page.getByRole('button', { name: /^Xóa bộ lọc/ }).first().click()
  await expect(rows(page)).toHaveCount(4)
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
    await auditScreen(page, testInfo, 'maintenance-schedule-sheet', theme, () => expect(sheet).toContainText('Đến hạn kế tiếp:'))
    await sheet.getByRole('button', { name: 'Hủy' }).click()
    await switchTo(page, 'STAFF')
    await page.goto('/admin/maintenance-schedules')
    await auditScreen(page, testInfo, 'maintenance-schedules-staff', theme, () => expect(rows(page)).toHaveCount(4))
  })
}
