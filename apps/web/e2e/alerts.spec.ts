// O2 Cảnh báo + chuông thông báo (issue FE 6.3) on the mock API (draft of BE 3.6). Done criterion: a new alert shows on
// the bell within one poll (Playwright's fake clock jumps one 30 s interval; the mock control window.__fvMock.raiseAlert
// makes a machine raise it in between), and acknowledging / closing records who did it and when. Also: STAFF and ADMIN
// by permission, 409 and 400 in the dialogs, missing endpoint (bell hidden, screen explains), 403, keyboard on the bell,
// screenshots + axe at 1440/768/390 light and dark.
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { auditScreen, loginAs, THEMES, useThemeChoice, VIEWPORTS } from './support.ts'

const id = (prefix: string, n: number) => `${prefix}-0000-0000-0000-${String(n).padStart(12, '0')}`
const SEEDED = id('60000000', 1)
const OFFLINE = id('60000000', 2)
const DISPENSE_FAILED = id('60000000', 4)
const MACHINE_1 = id('20000000', 1)

const bell = (page: Page) => page.getByRole('banner').getByRole('button', { name: /^Cảnh báo/ })
const popover = (page: Page) => page.getByRole('dialog', { name: 'Cảnh báo đang mở' })
const rows = (page: Page) => page.getByRole('table', { name: 'Danh sách cảnh báo' }).locator('tbody tr')
const row = (page: Page, alertId: string) => rows(page).filter({ has: page.locator(`a[href="/admin/alerts/${alertId}"]`) })
/** dd/mm/yyyy hh:mm, the only time format of the portal. */
const TIME = String.raw`\d{2}/\d{2}/\d{4} \d{2}:\d{2}`

async function raiseAlert(page: Page) {
  return page.evaluate(() => (window as unknown as { __fvMock: { raiseAlert: (input: object) => { id: string } } }).__fvMock
    .raiseAlert({ type: 'MACHINE_OFFLINE', severity: 'CRITICAL', title: 'Machine offline', machineId: '20000000-0000-0000-0000-000000000001' }).id)
}

test('Tiêu chí xong: cảnh báo mới hiện trên chuông sau đúng một lần polling (30 giây)', async ({ page }) => {
  await page.clock.install()
  await loginAs(page, 'STAFF')
  await page.goto('/admin/machines')
  await expect(bell(page)).toHaveAccessibleName('Cảnh báo: 3 đang mở, 1 nghiêm trọng')
  const live = page.getByRole('banner').locator('[aria-live="polite"]')
  await expect(live).toHaveText('')

  const newId = await raiseAlert(page)
  // Not yet: the bell only learns about it at the next poll.
  await page.clock.fastForward(29_000)
  await expect(bell(page)).toHaveAccessibleName('Cảnh báo: 3 đang mở, 1 nghiêm trọng')
  await page.clock.fastForward(1_000)
  await expect(bell(page)).toHaveAccessibleName('Cảnh báo: 4 đang mở, 2 nghiêm trọng')
  await expect(live).toHaveText('Cảnh báo mới: Máy mất kết nối tại máy DEV-MACHINE-01.')

  await bell(page).click()
  const panel = popover(page)
  await expect(panel).toBeVisible()
  const first = panel.getByRole('listitem').first()
  await expect(first).toContainText('Mới')
  await expect(first).toContainText('Nghiêm trọng')
  await expect(first.getByRole('link', { name: 'Máy mất kết nối: Machine offline' })).toHaveAttribute('href', `/admin/alerts/${newId}`)
  await expect(first.getByRole('link', { name: /^Máy DEV-MACHINE-01/ })).toHaveAttribute('href', `/admin/machines/${MACHINE_1}`)
  await first.getByRole('link', { name: 'Máy mất kết nối: Machine offline' }).click()
  await expect(page).toHaveURL(`/admin/alerts/${newId}`)
  await expect(panel).toBeHidden()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Máy mất kết nối · máy DEV-MACHINE-01')
  // Backend text is labelled as such.
  await expect(page.getByText('Tiêu đề từ máy: Machine offline')).toBeVisible()
  await expect(page.getByRole('region', { name: 'Thông tin cảnh báo' }).getByRole('term').filter({ hasText: 'Nội dung từ máy' })).toBeVisible()
})

