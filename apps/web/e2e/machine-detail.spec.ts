// C3 Chi tiết máy (issue FE 3.5) on the mock API. Done criteria: the kiosk key is shown exactly once with a copy button;
// the flow product → machine → 2 slots → key → ACTIVE runs end to end without instructions. Also: tabs in the URL,
// duplicate slot code (409) under the field, what is missing before ACTIVE, revoke with a confirmation, 409 of the
// status change in Vietnamese, configuration edit in a Sheet, STAFF view-only, 404/403/500; screenshots + axe.
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { auditScreen, loginAs, THEMES, useThemeChoice } from './support.ts'

const DEV_01 = '/admin/machines/20000000-0000-0000-0000-000000000001'
const DEV_03 = '/admin/machines/20000000-0000-0000-0000-000000000003'
const SLOT_TAKEN = 'Máy này đã có ngăn mang mã này (không phân biệt hoa thường). Hãy nhập mã khác; máy khác vẫn dùng được cùng mã.'
const STATUS_CONFLICT = 'Máy chủ từ chối vì máy vừa được thay đổi ở nơi khác. Hãy tải lại trang để xem trạng thái mới rồi thử lại.'
const KEY_RACE = 'Danh sách khóa của máy vừa thay đổi ở nơi khác và đã được tải lại. Kiểm tra cảnh báo trong hộp thoại rồi cấp lại nếu cần.'
const KEY_CHANGED = 'Khóa này vừa bị thay đổi ở nơi khác (có thể đã bị thu hồi hoặc thay bằng khóa mới). Danh sách khóa đã được tải lại; kiểm tra rồi thử lại nếu cần.'
const DEV_01_ID = DEV_01.split('/').pop()

const tabs = (page: Page) => page.getByRole('tablist', { name: 'Thông tin máy' })
const tab = (page: Page, name: string) => tabs(page).getByRole('tab', { name })
const slotTable = (page: Page) => page.getByRole('table', { name: 'Danh sách ngăn' })
const keyTable = (page: Page) => page.getByRole('table', { name: 'Lịch sử khóa kiosk' })
const conditions = (page: Page) => page.getByRole('list', { name: 'Điều kiện bán hàng' })
const deleteControls = (page: Page) => page.getByRole('button', { name: /xóa|xoá|delete|remove/i }).filter({ hasNotText: /bộ lọc/i })

async function addSlot(page: Page, code: string, capacity: string) {
  await page.getByRole('button', { name: 'Thêm ngăn' }).click()
  const sheet = page.getByRole('dialog', { name: 'Thêm ngăn' })
  await sheet.getByRole('textbox', { name: 'Mã ngăn' }).fill(code)
  await sheet.getByRole('textbox', { name: /Sức chứa/ }).fill(capacity)
  await sheet.getByRole('button', { name: 'Thêm ngăn' }).click()
  return sheet
}

