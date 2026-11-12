// O3 Phiếu công việc (issue FE 7.1) on the mock API (draft of BE 4.3). Done criterion: a STAFF account only sees the
// tickets given to it, and every screen only offers the valid next step for the account and the status. Also: ADMIN
// assigns, cancels with a reason and creates (from the list and from an alert, "Mở phiếu"), 409 / 400 in the dialogs,
// 403, missing endpoint, error, screenshots + axe at 1440/768/390 light and dark.
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { ACCOUNTS, auditScreen, loginAs, THEMES, typeLogin, useThemeChoice } from './support.ts'

const id = (prefix: string, n: number) => `${prefix}-0000-0000-0000-${String(n).padStart(12, '0')}`
const T = (n: number) => id('61000000', n)
const LOW_STOCK_ALERT = id('60000000', 5)
const MACHINE_1 = id('20000000', 1)
const TITLES = {
  1: 'Máy mất kết nối · máy DEV-MACHINE-02',
  2: 'Nạp thêm hộp ngăn A2 · máy DEV-MACHINE-01',
  3: 'Rút hộp hết hạn ngăn B1 · máy DEV-MACHINE-01',
  4: 'Vệ sinh khay nhả hàng · máy DEV-MACHINE-01',
  5: 'Kiểm tra gioăng cửa · máy DEV-MACHINE-02',
} as const
/** dd/mm/yyyy hh:mm, the only time format of the portal. */
const TIME = String.raw`\d{2}/\d{2}/\d{4} \d{2}:\d{2}`

const table = (page: Page) => page.getByRole('table', { name: 'Danh sách phiếu công việc' })
const rows = (page: Page) => table(page).locator('tbody tr')
const row = (page: Page, ticketId: string) => rows(page).filter({ has: page.locator(`a[href="/admin/tickets/${ticketId}"]`) })
const progress = (page: Page) => page.getByRole('region', { name: 'Tiến trình' })
const info = (page: Page) => page.getByRole('region', { name: 'Thông tin phiếu' })
/** Signs out by dropping the stored session (and any mock scenario), then signs in as `role`. */
async function switchTo(page: Page, role: 'ADMIN' | 'STAFF') {
  await page.evaluate(() => sessionStorage.clear())
  await loginAs(page, role)
}
/**
 * Signs out through the account menu and in again as `role` without loading the page, so the in-memory mock keeps what
 * this test changed (a ticket just created by the admin is still there for the staff account).
 */
async function switchInPlace(page: Page, role: 'ADMIN' | 'STAFF') {
  await page.getByRole('button', { name: /^Tài khoản: / }).click()
  await page.getByRole('menuitem', { name: 'Đăng xuất' }).click()
  await expect(page).toHaveURL(/\/login/)
  await typeLogin(page, ACCOUNTS[role].email, ACCOUNTS[role].password)
  await page.waitForURL(url => url.pathname.startsWith('/admin/'))
  await expect(page.locator('#admin-main')).toBeVisible()
}
const openTicketsFromNav = (page: Page) => page.getByRole('navigation', { name: 'Quản trị' }).getByRole('link', { name: 'Phiếu công việc', exact: true }).click()
/** Every action button a row or screen can show (the names start with the visible label). */
const ACTIONS = /^(Phân công|Đổi người phụ trách|Bắt đầu|Hoàn tất|Hủy phiếu)/
const BACK_TO_LIST = '← Danh sách phiếu công việc'

