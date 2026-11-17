// O4 Thực hiện phiếu nạp hàng (issue FE 7.2) on the mock of the real API (backend #64/#66/#68), on a phone (390 × 844).
// Done criterion: a STAFF account carries out a whole RESTOCK work order on the phone (start, take the expired bowls of
// B1 out with a command linked to the work order, open B1's refill gate, load each line, close the gate, give a reason for
// the line loaded short, complete) and the linked LOW_STOCK alert is closed. Also: the lock while the machine is offline,
// the capacity limit, 401/403/404/409/500, screenshots + axe at each step.
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
async function stopMachine(page: Page) {
  await page.evaluate(() => (window as unknown as { __fvMock: { stopHeartbeat: (machine: string) => void } }).__fvMock.stopHeartbeat('DEV-MACHINE-01'))
}
async function resumeMachine(page: Page) {
  await page.evaluate(() => (window as unknown as { __fvMock: { resumeHeartbeat: (machine: string) => void } }).__fvMock.resumeHeartbeat('DEV-MACHINE-01'))
}

test('Tiêu chí xong: STAFF làm hết phiếu RESTOCK trên điện thoại; cảnh báo LOW_STOCK liên kết được đóng', async ({ page }, testInfo) => {
  test.setTimeout(120_000)
  await loginAs(page, 'STAFF')
  await page.goto(`/admin/tickets/${T2}`)
  await page.getByRole('link', { name: 'Thực hiện nạp hàng từng bước' }).click()
  await expect(page).toHaveURL(RESTOCK)
  await expect(page.getByRole('group', { name: 'Tiến độ nạp hàng' }).locator('[aria-current="step"]')).toContainText('Bắt đầu')
  await expect(stepHeading(page)).toHaveText('Bước 1/5: Bắt đầu')
  await expect(page.getByRole('list', { name: 'Kế hoạch nạp' })).toContainText('Ngăn B1 · Mixed fruit bowl: nạp 6 hộp')

  // (1) Start: the machine goes MAINTENANCE and the step moves to the old bowls.
  await page.getByRole('button', { name: 'Bắt đầu phiếu' }).focus()
  await page.keyboard.press('Enter')
  await expect(stepHeading(page)).toHaveText('Bước 2/5: Rút hộp cũ')
  await expect(stepHeading(page)).toBeFocused()

  // (2) The machine goes silent: commands are locked with the reason; back online, B1 is emptied (2 expired bowls).
  await stopMachine(page)
  const b1 = slotCard(page, 'Ngăn B1')
  await expect(b1).toContainText('2 hộp hết hạn hoặc nhả lỗi cần rút')
  await auditScreen(page, testInfo, 'restock-remove', 'light', () => expect(b1).toBeVisible(), PHONE)
  await resumeMachine(page)
  await b1.getByRole('button', { name: 'Xả cả ngăn B1' }).click()
  const confirm = page.getByRole('alertdialog', { name: 'Xả cả ngăn B1?' })
  await expect(confirm).toContainText('Hộp hết hạn')
  await confirm.getByRole('button', { name: 'Xả cả ngăn' }).click()
  const waiting = page.getByRole('status').filter({ hasText: 'Đang chờ máy: “Xả cả ngăn” ngăn B1' })
  await expect(waiting).toBeVisible()
  await expect(page.getByText('Đã rút 2 hộp trong phiếu này (Hộp hết hạn: 2).')).toBeVisible({ timeout: COMMAND_WAIT })
  expect(await activeTag(page)).not.toBe('BODY')
  await page.getByRole('button', { name: 'Tiếp tục: Nạp theo dòng' }).click()

  // (3) Open B1's refill gate, load each line: the count defaults to the plan within the free places.
  await expect(stepHeading(page)).toHaveText('Bước 3/5: Nạp theo dòng')
  const b1Load = slotCard(page, 'Ngăn B1 · Mixed fruit bowl')
  await b1Load.getByRole('button', { name: 'Mở cổng nạp ngăn B1' }).click()
  await expect(b1Load).toContainText('Cổng nạp đang mở', { timeout: COMMAND_WAIT })
  const count = b1Load.getByLabel('Số hộp nạp lần này')
  await expect(count).toHaveValue('6')
  await count.fill('11')
  await expect(count).toHaveAccessibleDescription(/Ngăn B1 chỉ còn trống 10 chỗ/)
  await count.fill('6')
  await auditScreen(page, testInfo, 'restock-load', 'light', () => expect(b1Load).toBeVisible(), PHONE)
  await b1Load.getByRole('button', { name: 'Nạp 6 hộp vào ngăn B1' }).click()
  await expect(b1Load).toContainText('Đã nạp đủ')
  const a2 = slotCard(page, 'Ngăn A2 · Watermelon bowl')
  await a2.getByLabel('Số hộp nạp lần này').fill('3')
  await a2.getByRole('button', { name: 'Nạp 3 hộp vào ngăn A2' }).click()
  await expect(a2).toContainText('Còn 1 hộp')
  await page.getByRole('button', { name: 'Tiếp tục: Đóng cổng nạp' }).click()

  // (4) Close the open gate.
  await expect(stepHeading(page)).toHaveText('Bước 4/5: Đóng cổng nạp')
  await page.getByRole('button', { name: 'Đóng cổng nạp ngăn B1' }).click()
  await expect(page.getByText('Mọi cổng nạp của máy đã đóng.')).toBeVisible({ timeout: COMMAND_WAIT })
  await page.getByRole('button', { name: 'Tiếp tục: Đối chiếu' }).click()

  // (5) Reconcile: A2 is one short, so its reason and the result are required.
  await expect(stepHeading(page)).toHaveText('Bước 5/5: Đối chiếu')
  const table = page.getByRole('table', { name: 'Đối chiếu kế hoạch và thực tế theo ngăn' })
  await expect(table.getByRole('row', { name: /^B1/ })).toContainText('Khớp kế hoạch')
  await expect(table.getByRole('row', { name: /^A2/ })).toContainText('Thiếu 1 hộp')
  await auditScreen(page, testInfo, 'restock-reconcile', 'light', () => expect(table).toBeVisible(), PHONE)
  await page.getByRole('button', { name: 'Hoàn tất phiếu' }).click()
  const reason = page.getByLabel(/Lý do lệch ngăn A2/)
  await expect(reason).toHaveAttribute('aria-invalid', 'true')
  await reason.fill('Lô dưa hấu chỉ mang theo 3 hộp.')
  await page.getByLabel('Kết quả nạp hàng').fill('Đã xả B1 và nạp đủ; A2 thiếu 1.')
  await page.getByRole('button', { name: 'Hoàn tất phiếu' }).click()

  // Done: the linked LOW_STOCK alert of A2 is closed, the reason is kept, the machine stays in MAINTENANCE.
  await expect(stepHeading(page)).toHaveText('Phiếu đã hoàn tất')
  const linked = page.getByRole('status').filter({ hasText: 'Cảnh báo liên kết với phiếu' })
  await expect(linked).toContainText('(đã đóng)')
  await expect(page.getByText('Lý do: Lô dưa hấu chỉ mang theo 3 hộp.')).toBeVisible()
  await expect(page.locator('p').filter({ hasText: 'Máy DEV-MACHINE-01 vẫn ở trạng thái Bảo trì' })).toContainText('nhờ Quản trị viên đổi trạng thái máy')
  await auditScreen(page, testInfo, 'restock-done', 'light', () => expect(linked).toBeVisible(), PHONE)
  await expect(page.getByRole('button', { name: /xóa|xoá|delete/i })).toHaveCount(0)
  await linked.getByRole('link').first().click()
  await expect(page).toHaveURL(`/admin/alerts/${LOW_STOCK_A2}`)
})

