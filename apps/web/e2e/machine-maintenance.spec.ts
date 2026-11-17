// FE 7.4 "Điều khiển bảo trì máy" (screen O6, tab "Bảo trì" of the machine detail) on the mock of the real API (backend #64,
// docs/maintenance-commands.md): every gate / removal command is per column (POST .../slots/{slotId}/maintenance-commands),
// so a column is picked first; RESET is for the whole machine; the refill gate state comes from the slot (refillGateOpen).
// Done criterion: the command buttons are locked with the reason while the machine is not MAINTENANCE (still focusable,
// nothing is sent), and EMPTY_COLUMN asks for a confirmation naming the slot and how many bowls will be taken out.
// Also: the way to MAINTENANCE from the lock (ADMIN) or who to ask (STAFF), OFFLINE machine, a command followed until it
// ends (PENDING → … → COMPLETED, bowls removed), a RESET the machine never took (FAILED ACCEPT_TIMEOUT), 400/409 from the
// server, a server error and 403 on the history; screenshots + axe at 1440/768/390 light and dark.
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { auditScreen, loginAs, THEMES, useThemeChoice } from './support.ts'

const id = (n: number) => `20000000-0000-0000-0000-${String(n).padStart(12, '0')}`
const DEV_01 = `/admin/machines/${id(1)}`
const DEV_02 = `/admin/machines/${id(2)}`
/** POSTs of a machine's column commands (/machines/{id}/slots/{slotId}/maintenance-commands) and its RESET. */
const COMMANDS_PATH = (n: number) => `/machines/${id(n)}/`

const tab = (page: Page, name: string) => page.getByRole('tablist', { name: 'Thông tin máy' }).getByRole('tab', { name })
const lockNotice = (page: Page) => page.locator('[data-lock]')
const command = (page: Page, type: string) => page.locator(`[data-command="${type}"]`)
const history = (page: Page) => page.getByRole('table', { name: 'Lịch sử lệnh bảo trì' })
const slotSelect = (page: Page) => page.getByLabel('Ngăn cần thao tác')
/** What the tab knows about the picked column: refill gate (from the slot) and bowls (from the slot summary). */
const slotFacts = (page: Page, count: number) => page.getByRole('status').filter({ hasText: new RegExp(`Đang có ${count} hộp`) })

async function posts(page: Page, n: number): Promise<number> {
  return page.evaluate(path => (window as unknown as { __fvMock: { requests: (prefix: string) => { method: string }[] } }).__fvMock
    .requests(path).filter(request => request.method === 'POST' && /\/(maintenance-commands|reset)$/.test((request as { path?: string }).path ?? '')).length, COMMANDS_PATH(n))
}
async function resumeHeartbeat(page: Page, code: string) {
  await page.evaluate(machine => (window as unknown as { __fvMock: { resumeHeartbeat: (machine: string) => string } }).__fvMock.resumeHeartbeat(machine), code)
}
/** ADMIN switches the machine to MAINTENANCE from the lock notice, then comes back to the tab (same SPA session). */
async function toMaintenance(page: Page) {
  await page.getByRole('button', { name: 'Mở thẻ Tổng quan để chuyển sang Bảo trì' }).click()
  await expect(tab(page, 'Tổng quan')).toHaveAttribute('aria-selected', 'true')
  const target = page.getByRole('button', { name: 'Chuyển sang Bảo trì' })
  await expect(target).toBeFocused()
  await page.keyboard.press('Enter')
  const confirm = page.getByRole('alertdialog')
  await confirm.getByRole('button', { name: 'Chuyển sang Bảo trì' }).click()
  await expect(confirm).toHaveCount(0)
  await expect(page.getByRole('group', { name: 'Trạng thái máy' })).toContainText('Bảo trì')
  await tab(page, 'Bảo trì').click()
  await page.waitForURL(/\?tab=maintenance$/)
}