test('Chuông dùng được bằng bàn phím: Enter mở, Esc đóng và trả focus; link "Xem tất cả" tới danh sách đang mở', async ({ page }) => {
  await loginAs(page, 'ADMIN')
  await page.goto('/admin/orders')
  await expect(bell(page)).toHaveAccessibleName('Cảnh báo: 3 đang mở, 1 nghiêm trọng')
  await bell(page).focus()
  await page.keyboard.press('Enter')
  await expect(popover(page)).toBeVisible()
  await expect(popover(page).getByRole('listitem')).toHaveCount(3)
  await page.keyboard.press('Escape')
  await expect(popover(page)).toBeHidden()
  await expect(bell(page)).toBeFocused()
  await page.keyboard.press('Enter')
  await popover(page).getByRole('link', { name: 'Mở danh sách cảnh báo' }).click()
  await expect(page).toHaveURL('/admin/alerts?status=OPEN')
  await expect(rows(page)).toHaveCount(3)
  await expect(page.getByRole('button', { name: 'Đang mở, chưa ai tiếp nhận' })).toHaveAttribute('aria-pressed', 'true')
})

test('Tiêu chí xong: STAFF xác nhận rồi đóng cảnh báo, ghi tên người và thời điểm; chuông giảm ngay', async ({ page }) => {
  await loginAs(page, 'STAFF')
  await page.goto('/admin/alerts')
  await expect(rows(page)).toHaveCount(7)
  await expect(bell(page)).toHaveAccessibleName('Cảnh báo: 3 đang mở, 1 nghiêm trọng')
  const seeded = row(page, SEEDED)
  await expect(seeded).toContainText('Chưa có người tiếp nhận')
  await seeded.getByRole('button', { name: /^Xác nhận cảnh báo Nhiệt độ cao/ }).click()
  const confirm = page.getByRole('alertdialog', { name: 'Xác nhận đã tiếp nhận cảnh báo?' })
  await expect(confirm).toContainText('ghi tên bạn và thời điểm')
  await confirm.getByRole('button', { name: 'Xác nhận' }).click()
  await expect(confirm).toBeHidden()
  await expect(seeded).toContainText('Đã tiếp nhận')
  await expect(seeded).toContainText(new RegExp(`Xác nhận: Nhân viên vận hành, ${TIME}`))
  await expect(seeded.getByRole('button', { name: /^Xác nhận cảnh báo/ })).toHaveCount(0)
  await expect(bell(page)).toHaveAccessibleName('Cảnh báo: 2 đang mở, 1 nghiêm trọng')

  await seeded.getByRole('button', { name: /^Đóng cảnh báo Nhiệt độ cao/ }).click()
  const sheet = page.getByRole('dialog', { name: 'Đóng cảnh báo' })
  await sheet.getByLabel('Ghi chú xử lý (không bắt buộc)').fill('Đã đóng chặt cửa máy, nhiệt độ về 5 °C.')
  await sheet.getByRole('button', { name: 'Đóng cảnh báo' }).click()
  await expect(sheet).toBeHidden()
  await expect(seeded).toContainText('Đã xử lý')
  await expect(seeded).toContainText(new RegExp(`Đóng: Nhân viên vận hành, ${TIME}`))
  await expect(seeded).toContainText('Đã đóng')

  // Detail: who and when for both steps, the note as text, no actions left, no delete anywhere.
  await seeded.getByRole('link', { name: /^Nhiệt độ cao/ }).click()
  const handling = page.getByRole('region', { name: 'Xử lý' })
  await expect(handling).toContainText(new RegExp(`Xác nhận: Nhân viên vận hành, ${TIME}`))
  await expect(handling).toContainText(new RegExp(`Đóng: Nhân viên vận hành, ${TIME}`))
  await expect(handling).toContainText('Ghi chú: Đã đóng chặt cửa máy, nhiệt độ về 5 °C.')
  await expect(page.getByRole('button', { name: /Đóng cảnh báo|Xác nhận|Mở phiếu/ })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /xóa|xoá|delete/i })).toHaveCount(0)
})