test('Trạng thái lỗi: 409 khi bắt đầu, 403, 401, 404 từ máy chủ, không tìm thấy, lỗi máy chủ, phiếu không phải nạp hàng', async ({ page }) => {
  await loginAs(page, 'STAFF')
  await page.goto(`${RESTOCK}?scenario=409`)
  await page.getByRole('button', { name: 'Bắt đầu phiếu' }).click()
  await expect(page.getByRole('alert').filter({ hasText: 'không còn ở trạng thái chờ bắt đầu' })).toContainText('Trang đã được tải lại')

  await page.goto(`${RESTOCK}?scenario=403:tickets`)
  await expect(page.getByRole('heading', { name: 'Không có quyền truy cập' })).toBeVisible()
  // The real API has the work orders: a 404 means the work order is gone or not the caller's (no "not shipped yet").
  await page.goto(`${RESTOCK}?scenario=missing:tickets`)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Không tìm thấy phiếu')
  await expect(page.getByText(/phiếu không giao cho bạn/)).toBeVisible()
  await page.goto(`${RESTOCK}?scenario=error500:tickets`)
  await expect(page.getByRole('button', { name: 'Thử lại' })).toBeVisible()
  await page.goto(`/admin/tickets/${id('61000000', 5)}/restock?scenario=none`)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Không tìm thấy phiếu')
  await expect(page.getByText(/phiếu không giao cho bạn/)).toBeVisible()
  await page.goto(`/admin/tickets/${id('61000000', 4)}/restock`)
  await expect(page.getByRole('status').filter({ hasText: 'Đây không phải phiếu nạp hàng' })).toBeVisible()

  await page.goto(`${RESTOCK}?scenario=401:tickets`)
  await expect(page).toHaveURL(/\/login\?next=/)
})

test('ADMIN lập kế hoạch: thêm, sửa và bỏ dòng chưa nạp; dòng trùng bị từ chối', async ({ page }) => {
  await loginAs(page, 'ADMIN')
  await page.goto(RESTOCK)
  const plan = page.getByRole('region', { name: /Kế hoạch nạp/ })
  await plan.getByRole('button', { name: 'Sửa kế hoạch' }).click()
  await plan.getByRole('button', { name: 'Thêm dòng nạp' }).click()
  // "Bỏ dòng ngăn … khỏi kế hoạch" buttons also mention "ngăn": pick the line form's slot select by role.
  await plan.getByRole('combobox', { name: /^Ngăn/ }).selectOption({ label: 'Ngăn A2 (sức chứa 10)' })
  await plan.getByRole('combobox', { name: /^Sản phẩm/ }).selectOption({ label: 'Watermelon bowl (DEV-WATERMELON)' })
  await plan.getByLabel('Số hộp dự kiến').last().fill('2')
  await plan.getByRole('button', { name: 'Thêm dòng' }).click()
  await expect(plan.getByRole('alert')).toContainText('đã có dòng cho sản phẩm đó')
  await plan.getByRole('button', { name: 'Bỏ dòng ngăn B1 khỏi kế hoạch' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Bỏ khỏi kế hoạch' }).click()
  await expect(plan.getByRole('heading')).toHaveText('Kế hoạch nạp (1 dòng)')
})

for (const theme of THEMES) {
  test(`Ảnh + axe: restock bước 1 ở 1440/768/390 (${theme})`, async ({ page }, testInfo) => {
    await useThemeChoice(page, theme)
    await loginAs(page, 'STAFF')
    await page.goto(RESTOCK)
    await auditScreen(page, testInfo, 'restock', theme, () => expect(stepHeading(page)).toHaveText('Bước 1/5: Bắt đầu'))
    await checkNoHorizontalScroll(page, 'restock', theme, PHONE[0])
  })
}
