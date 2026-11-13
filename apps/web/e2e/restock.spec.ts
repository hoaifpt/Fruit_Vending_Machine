// O4 Thực hiện phiếu nạp hàng (issue FE 7.2) on the mock API (drafts of BE 4.4 and 4.2), on a phone (390 × 844).
// Done criterion: a STAFF account carries out a whole RESTOCK ticket on the phone (start, open the refill door, take out
// the expired bowls, load each line, close the door, reconcile with a note when short, complete) and the related
// LOW_STOCK alert is closed by the system. Also: the lock while the machine is not in MAINTENANCE, the capacity limit,
// 401/403/404/409/500, a backend without maintenance commands, screenshots + axe at each step.
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { auditScreen, checkNoHorizontalScroll, loginAs, THEMES, useThemeChoice, VIEWPORTS } from './support.ts'

const id = (prefix: string, n: number) => `${prefix}-0000-0000-0000-${String(n).padStart(12, '0')}`
const T2 = id('61000000', 2)
const LOW_STOCK_A2 = id('60000000', 5)
const RESTOCK = `/admin/tickets/${T2}/restock`
const PHONE = VIEWPORTS.filter(viewport => viewport.name === '390')
const COMMAND_WAIT = 20_000

test.use({ viewport: { width: 390, height: 844 } })

const stepHeading = (page: Page) => page.locator('#restock-step-title')
const activeTag = (page: Page) => page.evaluate(() => document.activeElement?.tagName ?? 'BODY')
const slotCard = (page: Page, name: RegExp | string) => page.getByRole('region', { name })
async function setMachineStatus(page: Page, status: 'ACTIVE' | 'MAINTENANCE') {
  await page.evaluate(value => (window as unknown as { __fvMock: { setMachineStatus: (machine: string, status: string) => void } }).__fvMock.setMachineStatus('DEV-MACHINE-01', value), status)
}