test('Tiêu chí xong: STAFF chỉ thấy phiếu của mình; mỗi phiếu chỉ có đúng bước tiếp theo; bắt đầu rồi hoàn tất ghi tên và giờ', async ({ page }) => {
  await loginAs(page, 'STAFF')
  await page.getByRole('navigation', { name: 'Quản trị' }).getByRole('link', { name: 'Phiếu công việc', exact: true }).click()
  await expect(page).toHaveURL('/admin/tickets')
  await expect(page.getByText('Danh sách chỉ gồm phiếu được giao cho bạn.')).toBeVisible()
  await expect(page.getByText(/^Phiếu được giao cho bạn/)).toBeVisible()
  await expect(rows(page)).toHaveCount(3)
  for (const n of [1, 5]) await expect(row(page, T(n))).toHaveCount(0)
  // No admin tools: no create, no assignee column or filter.
  await expect(page.getByRole('button', { name: 'Tạo phiếu' })).toHaveCount(0)
  await expect(table(page).getByRole('columnheader', { name: 'Người phụ trách' })).toHaveCount(0)
  await expect(page.getByLabel('Người phụ trách')).toHaveCount(0)

  // RESTOCK with lines → only the link to the restock screen (no plain Bắt đầu, which would skip the door and the
  // reconciliation); IN_PROGRESS without lines → only "Hoàn tất"; COMPLETED → nothing.
  await expect(row(page, T(2)).getByRole('button')).toHaveCount(0)
  await expect(row(page, T(2)).getByRole('link', { name: `Thực hiện nạp hàng: ${TITLES[2]}` })).toHaveAttribute('href', `/admin/tickets/${T(2)}/restock`)
  await expect(row(page, T(3)).getByRole('button')).toHaveCount(1)
  await expect(row(page, T(3)).getByRole('button', { name: `Hoàn tất: ${TITLES[3]}` })).toBeVisible()
  await expect(row(page, T(3))).toContainText('Quá hạn')
  await expect(row(page, T(4)).getByRole('button')).toHaveCount(0)
  await expect(row(page, T(4))).toContainText('Không còn bước nào')

  // Someone else's ticket by URL: the server does not disclose it.
  await page.goto(`/admin/tickets/${T(5)}`)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Không tìm thấy phiếu')
  await expect(page.getByText(/phiếu không giao cho bạn/)).toBeVisible()
  await page.getByRole('link', { name: 'Về danh sách phiếu' }).click()

  // The restock ticket's detail: the header leads to the restock screen, not to a plain Bắt đầu.
  await row(page, T(2)).getByRole('link', { name: TITLES[2], exact: true }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(TITLES[2])
  await expect(progress(page)).toContainText('Bước tiếp theo: Khi tới máy, mở “Thực hiện nạp hàng”')
  await expect(page.getByRole('button', { name: ACTIONS })).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Thực hiện nạp hàng', exact: true })).toHaveAttribute('href', `/admin/tickets/${T(2)}/restock`)
  await page.getByRole('link', { name: BACK_TO_LIST }).click()

  // Plain completion of a ticket without restock lines.
  await row(page, T(3)).getByRole('link', { name: TITLES[3], exact: true }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(TITLES[3])
  await expect(progress(page)).toContainText(new RegExp(`Bắt đầu · ${TIME}`))
  await expect(progress(page)).toContainText('Bước tiếp theo: Làm xong việc tại máy thì bấm “Hoàn tất”')
  await expect(info(page)).toContainText('Nhân viên vận hành (bạn)')
  await expect(page.getByRole('button', { name: ACTIONS })).toHaveCount(1)
  await page.getByRole('button', { name: 'Hoàn tất' }).click()
  const sheet = page.getByRole('dialog', { name: 'Hoàn tất phiếu' })
  await sheet.getByLabel('Ghi chú (không bắt buộc)').fill('Đã rút 2 hộp hết hạn ở ngăn B1.')
  await sheet.getByRole('button', { name: 'Hoàn tất' }).click()
  await expect(sheet).toBeHidden()
  await expect(info(page)).toContainText('Hoàn tất')
  await expect(progress(page)).toContainText(new RegExp(`Hoàn tất · ${TIME}`))
  await expect(progress(page)).toContainText('Đã rút 2 hộp hết hạn ở ngăn B1.')
  await expect(progress(page)).toContainText('Phiếu đã hoàn tất, không còn bước nào.')
  await expect(page.getByRole('button', { name: ACTIONS })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /xóa|xoá|delete/i })).toHaveCount(0)
})

