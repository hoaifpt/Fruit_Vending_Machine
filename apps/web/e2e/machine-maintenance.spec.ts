// FE 7.4 "Điều khiển bảo trì máy" (screen O6, tab "Bảo trì" of the machine detail) on the mock API (draft of BE 4.2).
// Done criterion: the command buttons are locked with the reason while the machine is not MAINTENANCE (still focusable,
// nothing is sent), and EMPTY_COLUMN asks for a confirmation naming the slot and how many bowls will be taken out.
// Also: the way to MAINTENANCE from the lock (ADMIN) or who to ask (STAFF), OFFLINE machine, a command followed until it
// ends (PENDING → … → SUCCESS, bowls removed), the machine refusing RESET (FAILED), 400/409 from the server, the API not
// there yet (404) and 403; screenshots + axe at 1440/768/390 light and dark.
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { auditScreen, loginAs, THEMES, useThemeChoice } from './support.ts'

const id = (n: number) => `20000000-0000-0000-0000-${String(n).padStart(12, '0')}`
const DEV_01 = `/admin/machines/${id(1)}`
const DEV_02 = `/admin/machines/${id(2)}`
const COMMANDS_PATH = (n: number) => `/machines/${id(n)}/maintenance-commands`

const tab = (page: Page, name: string) => page.getByRole('tablist', { name: 'Thông tin máy' }).getByRole('tab', { name })
const lockNotice = (page: Page) => page.locator('[data-lock]')
const command = (page: Page, type: string) => page.locator(`[data-command="${type}"]`)
const history = (page: Page) => page.getByRole('table', { name: 'Lịch sử lệnh bảo trì' })
const slotSelect = (page: Page) => page.getByLabel('Ngăn cần thao tác')

