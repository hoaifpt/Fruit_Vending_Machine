// A2 Tài khoản (issue FE 3.1) on the mock API: the lock button of yourself and of the last ACTIVE admin is refused with
// a reason that keyboard and screen-reader users get (focusable, aria-disabled, aria-describedby), lock/unlock goes
// through a confirmation, create/edit happen in a Sheet; plus screenshots, overflow and axe at 1440/768/390.
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { auditScreen, loginAs, THEMES, useThemeChoice } from './support.ts'

const table = (page: Page) => page.getByRole('table', { name: 'Danh sách tài khoản' })
const row = (page: Page, name: string) => table(page).getByRole('row').filter({ hasText: name })
const ready = (page: Page) => expect(row(page, 'admin@freshvend.test').getByRole('button', { name: /^Khóa/ })).toBeVisible()

test.describe('màn Tài khoản', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, 'ADMIN')
    await page.goto('/admin/users')
    await ready(page)
  })

  test('Nút Khóa của chính mình bị vô hiệu kèm lý do, vẫn nhận focus bằng bàn phím và không mở hộp thoại', async ({ page }) => {
    const lock = row(page, 'admin@freshvend.test').getByRole('button', { name: /^Khóa/ })
    await expect(lock).toHaveAttribute('aria-disabled', 'true')
    await expect(lock).toHaveAccessibleDescription('Không thể khóa chính bạn.')
    await expect(row(page, 'admin@freshvend.test').getByText('Không thể khóa chính bạn.')).toBeVisible()
    await lock.focus()
    await expect(lock).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('alertdialog')).toHaveCount(0)
    // The other active admin can still be locked.
    await expect(row(page, 'admin.ca2@freshvend.test').getByRole('button', { name: /^Khóa/ })).not.toHaveAttribute('aria-disabled', 'true')
  })

  test('Khóa Admin thứ hai qua xác nhận, sau đó Admin còn lại (chính mình) hiện thêm lý do Admin cuối cùng; mở khóa lại được', async ({ page }) => {
    await row(page, 'admin.ca2@freshvend.test').getByRole('button', { name: /^Khóa/ }).click()
    const dialog = page.getByRole('alertdialog', { name: /Khóa tài khoản/ })
    await expect(dialog.getByRole('radio', { name: /^Khóa/ })).toBeChecked()
    await dialog.getByRole('button', { name: 'Khóa', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    await expect(row(page, 'admin.ca2@freshvend.test').getByRole('button', { name: /^Mở khóa/ })).toBeVisible()
    const self = row(page, 'admin@freshvend.test').getByRole('button', { name: /^Khóa/ })
    await expect(self).toHaveAccessibleDescription('Không thể khóa chính bạn. Đây là Quản trị viên đang hoạt động cuối cùng.')

    await row(page, 'admin.ca2@freshvend.test').getByRole('button', { name: /^Mở khóa/ }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Mở khóa', exact: true }).click()
    await expect(row(page, 'admin.ca2@freshvend.test').getByRole('button', { name: /^Khóa/ })).toBeVisible()
    await expect(self).toHaveAccessibleDescription('Không thể khóa chính bạn.')
  })

  test('Sửa trong Sheet: email bị khóa, chỉ đổi họ tên/điện thoại; 409 khi khóa hiện thông điệp tiếng Việt', async ({ page }) => {
    await row(page, 'staff@freshvend.test').getByRole('button', { name: /^Sửa/ }).click()
    const sheet = page.getByRole('dialog', { name: 'Sửa tài khoản' })
    await expect(sheet.getByRole('textbox', { name: 'Email' })).toHaveAttribute('readonly', '')
    await sheet.getByRole('textbox', { name: 'Họ tên' }).fill('Nhân viên Đã Sửa')
    await sheet.getByRole('button', { name: 'Lưu thay đổi' }).click()
    await expect(sheet).toHaveCount(0)
    await expect(row(page, 'staff@freshvend.test')).toContainText('Nhân viên Đã Sửa')

    await page.goto('/admin/users?scenario=409:/users/11000000-0000-0000-0000-000000000002/status')
    await ready(page)
    await row(page, 'staff@freshvend.test').getByRole('button', { name: /^Khóa/ }).click()
    const dialog = page.getByRole('alertdialog')
    await dialog.getByRole('button', { name: 'Khóa', exact: true }).click()
    // The mock's generic conflict is not a self/last-admin message, so it is shown as is (in Vietnamese).
    await expect(dialog.getByRole('alert')).toHaveText('Thao tác xung đột với trạng thái hiện tại của dữ liệu.')
    await expect(dialog).toBeVisible()
  })

  test('Đóng Sheet/hộp thoại trả focus về nút đã mở: Esc, Hủy và sau khi lưu', async ({ page }) => {
    const create = page.getByRole('button', { name: 'Tạo tài khoản nhân viên' })
    await create.focus()
    await page.keyboard.press('Enter')
    const sheet = page.getByRole('dialog', { name: 'Tạo tài khoản nhân viên' })
    await expect(sheet.getByRole('textbox', { name: 'Họ tên' })).toBeFocused()
    // A click outside does not close the sheet (what was typed is kept); Esc does.
    await sheet.getByRole('textbox', { name: 'Họ tên' }).fill('Đang nhập dở')
    await page.mouse.click(20, 400)
    await expect(sheet.getByRole('textbox', { name: 'Họ tên' })).toHaveValue('Đang nhập dở')
    await page.keyboard.press('Escape')
    await expect(sheet).toHaveCount(0)
    await expect(create).toBeFocused()

    const edit = row(page, 'staff@freshvend.test').getByRole('button', { name: /^Sửa/ })
    await edit.focus()
    await page.keyboard.press('Enter')
    const editSheet = page.getByRole('dialog', { name: 'Sửa tài khoản' })
    await editSheet.getByRole('button', { name: 'Hủy' }).click()
    await expect(edit).toBeFocused()
    await edit.press('Enter')
    await editSheet.getByRole('textbox', { name: 'Điện thoại' }).fill('0911111111')
    await editSheet.getByRole('button', { name: 'Lưu thay đổi' }).click()
    await expect(editSheet).toHaveCount(0)
    await expect(row(page, 'staff@freshvend.test')).toContainText('0911111111')
    await expect(edit).toBeFocused()

    const status = row(page, 'kho.quan1@freshvend.test').locator('[data-focus-key^="user-status-"]')
    await status.focus()
    await page.keyboard.press('Enter')
    await page.keyboard.press('Escape')
    await expect(page.getByRole('alertdialog')).toHaveCount(0)
    await expect(status).toBeFocused()
    await status.press('Enter')
    await page.getByRole('alertdialog').getByRole('button', { name: 'Khóa', exact: true }).click()
    await expect(status).toHaveText('Mở khóa')
    await expect(status).toBeFocused()
    await status.press('Enter')
    await page.getByRole('alertdialog').getByRole('button', { name: 'Mở khóa', exact: true }).click()
    await expect(status).toHaveText('Khóa')
    await expect(status).toBeFocused()
  })

  test('400 từ máy chủ (mật khẩu ngắn): lỗi dưới ô Mật khẩu, ô đó nhận focus, một câu chung cấp form', async ({ page }) => {
    await page.getByRole('button', { name: 'Tạo tài khoản nhân viên' }).click()
    const sheet = page.getByRole('dialog', { name: 'Tạo tài khoản nhân viên' })
    await sheet.getByRole('textbox', { name: 'Họ tên' }).fill('Nhân viên Mới')
    await sheet.getByRole('textbox', { name: 'Email' }).fill('moi@freshvend.test')
    const password = sheet.getByRole('textbox', { name: 'Mật khẩu', exact: true })
    await password.fill('ngan')
    await sheet.getByRole('button', { name: 'Tạo tài khoản' }).click()
    await expect(password).toHaveAttribute('aria-invalid', 'true')
    await expect(password).toHaveAccessibleDescription('Tối thiểu 12 ký tự.')
    await expect(password).toBeFocused()
    await expect(sheet.getByRole('alert')).toHaveText('Vui lòng kiểm tra các trường được đánh dấu.')
  })

  test('Email trùng (409): báo một lần dưới ô Email, cấp form là câu chung', async ({ page }) => {
    await page.getByRole('button', { name: 'Tạo tài khoản nhân viên' }).click()
    const sheet = page.getByRole('dialog', { name: 'Tạo tài khoản nhân viên' })
    await sheet.getByRole('textbox', { name: 'Họ tên' }).fill('Trùng')
    await sheet.getByRole('textbox', { name: 'Email' }).fill('staff@freshvend.test')
    await sheet.getByRole('textbox', { name: 'Mật khẩu', exact: true }).fill('mat-khau-du-dai-12')
    await sheet.getByRole('button', { name: 'Tạo tài khoản' }).click()
    const email = sheet.getByRole('textbox', { name: 'Email' })
    await expect(email).toHaveAccessibleDescription('Email này đã được dùng cho một tài khoản khác. Hãy dùng email khác.')
    await expect(email).toBeFocused()
    await expect(sheet.getByRole('alert')).toHaveText('Vui lòng kiểm tra các trường được đánh dấu.')
    await expect(sheet.getByText('Email này đã được dùng cho một tài khoản khác. Hãy dùng email khác.')).toHaveCount(1)
  })

  test('API trả 403: chỉ còn lời giải thích, ẩn nút tạo và bộ lọc', async ({ page }) => {
    await page.goto('/admin/users?scenario=403:users')
    await expect(page.getByRole('heading', { name: 'Không có quyền truy cập' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Tạo tài khoản nhân viên' })).toHaveCount(0)
    await expect(page.getByRole('group', { name: 'Bộ lọc' })).toHaveCount(0)
    await page.goto('/admin/users?scenario=none')
  })

  test('Bộ lọc nằm trên URL và gửi lên máy chủ', async ({ page }) => {
    await page.getByLabel('Vai trò').selectOption('ADMIN')
    await page.waitForURL(/role=ADMIN/)
    await expect(table(page).getByRole('row').filter({ hasText: 'staff@freshvend.test' })).toHaveCount(0)
    await expect(row(page, 'admin.locked@freshvend.test')).toBeVisible()
    await page.getByLabel('Trạng thái').selectOption('LOCKED')
    await page.waitForURL(/status=LOCKED/)
    await expect(row(page, 'admin@freshvend.test')).toHaveCount(0)
    await page.getByRole('button', { name: /Xóa bộ lọc/ }).first().click()
    await page.waitForURL(url => !url.search.includes('role='))
  })
})

for (const theme of THEMES) {
  test(`Ảnh + axe: users (${theme})`, async ({ page }, testInfo) => {
    await useThemeChoice(page, theme)
    await loginAs(page, 'ADMIN')
    await page.goto('/admin/users')
    await auditScreen(page, testInfo, 'users', theme, () => ready(page))
  })
}