test('Phiếu không có dòng nạp: STAFF bấm Bắt đầu (focus sang Hoàn tất) rồi Hoàn tất ghi tên và giờ', async ({ page }) => {
  // The seed's ASSIGNED ticket of the staff account is a restock with lines (restock screen), so the admin first gives
  // it a maintenance ticket; switching accounts in place keeps that ticket in the in-memory mock.
  await loginAs(page, 'ADMIN')
  await openTicketsFromNav(page)
  await page.getByRole('button', { name: 'Tạo phiếu' }).click()
  const create = page.getByRole('dialog', { name: 'Tạo phiếu công việc' })
  await create.getByLabel('Loại phiếu').selectOption('MAINTENANCE')
  await create.getByRole('combobox', { name: 'Máy', exact: true }).selectOption(MACHINE_1)
  await create.getByLabel('Tiêu đề').fill('Lau kính cửa máy')
  await create.getByLabel('Người phụ trách (không bắt buộc)').selectOption({ label: 'Nhân viên vận hành (staff@freshvend.test)' })
  await create.getByRole('button', { name: 'Tạo phiếu' }).click()
  await expect(create).toBeHidden()

  await switchInPlace(page, 'STAFF')
  await openTicketsFromNav(page)
  const mine = rows(page).filter({ hasText: 'Lau kính cửa máy' })
  await expect(mine.getByRole('button')).toHaveCount(1)
  await mine.getByRole('button', { name: 'Bắt đầu: Lau kính cửa máy' }).click()
  const confirm = page.getByRole('alertdialog', { name: 'Bắt đầu làm phiếu này?' })
  await expect(confirm).toContainText('ghi tên bạn và thời điểm bắt đầu')
  await confirm.getByRole('button', { name: 'Bắt đầu' }).click()
  await expect(confirm).toBeHidden()
  await expect(mine).toContainText('Đang thực hiện')
  await expect(mine.getByRole('button')).toHaveCount(1)
  await expect(mine.getByRole('button', { name: /^Hoàn tất/ })).toBeFocused()

  await mine.getByRole('link', { name: 'Lau kính cửa máy', exact: true }).click()
  await expect(progress(page)).toContainText(new RegExp(`Bắt đầu · ${TIME}`))
  await page.getByRole('button', { name: 'Hoàn tất' }).click()
  const sheet = page.getByRole('dialog', { name: 'Hoàn tất phiếu' })
  await sheet.getByLabel('Ghi chú (không bắt buộc)').fill('Đã lau kính.')
  await sheet.getByRole('button', { name: 'Hoàn tất' }).click()
  await expect(sheet).toBeHidden()
  await expect(progress(page)).toContainText(new RegExp(`Hoàn tất · ${TIME}`))
  await expect(progress(page)).toContainText('Phiếu đã hoàn tất, không còn bước nào.')
  await expect(page.getByRole('button', { name: ACTIONS })).toHaveCount(0)
})