test('Luồng trọn: tạo sản phẩm → đăng ký máy → 2 ngăn → cấp khóa (hiện 1 lần, sao chép) → bật Hoạt động', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => undefined)
  await loginAs(page, 'ADMIN')
  // The mock keeps data in memory until a full reload: from here on only in-app navigation.
  await page.goto('/admin/products')
  await page.getByRole('button', { name: 'Thêm sản phẩm' }).click()
  const product = page.getByRole('dialog', { name: 'Thêm sản phẩm' })
  await product.getByRole('textbox', { name: 'SKU' }).fill('xoai-flow-01')
  await product.getByRole('textbox', { name: 'Tên sản phẩm' }).fill('Xoài cắt hộp')
  await product.getByRole('textbox', { name: /Giá bán/ }).fill('35000')
  await product.getByRole('button', { name: 'Thêm sản phẩm' }).click()
  await expect(product).toHaveCount(0)
  await expect(page.getByRole('table', { name: 'Danh sách sản phẩm' })).toContainText('35.000 ₫')

  await page.getByRole('navigation', { name: 'Quản trị' }).getByRole('link', { name: 'Máy bán hàng' }).click()
  await page.getByRole('button', { name: 'Đăng ký máy' }).click()
  const register = page.getByRole('dialog', { name: 'Đăng ký máy' })
  await register.getByRole('textbox', { name: 'Mã máy' }).fill('fv-flow-01')
  await register.getByRole('textbox', { name: 'Tên máy' }).fill('Máy sảnh C')
  await register.getByRole('textbox', { name: 'Vị trí đặt máy' }).fill('Tòa C, tầng trệt')
  await register.getByRole('button', { name: 'Đăng ký máy' }).click()
  await expect(register).toHaveCount(0)
  await page.getByRole('link', { name: 'FV-FLOW-01' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Máy sảnh C' })).toBeVisible()

  // Overview says what is missing and leads to it.
  await expect(tab(page, 'Tổng quan')).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByText(/^Còn thiếu: ngăn đang hoạt động, khóa kiosk đang dùng\./)).toBeVisible()
  await conditions(page).getByRole('button', { name: 'Thêm ngăn' }).click()
  await page.waitForURL(/\?tab=slots$/)
  // The overview panel is gone: focus lands on the main button of the tab it led to, not on <body>.
  await expect(page.getByRole('button', { name: 'Thêm ngăn' })).toBeFocused()
  await expect(page.getByText('Máy chưa có ngăn nào. Bấm “Thêm ngăn” để khai báo vị trí chứa hộp, ví dụ A1, A2.')).toBeVisible()

  let sheet = await addSlot(page, 'a1', '6')
  await expect(sheet).toHaveCount(0)
  await expect(slotTable(page).getByRole('row').filter({ hasText: 'A1' })).toContainText('6 hộp')
  // Same code, other case: 409 once under the slot code field.
  sheet = await addSlot(page, 'A1', '6')
  const code = sheet.getByRole('textbox', { name: 'Mã ngăn' })
  await expect(code).toHaveAccessibleDescription(SLOT_TAKEN)
  await expect(code).toBeFocused()
  await expect(sheet.getByText(SLOT_TAKEN)).toHaveCount(1)
  await code.fill('a2')
  await sheet.getByRole('button', { name: 'Thêm ngăn' }).click()
  await expect(sheet).toHaveCount(0)
  await expect(slotTable(page).locator('tbody tr')).toHaveCount(2)

  // With slots in place, the slots tab says what comes next and leads there.
  await expect(page.getByRole('note')).toContainText('Tiếp theo: kiểm tra khóa kiosk')
  await page.getByRole('button', { name: 'Mở Khóa kiosk' }).click()
  await page.waitForURL(/\?tab=kiosk$/)
  await expect(tab(page, 'Khóa kiosk')).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('button', { name: 'Cấp khóa', exact: true })).toBeFocused()
  await expect(page.getByText('Máy chưa có khóa nào. Bấm “Cấp khóa” để tạo khóa cho kiosk của máy.')).toBeVisible()
  await page.getByRole('button', { name: 'Cấp khóa', exact: true }).click()
  const dialog = page.getByRole('alertdialog')
  await dialog.getByRole('button', { name: 'Cấp khóa', exact: true }).click()
  const keyNode = dialog.getByRole('textbox', { name: 'Khóa kiosk' })
  await expect(keyNode).toHaveValue(/^fvk_[a-z0-9]+_\S+$/)
  const apiKey = await keyNode.inputValue()
  await expect(dialog).toContainText('Khóa chỉ hiện lần này')
  const copy = dialog.getByRole('button', { name: 'Sao chép khóa' })
  await expect(copy).toBeFocused()
  await copy.click()
  await expect(dialog.getByRole('status')).toHaveText(/Đã sao chép|Ctrl\+C/)
  // Esc does not close it by accident while the key is shown.
  await page.keyboard.press('Escape')
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Tôi đã lưu khóa, đóng' }).click()
  await expect(dialog).toHaveCount(0)
  // Shown once: gone from the page, only the prefix stays; nothing in storage or the URL.
  expect(await page.content()).not.toContain(apiKey)
  const prefix = apiKey.split('_')[1]
  await expect(keyTable(page).getByRole('row').filter({ hasText: prefix })).toContainText('Đang dùng')
  await expect(page.getByRole('button', { name: /xem khóa|hiện khóa/i })).toHaveCount(0)
  const stored = await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }) + location.href)
  expect(stored.includes(apiKey)).toBe(false)
  await expect(page.getByRole('button', { name: 'Cấp khóa mới' })).toBeVisible()

  await tab(page, 'Tổng quan').click()
  await expect(conditions(page).getByRole('listitem')).toHaveCount(2)
  await expect(conditions(page)).toContainText('Ngăn đang hoạt động: Đã có')
  await expect(conditions(page)).toContainText('2 ngăn Hoạt động.')
  await expect(conditions(page)).toContainText('Khóa kiosk đang dùng: Đã có')
  await expect(page.getByText(/^Còn thiếu:/)).toHaveCount(0)
  await page.getByRole('button', { name: 'Bật bán (Hoạt động)' }).click()
  const confirm = page.getByRole('alertdialog', { name: 'Bật bán cho máy FV-FLOW-01?' })
  await expect(confirm).not.toContainText('còn thiếu')
  await confirm.getByRole('button', { name: 'Bật bán' }).click()
  await expect(confirm).toHaveCount(0)
  await expect(page.getByText('Đang mở bán (kiosk nhận đơn khi có hàng).')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Bật bán (Hoạt động)' })).toHaveCount(0)
  // The button used is gone once ACTIVE: focus moves to the next status button instead of <body>.
  await expect(page.getByRole('button', { name: 'Chuyển sang Bảo trì' })).toBeFocused()
  // The toast says what happened, not the question of the dialog.
  await expect(page.getByText(/^Máy FV-FLOW-01 đã chuyển sang /)).toBeVisible()
  await expect(page.getByText('Bật bán cho máy FV-FLOW-01?')).toHaveCount(0)
  await expect(deleteControls(page)).toHaveCount(0)
})

