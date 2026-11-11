// I2 Sơ đồ tồn kho theo ngăn (issue FE 4.2) on the mock API. Done criterion: a bottom box that is expired or failed to
// dispense shows "Đang chặn ngăn" with the remove button ("Rút hộp"; for a failed dispense the API refuses removal
// today, so the next step is explained instead). Also: machine chosen in the URL, held box, reserved discount slot,
// remove flow with focus kept, list view, loading / empty / 404 / 403 / 401 / server error, screenshots + axe.
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { auditScreen, loginAs, THEMES, useThemeChoice } from './support.ts'

const MACHINE_1 = '20000000-0000-0000-0000-000000000001'
const MACHINE_2 = '20000000-0000-0000-0000-000000000002'
const SLOT_B1 = '30000000-0000-0000-0000-000000000003'
const column = (page: Page, code: string) => page.locator(`[data-slot-column="${code}"]`)
const head = (page: Page, code: string) => column(page, code).locator('li[data-head]')
const ready = (page: Page) => expect(column(page, 'B1')).toContainText('Đang chặn ngăn')

test.describe('Sơ đồ tồn kho (Quản trị viên)', () => {
  test.beforeEach(async ({ page }) => { await loginAs(page, 'ADMIN') })

  test('Chọn máy lưu trên URL; mỗi ngăn là cột hộp với hộp đáy bán tiếp theo', async ({ page }) => {
    await page.goto('/admin/inventory')
    await expect(page.getByRole('heading', { name: 'Chọn máy để xem sơ đồ ngăn' })).toBeVisible()
    await page.getByRole('button', { name: /Development fruit machine/ }).click()
    await page.waitForURL(new RegExp(`machineId=${MACHINE_1}`))
    await ready(page)
    await expect(page.getByRole('list', { name: 'Các ngăn của máy' }).getByRole('listitem').filter({ has: page.locator('[data-slot-column]') })).toHaveCount(3)
    await expect(column(page, 'A1')).toContainText('8/10 hộp')
    await expect(column(page, 'A1')).toContainText('Đang bán: hộp đáy được bán tiếp theo.')
    await expect(head(page, 'A1')).toContainText('Hộp đáy · bán tiếp theo')
    await expect(column(page, 'A1').locator('li[data-box-status]')).toHaveCount(8)
    // Two free places drawn above the boxes; the head is the last in the visual stack (column reversed).
    await expect(column(page, 'A1').locator('li[aria-hidden="true"]')).toHaveCount(2)
    const boxes = column(page, 'A1').locator('li[data-box-status]')
    const headBox = await boxes.first().boundingBox(), topBox = await boxes.last().boundingBox()
    expect(headBox!.y).toBeGreaterThan(topBox!.y)
    // Heads of one row share a floor line (1440px: A1 and A2 side by side, different header heights and fills).
    const floorA1 = await head(page, 'A1').boundingBox(), floorA2 = await head(page, 'A2').boundingBox()
    expect(Math.abs((floorA1!.y + floorA1!.height) - (floorA2!.y + floorA2!.height))).toBeLessThanOrEqual(1)
    // A place is reserved for a future "-50%" label on every box, empty for now.
    await expect(column(page, 'A1').locator('[data-discount-slot]')).toHaveCount(8)
    await expect(column(page, 'A1').locator('[data-discount-slot]').first()).toHaveText('')
    // Reload keeps the machine; the slot filter narrows to one column.
    await page.reload()
    await ready(page)
    await page.getByLabel('Ngăn', { exact: true }).selectOption({ label: 'Ngăn B1' })
    await page.waitForURL(new RegExp(`slotId=${SLOT_B1}`))
    await expect(column(page, 'A1')).toHaveCount(0)
    await expect(column(page, 'B1')).toBeVisible()
  })

  test('Hộp đáy hết hạn hiện "Đang chặn ngăn" và nút Rút hộp; rút xong ngăn trống, focus ở lại ngăn', async ({ page }) => {
    await page.goto(`/admin/inventory?machineId=${MACHINE_1}`)
    await ready(page)
    const b1 = column(page, 'B1')
    await expect(b1).toContainText('Không bán: hộp đáy đã hết hạn nên chặn cả ngăn.')
    await expect(head(page, 'B1')).toHaveAttribute('data-blocking', 'true')
    await expect(head(page, 'B1')).toContainText('Hộp đã hết hạn, máy không bán hộp nào của ngăn. 1 hộp phía trên chỉ bán được sau khi rút hộp này.')
    const removeButton = page.getByRole('button', { name: 'Rút hộp đáy ngăn B1' })
    await expect(removeButton).toBeVisible()
    // Only the blocking head has the button.
    await expect(page.getByRole('button', { name: /^Rút hộp đáy ngăn/ })).toHaveCount(1)

    // Keyboard: open, Esc closes and gives focus back.
    await removeButton.focus()
    await page.keyboard.press('Enter')
    const dialog = page.getByRole('dialog', { name: 'Rút hộp khỏi ngăn' })
    await expect(dialog).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await expect(removeButton).toBeFocused()

    await removeButton.click()
    await dialog.getByRole('button', { name: 'Rút hộp' }).click()
    await expect(dialog.getByLabel('Lý do rút hộp')).toHaveAccessibleDescription(/Vui lòng nhập lý do rút hộp\./)
    await dialog.getByLabel('Lý do rút hộp').fill('Hộp hết hạn, đã lấy ra')
    await dialog.getByRole('button', { name: 'Rút hộp' }).click()
    await expect(dialog).toHaveCount(0)
    // The next box is from the same expired batch: still blocked, now with one box.
    await expect(b1).toContainText('1/10 hộp')
    await expect(head(page, 'B1')).toHaveAttribute('data-blocking', 'true')
    await removeButton.click()
    await dialog.getByLabel('Lý do rút hộp').fill('Hộp hết hạn, đã lấy ra')
    await dialog.getByRole('button', { name: 'Rút hộp' }).click()
    await expect(b1).toContainText('0/10 hộp')
    await expect(b1).toContainText('Ngăn trống, cần nạp hộp.')
    await expect(page.getByRole('button', { name: 'Rút hộp đáy ngăn B1' })).toHaveCount(0)
    await expect(b1).toBeFocused()
  })

  test('Hộp đáy nhả hàng thất bại chặn ngăn và giải thích bước tiếp theo; hộp đang giữ; máy bảo trì', async ({ page }) => {
    await page.goto(`/admin/inventory?machineId=${MACHINE_2}`)
    const a1 = column(page, 'A1')
    await expect(a1).toContainText('Đang chặn ngăn')
    await expect(a1).toContainText('Không bán: hộp đáy nhả hàng thất bại nên chặn cả ngăn.')
    await expect(head(page, 'A1')).toContainText('Nhả hàng thất bại. Máy không nhả được hộp này. 3 hộp phía trên phải chờ hộp này được xử lý xong.')
    // The button is there but locked, with why and the next step (an administrator is not told to call one).
    const locked = page.getByRole('button', { name: 'Rút hộp đáy ngăn A1' })
    await expect(locked).toHaveAttribute('aria-disabled', 'true')
    await expect(locked).toHaveAccessibleDescription(/Hộp nhả hàng thất bại cần đối soát; hệ thống chưa cho rút trực tiếp\./)
    await expect(head(page, 'A1')).not.toContainText('báo quản trị viên')
    // Still reachable by keyboard (so its description is read), but pressing it opens nothing.
    await locked.focus()
    await page.keyboard.press('Enter')
    await expect(locked).toBeFocused()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(head(page, 'A2')).toContainText('Hộp đáy · đang giữ')
    await expect(column(page, 'A2')).toContainText('Hộp đáy đang được giữ cho một đơn')
    await expect(page.getByRole('note').filter({ hasText: 'Máy đang ở trạng thái Bảo trì' })).toBeVisible()
    await expect(page.getByText(/^2 ngăn · 0 đang bán · 1 đang chặn · 1 đang giữ · 0 trống/)).toBeVisible()
  })

  test('Rút hộp bị 409 (hộp vừa đổi trạng thái): câu tiếng Việt và sơ đồ tự tải lại', async ({ page }) => {
    await page.goto(`/admin/inventory?machineId=${MACHINE_1}&scenario=409:/inventory/70000000-0000-0000-0000-000000000201/remove`)
    await ready(page)
    const map = page.locator('section[data-updated-at]')
    const before = await map.getAttribute('data-updated-at')
    await page.getByRole('button', { name: 'Rút hộp đáy ngăn B1' }).click()
    const dialog = page.getByRole('dialog', { name: 'Rút hộp khỏi ngăn' })
    await dialog.getByLabel('Lý do rút hộp').fill('Hộp hết hạn')
    await dialog.getByRole('button', { name: 'Rút hộp' }).click()
    await expect(dialog.getByRole('alert')).toHaveText('Hộp vừa đổi trạng thái (đang giữ cho đơn hoặc đã được rút). Dữ liệu đã tải lại.')
    await expect(map).not.toHaveAttribute('data-updated-at', before!)
    await page.goto(`/admin/inventory?machineId=${MACHINE_1}&scenario=none`)
  })

  test('Đổi máy: không hiện sơ đồ hay ngăn của máy cũ trong lúc tải', async ({ page }) => {
    await page.goto(`/admin/inventory?machineId=${MACHINE_1}`)
    await ready(page)
    await page.goto(`/admin/inventory?machineId=${MACHINE_1}&scenario=slow`)
    await ready(page)
    await page.getByLabel('Máy', { exact: true }).selectOption({ label: 'Maintenance test machine (DEV-MACHINE-02)' })
    await expect(page.getByRole('status').filter({ hasText: 'Đang tải sơ đồ ngăn…' })).toBeAttached()
    await expect(column(page, 'B1')).toHaveCount(0)
    await expect(page.getByLabel('Ngăn', { exact: true }).locator('option', { hasText: 'Ngăn B1' })).toHaveCount(0)
    await expect(column(page, 'A1')).toContainText('Đang chặn ngăn')
    await page.goto(`/admin/inventory?machineId=${MACHINE_2}&scenario=none`)
  })

  test('Danh sách hộp vẫn dùng được (view=list) và giữ máy trên URL', async ({ page }) => {
    await page.goto(`/admin/inventory?machineId=${MACHINE_1}`)
    await ready(page)
    await page.getByRole('button', { name: 'Danh sách hộp' }).click()
    await page.waitForURL(/view=list/)
    await expect(page.getByRole('button', { name: 'Danh sách hộp' })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByRole('table', { name: 'Danh sách hộp' })).toBeVisible()
    await page.getByRole('button', { name: 'Sơ đồ ngăn' }).click()
    await ready(page)
  })

  test('Danh sách hộp: tham số URL sai bị bỏ qua có ghi chú; hộp không rút được có lý do; rỗng / 403 / máy chưa có ngăn', async ({ page }) => {
    const table = page.getByRole('table', { name: 'Danh sách hộp' })
    const headerLoad = page.getByRole('button', { name: 'Nạp hộp', exact: true })
    // Values GET /inventory would refuse with a 400 are not sent: the list loads and a note says what was ignored.
    await page.goto('/admin/inventory?view=list&machineId=abc&status=LOST&sort=password,asc')
    const note = page.getByRole('note').filter({ hasText: 'đã bỏ qua' })
    await expect(note).toContainText('Máy “abc”')
    await expect(note).toContainText('Trạng thái “LOST”')
    await expect(note).toContainText('Sắp xếp “password,asc”')
    await expect(table.getByRole('row').nth(1)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Thử lại' })).toHaveCount(0)
    await note.getByRole('button', { name: 'Bỏ khỏi đường dẫn' }).click()
    await expect(note).toHaveCount(0)
    expect([...new URL(page.url()).searchParams.keys()]).toEqual(['view'])

    // A box that failed to dispense: the button is locked (aria-disabled) and the reason is on screen.
    await page.goto(`/admin/inventory?view=list&machineId=${MACHINE_2}&status=DISPENSE_FAILED`)
    const locked = table.getByRole('button', { name: 'Rút hộp' })
    await expect(locked).toHaveAttribute('aria-disabled', 'true')
    await expect(locked).toHaveAccessibleDescription(/cần đối soát/)
    await expect(table).toContainText('hệ thống chưa cho rút trực tiếp')

    // Nothing at all (no filter): what to do next.
    await page.goto('/admin/inventory?view=list&scenario=empty')
    await expect(page.getByText('Chưa có hộp nào trong kho.', { exact: false })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Mở sơ đồ ngăn' })).toBeVisible()
    await expect(headerLoad).toHaveCount(2) // the page header and the empty state

    // 403: no filters and no load button, only the explanation.
    await page.goto('/admin/inventory?view=list&scenario=403:inventory')
    await expect(page.getByRole('heading', { name: 'Không có quyền truy cập' })).toBeVisible()
    await expect(page.getByRole('group', { name: 'Bộ lọc' })).toHaveCount(0)
    await expect(headerLoad).toHaveCount(0)

    // A machine without slots: no load button, no "0 ngăn" summary nor legend above the explanation.
    await page.goto(`/admin/inventory?machineId=${MACHINE_1}&scenario=empty`)
    await expect(page.getByText('Máy chưa có ngăn nào nên chưa có hộp để hiện.')).toBeVisible()
    await expect(headerLoad).toHaveCount(0)
    await expect(page.getByText('Hộp đáy (bán tiếp theo)')).toHaveCount(0)
    await expect(page.getByText(/0 ngăn/)).toHaveCount(0)
  })

  test('Trạng thái: đang tải, máy không tồn tại, không có máy, lỗi máy chủ, 403, 401', async ({ page }) => {
    await page.goto(`/admin/inventory?machineId=${MACHINE_1}&scenario=slow`)
    await expect(page.getByRole('status').filter({ hasText: 'Đang tải sơ đồ ngăn…' })).toBeAttached()
    await ready(page)

    await page.goto('/admin/inventory?machineId=20000000-0000-0000-0000-0000000000ff&scenario=none')
    await expect(page.getByRole('alert')).toContainText('Không tìm thấy máy này')

    await page.goto('/admin/inventory?scenario=empty')
    await expect(page.getByText(/Chưa có máy nào/)).toBeVisible()
    await page.goto(`/admin/inventory?machineId=${MACHINE_1}&scenario=empty`)
    await expect(page.getByText('Máy chưa có ngăn nào nên chưa có hộp để hiện.')).toBeVisible()

    await page.goto(`/admin/inventory?machineId=${MACHINE_1}&scenario=error500:inventory`)
    await expect(page.getByRole('button', { name: 'Thử lại' })).toBeVisible()
    await page.goto(`/admin/inventory?machineId=${MACHINE_1}&scenario=none`)
    await ready(page)

    await page.goto(`/admin/inventory?machineId=${MACHINE_1}&scenario=403:inventory`)
    await expect(page.getByRole('heading', { name: 'Không có quyền truy cập' })).toBeVisible()
    await expect(page.getByRole('group', { name: 'Bộ lọc' })).toHaveCount(0)
    await page.goto(`/admin/inventory?machineId=${MACHINE_1}&scenario=none`)
    await ready(page)

    await page.goto(`/admin/inventory?machineId=${MACHINE_1}&scenario=expire`)
    await page.waitForURL(/\/login\?next=/)
    expect(decodeURIComponent(page.url())).toContain(`/admin/inventory?machineId=${MACHINE_1}`)
  })
})

test('Nhân viên (có quyền nạp/rút) thấy nút Rút hộp ở hộp đáy chặn ngăn', async ({ page }) => {
  await loginAs(page, 'STAFF')
  await page.goto(`/admin/inventory?machineId=${MACHINE_1}`)
  await ready(page)
  await expect(page.getByRole('button', { name: 'Rút hộp đáy ngăn B1' })).toBeVisible()
  await expect(page.getByRole('button', { name: /xóa|xoá|delete/i })).toHaveCount(0)
})

for (const theme of THEMES) {
  test(`Ảnh + axe: inventory-map (${theme})`, async ({ page }, testInfo) => {
    await useThemeChoice(page, theme)
    await loginAs(page, 'ADMIN')
    await page.goto(`/admin/inventory?machineId=${MACHINE_1}`)
    await auditScreen(page, testInfo, 'inventory-map', theme, () => ready(page))
  })

  test(`Ảnh + axe: inventory-map-maintenance (${theme})`, async ({ page }, testInfo) => {
    await useThemeChoice(page, theme)
    await loginAs(page, 'ADMIN')
    await page.goto(`/admin/inventory?machineId=${MACHINE_2}`)
    await auditScreen(page, testInfo, 'inventory-map-maintenance', theme, () => expect(column(page, 'A1')).toContainText('Đang chặn ngăn'))
  })
}