test('ADMIN đóng thẳng cảnh báo đang mở từ trang chi tiết; "Mở phiếu" vô hiệu kèm lý do (FM7); link máy, đơn', async ({ page }) => {
  await loginAs(page, 'ADMIN')
  await page.goto(`/admin/alerts/${OFFLINE}`)
  const ticket = page.getByRole('button', { name: 'Mở phiếu' })
  await expect(ticket).toHaveAttribute('aria-disabled', 'true')
  await expect(ticket).toHaveAccessibleDescription(/phiếu sẽ có trong đợt cập nhật Phiếu công việc \(FM7\)/)
  // Focusable (aria-disabled), so keyboard users reach the reason; pressing it does nothing.
  await ticket.focus()
  await expect(ticket).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(`/admin/alerts/${OFFLINE}`)
  await page.getByRole('button', { name: 'Đóng cảnh báo' }).click()
  await page.getByRole('dialog', { name: 'Đóng cảnh báo' }).getByRole('button', { name: 'Đóng cảnh báo' }).click()
  const handling = page.getByRole('region', { name: 'Xử lý' })
  await expect(handling).toContainText(new RegExp(`Đóng: Quản trị viên, ${TIME}`))
  await expect(handling).not.toContainText('Xác nhận:')
  await expect(page.getByRole('region', { name: 'Thông tin cảnh báo' })).toContainText('Đã xử lý')

  await page.goto(`/admin/alerts/${DISPENSE_FAILED}`)
  const info = page.getByRole('region', { name: 'Thông tin cảnh báo' })
  await expect(page.getByRole('region', { name: 'Xử lý' })).toContainText('Ghi chú: Đã kiểm tra ngăn tại máy và hoàn tiền thủ công cho khách.')
  await info.getByRole('link', { name: /^Đơn ORD-/ }).click()
  await expect(page).toHaveURL(`/admin/orders/${id('93000000', 1)}`)
})

test('409: hộp xác nhận đóng lại, màn tải lại, toast giải thích bằng tiếng Việt (câu riêng cho trang chi tiết); 400 đánh dấu ô ghi chú', async ({ page }) => {
  await loginAs(page, 'STAFF')
  await page.goto('/admin/alerts?scenario=409')
  await row(page, SEEDED).getByRole('button', { name: /^Xác nhận cảnh báo/ }).click()
  const confirm = page.getByRole('alertdialog', { name: 'Xác nhận đã tiếp nhận cảnh báo?' })
  await confirm.getByRole('button', { name: 'Xác nhận' }).click()
  // Retrying cannot help: the dialog closes instead of offering the button again.
  await expect(confirm).toBeHidden()
  await expect(page.getByText(/vừa được người khác xác nhận hoặc đóng nên không xác nhận được nữa\. Danh sách đã được tải lại/)).toBeVisible()
  await expect(page.getByText('Đã xác nhận cảnh báo')).toHaveCount(0)
  // Focus is back on the button that opened the dialog (the row is unchanged here: the 409 is simulated).
  await expect(row(page, SEEDED).getByRole('button', { name: /^Xác nhận cảnh báo/ })).toBeFocused()

  await page.goto(`/admin/alerts/${SEEDED}?scenario=409`)
  await page.getByRole('button', { name: 'Đóng cảnh báo' }).click()
  const detailSheet = page.getByRole('dialog', { name: 'Đóng cảnh báo' })
  await detailSheet.getByRole('button', { name: 'Đóng cảnh báo' }).click()
  await expect(detailSheet).toBeHidden()
  const toastText = page.getByText(/đã được đóng trước đó nên không đóng lại được\. Trang đã được tải lại; xem người đã đóng ở mục Xử lý\./)
  await expect(toastText).toBeVisible()
  await expect(toastText).not.toContainText('Danh sách')

  await page.goto('/admin/alerts?scenario=400')
  await row(page, SEEDED).getByRole('button', { name: /^Đóng cảnh báo/ }).click()
  const sheet = page.getByRole('dialog', { name: 'Đóng cảnh báo' })
  const note = sheet.getByLabel('Ghi chú xử lý (không bắt buộc)')
  await note.fill('Ghi chú thử')
  await sheet.getByRole('button', { name: 'Đóng cảnh báo' }).click()
  await expect(note).toHaveAttribute('aria-invalid', 'true')
  await expect(note).toHaveAccessibleDescription(/Giá trị không hợp lệ \(mô phỏng\)\./)
  await expect(sheet.getByRole('alert')).toHaveText('Vui lòng kiểm tra các trường được đánh dấu.')
})

test('Lọc trên URL: lọc nhanh nghiêm trọng, loại, máy; link ngăn tới sơ đồ tồn kho; trạng thái rỗng và xóa bộ lọc', async ({ page }) => {
  await loginAs(page, 'ADMIN')
  await page.goto('/admin/alerts')
  await page.getByRole('button', { name: 'Nghiêm trọng đang mở' }).click()
  await expect(page).toHaveURL(/status=OPEN&severity=CRITICAL|severity=CRITICAL&status=OPEN/)
  await expect(rows(page)).toHaveCount(1)
  await expect(row(page, OFFLINE)).toBeVisible()
  await page.goto(`/admin/alerts?type=LOW_STOCK&machineId=${MACHINE_1}`)
  await expect(rows(page)).toHaveCount(1)
  await expect(rows(page).first()).toContainText('Ngăn A2')
  await expect(rows(page).first().getByRole('link', { name: /^Ngăn A2/ })).toHaveAttribute('href', new RegExp(`/admin/inventory\\?machineId=${MACHINE_1}&slotId=`))
  await page.getByLabel('Loại').selectOption('DISPENSE_FAILED')
  await expect(rows(page)).toHaveCount(0)
  await expect(page.getByText('Không có cảnh báo khớp bộ lọc. Hãy đổi hoặc xóa bộ lọc.')).toBeVisible()
  await page.getByRole('button', { name: /^Xóa bộ lọc/ }).click()
  await expect(rows(page)).toHaveCount(7)
})