test.describe('Tiêu chí xong (Quản trị viên)', () => {
  test.beforeEach(async ({ page }) => { await loginAs(page, 'ADMIN') })

  test('Máy không ở Bảo trì: mọi nút khóa kèm lý do, vẫn focus được, bấm không gửi gì; nút dẫn sang Tổng quan', async ({ page }) => {
    await page.goto(`${DEV_01}?tab=maintenance`)
    await expect(tab(page, 'Bảo trì')).toHaveAttribute('aria-selected', 'true')
    await expect(lockNotice(page)).toHaveAttribute('data-lock', 'status')
    await expect(lockNotice(page)).toContainText('Các nút lệnh đang khóa')
    await expect(lockNotice(page)).toContainText('Máy đang ở trạng thái Hoạt động. Lệnh bảo trì chỉ gửi được khi máy ở trạng thái Bảo trì')
    await expect(lockNotice(page)).toContainText('Việc cần làm: Chuyển máy sang Bảo trì ở thẻ Tổng quan')
    // The slot commands need a slot first; pick one so every button is locked by the machine status only.
    await slotSelect(page).selectOption({ label: 'Ngăn B1 (Hoạt động)' })
    await page.waitForURL(/maintenanceSlot=/)
    for (const type of ['OPEN_REFILL', 'CLOSE_REFILL', 'RESET', 'REMOVE_ITEM', 'EMPTY_COLUMN']) {
      const button = command(page, type)
      await expect(button).toHaveAttribute('aria-disabled', 'true')
      await expect(button).not.toHaveAttribute('disabled') // focusable: aria-disabled only
      const describedBy = (await button.getAttribute('aria-describedby')) ?? ''
      expect(describedBy.split(' ')).toContain(await lockNotice(page).getAttribute('id'))
    }
    await command(page, 'OPEN_REFILL').focus()
    await expect(command(page, 'OPEN_REFILL')).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(lockNotice(page)).toBeFocused()
    // A mouse click on a locked button (force: Playwright treats aria-disabled as not clickable) asks nothing either.
    await command(page, 'EMPTY_COLUMN').click({ force: true })
    await expect(lockNotice(page)).toBeFocused()
    await expect(page.getByRole('alertdialog')).toHaveCount(0)
    expect(await posts(page, 1)).toBe(0)

    await toMaintenance(page)
    await expect(lockNotice(page)).toHaveCount(0)
    // Column commands need a column (the tab switch dropped it from the URL): once picked, they can be sent.
    await expect(command(page, 'OPEN_REFILL')).toHaveAttribute('aria-disabled', 'true')
    await expect(page.getByText('Chưa gửi được: Chọn ngăn trước.').first()).toBeVisible()
    await slotSelect(page).selectOption({ label: 'Ngăn B1 (Hoạt động)' })
    await expect(command(page, 'OPEN_REFILL')).not.toHaveAttribute('aria-disabled', 'true')
    await expect(command(page, 'RESET')).not.toHaveAttribute('aria-disabled', 'true')
  })

  test('EMPTY_COLUMN cần xác nhận nêu ngăn và số hộp; hủy không gửi; xác nhận thì theo dõi tới Đã xong và hộp bị rút', async ({ page }) => {
    await page.goto(`${DEV_01}?tab=maintenance`)
    await toMaintenance(page)
    await slotSelect(page).selectOption({ label: 'Ngăn B1 (Hoạt động)' })
    await expect(slotFacts(page, 2)).toContainText('Cổng nạp đang đóng.')
    await command(page, 'EMPTY_COLUMN').click()
    let dialog = page.getByRole('alertdialog')
    await expect(dialog.getByRole('heading', { name: 'Xả hết 2 hộp ở ngăn B1?' })).toBeVisible()
    await expect(dialog).toContainText('Máy DEV-MACHINE-01, ngăn B1: 2 hộp sẽ bị rút và chuyển sang Đã rút. Không hoàn tác được')
    await dialog.getByRole('button', { name: 'Hủy' }).click()
    await expect(dialog).toHaveCount(0)
    await expect(command(page, 'EMPTY_COLUMN')).toBeFocused()
    expect(await posts(page, 1)).toBe(0)

    await command(page, 'EMPTY_COLUMN').click()
    dialog = page.getByRole('alertdialog')
    // A reason is required for a removal (backend #64); EMPTY_COLUMN starts on "Xả ngăn để nạp hàng mới".
    await dialog.getByLabel(/^Lý do rút/).selectOption({ label: 'Hộp hết hạn' })
    await dialog.getByLabel('Ghi chú (không bắt buộc)').fill('Hộp hết hạn')
    await dialog.getByRole('button', { name: 'Xả 2 hộp' }).click()
    await expect(dialog).toHaveCount(0)
    expect(await posts(page, 1)).toBe(1)
    const first = history(page).locator('tbody tr').first()
    await expect(first).toContainText('Xả cả ngăn')
    await expect(first).toContainText('Ghi chú: Hộp hết hạn')
    // While it runs the buttons are locked by the running command.
    await expect(lockNotice(page)).toHaveAttribute('data-lock', 'running')
    await expect(first).toContainText('Đã xong', { timeout: 15_000 })
    await expect(first).toContainText('Ngăn B1 · Hộp hết hạn · đã rút 2 hộp')
    await expect(lockNotice(page)).toHaveCount(0)
    await expect(slotFacts(page, 0)).toBeVisible()
    await expect(page.getByText('Chưa gửi được: Ngăn đang trống, không có hộp nào để rút.').first()).toBeVisible()
  })

  test('RESET hỏi trước rồi xong ngay (máy không ở FAULT); mở cổng nạp của ngăn gửi ngay, cổng mở chặn rút hộp', async ({ page }) => {
    await page.goto(`${DEV_01}?tab=maintenance`)
    await toMaintenance(page)
    await command(page, 'RESET').click()
    const dialog = page.getByRole('alertdialog')
    await expect(dialog.getByRole('heading', { name: 'Khởi động lại bộ điều khiển của máy DEV-MACHINE-01?' })).toBeVisible()
    await dialog.getByRole('button', { name: 'Khởi động lại' }).click()
    // The seed's newest row is an older refused RESET: wait for the new row first.
    await expect(history(page).locator('tbody tr')).toHaveCount(4)
    const first = history(page).locator('tbody tr').first()
    // Backend #64: RESET_ACCEPTED completes the command at once (the controller of DEV-MACHINE-01 is not in FAULT).
    await expect(first).toContainText('Đã xong', { timeout: 15_000 })
    await expect(lockNotice(page)).toHaveCount(0)
    await slotSelect(page).selectOption({ label: 'Ngăn B1 (Hoạt động)' })
    await command(page, 'OPEN_REFILL').click()
    await expect(page.getByRole('alertdialog')).toHaveCount(0)
    await expect(first).toContainText('Mở cổng nạp')
    await expect(first).toContainText('Đã xong', { timeout: 15_000 })
    // refillGateOpen of the slot: the column does not sell, a removal waits for the gate to close.
    await expect(page.getByText('Cổng nạp đang mở: ngăn không bán.')).toBeVisible()
    await expect(page.getByText('Đang mở cổng nạp: ngăn B1.')).toBeVisible()
    await expect(page.getByText('Chưa gửi được: Cổng nạp của ngăn đang mở. Đóng cổng nạp trước rồi rút hộp.').first()).toBeVisible()
    await expect(command(page, 'CLOSE_REFILL')).not.toHaveAttribute('aria-disabled', 'true')
  })

  test('Máy Bảo trì nhưng OFFLINE: khóa và nói rõ; lịch sử có lệnh quá thời gian', async ({ page }) => {
    await page.goto(`${DEV_02}?tab=maintenance`)
    await expect(lockNotice(page)).toHaveAttribute('data-lock', 'offline')
    await expect(lockNotice(page)).toContainText('Máy đang mất kết nối (OFFLINE) nên lệnh không tới được máy.')
    await expect(lockNotice(page)).toContainText('Kiểm tra nguồn điện và Wi-Fi')
    // Newest: a RESET the machine never took (FAILED ACCEPT_TIMEOUT); before it a REMOVE_ITEM accepted but never reported.
    const first = history(page).locator('tbody tr').first()
    await expect(first).toContainText('Khởi động lại bộ điều khiển')
    await expect(first).toContainText('Thất bại')
    await expect(first).toContainText('Máy không nhận lệnh trong 30 giây')
    await expect(first).toContainText('Ghi chú: Xóa lỗi FAULT sau khi kiểm tra hai cổng.')
    const waiting = history(page).locator('tbody tr').filter({ hasText: 'Rút hộp đáy ngăn' })
    await expect(waiting).toContainText('Cần đối soát')
    await expect(waiting).toContainText('Máy đã nhận lệnh nhưng không báo xong trong 90 giây.')
    // A1's head failed to dispense and A2's bowl is held for an order: no slot command can run there.
    await slotSelect(page).selectOption({ label: 'Ngăn A1 (Hoạt động)' })
    await expect(page.getByText(/Hộp ở đáy ngăn: nhả hàng thất bại/)).toBeVisible()
    // The machine lock (OFFLINE) is the reason given; the slot reason only shows once the machine can take commands.
    await expect(page.getByText(/^Chưa gửi được:/)).toHaveCount(0)
  })

  test('Máy có lại tín hiệu: RESET xóa FAULT; 409 và 400 từ máy chủ hiện trong hộp thoại / đầu thẻ', async ({ page }) => {
    await page.clock.install()
    await page.goto(`${DEV_02}?tab=maintenance`)
    await expect(lockNotice(page)).toHaveAttribute('data-lock', 'offline')
    await resumeHeartbeat(page, 'DEV-MACHINE-02')
    await page.clock.fastForward(31_000)
    await expect(lockNotice(page)).toHaveCount(0)
    // 409 (mock scenario on writes only): the message and the next step stay in the dialog.
    await page.evaluate(() => sessionStorage.setItem('fv-mock-scenario', '409'))
    await command(page, 'RESET').click()
    const dialog = page.getByRole('alertdialog')
    await dialog.getByRole('button', { name: 'Khởi động lại' }).click()
    await expect(dialog.getByRole('alert')).toContainText('Máy chủ từ chối lệnh vì trạng thái máy hoặc ngăn vừa thay đổi')
    await dialog.getByRole('button', { name: 'Hủy' }).click()
    // 400 on a command sent at once: shown at the top of the tab.
    await page.evaluate(() => sessionStorage.setItem('fv-mock-scenario', '400'))
    await slotSelect(page).selectOption({ label: 'Ngăn A1 (Hoạt động)' })
    await command(page, 'CLOSE_REFILL').click()
    await expect(page.getByRole('alert').filter({ hasText: 'Lệnh gửi lên chưa hợp lệ' })).toBeVisible()
    await page.evaluate(() => sessionStorage.removeItem('fv-mock-scenario'))
    await command(page, 'RESET').click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Khởi động lại' }).click()
    const first = history(page).locator('tbody tr').first()
    await expect(first).toContainText('Khởi động lại bộ điều khiển')
    await page.clock.fastForward(5_000)
    await expect(first).toContainText('Đã xong', { timeout: 15_000 })
  })

  test('Lịch sử lệnh lỗi máy chủ: giải thích và Thử lại; 403 giải thích quyền; cổng nạp vẫn biết từ ngăn', async ({ page }) => {
    // The real API has the maintenance commands (no "not shipped yet" 404): the history failing is a server error or 403.
    const B1 = 'maintenanceSlot=30000000-0000-0000-0000-000000000003'
    await page.goto(`${DEV_01}?tab=maintenance&${B1}&scenario=error500:maintenance-commands`)
    await expect(page.getByRole('button', { name: 'Thử lại' })).toBeVisible()
    await expect(lockNotice(page)).toHaveAttribute('data-lock', 'status')
    await page.goto(`${DEV_01}?tab=maintenance&${B1}&scenario=403:maintenance-commands`)
    await expect(page.getByRole('heading', { name: 'Không có quyền truy cập' })).toBeVisible()
    // Without the history the gate state still comes from the slot (refillGateOpen), not from past commands.
    await expect(slotFacts(page, 2)).toContainText('Cổng nạp đang đóng.')
    await page.goto(`${DEV_01}?tab=maintenance&scenario=none`)
  })
})

