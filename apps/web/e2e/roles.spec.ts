// A3 Vai trò & quyền (issue FE 3.2) on the mock of the backend #48 API. Done criteria: after saving, the screen says
// which permissions were added/removed for which role (aria-live), and STAFF cannot get in (no nav item, typed URL → 403
// from the route guard). Also: locked ADMIN cells, undo, leave guard, 400/409/403/500/empty, and screenshots + axe.
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { auditScreen, loginAs, THEMES, useThemeChoice } from './support.ts'

const STAFF_ROLE = '10000000-0000-0000-0000-000000000002'
const matrix = (page: Page) => page.getByRole('table', { name: /Ma trận quyền/ })
const box = (page: Page, name: string) => matrix(page).getByRole('checkbox', { name, exact: true })
const result = (page: Page) => page.locator('#roles-save-result')
const bar = (page: Page) => page.getByText(/thay đổi chưa lưu|Chưa có thay đổi nào/)
const ready = (page: Page) => expect(box(page, 'Nhân viên: Xem thanh toán')).toBeVisible()

async function openRoles(page: Page, query = '') {
  await page.goto(`/admin/roles${query}`)
}

test.describe('màn Vai trò & quyền (ADMIN)', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, 'ADMIN')
    await openRoles(page)
    await ready(page)
  })

  test('Mục menu có trong nhóm Hệ thống; ma trận gom quyền theo nhóm, cột là vai trò', async ({ page }) => {
    const nav = page.getByRole('navigation', { name: 'Quản trị' })
    await expect(nav.getByRole('link', { name: 'Vai trò & quyền', exact: true })).toHaveAttribute('aria-current', 'page')
    await expect(matrix(page).getByRole('columnheader', { name: /Quản trị viên/ })).toBeVisible()
    await expect(matrix(page).getByRole('columnheader', { name: /Nhân viên/ })).toBeVisible()
    for (const group of ['Tài khoản & phân quyền', 'Sản phẩm', 'Máy, ngăn & khóa kiosk', 'Lô hàng', 'Tồn kho', 'Đơn hàng', 'Thanh toán']) {
      await expect(matrix(page).getByRole('columnheader', { name: group, exact: true })).toBeVisible()
    }
    await expect(box(page, 'Nhân viên: Xem đơn hàng')).toBeChecked()
    await expect(box(page, 'Nhân viên: Xem thanh toán')).not.toBeChecked()
    await expect(bar(page)).toHaveText('Chưa có thay đổi nào.')
    await expect(page.getByRole('button', { name: 'Lưu thay đổi' })).toBeDisabled()
  })

  test('Quyền cốt lõi của Quản trị viên bị khóa kèm lý do, vẫn nhận focus và không bỏ được', async ({ page }) => {
    for (const name of ['Quản trị viên: Tạo, sửa, khóa/mở tài khoản', 'Quản trị viên: Xem và đổi quyền của vai trò']) {
      const locked = box(page, name)
      await expect(locked).toHaveAttribute('aria-disabled', 'true')
      await expect(locked).toHaveAccessibleDescription(/Quản trị viên luôn giữ quyền này/)
      await locked.focus()
      await expect(locked).toBeFocused()
      await page.keyboard.press('Space')
      await locked.click({ force: true })
      await expect(locked).toBeChecked()
    }
    await expect(bar(page)).toHaveText('Chưa có thay đổi nào.')
    // The same permission stays free for STAFF.
    await expect(box(page, 'Nhân viên: Tạo, sửa, khóa/mở tài khoản')).not.toHaveAttribute('aria-disabled', 'true')
  })

  test('Đổi bằng bàn phím, ô đã đổi được đánh dấu; Hoàn tác trả về như cũ', async ({ page }) => {
    const pay = box(page, 'Nhân viên: Xem thanh toán')
    await pay.focus()
    await page.keyboard.press('Space')
    await expect(pay).toBeChecked()
    await expect(pay).toHaveAccessibleDescription(/Sẽ thêm \(chưa lưu\)/)
    await box(page, 'Nhân viên: Xem đơn hàng').uncheck()
    await expect(box(page, 'Nhân viên: Xem đơn hàng')).toHaveAccessibleDescription(/Sẽ bỏ/)
    await expect(bar(page)).toContainText('2 thay đổi chưa lưu')
    await page.getByRole('button', { name: 'Hoàn tác thay đổi' }).click()
    await expect(pay).not.toBeChecked()
    await expect(box(page, 'Nhân viên: Xem đơn hàng')).toBeChecked()
    await expect(bar(page)).toHaveText('Chưa có thay đổi nào.')
  })

  test('Lưu một lần: hộp xác nhận liệt kê thay đổi, lưu xong báo rõ quyền thêm/bớt của từng vai trò (aria-live) và giữ khi quay lại', async ({ page }) => {
    await box(page, 'Nhân viên: Xem thanh toán').check()
    await box(page, 'Nhân viên: Tạo, sửa, đổi trạng thái sản phẩm').check()
    await box(page, 'Nhân viên: Xem đơn hàng').uncheck()
    await box(page, 'Quản trị viên: Xem nhật ký webhook thanh toán').uncheck()
    await page.getByRole('button', { name: 'Lưu thay đổi' }).click()
    const dialog = page.getByRole('alertdialog', { name: 'Lưu thay đổi quyền?' })
    await expect(dialog).toContainText('Quản trị viên · bỏ: Xem nhật ký webhook thanh toán')
    await expect(dialog).toContainText('Nhân viên · thêm: Xem thanh toán, Tạo, sửa, đổi trạng thái sản phẩm · bỏ: Xem đơn hàng')
    await dialog.getByRole('button', { name: 'Lưu thay đổi' }).click()
    await expect(dialog).toHaveCount(0)

    await expect(result(page)).toHaveAttribute('aria-live', 'polite')
    await expect(result(page)).toContainText(/Đã lưu quyền lúc \d{2}\/\d{2}\/\d{4} \d{2}:\d{2}/)
    await expect(result(page)).toContainText('Quản trị viên · bỏ: Xem nhật ký webhook thanh toán')
    await expect(result(page)).toContainText('Nhân viên · thêm: Xem thanh toán, Tạo, sửa, đổi trạng thái sản phẩm · bỏ: Xem đơn hàng')
    await expect(result(page)).toBeFocused()
    await expect(bar(page)).toHaveText('Chưa có thay đổi nào.')

    // Saved on the (mock) server: leave and come back inside the app.
    await page.getByRole('navigation', { name: 'Quản trị' }).getByRole('link', { name: 'Tài khoản', exact: true }).click()
    await expect(page).toHaveURL(/\/admin\/users$/)
    await page.getByRole('navigation', { name: 'Quản trị' }).getByRole('link', { name: 'Vai trò & quyền', exact: true }).click()
    await ready(page)
    await expect(box(page, 'Nhân viên: Xem thanh toán')).toBeChecked()
    await expect(box(page, 'Nhân viên: Xem đơn hàng')).not.toBeChecked()
    await expect(box(page, 'Quản trị viên: Xem nhật ký webhook thanh toán')).not.toBeChecked()
  })

  test('Rời trang khi còn thay đổi chưa lưu thì được hỏi; Hủy thì ở lại', async ({ page }) => {
    await box(page, 'Nhân viên: Xem thanh toán').check()
    const users = page.getByRole('navigation', { name: 'Quản trị' }).getByRole('link', { name: 'Tài khoản', exact: true })
    page.once('dialog', dialog => { expect(dialog.message()).toContain('chưa lưu'); void dialog.dismiss() })
    await users.click()
    await expect(page).toHaveURL(/\/admin\/roles$/)
    await expect(box(page, 'Nhân viên: Xem thanh toán')).toBeChecked()
    page.once('dialog', dialog => { void dialog.accept() })
    await users.click()
    await expect(page).toHaveURL(/\/admin\/users$/)
  })

  test('Nút Back khi còn thay đổi: Hủy thì URL về /admin/roles và ma trận giữ nguyên thay đổi', async ({ page }) => {
    // Reach the screen through in-app links so Back is a same-document (popstate) navigation.
    const nav = page.getByRole('navigation', { name: 'Quản trị' })
    await nav.getByRole('link', { name: 'Tài khoản', exact: true }).click()
    await expect(page.getByRole('table', { name: 'Danh sách tài khoản' })).toBeVisible()
    await nav.getByRole('link', { name: 'Vai trò & quyền', exact: true }).click()
    await ready(page)
    await box(page, 'Nhân viên: Xem thanh toán').check()
    let asked = 0
    page.on('dialog', dialog => { asked += 1; void dialog.dismiss() })
    await page.evaluate(() => history.back())
    await expect.poll(() => asked).toBe(1)
    await expect(page).toHaveURL(/\/admin\/roles$/)
    await expect(box(page, 'Nhân viên: Xem thanh toán')).toBeChecked()
    await expect(bar(page)).toContainText('1 thay đổi chưa lưu')
  })

  test('Đăng xuất khi còn thay đổi: Hủy thì vẫn đăng nhập và ở lại màn', async ({ page }) => {
    await box(page, 'Nhân viên: Xem thanh toán').check()
    let asked = 0
    page.on('dialog', dialog => { asked += 1; void dialog.dismiss() })
    await page.getByRole('button', { name: /^Tài khoản: / }).click()
    await page.getByRole('menuitem', { name: 'Đăng xuất' }).click()
    await expect.poll(() => asked).toBe(1)
    await expect(page).toHaveURL(/\/admin\/roles$/)
    await expect(box(page, 'Nhân viên: Xem thanh toán')).toBeChecked()
    // Still signed in: the next API call (saving) works.
    await page.getByRole('button', { name: 'Lưu thay đổi' }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Lưu thay đổi' }).click()
    await expect(result(page)).toContainText('Nhân viên · thêm: Xem thanh toán')
  })

  test('Hết phiên khi còn thay đổi: về /login?next=… ngay, không hỏi rời trang', async ({ page }) => {
    await box(page, 'Nhân viên: Xem thanh toán').check()
    let asked = 0
    page.on('dialog', dialog => { asked += 1; void dialog.dismiss() })
    // The mock "expire" scenario (remembered in sessionStorage, no reload): tokens issued before now get 401.
    await page.evaluate(() => sessionStorage.setItem('fv-mock-scenario', 'expire'))
    await page.getByRole('button', { name: 'Lưu thay đổi' }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Lưu thay đổi' }).click()
    await expect(page).toHaveURL(/\/login\?next=%2Fadmin%2Froles$/)
    await expect(page.getByLabel('Email')).toBeVisible()
    expect(asked).toBe(0)
  })

  test('409 khi lưu: hộp xác nhận vẫn mở, báo lỗi theo vai trò, thay đổi giữ nguyên', async ({ page }) => {
    await openRoles(page, `?scenario=409:/roles/${STAFF_ROLE}/permissions`)
    await ready(page)
    await box(page, 'Nhân viên: Xem thanh toán').check()
    await page.getByRole('button', { name: 'Lưu thay đổi' }).click()
    const dialog = page.getByRole('alertdialog')
    await dialog.getByRole('button', { name: 'Lưu thay đổi' }).click()
    await expect(dialog.getByRole('alert')).toHaveText('Nhân viên: Máy chủ từ chối vì quyền của vai trò này xung đột với dữ liệu hiện tại. Hãy tải lại dữ liệu rồi thử lại.')
    await dialog.getByRole('button', { name: 'Hủy' }).click()
    await expect(box(page, 'Nhân viên: Xem thanh toán')).toBeChecked()
    await expect(bar(page)).toContainText('1 thay đổi chưa lưu')
    await expect(page.getByRole('button', { name: 'Lưu thay đổi' })).toBeFocused()
    await openRoles(page, '?scenario=none')
  })

  test('400 khi lưu: lời giải thích tiếng Việt và bước tiếp theo', async ({ page }) => {
    await openRoles(page, `?scenario=400:/roles/${STAFF_ROLE}/permissions`)
    await ready(page)
    await box(page, 'Nhân viên: Xem thanh toán').check()
    await page.getByRole('button', { name: 'Lưu thay đổi' }).click()
    const dialog = page.getByRole('alertdialog')
    await dialog.getByRole('button', { name: 'Lưu thay đổi' }).click()
    await expect(dialog.getByRole('alert')).toHaveText('Nhân viên: Dữ liệu gửi lên chưa hợp lệ. Hãy tải lại dữ liệu rồi thử lại.')
    await openRoles(page, '?scenario=none')
  })

  test('API trả 403, lỗi 500 và dữ liệu rỗng đều có lời giải thích', async ({ page }) => {
    await openRoles(page, '?scenario=403:roles')
    await expect(page.getByRole('heading', { name: 'Không có quyền truy cập' })).toBeVisible()
    await expect(matrix(page)).toHaveCount(0)
    await openRoles(page, '?scenario=error500:roles')
    await expect(page.getByText('Hệ thống đang gặp sự cố. Vui lòng thử lại.')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Thử lại' })).toBeVisible()
    await openRoles(page, '?scenario=empty:roles')
    await expect(page.getByText(/Máy chủ chưa trả về vai trò nào/)).toBeVisible()
    await openRoles(page, '?scenario=none')
    await ready(page)
  })
})

test('STAFF không thấy mục Vai trò & quyền; gõ thẳng URL gặp trang 403 của bộ chặn route, không có ma trận', async ({ page }) => {
  await loginAs(page, 'STAFF')
  await expect(page.getByRole('navigation', { name: 'Quản trị' }).getByRole('link', { name: 'Vai trò & quyền' })).toHaveCount(0)
  await openRoles(page)
  await expect(page.getByRole('heading', { level: 1, name: 'Không có quyền truy cập' })).toBeVisible()
  // "Mục này chỉ dành cho…" is the route-guard version: the screen (and its API calls) never mounted.
  await expect(page.getByText('Mục này chỉ dành cho Quản trị viên.')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Vai trò & quyền' })).toHaveCount(0)
  await expect(matrix(page)).toHaveCount(0)
  await expect(page).toHaveURL(/\/admin\/roles$/)
})

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  test(`Tab qua ma trận ở ${viewport.width}px: ô đang focus không bị thanh Lưu/Hoàn tác che`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await loginAs(page, 'ADMIN')
    await openRoles(page)
    await ready(page)
    await box(page, 'Nhân viên: Xem đơn hàng').uncheck()
    await matrix(page).getByRole('checkbox').first().focus()
    await page.evaluate(() => window.scrollTo({ top: 0 }))
    await matrix(page).getByRole('checkbox').first().focus()
    const actions = page.locator('[data-roles-actions]')
    let checked = 0
    for (let step = 0; step < 40; step++) {
      const focused = page.locator(':focus')
      if ((await focused.getAttribute('type')) !== 'checkbox') break
      const [cell, barBox] = [await focused.boundingBox(), await actions.boundingBox()]
      expect(cell && barBox, 'boxes').toBeTruthy()
      const name = await focused.getAttribute('aria-label')
      expect(cell!.y + cell!.height <= barBox!.y || cell!.y >= barBox!.y + barBox!.height, `${name} bị thanh hành động che`).toBe(true)
      expect(cell!.y >= 0 && cell!.y + cell!.height <= viewport.height, `${name} nằm ngoài màn hình`).toBe(true)
      checked += 1
      await page.keyboard.press('Tab')
    }
    expect(checked).toBe(30)
  })
}

for (const theme of THEMES) {
  test(`Ảnh + axe: roles (${theme})`, async ({ page }, testInfo) => {
    await useThemeChoice(page, theme)
    await loginAs(page, 'ADMIN')
    await openRoles(page)
    await ready(page)
    // One pending change so the marked cells and the action bar are part of the audit.
    await box(page, 'Nhân viên: Xem thanh toán').check()
    await auditScreen(page, testInfo, 'roles', theme, () => ready(page))
  })
}