async function posts(page: Page, n: number): Promise<number> {
  return page.evaluate(path => (window as unknown as { __fvMock: { requests: (prefix: string) => { method: string }[] } }).__fvMock
    .requests(path).filter(request => request.method === 'POST').length, COMMANDS_PATH(n))
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
    await expect(command(page, 'OPEN_REFILL')).not.toHaveAttribute('aria-disabled', 'true')
  })

  test('EMPTY_COLUMN cần xác nhận nêu ngăn và số hộp; hủy không gửi; xác nhận thì theo dõi tới Thành công và hộp bị rút', async ({ page }) => {
    await page.goto(`${DEV_01}?tab=maintenance`)
    await toMaintenance(page)
    await slotSelect(page).selectOption({ label: 'Ngăn B1 (Hoạt động)' })
    await expect(page.getByText(/^Đang có 2 hộp/)).toBeVisible()
    await command(page, 'EMPTY_COLUMN').click()
    let dialog = page.getByRole('alertdialog')
    await expect(dialog.getByRole('heading', { name: 'Rút hết 2 hộp ở ngăn B1?' })).toBeVisible()
    await expect(dialog).toContainText('Máy DEV-MACHINE-01, ngăn B1: 2 hộp sẽ bị rút và chuyển sang Đã rút. Không hoàn tác được')
    await dialog.getByRole('button', { name: 'Hủy' }).click()
    await expect(dialog).toHaveCount(0)
    await expect(command(page, 'EMPTY_COLUMN')).toBeFocused()
    expect(await posts(page, 1)).toBe(0)

    await command(page, 'EMPTY_COLUMN').click()
    dialog = page.getByRole('alertdialog')
    await dialog.getByLabel('Ghi chú (không bắt buộc)').fill('Hộp hết hạn')
    await dialog.getByRole('button', { name: 'Rút 2 hộp' }).click()
    await expect(dialog).toHaveCount(0)
    expect(await posts(page, 1)).toBe(1)
    const first = history(page).locator('tbody tr').first()
    await expect(first).toContainText('Rút hết hộp trong ngăn')
    await expect(first).toContainText('Ghi chú: Hộp hết hạn')
    // While it runs the buttons are locked by the running command.
    await expect(lockNotice(page)).toHaveAttribute('data-lock', 'running')
    await expect(first).toContainText('Thành công', { timeout: 15_000 })
    await expect(first).toContainText('Ngăn B1 · đã rút 2 hộp')
    await expect(lockNotice(page)).toHaveCount(0)
    await expect(page.getByText(/^Đang có 0 hộp/)).toBeVisible()
    await expect(page.getByText('Chưa gửi được: Ngăn đang trống, không có hộp nào để rút.').first()).toBeVisible()
  })

  test('RESET hỏi trước; máy không ở FAULT thì báo Thất bại kèm lý do; mở/đóng cửa nạp gửi ngay', async ({ page }) => {
    await page.goto(`${DEV_01}?tab=maintenance`)
    await toMaintenance(page)
    await command(page, 'RESET').click()
    const dialog = page.getByRole('alertdialog')
    await expect(dialog.getByRole('heading', { name: 'Khởi động lại bộ nhả hàng của máy DEV-MACHINE-01?' })).toBeVisible()
    await dialog.getByRole('button', { name: 'Khởi động lại' }).click()
    // The seed's newest row is an older refused RESET: wait for the new row first.
    await expect(history(page).locator('tbody tr')).toHaveCount(4)
    const first = history(page).locator('tbody tr').first()
    await expect(first).toContainText('Thất bại', { timeout: 15_000 })
    await expect(first).toContainText('Bộ nhả hàng không ở trạng thái lỗi FAULT')
    await expect(lockNotice(page)).toHaveCount(0)
    await command(page, 'OPEN_REFILL').click()
    await expect(page.getByRole('alertdialog')).toHaveCount(0)
    await expect(first).toContainText('Mở cửa nạp hàng')
    await expect(first).toContainText('Thành công', { timeout: 15_000 })
    await expect(page.getByText(/^Cửa nạp: đang mở/)).toBeVisible()
  })

  test('Máy Bảo trì nhưng OFFLINE: khóa và nói rõ; lịch sử có lệnh quá thời gian', async ({ page }) => {
    await page.goto(`${DEV_02}?tab=maintenance`)
    await expect(lockNotice(page)).toHaveAttribute('data-lock', 'offline')
    await expect(lockNotice(page)).toContainText('Máy đang mất kết nối (OFFLINE) nên lệnh không tới được máy.')
    await expect(lockNotice(page)).toContainText('Kiểm tra nguồn điện và Wi-Fi')
    const first = history(page).locator('tbody tr').first()
    await expect(first).toContainText('Khởi động lại bộ nhả hàng')
    await expect(first).toContainText('Quá thời gian')
    await expect(first).toContainText('Ghi chú: Xóa lỗi FAULT sau khi kiểm tra hai cửa.')
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
    await command(page, 'CLOSE_REFILL').click()
    await expect(page.getByRole('alert').filter({ hasText: 'Lệnh gửi lên chưa hợp lệ' })).toBeVisible()
    await page.evaluate(() => sessionStorage.removeItem('fv-mock-scenario'))
    await command(page, 'RESET').click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Khởi động lại' }).click()
    const first = history(page).locator('tbody tr').first()
    await expect(first).toContainText('Khởi động lại bộ nhả hàng')
    await page.clock.fastForward(5_000)
    await expect(first).toContainText('Thành công', { timeout: 15_000 })
  })

  test('Chưa có API (404): báo chưa có và khóa nút; 403 giải thích quyền', async ({ page }) => {
    await page.goto(`${DEV_01}?tab=maintenance&scenario=missing:maintenance-commands`)
    await expect(lockNotice(page)).toHaveAttribute('data-lock', 'missing')
    await expect(page.getByText(/^Chưa có chức năng lệnh bảo trì: máy chủ chưa hỗ trợ phần này/)).toBeVisible()
    await page.goto(`${DEV_01}?tab=maintenance&scenario=403:maintenance-commands`)
    await expect(page.getByRole('heading', { name: 'Không có quyền truy cập' })).toBeVisible()
    await page.goto(`${DEV_01}?tab=maintenance&scenario=none`)
  })
})

test.describe('Nhân viên', () => {
  test('Máy không ở Bảo trì: lý do và việc cần làm là nhờ Quản trị viên (không có nút đổi trạng thái)', async ({ page }) => {
    await loginAs(page, 'STAFF')
    await page.goto(`${DEV_01}?tab=maintenance`)
    await expect(tab(page, 'Bảo trì')).toHaveAttribute('aria-selected', 'true')
    await expect(lockNotice(page)).toContainText('Nhờ Quản trị viên chuyển máy sang Bảo trì')
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
      await expect(page.getByText(/^Đang có 2 hộp/)).toBeVisible()
    })
  })
}
