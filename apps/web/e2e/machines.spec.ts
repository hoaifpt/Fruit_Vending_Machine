// C2 Máy bán hàng (issue FE 3.4) on the mock API. Done criterion: looking at the list tells at once which machines do not
// sell and why. Also: administrative status kept apart from connectivity (no online/offline guess), registration in a
// Sheet starting INACTIVE, duplicate code (409, including the race) once under the code field, client checks of the
// thresholds, filters/sort in the URL, row → /admin/machines/:id, STAFF view-only, 403/500; screenshots + axe.
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { auditScreen, loginAs, THEMES, useThemeChoice } from './support.ts'

const table = (page: Page) => page.getByRole('table', { name: 'Danh sách máy' })
const row = (page: Page, code: string) => table(page).getByRole('row').filter({ hasText: code })
const ready = (page: Page) => expect(row(page, 'DEV-MACHINE-01')).toBeVisible()
const deleteControls = (page: Page) => page.getByRole('button', { name: /xóa|xoá|delete|remove/i }).filter({ hasNotText: /bộ lọc/i })
const TAKEN = 'Mã máy này đã được dùng cho một máy khác (không phân biệt hoa thường). Hãy nhập mã khác.'

async function openRegister(page: Page) {
  await page.getByRole('button', { name: 'Đăng ký máy' }).click()
  const sheet = page.getByRole('dialog', { name: 'Đăng ký máy' })
  await expect(sheet).toBeVisible()
  return sheet
}
async function fillRegister(page: Page, code: string) {
  const sheet = await openRegister(page)
  await sheet.getByRole('textbox', { name: 'Mã máy' }).fill(code)
  await sheet.getByRole('textbox', { name: 'Tên máy' }).fill('Máy sảnh B')
  await sheet.getByRole('textbox', { name: 'Vị trí đặt máy' }).fill('Tòa B, tầng 1')
  return sheet
}