test.describe('Chi tiết máy (Quản trị viên)', () => {
  test.beforeEach(async ({ page }) => { await loginAs(page, 'ADMIN') })

  test('Thẻ nằm trên URL: mở thẳng ?tab=slots, phím mũi tên chuyển thẻ và đổi URL', async ({ page }) => {
    await page.goto(`${DEV_01}?tab=slots`)
    await expect(tab(page, 'Ngăn')).toHaveAttribute('aria-selected', 'true')
    await expect(slotTable(page).locator('tbody tr')).toHaveCount(3)
    await page.getByLabel('Trạng thái ngăn', { exact: true }).selectOption('ERROR')
    await page.waitForURL(/slotStatus=ERROR/)
    await expect(page.getByText('Không có ngăn nào ở trạng thái này.')).toBeVisible()
    await tab(page, 'Ngăn').focus()
    await page.keyboard.press('ArrowRight')
    await page.waitForURL(/\?tab=kiosk$/)
    await expect(keyTable(page)).toBeVisible()
    await page.keyboard.press('Home')
    await page.waitForURL(url => !url.search)
    await expect(conditions(page)).toBeVisible()
    await page.goto(`${DEV_01}?tab=unknown`)
    await expect(tab(page, 'Tổng quan')).toHaveAttribute('aria-selected', 'true')
  })

  test('Trước khi bật Hoạt động: nói rõ còn thiếu gì nhưng vẫn cho bật (máy chủ không bắt buộc)', async ({ page }) => {
    await page.goto(DEV_03)
    await expect(conditions(page)).toContainText('Ngăn đang hoạt động: Còn thiếu')
    await expect(conditions(page)).toContainText('Khóa kiosk đang dùng: Còn thiếu')
    await page.getByRole('button', { name: 'Bật bán (Hoạt động)' }).click()
    const confirm = page.getByRole('alertdialog')
    await expect(confirm).toContainText('Kiosk chưa bán được ngay vì còn thiếu:')
    await expect(confirm).toContainText('Chưa có ngăn Hoạt động')
    await expect(confirm).toContainText('Chưa có khóa')
    await expect(confirm.getByRole('button', { name: 'Bật bán' })).toBeEnabled()
    await confirm.getByRole('button', { name: 'Hủy' }).click()
    await expect(confirm).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Bật bán (Hoạt động)' })).toBeFocused()
  })

  test('Nút "Cấp khóa" ở Tổng quan mở thẻ Khóa kiosk và đặt focus vào nút Cấp khóa', async ({ page }) => {
    await page.goto(DEV_03)
    await conditions(page).getByRole('button', { name: 'Cấp khóa' }).click()
    await page.waitForURL(/\?tab=kiosk$/)
    await expect(page.getByRole('button', { name: 'Cấp khóa', exact: true })).toBeFocused()
    expect(await page.evaluate(() => document.activeElement === document.body)).toBe(false)
  })

  test('Tổng quan: lỗi tải điều kiện bán có nút Thử lại', async ({ page }) => {
    await page.goto(`${DEV_01}?scenario=error500:/machines/${DEV_01_ID}/slots`)
    await expect(conditions(page)).toContainText('Ngăn đang hoạt động: Chưa rõ')
    await expect(conditions(page).getByRole('button', { name: 'Thử lại: ngăn đang hoạt động' })).toBeVisible()
    await page.goto(`${DEV_01}?scenario=none`)
    await expect(conditions(page)).toContainText('Ngăn đang hoạt động: Đã có')
    await expect(conditions(page).getByRole('button', { name: /^Thử lại/ })).toHaveCount(0)
  })

  test('409 khi thu hồi và khi cấp khóa: lời tiếng Việt đúng nghĩa, hộp thoại theo danh sách khóa mới nhất', async ({ page }) => {
    await page.goto(`${DEV_01}?tab=kiosk&scenario=409`)
    const active = keyTable(page).getByRole('row').filter({ hasText: 'mockactive' })
    await active.getByRole('button', { name: /^Thu hồi khóa/ }).click()
    let dialog = page.getByRole('alertdialog')
    await dialog.getByRole('button', { name: 'Thu hồi khóa' }).click()
    await expect(dialog.getByRole('alert')).toHaveText(KEY_CHANGED)
    await dialog.getByRole('button', { name: 'Hủy' }).click()
    await expect(dialog).toHaveCount(0)

    await page.getByRole('button', { name: 'Cấp khóa mới' }).click()
    dialog = page.getByRole('alertdialog')
    const confirm = dialog.getByRole('button', { name: 'Cấp khóa mới và thu hồi khóa cũ' })
    await confirm.click()
    await expect(dialog.getByRole('alert')).toHaveText(KEY_RACE)
    // After the reload the warning still names the key a click would revoke, and the button is usable again.
    await expect(dialog).toContainText(/Khóa đang dùng fvk_mockactive_\S+ sẽ bị thu hồi ngay/)
    await expect(confirm).toBeEnabled()
    await dialog.getByRole('button', { name: 'Hủy' }).click()
    await page.goto(`${DEV_01}?tab=kiosk&scenario=none`)
  })

  test('409 khi đổi trạng thái hiện bằng tiếng Việt trong hộp xác nhận', async ({ page }) => {
    await page.goto(`${DEV_03}?scenario=409:/machines/20000000-0000-0000-0000-000000000003/status`)
    await page.getByRole('button', { name: 'Chuyển sang Bảo trì' }).click()
    const confirm = page.getByRole('alertdialog')
    await confirm.getByRole('button', { name: 'Chuyển sang Bảo trì' }).click()
    await expect(confirm.getByRole('alert')).toHaveText(STATUS_CONFLICT)
    await confirm.getByRole('button', { name: 'Hủy' }).click()
    await page.goto(`${DEV_03}?scenario=none`)
  })

  test('Thu hồi khóa có xác nhận; sau đó nút đổi thành Cấp khóa', async ({ page }) => {
    await page.goto(`${DEV_01}?tab=kiosk`)
    const active = keyTable(page).getByRole('row').filter({ hasText: 'mockactive' })
    await expect(active).toContainText('Đang dùng')
    await expect(page.getByRole('button', { name: 'Cấp khóa mới' })).toBeVisible()
    await active.getByRole('button', { name: /^Thu hồi khóa/ }).click()
    const confirm = page.getByRole('alertdialog', { name: /^Thu hồi khóa fvk_mockactive_/ })
    await expect(confirm).toContainText('bị từ chối ngay')
    await confirm.getByRole('button', { name: 'Thu hồi khóa' }).click()
    await expect(confirm).toHaveCount(0)
    await expect(active).toContainText('Đã thu hồi')
    await expect(page.getByRole('button', { name: 'Cấp khóa', exact: true })).toBeVisible()
  })

  test('Cấp khóa mới khi đang có khóa: cảnh báo khóa cũ bị thu hồi', async ({ page }) => {
    await page.goto(`${DEV_01}?tab=kiosk`)
    await page.getByRole('button', { name: 'Cấp khóa mới' }).click()
    const dialog = page.getByRole('alertdialog')
    await expect(dialog).toContainText('sẽ bị thu hồi ngay')
    await dialog.getByRole('button', { name: 'Hủy' }).click()
    await expect(dialog).toHaveCount(0)
  })

  test('Khóa đang hiện: nút Quay lại của trình duyệt hỏi trước khi rời, chọn ở lại thì khóa vẫn còn', async ({ page }) => {
    // Opened from the list inside the app, so "back" is an in-app move (a full reload would ask through beforeunload).
    await page.goto('/admin/machines')
    await page.locator(`a[href^="${DEV_03}"]`).first().click()
    await page.getByRole('tab', { name: 'Khóa kiosk' }).click()
    await page.getByRole('button', { name: 'Cấp khóa', exact: true }).click()
    const dialog = page.getByRole('alertdialog')
    await dialog.getByRole('button', { name: 'Cấp khóa', exact: true }).click()
    const key = dialog.getByRole('textbox', { name: 'Khóa kiosk' })
    await expect(key).toHaveValue(/^fvk_/)
    const questions: string[] = []
    page.once('dialog', prompt => { questions.push(prompt.message()); void prompt.dismiss() })
    // The tab switch replaces the entry, so one step back is the list.
    await page.evaluate(() => history.back())
    await expect.poll(() => questions.length).toBe(1)
    expect(questions[0]).toContain('chỉ hiện lần này')
    await expect(page).toHaveURL(new RegExp(`${DEV_03}`))
    await expect(key).toHaveValue(/^fvk_/)
    // Closing the dialog removes the guard: leaving is no longer asked.
    await dialog.getByRole('button', { name: 'Tôi đã lưu khóa, đóng' }).click()
    page.once('dialog', prompt => { questions.push(prompt.message()); void prompt.dismiss() })
    await page.getByRole('link', { name: 'Sản phẩm' }).first().click()
    await expect(page).toHaveURL(/\/admin\/products/)
    expect(questions).toHaveLength(1)
  })

  test('Sửa cấu hình trong Sheet: mã khóa cứng, ngưỡng sai báo dưới ô, lưu thì tên mới hiện ngay', async ({ page }) => {
    await page.goto(DEV_03)
    await page.getByRole('button', { name: 'Sửa cấu hình' }).click()
    const sheet = page.getByRole('dialog', { name: 'Sửa cấu hình máy' })
    await expect(sheet.getByRole('textbox', { name: 'Mã máy' })).toHaveAttribute('readonly', '')
    const minTemperature = sheet.getByRole('textbox', { name: /Nhiệt độ tối thiểu/ })
    await minTemperature.fill('9')
    await sheet.getByRole('button', { name: 'Lưu thay đổi' }).click()
    await expect(minTemperature).toHaveAccessibleDescription('Phải nhỏ hơn nhiệt độ tối đa.')
    await minTemperature.fill('2,5')
    await sheet.getByRole('textbox', { name: 'Tên máy' }).fill('Máy kho 3')
    await sheet.getByRole('button', { name: 'Lưu thay đổi' }).click()
    await expect(sheet).toHaveCount(0)
    await expect(page.getByRole('heading', { level: 1, name: 'Máy kho 3' })).toBeVisible()
    await expect(page.getByText('2,5 – 8 °C')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Sửa cấu hình' })).toBeFocused()
  })

  test('Đổi sức chứa và trạng thái ngăn', async ({ page }) => {
    await page.goto(`${DEV_01}?tab=slots`)
    const b1 = slotTable(page).getByRole('row').filter({ hasText: 'B1' })
    await b1.getByRole('button', { name: 'Sửa sức chứa ngăn B1' }).click()
    let sheet = page.getByRole('dialog', { name: 'Sức chứa ngăn B1' })
    await sheet.getByRole('textbox', { name: /Sức chứa/ }).fill('0')
    await sheet.getByRole('button', { name: 'Lưu sức chứa' }).click()
    await expect(sheet.getByRole('textbox', { name: /Sức chứa/ })).toHaveAccessibleDescription('Sức chứa phải lớn hơn 0.')
    await sheet.getByRole('textbox', { name: /Sức chứa/ }).fill('12')
    await sheet.getByRole('button', { name: 'Lưu sức chứa' }).click()
    await expect(sheet).toHaveCount(0)
    await expect(b1).toContainText('12 hộp')
    await b1.getByRole('button', { name: 'Đổi trạng thái ngăn B1' }).click()
    sheet = page.getByRole('dialog', { name: 'Trạng thái ngăn B1' })
    await sheet.getByRole('radio', { name: /^Lỗi/ }).check()
    await sheet.getByRole('button', { name: 'Đổi trạng thái' }).click()
    await expect(sheet).toHaveCount(0)
    await expect(b1).toContainText('Lỗi')
    await expect(deleteControls(page)).toHaveCount(0)
  })

  test('Máy không tồn tại: giải thích và đường về danh sách', async ({ page }) => {
    await page.goto('/admin/machines/00000000-0000-0000-0000-000000000000')
    await expect(page.getByRole('heading', { level: 1, name: 'Không tìm thấy máy' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Về danh sách máy' })).toBeVisible()
  })

  test('403 ở thẻ Ngăn chỉ còn lời giải thích; lỗi máy chủ khi tải máy có nút Thử lại', async ({ page }) => {
    await page.goto(`${DEV_01}?tab=slots&scenario=403:slots`)
    await expect(page.getByRole('heading', { name: 'Không có quyền truy cập' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Thêm ngăn' })).toHaveCount(0)
    await page.goto(`${DEV_01}?scenario=error500:machines`)
    await expect(page.getByRole('button', { name: 'Thử lại' })).toBeVisible()
    await page.goto(`${DEV_01}?scenario=none`)
    await expect(conditions(page)).toBeVisible()
  })
})

test('Nhân viên chỉ xem: không có thẻ Khóa kiosk, không sửa, không đổi trạng thái, không thêm ngăn', async ({ page }) => {
  await loginAs(page, 'STAFF')
  await page.goto(`${DEV_01}?tab=kiosk`)
  await expect(tab(page, 'Tổng quan')).toHaveAttribute('aria-selected', 'true')
  await expect(tab(page, 'Khóa kiosk')).toHaveCount(0)
  // The URL follows the tab shown instead of keeping a tab this account cannot open.
  await page.waitForURL(url => !new URL(url).searchParams.has('tab'))
  await expect(page.getByText(/Bạn chỉ xem/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Sửa cấu hình' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Bảo trì|Ngừng hoạt động|Bật bán/ })).toHaveCount(0)
  await expect(conditions(page)).toContainText('Chỉ quản trị viên xem và cấp khóa kiosk.')
  await tab(page, 'Ngăn').click()
  await expect(slotTable(page).locator('tbody tr')).toHaveCount(3)
  await expect(page.getByRole('button', { name: 'Thêm ngăn' })).toHaveCount(0)
  await expect(slotTable(page).getByRole('button', { name: /Sửa sức chứa|Đổi trạng thái/ })).toHaveCount(0)
  await expect(deleteControls(page)).toHaveCount(0)
})

for (const theme of THEMES) {
  test(`Ảnh + axe: machine-detail (${theme})`, async ({ page }, testInfo) => {
    await useThemeChoice(page, theme)
    await loginAs(page, 'ADMIN')
    await page.goto(DEV_03)
    await auditScreen(page, testInfo, 'machine-detail', theme, () => expect(conditions(page)).toContainText('Còn thiếu'))
  })

  test(`Ảnh + axe: machine-detail-slots (${theme})`, async ({ page }, testInfo) => {
    await useThemeChoice(page, theme)
    await loginAs(page, 'ADMIN')
    await page.goto(`${DEV_01}?tab=slots`)
    await auditScreen(page, testInfo, 'machine-detail-slots', theme, () => expect(slotTable(page).locator('tbody tr')).toHaveCount(3))
  })

  test(`Ảnh + axe: machine-detail-key (${theme})`, async ({ page }, testInfo) => {
    await useThemeChoice(page, theme)
    await loginAs(page, 'ADMIN')
    await page.goto(`${DEV_03}?tab=kiosk`)
    await page.getByRole('button', { name: 'Cấp khóa', exact: true }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Cấp khóa', exact: true }).click()
    await auditScreen(page, testInfo, 'machine-detail-key', theme, () => expect(page.getByRole('alertdialog').getByRole('textbox', { name: 'Khóa kiosk' })).toHaveValue(/^fvk_/))
  })
}