test('ADMIN thấy mọi phiếu; chỉ có Phân công/Hủy theo trạng thái (không Bắt đầu thay nhân viên); phân công rồi hủy kèm lý do', async ({ page }) => {
  await loginAs(page, 'ADMIN')
  await page.goto('/admin/tickets')
  await expect(rows(page)).toHaveCount(7)
  await expect(table(page).getByRole('columnheader', { name: 'Người phụ trách' })).toBeVisible()
  await expect(page.getByText('Danh sách chỉ gồm phiếu được giao cho bạn.')).toHaveCount(0)
  const names = async (ticketId: string) => (await row(page, ticketId).getByRole('button').allInnerTexts()).map(text => text.trim())
  expect(await names(T(1))).toEqual(['Phân công', 'Hủy phiếu'])
  expect(await names(T(2))).toEqual(['Đổi người phụ trách', 'Hủy phiếu'])
  expect(await names(T(3))).toEqual(['Hủy phiếu'])
  expect(await names(T(4))).toEqual([])
  await expect(table(page).getByRole('button', { name: /^(Bắt đầu|Hoàn tất)/ })).toHaveCount(0)
  await expect(row(page, T(1))).toContainText('Chưa phân công')

  await row(page, T(1)).getByRole('button', { name: /^Phân công/ }).click()
  const assign = page.getByRole('dialog', { name: 'Phân công phiếu' })
  await assign.getByRole('button', { name: 'Phân công' }).click()
  await expect(assign.getByLabel('Nhân viên phụ trách')).toHaveAttribute('aria-invalid', 'true')
  await assign.getByLabel('Nhân viên phụ trách').selectOption({ label: 'Nhân viên vận hành (staff@freshvend.test)' })
  await assign.getByRole('button', { name: 'Phân công' }).click()
  await expect(assign).toBeHidden()
  await expect(row(page, T(1))).toContainText('Đã phân công')
  await expect(row(page, T(1))).toContainText('Nhân viên vận hành')
  expect(await names(T(1))).toEqual(['Đổi người phụ trách', 'Hủy phiếu'])

  await row(page, T(1)).getByRole('link', { name: TITLES[1] }).click()
  await expect(progress(page)).toContainText(new RegExp(`Phân công · ${TIME}`))
  await expect(progress(page)).toContainText('Giao cho Nhân viên vận hành')
  await expect(progress(page)).toContainText('Chờ Nhân viên vận hành bắt đầu tại máy.')
  await expect(info(page).getByRole('link', { name: 'Mở cảnh báo gốc' })).toHaveAttribute('href', `/admin/alerts/${id('60000000', 2)}`)
  await page.getByRole('button', { name: 'Hủy phiếu' }).click()
  const cancel = page.getByRole('dialog', { name: 'Hủy phiếu công việc?' })
  await expect(cancel).toContainText('Phiếu không bị xóa')
  await cancel.getByRole('button', { name: 'Hủy phiếu' }).click()
  const reason = cancel.getByLabel('Lý do hủy')
  await expect(reason).toHaveAttribute('aria-invalid', 'true')
  await expect(reason).toBeFocused()
  await reason.fill('Máy đã có kết nối lại, không cần tới máy.')
  await cancel.getByRole('button', { name: 'Hủy phiếu' }).click()
  await expect(cancel).toBeHidden()
  await expect(info(page)).toContainText('Đã hủy')
  await expect(progress(page)).toContainText(new RegExp(`Hủy · ${TIME}`))
  await expect(progress(page)).toContainText('Lý do: Máy đã có kết nối lại, không cần tới máy.')
  await expect(page.getByRole('button', { name: ACTIONS })).toHaveCount(0)
})