test('Máy chủ chưa có API cảnh báo (404): trang báo chưa có dữ liệu, chuông ẩn; 403: giải thích quyền, chuông ẩn', async ({ page }) => {
  await loginAs(page, 'ADMIN')
  await page.goto('/admin/alerts?scenario=missing:alerts')
  await expect(page.getByRole('status').filter({ hasText: 'Chưa có dữ liệu cảnh báo: máy chủ chưa cung cấp chức năng cảnh báo.' })).toBeVisible()
  await expect(bell(page)).toHaveCount(0)
  await expect(page.getByRole('table')).toHaveCount(0)
  await page.goto('/admin/orders?scenario=missing:alerts')
  await expect(page.getByRole('navigation', { name: 'Phân trang' })).toBeVisible()
  await expect(bell(page)).toHaveCount(0)

  // Detail on a backend without the feature: says so. An unknown id on a backend that has it: neutral "not found".
  await page.goto(`/admin/alerts/${SEEDED}?scenario=missing:alerts`)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Chưa có dữ liệu cảnh báo')
  await expect(page.getByRole('alert').filter({ hasText: 'máy chủ chưa cung cấp chức năng cảnh báo' })).toBeVisible()
  await page.goto(`/admin/alerts/${id('60000000', 999)}?scenario=none`)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Không tìm thấy cảnh báo')
  await expect(page.getByText(/máy chủ chưa/)).toHaveCount(0)

  await page.goto('/admin/alerts?scenario=403:alerts')
  await expect(page.getByRole('heading', { name: 'Không có quyền truy cập' })).toBeVisible()
  await expect(bell(page)).toHaveCount(0)
  await expect(page.getByRole('group', { name: 'Bộ lọc' })).toHaveCount(0)

  // Other failures keep the bell and retry; the list offers "Thử lại".
  await page.goto('/admin/alerts?scenario=error500:alerts')
  await expect(page.getByRole('button', { name: 'Thử lại' })).toBeVisible()
  await expect(bell(page)).toHaveAccessibleName('Cảnh báo')
  await page.goto('/admin/alerts?scenario=none')
  await expect(rows(page)).toHaveCount(7)
})

for (const theme of THEMES) {
  test(`Ảnh + axe: alerts, alert-detail, alert-bell (${theme})`, async ({ page }, testInfo) => {
    await useThemeChoice(page, theme)
    await loginAs(page, 'STAFF')
    await page.goto('/admin/alerts')
    await auditScreen(page, testInfo, 'alerts', theme, () => expect(rows(page)).toHaveCount(7))
    await page.goto(`/admin/alerts/${SEEDED}`)
    await auditScreen(page, testInfo, 'alert-detail', theme, () => expect(page.getByRole('region', { name: 'Xử lý' })).toBeVisible())
    await auditScreen(page, testInfo, 'alert-bell', theme, async () => {
      if (!await popover(page).isVisible()) await bell(page).click()
      await expect(popover(page).getByRole('listitem')).toHaveCount(3)
    })
  })
}

test('Danh sách rỗng ở 390px: không còn bảng thiếu hàng (axe), có câu giải thích (light, dark)', async ({ page }, testInfo) => {
  const phone = VIEWPORTS.filter(viewport => viewport.name === '390')
  for (const theme of THEMES) {
    await useThemeChoice(page, theme)
    if (theme === THEMES[0]) await loginAs(page, 'STAFF')
    await page.goto('/admin/alerts?scenario=empty')
    await auditScreen(page, testInfo, 'alerts-empty', theme, async () => {
      await expect(page.getByText('Chưa có cảnh báo nào. Máy sẽ gửi cảnh báo khi nhiệt độ, độ ẩm, kết nối hoặc hàng trong ngăn bất thường.')).toBeVisible()
      await expect(page.getByRole('table')).toHaveCount(0)
    }, phone)
  }
  await page.goto('/admin/alerts?scenario=none')
})