test('Tiêu chí xong: STAFF làm hết phiếu RESTOCK trên điện thoại; cảnh báo LOW_STOCK của ngăn đã nạp đủ tự đóng', async ({ page }, testInfo) => {
  test.setTimeout(120_000)
  await loginAs(page, 'STAFF')
  await page.goto(`/admin/tickets/${T2}`)
  await page.getByRole('link', { name: 'Thực hiện nạp hàng từng bước' }).click()
  await expect(page).toHaveURL(RESTOCK)
  await expect(page.getByRole('group', { name: 'Tiến độ nạp hàng' }).locator('[aria-current="step"]')).toContainText('Mở cửa nạp')
  await expect(stepHeading(page)).toHaveText('Bước 1/5: Mở cửa nạp')

  // (1) Start, then the door: locked while the machine is ACTIVE, with the reason and who can fix it.
  await page.getByRole('button', { name: 'Bắt đầu phiếu' }).focus()
  await page.keyboard.press('Enter')
  await expect(page.getByText(/^Đã bắt đầu lúc \d{2}\/\d{2}\/\d{4} \d{2}:\d{2}\.$/)).toBeVisible()
  const lock = page.locator('[data-lock="status"]')
  // The start button is gone: focus moves to what comes next (here the reason the door cannot be opened yet).
  await expect(lock).toBeFocused()
  expect(await activeTag(page)).not.toBe('BODY')
  await expect(lock).toContainText('Lệnh bảo trì chỉ gửi được khi máy ở trạng thái Bảo trì')
  await expect(lock).toContainText('Nhờ Quản trị viên chuyển máy sang Bảo trì')
  // The locked button stays focusable (aria-disabled); using it moves focus to the reason.
  await page.getByRole('button', { name: 'Mở cửa nạp hàng' }).focus()
  await page.keyboard.press('Enter')
  await expect(lock).toBeFocused()
  await auditScreen(page, testInfo, 'restock-open-locked', 'light', () => expect(lock).toBeVisible(), PHONE)
  // An administrator elsewhere puts the machine in MAINTENANCE; the staff checks again.
  await setMachineStatus(page, 'MAINTENANCE')
  await page.getByRole('button', { name: 'Kiểm tra lại trạng thái máy' }).click()
  await expect(lock).toHaveCount(0)
  await page.getByRole('button', { name: 'Mở cửa nạp hàng' }).focus()
  await page.keyboard.press('Enter')
  const waiting = page.getByRole('status').filter({ hasText: 'Đang chờ máy: “Mở cửa nạp hàng”' })
  await expect(waiting).toBeVisible()
  // The button became "Đang chờ máy…": focus follows it instead of falling back to the page.
  await expect(waiting).toBeFocused()
  expect(await activeTag(page)).not.toBe('BODY')

  // (2) The door is open: B1 has two expired bowls to take out.
  await expect(stepHeading(page)).toHaveText('Bước 2/5: Rút hộp hỏng', { timeout: COMMAND_WAIT })
  await expect(stepHeading(page)).toBeFocused()
  const b1 = slotCard(page, 'Ngăn B1')
  await expect(b1).toContainText('2 hộp hết hạn cần rút.')
  await auditScreen(page, testInfo, 'restock-remove', 'light', () => expect(b1).toBeVisible(), PHONE)
  await b1.getByRole('button', { name: 'Đã rút hộp này: hộp 1 hết hạn ở ngăn B1' }).click()
  await expect(b1).toContainText('1 hộp hết hạn cần rút.')
  await b1.getByRole('button', { name: 'Đã rút hộp này: hộp 1 hết hạn ở ngăn B1' }).click()
  await expect(b1).toContainText('Không còn hộp hết hạn. Đã rút 2 hộp trong phiếu này.')
  await page.getByRole('button', { name: 'Tiếp tục: Nạp theo dòng' }).click()

  // (3) Load each line: the count defaults to the plan within the free places; more than fits is refused as typed.
  await expect(stepHeading(page)).toHaveText('Bước 3/5: Nạp theo dòng')
  const a2 = slotCard(page, 'Ngăn A2 · Watermelon bowl')
  await expect(a2.getByLabel('Số hộp nạp lần này')).toHaveValue('4')
  await a2.getByRole('button', { name: 'Nạp 4 hộp vào ngăn A2' }).click()
  await expect(a2).toContainText('Đã nạp đủ')
  await expect(a2.getByRole('heading', { name: 'Ngăn A2 · Watermelon bowl' })).toBeFocused()
  const b1Load = slotCard(page, 'Ngăn B1 · Mixed fruit bowl')
  const count = b1Load.getByLabel('Số hộp nạp lần này')
  await expect(count).toHaveValue('6')
  await count.fill('11')
  await expect(count).toHaveAccessibleDescription(/Ngăn B1 chỉ còn trống 10 chỗ/)
  await count.fill('5')
  await auditScreen(page, testInfo, 'restock-load', 'light', () => expect(b1Load).toBeVisible(), PHONE)
  await b1Load.getByRole('button', { name: 'Nạp 5 hộp vào ngăn B1' }).click()
  await expect(b1Load).toContainText('Còn 1 hộp')
  await expect(page.getByText('Còn 1 hộp chưa nạp theo kế hoạch.')).toBeVisible()
  await page.getByRole('button', { name: 'Tiếp tục: Đóng cửa nạp' }).click()

  // (4) Close the door.
  await expect(stepHeading(page)).toHaveText('Bước 4/5: Đóng cửa nạp')
  await page.getByRole('button', { name: 'Đóng cửa nạp hàng' }).click()

  // (5) Reconcile: B1 is one short, so the note is required.
  await expect(stepHeading(page)).toHaveText('Bước 5/5: Đối chiếu', { timeout: COMMAND_WAIT })
  const table = page.getByRole('table', { name: 'Đối chiếu kế hoạch và thực tế theo ngăn' })
  await expect(table.getByRole('row', { name: /^A2/ })).toContainText('Khớp kế hoạch')
  await expect(table.getByRole('row', { name: /^B1/ })).toContainText('Thiếu 1 hộp')
  await auditScreen(page, testInfo, 'restock-reconcile', 'light', () => expect(table).toBeVisible(), PHONE)
  await page.getByRole('button', { name: 'Hoàn tất phiếu' }).click()
  const note = page.getByLabel('Ghi chú đối chiếu')
  await expect(note).toBeFocused()
  await expect(note).toHaveAttribute('aria-invalid', 'true')
  await expect(note).toHaveAccessibleDescription(/Số hộp đã nạp khác kế hoạch/)
  await note.fill('Lô trộn chỉ còn 5 hộp mang theo.')
  await page.getByRole('button', { name: 'Hoàn tất phiếu' }).click()

  // Done: the server closed the LOW_STOCK alert of A2 (loaded in full) and says so, with a link.
  await expect(stepHeading(page)).toHaveText('Phiếu đã hoàn tất')
  await expect(stepHeading(page)).toBeFocused()
  const result = page.getByRole('status').filter({ hasText: 'Đã tự đóng 1 cảnh báo Ngăn sắp hết hàng của máy này.' })
  await expect(result).toBeVisible()
  await expect(page.getByText('Ghi chú: Lô trộn chỉ còn 5 hộp mang theo.')).toBeVisible()
  // The machine is still in MAINTENANCE: a reminder to switch it back (a STAFF account asks an administrator).
  await expect(page.locator('p').filter({ hasText: 'Máy DEV-MACHINE-01 vẫn ở trạng thái Bảo trì' })).toContainText('nhờ Quản trị viên đổi trạng thái máy')
  await expect(page.getByRole('link', { name: /Mở thẻ Tổng quan của máy/ })).toHaveCount(0)
  await auditScreen(page, testInfo, 'restock-done', 'light', () => expect(result).toBeVisible(), PHONE)
  await expect(page.getByRole('button', { name: /xóa|xoá|delete/i })).toHaveCount(0)
  await result.getByRole('link', { name: 'Ngăn sắp hết hàng · ngăn A2 (đã đóng)' }).click()
  await expect(page).toHaveURL(`/admin/alerts/${LOW_STOCK_A2}`)
  const handling = page.getByRole('region', { name: 'Xử lý' })
  await expect(handling).toContainText('Hệ thống')
  await expect(handling).toContainText('Tự đóng khi hoàn tất phiếu nạp hàng “Nạp thêm hộp ngăn A2 · máy DEV-MACHINE-01”: đã nạp 4 hộp vào ngăn A2.')
  await expect(page.getByRole('region', { name: 'Thông tin cảnh báo' })).toContainText('Đã xử lý')
})