test('ADMIN tạo phiếu từ danh sách (chỉ gửi trường có trong hợp đồng) và mở phiếu từ cảnh báo; STAFF không có nút mở phiếu', async ({ page }) => {
  await loginAs(page, 'ADMIN')
  await page.goto('/admin/tickets')
  await expect(rows(page)).toHaveCount(7)
  // The mock answers inside the page (no network request to inspect). It rejects any field outside
  // CreateWorkTicketRequest with a 400, so a successful create proves only contract fields were sent; the exact bodies
  // are unit-tested (createTicketBody in tests/tickets.test.mjs).
  const creates = () => page.evaluate(() => (window as unknown as { __fvMock: { requests: (prefix: string) => { method: string; path: string }[] } }).__fvMock
    .requests('/work-tickets').filter(entry => entry.method === 'POST' && entry.path === '/work-tickets').length)
  await page.getByRole('button', { name: 'Tạo phiếu' }).click()
  const sheet = page.getByRole('dialog', { name: 'Tạo phiếu công việc' })
  await sheet.getByRole('button', { name: 'Tạo phiếu' }).click()
  for (const [role, name] of [['combobox', 'Loại phiếu'], ['combobox', 'Máy'], ['textbox', 'Tiêu đề']] as const) {
    await expect(sheet.getByRole(role, { name, exact: true })).toHaveAttribute('aria-invalid', 'true')
  }
  await sheet.getByLabel('Loại phiếu').selectOption('MAINTENANCE')
  await sheet.getByRole('combobox', { name: 'Máy', exact: true }).selectOption(MACHINE_1)
  await sheet.getByLabel('Tiêu đề').fill('Kiểm tra cảm biến cửa')
  await sheet.getByLabel('Người phụ trách (không bắt buộc)').selectOption({ label: 'Lê Văn Nạp Hàng (kho.quan1@freshvend.test)' })
  await sheet.getByRole('button', { name: 'Tạo phiếu' }).click()
  await expect(sheet).toBeHidden()
  await expect(rows(page)).toHaveCount(8)
  await expect(rows(page).first()).toContainText('Kiểm tra cảm biến cửa')
  await expect(rows(page).first()).toContainText('Lê Văn Nạp Hàng')
  expect(await creates()).toBe(1)

  // "Mở phiếu" on an alert: machine and alert pre-filled, machine locked.
  await page.goto(`/admin/alerts/${LOW_STOCK_ALERT}`)
  await page.getByRole('button', { name: 'Mở phiếu' }).click()
  const fromAlert = page.getByRole('dialog', { name: 'Tạo phiếu công việc' })
  await expect(fromAlert).toContainText('Mở từ cảnh báo: Ngăn sắp hết hàng · máy DEV-MACHINE-01')
  await expect(fromAlert.getByRole('combobox', { name: 'Máy', exact: true })).toBeDisabled()
  await expect(fromAlert.getByRole('combobox', { name: 'Máy', exact: true })).toHaveValue(MACHINE_1)
  await expect(fromAlert.getByLabel('Loại phiếu')).toHaveValue('RESTOCK')
  await expect(fromAlert.getByLabel('Tiêu đề')).toHaveValue('Ngăn sắp hết hàng · máy DEV-MACHINE-01, ngăn A2')
  await fromAlert.getByLabel('Người phụ trách (không bắt buộc)').selectOption({ label: 'Nhân viên vận hành (staff@freshvend.test)' })
  await fromAlert.getByRole('button', { name: 'Tạo phiếu' }).click()
  await expect(fromAlert).toBeHidden()
  await expect(page.getByRole('status').filter({ hasText: 'Đã mở phiếu “Ngăn sắp hết hàng · máy DEV-MACHINE-01, ngăn A2”.' })).toBeVisible()
  await page.getByRole('link', { name: 'Xem phiếu' }).click()
  await expect(page).toHaveURL(/\/admin\/tickets\/[0-9a-f-]{36}$/)
  await expect(info(page)).toContainText('Đã phân công')
  await expect(info(page).getByRole('link', { name: 'Mở cảnh báo gốc' })).toHaveAttribute('href', `/admin/alerts/${LOW_STOCK_ALERT}`)
  // The server planned the restock lines (mock of the draft rule: B1 is the slot of DEV-MACHINE-01 below the threshold).
  await expect(progress(page)).toContainText('Phiếu nạp 1 ngăn (B1), tổng 8 hộp theo kế hoạch.')
  await expect(progress(page).getByRole('link', { name: 'Xem tiến độ nạp hàng' })).toBeVisible()
  const ticketUrl = new URL(page.url()).pathname

  // The staff it was given to opens the restock screen and sees the line.
  await switchInPlace(page, 'STAFF')
  await openTicketsFromNav(page)
  const fromAlertRow = rows(page).filter({ has: page.locator(`a[href="${ticketUrl}"]`) })
  await expect(fromAlertRow.getByRole('button')).toHaveCount(0)
  await fromAlertRow.getByRole('link', { name: /^Thực hiện nạp hàng: / }).click()
  await expect(page).toHaveURL(`${ticketUrl}/restock`)
  await expect(page.locator('#restock-step-title')).toHaveText('Bước 1/5: Mở cửa nạp')
  await expect(page.getByText(/chưa có dòng nạp hàng/)).toHaveCount(0)
  await page.getByRole('link', { name: 'Xem chi tiết phiếu' }).click()
  await expect(progress(page)).toContainText('Phiếu nạp 1 ngăn (B1), tổng 8 hộp theo kế hoạch.')
  await expect(progress(page).getByRole('link', { name: 'Thực hiện nạp hàng từng bước' })).toHaveAttribute('href', `${ticketUrl}/restock`)

  await switchTo(page, 'STAFF')
  await page.goto(`/admin/alerts/${LOW_STOCK_ALERT}`)
  await expect(page.getByRole('region', { name: 'Xử lý' })).toContainText('Phiếu công việc do quản trị viên mở.')
  await expect(page.getByRole('button', { name: 'Mở phiếu' })).toHaveCount(0)
})