test.describe('màn Máy bán hàng (Quản trị viên)', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, 'ADMIN')
    await page.goto('/admin/machines')
    await ready(page)
  })

  test('Nhìn danh sách biết ngay máy nào ngừng bán và vì sao; liên lạc tách khỏi trạng thái quản trị', async ({ page }) => {
    await expect(row(page, 'DEV-MACHINE-01')).toContainText('Hoạt động')
    await expect(row(page, 'DEV-MACHINE-01')).toContainText('Đang mở bán (kiosk nhận đơn khi có hàng).')
    await expect(row(page, 'DEV-MACHINE-01')).toContainText(/\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}/)
    await expect(row(page, 'DEV-MACHINE-02')).toContainText('Bảo trì')
    await expect(row(page, 'DEV-MACHINE-02')).toContainText('Ngừng bán: đang bảo trì.')
    await expect(row(page, 'DEV-MACHINE-02')).toContainText('chuyển về Hoạt động trong chi tiết máy')
    await expect(row(page, 'DEV-MACHINE-03')).toContainText('Ngừng hoạt động')
    await expect(row(page, 'DEV-MACHINE-03')).toContainText('Ngừng bán: mới đăng ký, chưa bật bán.')
    await expect(row(page, 'DEV-MACHINE-03')).toContainText('Chưa từng kết nối')
    // The API has no connectivity value: nothing claims a machine is online or offline.
    await expect(table(page).getByText(/Trực tuyến|Mất kết nối/)).toHaveCount(0)
    await expect(table(page).getByRole('columnheader', { name: /Liên lạc gần nhất/ })).toBeVisible()
    await expect(deleteControls(page)).toHaveCount(0)
  })

  test('Mã máy dẫn tới trang chi tiết /admin/machines/:id', async ({ page }) => {
    await row(page, 'DEV-MACHINE-02').getByRole('link', { name: 'DEV-MACHINE-02' }).click()
    await page.waitForURL(/\/admin\/machines\/20000000-0000-0000-0000-000000000002$/)
  })

  test('Đăng ký máy: mã trùng (409) báo một lần dưới ô mã; sửa mã thì máy mới hiện Ngừng hoạt động', async ({ page }) => {
    const sheet = await fillRegister(page, 'dev-machine-01')
    await expect(sheet).toContainText('Máy mới ở trạng thái Ngừng hoạt động')
    await sheet.getByRole('button', { name: 'Đăng ký máy' }).click()
    const code = sheet.getByRole('textbox', { name: 'Mã máy' })
    await expect(code).toHaveAccessibleDescription(TAKEN)
    await expect(code).toBeFocused()
    await expect(sheet.getByRole('alert')).toHaveText('Vui lòng kiểm tra các trường được đánh dấu.')
    await expect(sheet.getByText(TAKEN)).toHaveCount(1)

    await code.fill('fv-test-01')
    await expect(code).not.toHaveAttribute('aria-invalid', 'true')
    await sheet.getByRole('button', { name: 'Đăng ký máy' }).click()
    await expect(sheet).toHaveCount(0)
    await expect(row(page, 'FV-TEST-01')).toContainText('Máy sảnh B')
    await expect(row(page, 'FV-TEST-01')).toContainText('Ngừng hoạt động')
    await expect(row(page, 'FV-TEST-01')).toContainText('Ngừng bán: mới đăng ký, chưa bật bán.')
    await expect(row(page, 'FV-TEST-01')).toContainText('Chưa từng kết nối')
    await expect(page.getByRole('button', { name: 'Đăng ký máy' })).toBeFocused()
  })

  test('Hai người đăng ký cùng lúc (409 chung của máy chủ) vẫn báo tiếng Việt dưới ô mã', async ({ page }) => {
    await page.goto('/admin/machines?scenario=409')
    await ready(page)
    const sheet = await fillRegister(page, 'fv-race-01')
    await sheet.getByRole('button', { name: 'Đăng ký máy' }).click()
    await expect(sheet.getByRole('textbox', { name: 'Mã máy' })).toHaveAccessibleDescription(TAKEN)
    await page.goto('/admin/machines?scenario=none')
  })

  test('Ngưỡng sai báo dưới đúng ô trước khi gửi; 400 từ máy chủ hiện dưới trường', async ({ page }) => {
    const sheet = await fillRegister(page, 'fv-test-02')
    const minTemperature = sheet.getByRole('textbox', { name: /Nhiệt độ tối thiểu/ })
    await minTemperature.fill('8')
    await sheet.getByRole('textbox', { name: /Độ ẩm tối đa/ }).fill('80,555')
    await sheet.getByRole('button', { name: 'Đăng ký máy' }).click()
    await expect(minTemperature).toHaveAccessibleDescription('Phải nhỏ hơn nhiệt độ tối đa.')
    await expect(minTemperature).toBeFocused()
    await expect(sheet.getByRole('textbox', { name: /Độ ẩm tối đa/ })).toHaveAccessibleDescription('Tối đa 2 chữ số thập phân.')
    await sheet.getByRole('button', { name: 'Hủy' }).click()

    await page.goto('/admin/machines?scenario=400')
    await ready(page)
    const again = await fillRegister(page, 'fv-test-03')
    await again.getByRole('button', { name: 'Đăng ký máy' }).click()
    const code = again.getByRole('textbox', { name: 'Mã máy' })
    await expect(code).toHaveAccessibleDescription('Giá trị không hợp lệ (mô phỏng).')
    await expect(again).toBeVisible()
    await page.goto('/admin/machines?scenario=none')
  })

  test('Đóng Sheet bằng Esc trả focus về nút Đăng ký máy', async ({ page }) => {
    const create = page.getByRole('button', { name: 'Đăng ký máy' })
    await create.focus()
    await page.keyboard.press('Enter')
    const sheet = page.getByRole('dialog', { name: 'Đăng ký máy' })
    await expect(sheet.getByRole('textbox', { name: 'Mã máy' })).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(sheet).toHaveCount(0)
    await expect(create).toBeFocused()
  })

  test('Bộ lọc và sắp xếp nằm trên URL; rỗng theo lọc có nút xóa bộ lọc', async ({ page }) => {
    await page.getByLabel('Trạng thái').selectOption('MAINTENANCE')
    await page.waitForURL(/status=MAINTENANCE/)
    await expect(row(page, 'DEV-MACHINE-02')).toBeVisible()
    await expect(row(page, 'DEV-MACHINE-01')).toHaveCount(0)
    await page.getByLabel('Trạng thái').selectOption('')
    await table(page).getByRole('button', { name: /^Mã máy/ }).click()
    await page.waitForURL(/sort=code%2Casc|sort=code,asc/)
    await expect(table(page).getByRole('columnheader', { name: /Mã máy/ })).toHaveAttribute('aria-sort', 'ascending')
    await expect(table(page).getByRole('row').nth(1)).toContainText('DEV-MACHINE-01')
    await page.getByLabel('Tìm theo mã, tên hoặc vị trí').fill('khong-co-may')
    await page.waitForURL(/search=khong-co-may/)
    await expect(page.getByText('Không có máy nào khớp bộ lọc.')).toBeVisible()
    await page.getByRole('button', { name: /Xóa bộ lọc/ }).first().click()
    await page.waitForURL(url => !url.search.includes('search='))
    await ready(page)
  })

  test('Ở 390px: ô Sắp xếp hiện "Mặc định" khi đang theo thứ tự mặc định, mọi mục chọn được; dòng trong ô Bán hàng căn trái', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    const select = page.getByRole('combobox', { name: 'Sắp xếp' })
    await expect(select).toBeVisible()
    await expect(select).toHaveValue('')
    await expect(select.locator('option:checked')).toHaveText('Mặc định')

    await select.selectOption('code,asc')
    await page.waitForURL(/sort=code%2Casc|sort=code,asc/)
    await expect(select).toHaveValue('code,asc')
    await expect(select.locator('option', { hasText: 'Mặc định' })).toHaveCount(0)
    await expect(table(page).locator('tbody tr').first()).toContainText('DEV-MACHINE-01')
    await select.selectOption('code,desc')
    await page.waitForURL(/sort=code%2Cdesc|sort=code,desc/)
    await expect(select).toHaveValue('code,desc')

    // Badge, reason and next step share one left edge in the card.
    const cell = row(page, 'DEV-MACHINE-02').locator('td[data-label="Bán hàng"]')
    const lines = cell.locator(':scope > span > *')
    await expect(lines).toHaveCount(3)
    const lefts = await lines.evaluateAll(nodes => nodes.map(node => Math.round(node.getBoundingClientRect().left)))
    expect(new Set(lefts).size).toBe(1)
    // The badge carries no generic hidden description: the lines below explain this machine.
    await expect(cell.locator('.sr-only')).toHaveCount(0)
    await expect(cell.locator('[title]')).toHaveCount(0)
  })

  test('API trả 403: chỉ còn lời giải thích, ẩn nút đăng ký và bộ lọc', async ({ page }) => {
    await page.goto('/admin/machines?scenario=403:machines')
    await expect(page.getByRole('heading', { name: 'Không có quyền truy cập' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Đăng ký máy' })).toHaveCount(0)
    await expect(page.getByRole('group', { name: 'Bộ lọc' })).toHaveCount(0)
    await page.goto('/admin/machines?scenario=none')
  })

  test('Lỗi máy chủ khi tải: thông báo và nút Thử lại; danh sách rỗng có hướng dẫn', async ({ page }) => {
    await page.goto('/admin/machines?scenario=error500:machines')
    await expect(page.getByRole('button', { name: 'Thử lại' })).toBeVisible()
    await page.goto('/admin/machines?scenario=empty:machines')
    await expect(page.getByText('Chưa có máy nào. Bấm “Đăng ký máy” để thêm máy đầu tiên.')).toBeVisible()
    await page.goto('/admin/machines?scenario=none')
    await ready(page)
  })
})

test('Nhân viên chỉ xem: không có nút đăng ký, lý do ngừng bán hướng tới quản trị viên', async ({ page }) => {
  await loginAs(page, 'STAFF')
  await page.goto('/admin/machines')
  await ready(page)
  await expect(page.getByText(/Bạn chỉ xem/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Đăng ký máy' })).toHaveCount(0)
  await expect(row(page, 'DEV-MACHINE-02')).toContainText('Báo quản trị viên khi máy đã sửa xong.')
  await expect(deleteControls(page)).toHaveCount(0)
})

for (const theme of THEMES) {
  test(`Ảnh + axe: machines (${theme})`, async ({ page }, testInfo) => {
    await useThemeChoice(page, theme)
    await loginAs(page, 'ADMIN')
    await page.goto('/admin/machines')
    await auditScreen(page, testInfo, 'machines', theme, () => ready(page))
  })

  test(`Ảnh + axe: machines-form (${theme})`, async ({ page }, testInfo) => {
    await useThemeChoice(page, theme)
    await loginAs(page, 'ADMIN')
    await page.goto('/admin/machines')
    await ready(page)
    const sheet = await openRegister(page)
    await sheet.getByRole('button', { name: 'Đăng ký máy' }).click()
    await auditScreen(page, testInfo, 'machines-form', theme, () => expect(sheet.getByRole('textbox', { name: 'Mã máy' })).toHaveAttribute('aria-invalid', 'true'))
  })
}