test('Trạng thái lỗi: 409 khi bắt đầu, 403, 401, không tìm thấy, chưa có API, lỗi máy chủ, phiếu không phải nạp hàng, máy chủ chưa có lệnh bảo trì', async ({ page }) => {
  await loginAs(page, 'STAFF')
  await page.goto(`${RESTOCK}?scenario=409`)
  await page.getByRole('button', { name: 'Bắt đầu phiếu' }).click()
  await expect(page.getByRole('alert').filter({ hasText: 'không còn ở trạng thái chờ bắt đầu' })).toContainText('Trang đã được tải lại')

  await page.goto(`${RESTOCK}?scenario=403:tickets`)
  await expect(page.getByRole('heading', { name: 'Không có quyền truy cập' })).toBeVisible()
  await page.goto(`${RESTOCK}?scenario=missing:tickets`)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Chưa có dữ liệu phiếu công việc')
  await page.goto(`${RESTOCK}?scenario=error500:tickets`)
  await expect(page.getByRole('button', { name: 'Thử lại' })).toBeVisible()
  await page.goto(`/admin/tickets/${id('61000000', 5)}/restock?scenario=none`)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Không tìm thấy phiếu')
  await expect(page.getByText(/phiếu không giao cho bạn/)).toBeVisible()
  await page.goto(`/admin/tickets/${id('61000000', 4)}/restock`)
  await expect(page.getByRole('status').filter({ hasText: 'Đây là phiếu bảo trì, không phải phiếu nạp hàng.' })).toBeVisible()

  // A backend without maintenance commands (BE 4.2 missing): the door is handled by hand and the restock goes on.
  await page.goto(`${RESTOCK}?scenario=missing:maintenance-commands`)
  await page.getByRole('button', { name: 'Bắt đầu phiếu' }).click()
  await expect(stepHeading(page)).toHaveText('Bước 2/5: Rút hộp hỏng')

  // The machine's command history cannot be read (500, 403): no guessed step, an explanation and a retry.
  await page.goto(`${RESTOCK}?scenario=error500:maintenance-commands`)
  await page.getByRole('button', { name: 'Bắt đầu phiếu' }).click()
  const unknown = page.getByRole('heading', { name: 'Chưa biết phiếu đang ở bước nào' })
  await expect(unknown).toBeVisible()
  await expect(unknown).toBeFocused()
  await expect(page.getByRole('button', { name: 'Thử lại' })).toBeVisible()
  await expect(page.getByText('Đang đọc lịch sử lệnh của máy để biết đang ở bước nào…')).toHaveCount(0)
  await expect(page.getByText(/chưa có lệnh mở\/đóng nào thành công|Cửa nạp chưa được mở cho phiếu này/)).toHaveCount(0)
  await page.goto(`${RESTOCK}?scenario=403:maintenance-commands`)
  await page.getByRole('button', { name: 'Bắt đầu phiếu' }).click()
  await expect(page.getByRole('heading', { name: 'Chưa biết phiếu đang ở bước nào' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Không có quyền truy cập' })).toBeVisible()

  await page.goto(`${RESTOCK}?scenario=401:tickets`)
  await expect(page).toHaveURL(/\/login\?next=/)
})

for (const theme of THEMES) {
  test(`Ảnh + axe: restock bước 1 ở 1440/768/390 (${theme})`, async ({ page }, testInfo) => {
    await useThemeChoice(page, theme)
    await loginAs(page, 'STAFF')
    await page.goto(RESTOCK)
    await auditScreen(page, testInfo, 'restock', theme, () => expect(stepHeading(page)).toHaveText('Bước 1/5: Mở cửa nạp'))
    await checkNoHorizontalScroll(page, 'restock', theme, PHONE[0])
  })
}