test('409 đóng hộp thoại và giải thích; 400 đánh dấu ô; 403, chưa có API (404) và lỗi máy chủ đều có lời giải thích', async ({ page }) => {
  await loginAs(page, 'STAFF')
  await page.goto('/admin/tickets?scenario=409')
  await row(page, T(3)).getByRole('button', { name: /^Hoàn tất/ }).click()
  const conflictSheet = page.getByRole('dialog', { name: 'Hoàn tất phiếu' })
  await conflictSheet.getByRole('button', { name: 'Hoàn tất' }).click()
  await expect(conflictSheet).toBeHidden()
  await expect(page.getByText(/không còn ở trạng thái đang thực hiện.*Danh sách đã được tải lại/)).toBeVisible()
  await expect(page.getByText('Đã hoàn tất phiếu')).toHaveCount(0)
  await expect(row(page, T(3)).getByRole('button', { name: /^Hoàn tất/ })).toBeFocused()

  await page.goto(`/admin/tickets/${T(3)}?scenario=400`)
  await page.getByRole('button', { name: 'Hoàn tất' }).click()
  const sheet = page.getByRole('dialog', { name: 'Hoàn tất phiếu' })
  const note = sheet.getByLabel('Ghi chú (không bắt buộc)')
  await note.fill('Ghi chú thử')
  await sheet.getByRole('button', { name: 'Hoàn tất' }).click()
  await expect(note).toHaveAttribute('aria-invalid', 'true')
  await expect(note).toHaveAccessibleDescription(/Giá trị không hợp lệ \(mô phỏng\)\./)
  await expect(sheet.getByRole('alert')).toHaveText('Vui lòng kiểm tra các trường được đánh dấu.')

  await page.goto('/admin/tickets?scenario=403:tickets')
  await expect(page.getByRole('heading', { name: 'Không có quyền truy cập' })).toBeVisible()
  await expect(page.getByRole('group', { name: 'Bộ lọc' })).toHaveCount(0)

  await page.goto('/admin/tickets?scenario=missing:tickets')
  await expect(page.getByRole('status').filter({ hasText: 'Chưa có dữ liệu phiếu công việc: máy chủ chưa cung cấp chức năng phiếu.' })).toBeVisible()
  await expect(page.getByRole('table')).toHaveCount(0)
  await page.goto(`/admin/tickets/${T(2)}?scenario=missing:tickets`)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Chưa có dữ liệu phiếu công việc')

  await page.goto('/admin/tickets?scenario=error500:tickets')
  await expect(page.getByRole('button', { name: 'Thử lại' })).toBeVisible()
  await page.goto('/admin/tickets?scenario=empty')
  await expect(page.getByText('Bạn chưa được giao phiếu nào. Khi quản trị viên giao việc, phiếu sẽ hiện ở đây.')).toBeVisible()
  await page.goto('/admin/tickets?scenario=none&status=CANCELLED')
  await expect(page.getByText(/Không có phiếu khớp bộ lọc/)).toBeVisible()
  await page.getByRole('button', { name: /^Xóa bộ lọc/ }).first().click()
  await expect(rows(page)).toHaveCount(3)
})

for (const theme of THEMES) {
  test(`Ảnh + axe: tickets (STAFF), ticket-detail, tickets-admin (${theme})`, async ({ page }, testInfo) => {
    await useThemeChoice(page, theme)
    await loginAs(page, 'STAFF')
    await page.goto('/admin/tickets')
    await auditScreen(page, testInfo, 'tickets', theme, () => expect(rows(page)).toHaveCount(3))
    await page.goto(`/admin/tickets/${T(3)}`)
    await auditScreen(page, testInfo, 'ticket-detail', theme, () => expect(progress(page)).toBeVisible())
    await switchTo(page, 'ADMIN')
    await page.goto('/admin/tickets')
    await auditScreen(page, testInfo, 'tickets-admin', theme, () => expect(rows(page)).toHaveCount(7))
  })
}