test.describe('Nhân viên', () => {
  test('Máy không ở Bảo trì: lý do và việc cần làm là nhờ Quản trị viên (không có nút đổi trạng thái)', async ({ page }) => {
    await loginAs(page, 'STAFF')
    await page.goto(`${DEV_01}?tab=maintenance`)
    await expect(tab(page, 'Bảo trì')).toHaveAttribute('aria-selected', 'true')
    await expect(lockNotice(page)).toContainText('Việc cần làm: Bắt đầu phiếu nạp hàng hoặc bảo trì của máy (máy tự chuyển sang Bảo trì), hoặc nhờ Quản trị viên chuyển máy sang Bảo trì.')
    await expect(page.getByRole('button', { name: 'Mở thẻ Tổng quan để chuyển sang Bảo trì' })).toHaveCount(0)
    await expect(history(page).locator('tbody tr')).toHaveCount(3)
  })
})

for (const theme of THEMES) {
  test(`Ảnh + axe: machine-maintenance (${theme})`, async ({ page }, testInfo) => {
    await useThemeChoice(page, theme)
    await loginAs(page, 'ADMIN')
    await page.goto(`${DEV_01}?tab=maintenance&maintenanceSlot=30000000-0000-0000-0000-000000000003`)
    await auditScreen(page, testInfo, 'machine-maintenance', theme, async () => {
      await expect(history(page).locator('tbody tr')).toHaveCount(3)
      await expect(slotFacts(page, 2)).toBeVisible()
    })
  })
}
