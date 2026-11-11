// I3 Nạp hộp & rút hộp (issue FE 4.3) on the mock API. Done criterion: a STAFF member loads 5 boxes and takes 1 out
// on a 390px phone in under 2 minutes, and a 409 "slot full" is easy to understand. Also: free places and what the
// batch can still take shown before sending, counts above either refused as typed, 44px touch targets and a numeric
// keyboard, required reason with one-tap reasons, 400/403/401 in the Sheet, screenshots + axe.
import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'
import { auditScreen, loginAs, THEMES, useThemeChoice } from './support.ts'

const MACHINE_1 = '20000000-0000-0000-0000-000000000001'
const MIXED = '50000000-0000-0000-0000-000000000001'
const PINEAPPLE = '50000000-0000-0000-0000-000000000003'
const PHONE = { width: 390, height: 844 }
const column = (page: Page, code: string) => page.locator(`[data-slot-column="${code}"]`)
const loadSheet = (page: Page) => page.getByRole('dialog', { name: 'Nạp hộp vào ngăn' })
const removeSheet = (page: Page) => page.getByRole('dialog', { name: 'Rút hộp khỏi ngăn' })
const ready = (page: Page) => expect(column(page, 'B1')).toContainText('Đang chặn ngăn')

async function expectTouchTarget(locator: Locator, what: string) {
  const box = await locator.boundingBox()
  expect(box, what).not.toBeNull()
  expect(box!.height, `${what}: cao ${box!.height}px`).toBeGreaterThanOrEqual(44)
}

test.describe('Nhân viên trên điện thoại 390px', () => {
  test.use({ viewport: PHONE })
  test.beforeEach(async ({ page }) => { await loginAs(page, 'STAFF') })

  test('Nạp 5 hộp rồi rút 1 hộp: dưới 2 phút, ít bước, vùng chạm ≥ 44px, bàn phím số', async ({ page }) => {
    await page.goto(`/admin/inventory?machineId=${MACHINE_1}`)
    await ready(page)
    let steps = 0
    const step = async (action: () => Promise<unknown>) => { steps += 1; await action() }
    const started = Date.now()

    const b1 = column(page, 'B1')
    await expect(b1).toContainText('2/10 hộp')
    const loadButton = page.getByRole('button', { name: 'Nạp hộp vào ngăn B1', exact: true })
    await expectTouchTarget(loadButton, 'Nạp hộp trên cột ngăn')
    await step(() => loadButton.click())
    const sheet = loadSheet(page)
    await expect(sheet).toBeVisible()
    // Machine and slot come from the column; the batch is the next choice and has focus.
    await expect(sheet.getByLabel('Máy')).toHaveValue(MACHINE_1)
    await expect(sheet.getByRole('combobox', { name: 'Ngăn', exact: true })).toHaveValue('30000000-0000-0000-0000-000000000003')
    await expect(sheet.getByLabel('Lô hàng')).toBeFocused()
    await expect(sheet.getByRole('status')).toContainText('Ngăn B1: còn trống 8/10 chỗ')
    await step(() => sheet.getByLabel('Lô hàng').selectOption(MIXED))
    await expect(sheet.getByRole('status')).toContainText('Lô SEED-MIXED-01: còn nạp được 12 hộp (đã nạp 8/20)')
    await expect(sheet.getByRole('status')).toContainText('Nạp được tối đa 8 hộp lần này (theo chỗ trống của ngăn).')
    const count = sheet.getByLabel('Số hộp đã xếp vào ngăn')
    await expect(count).toHaveAttribute('inputmode', 'numeric')
    for (const [locator, what] of [[count, 'ô số hộp'], [sheet.getByLabel('Lô hàng'), 'ô lô'], [sheet.getByRole('button', { name: 'Thêm 1 hộp' }), 'nút +'],
      [sheet.getByRole('button', { name: 'Nạp hộp', exact: true }), 'nút Nạp hộp'], [sheet.getByRole('button', { name: 'Hủy' }), 'nút Hủy']] as const) await expectTouchTarget(locator, what)
    await step(() => count.fill('5'))
    await step(() => sheet.getByRole('button', { name: 'Nạp hộp', exact: true }).click())
    await expect(sheet).toHaveCount(0)
    await expect(page.getByText('Đã nạp 5 hộp')).toBeVisible()
    await expect(b1).toContainText('7/10 hộp')
    // On a phone the toast shows at the top, so the head's button at the bottom can be tapped at once (no waiting).
    const toast = await page.getByText('Đã nạp 5 hộp').boundingBox()
    expect(toast!.y, 'toast ở đầu màn hình').toBeLessThan(PHONE.height / 3)
    // The expired head still blocks the slot: the new boxes sit above it.
    const removeButton = page.getByRole('button', { name: 'Rút hộp đáy ngăn B1' })
    await expectTouchTarget(removeButton, 'Rút hộp')
    // The toast (still on screen) does not overlap the button: tapped right away, nothing intercepts the click.
    const button = await removeButton.boundingBox()
    if (await page.getByText('Đã nạp 5 hộp').isVisible()) {
      const shown = await page.getByText('Đã nạp 5 hộp').boundingBox()
      expect(shown!.y + shown!.height <= button!.y || shown!.y >= button!.y + button!.height, 'toast không che nút Rút hộp').toBe(true)
    }
    await step(() => removeButton.click())
    const remove = removeSheet(page)
    await expect(remove).toBeVisible()
    await expect(remove).toContainText('Mango bowl')
    const quick = remove.getByRole('button', { name: 'Hộp hết hạn' })
    await expectTouchTarget(quick, 'Lý do nhanh')
    await step(() => quick.click())
    await expect(quick).toHaveAttribute('aria-pressed', 'true')
    await expect(remove.getByLabel('Lý do rút hộp')).toHaveValue('Hộp hết hạn')
    await step(() => remove.getByRole('button', { name: 'Rút hộp', exact: true }).click())
    await expect(remove).toHaveCount(0)
    await expect(b1).toContainText('6/10 hộp')

    const elapsed = Date.now() - started
    test.info().annotations.push({ type: 'thời gian thao tác', description: `${(elapsed / 1000).toFixed(1)} s, ${steps} bước` })
    expect(elapsed, 'nạp 5 + rút 1 dưới 2 phút').toBeLessThan(120_000)
    expect(steps, 'số bước của nhân viên').toBeLessThanOrEqual(7)
  })

  test('Lỗi 409 vượt sức chứa: câu tiếng Việt dưới ô số hộp, nêu ngăn và việc cần làm; Sheet giữ nguyên', async ({ page }) => {
    await page.goto(`/admin/inventory?machineId=${MACHINE_1}&scenario=409:/inventory/load`)
    await ready(page)
    await page.getByRole('button', { name: 'Nạp hộp vào ngăn B1', exact: true }).click()
    const sheet = loadSheet(page)
    await sheet.getByLabel('Lô hàng').selectOption(MIXED)
    await expect(sheet.getByRole('status')).toContainText('Nạp được tối đa 8 hộp')
    const count = sheet.getByLabel('Số hộp đã xếp vào ngăn')
    await count.fill('5')
    await sheet.getByRole('button', { name: 'Nạp hộp', exact: true }).click()
    await expect(count).toHaveAttribute('aria-invalid', 'true')
    // The free places read again still fit 5: the text says something changed and to retry, not to lower the count.
    await expect(count).toHaveAccessibleDescription('Ngăn B1 vừa có thay đổi trong lúc nạp; số chỗ trống vừa tải lại vẫn đủ cho 5 hộp. Bấm Nạp hộp để thử lại.')
    await expect(count).toBeFocused()
    await expect(sheet.getByRole('alert')).toHaveText('Vui lòng kiểm tra các trường được đánh dấu.')
    // The form-level line stays in view above the buttons on a phone.
    await expect(sheet.getByRole('alert')).toBeInViewport()
    await expect(sheet.getByText(/Slot capacity exceeded/)).toHaveCount(0)
    await expect(count).toHaveValue('5')
    // Another batch: the refusal about the previous choice goes away.
    await sheet.getByLabel('Lô hàng').selectOption(PINEAPPLE)
    await expect(count).not.toHaveAttribute('aria-invalid', 'true')
    await expect(count).toHaveAccessibleDescription('Số nguyên từ 1 đến 6.')
    await page.goto(`/admin/inventory?machineId=${MACHINE_1}&scenario=none`)
  })

  test('Chặn số vượt ngay khi nhập: theo chỗ trống của ngăn và theo số còn lại của lô; nút Tối đa', async ({ page }) => {
    await page.goto(`/admin/inventory?machineId=${MACHINE_1}`)
    await ready(page)
    await page.getByRole('button', { name: 'Nạp hộp vào ngăn B1', exact: true }).click()
    const sheet = loadSheet(page)
    await sheet.getByLabel('Lô hàng').selectOption(MIXED)
    const count = sheet.getByLabel('Số hộp đã xếp vào ngăn')
    await count.fill('9')
    await expect(count).toHaveAttribute('aria-invalid', 'true')
    await expect(count).toHaveAccessibleDescription('Ngăn B1 chỉ còn trống 8 chỗ. Nhập tối đa 8 hộp hoặc chọn ngăn khác.')
    // Submitting sends nothing: the Sheet stays and the column is unchanged.
    await sheet.getByRole('button', { name: 'Nạp hộp', exact: true }).click()
    await expect(sheet).toBeVisible()
    await sheet.getByRole('button', { name: 'Tối đa 8 hộp' }).click()
    await expect(count).toHaveValue('8')
    await expect(count).not.toHaveAttribute('aria-invalid', 'true')
    // Pineapple: 4 of 10 declared already loaded elsewhere, so the batch limits before the slot.
    await sheet.getByLabel('Lô hàng').selectOption(PINEAPPLE)
    await expect(sheet.getByRole('status')).toContainText('Lô SEED-PINEAPPLE-01: còn nạp được 6 hộp (đã nạp 4/10)')
    await expect(count).toHaveAccessibleDescription('Lô SEED-PINEAPPLE-01 chỉ còn nạp được 6 hộp (đã nạp 4/10). Nhập tối đa 6 hộp hoặc chọn lô khác.')
    await sheet.getByRole('button', { name: 'Hủy' }).click()
    await expect(sheet).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Nạp hộp vào ngăn B1', exact: true })).toBeFocused()
    await expect(column(page, 'B1')).toContainText('2/10 hộp')
  })
})

test.describe('Nạp và rút hộp (Quản trị viên)', () => {
  test.beforeEach(async ({ page }) => { await loginAs(page, 'ADMIN') })

  test('Nút Nạp hộp ở đầu trang điền sẵn máy trên URL; thiếu lựa chọn báo dưới từng ô; lô hết hạn không có trong danh sách', async ({ page }) => {
    await page.goto(`/admin/inventory?machineId=${MACHINE_1}`)
    await ready(page)
    await page.getByRole('button', { name: 'Nạp hộp', exact: true }).click()
    const sheet = loadSheet(page)
    await expect(sheet.getByLabel('Máy')).toHaveValue(MACHINE_1)
    await expect(sheet.getByRole('combobox', { name: 'Ngăn', exact: true })).toBeFocused()
    await expect(sheet.getByLabel('Lô hàng').locator('option', { hasText: 'SEED-MANGO-EXPIRED' })).toHaveCount(0)
    await sheet.getByRole('button', { name: 'Nạp hộp', exact: true }).click()
    await expect(sheet.getByRole('combobox', { name: 'Ngăn', exact: true })).toHaveAccessibleDescription('Vui lòng chọn ngăn.')
    await expect(sheet.getByLabel('Lô hàng')).toHaveAccessibleDescription('Vui lòng chọn lô hàng.')
    await expect(sheet.getByLabel('Số hộp đã xếp vào ngăn')).toHaveAccessibleDescription('Vui lòng nhập số hộp đã xếp vào ngăn.')
    await expect(sheet.getByRole('combobox', { name: 'Ngăn', exact: true })).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(sheet).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Nạp hộp', exact: true })).toBeFocused()
  })

  test('Ngăn đầy không có nút Nạp hộp; lý do rút bắt buộc và tối đa 500 ký tự', async ({ page }) => {
    await page.goto(`/admin/inventory?machineId=${MACHINE_1}`)
    await ready(page)
    // A1 8/10: load 2 and the slot is full.
    await page.getByRole('button', { name: 'Nạp hộp vào ngăn A1', exact: true }).click()
    const sheet = loadSheet(page)
    await expect(sheet.getByLabel('Lô hàng')).toHaveValue(MIXED)
    await sheet.getByRole('button', { name: 'Tối đa 2 hộp' }).click()
    await sheet.getByRole('button', { name: 'Nạp hộp', exact: true }).click()
    await expect(sheet).toHaveCount(0)
    await expect(column(page, 'A1')).toContainText('10/10 hộp')
    await expect(page.getByRole('button', { name: 'Nạp hộp vào ngăn A1', exact: true })).toHaveCount(0)
    await expect(column(page, 'A1')).toBeFocused()

    await page.getByRole('button', { name: 'Rút hộp đáy ngăn B1' }).click()
    const remove = removeSheet(page)
    await remove.getByLabel('Lý do rút hộp').fill('   ')
    await remove.getByRole('button', { name: 'Rút hộp', exact: true }).click()
    await expect(remove.getByLabel('Lý do rút hộp')).toHaveAccessibleDescription('Vui lòng nhập lý do rút hộp.')
    await expect(remove.getByLabel('Lý do rút hộp')).toHaveAttribute('maxlength', '500')
    await remove.getByRole('button', { name: 'Hộp dập, hỏng' }).click()
    await expect(remove.getByLabel('Lý do rút hộp')).toHaveAccessibleDescription(/13\/500 ký tự/)
  })

  test('Nạp hộp bị 400, 403, 401: lời giải thích trong Sheet hoặc về trang đăng nhập', async ({ page }) => {
    const open = async (scenario: string) => {
      await page.goto(`/admin/inventory?machineId=${MACHINE_1}&scenario=${scenario}`)
      await ready(page)
      await page.getByRole('button', { name: 'Nạp hộp vào ngăn B1', exact: true }).click()
      const sheet = loadSheet(page)
      await sheet.getByLabel('Lô hàng').selectOption(MIXED)
      await expect(sheet.getByRole('status')).toContainText('Nạp được tối đa')
      await sheet.getByLabel('Số hộp đã xếp vào ngăn').fill('1')
      await sheet.getByRole('button', { name: 'Nạp hộp', exact: true }).click()
      return sheet
    }
    let sheet = await open('400:/inventory/load')
    await expect(sheet.getByLabel('Lô hàng')).toHaveAccessibleDescription('Giá trị không hợp lệ (mô phỏng).')
    sheet = await open('403:/inventory/load')
    await expect(sheet.getByRole('alert')).toBeVisible()
    await expect(sheet).toBeVisible()
    await open('expire:/inventory/load')
    await page.waitForURL(/\/login\?next=/)
    await page.goto(`/admin/inventory?machineId=${MACHINE_1}&scenario=none`)
  })
})

for (const theme of THEMES) {
  test(`Ảnh + axe: inventory-load (${theme})`, async ({ page }, testInfo) => {
    await useThemeChoice(page, theme)
    await loginAs(page, 'STAFF')
    await page.goto(`/admin/inventory?machineId=${MACHINE_1}`)
    await ready(page)
    await page.getByRole('button', { name: 'Nạp hộp vào ngăn B1', exact: true }).click()
    const sheet = loadSheet(page)
    await sheet.getByLabel('Lô hàng').selectOption(MIXED)
    await sheet.getByLabel('Số hộp đã xếp vào ngăn').fill('9')
    await auditScreen(page, testInfo, 'inventory-load', theme, async () => {
      await expect(sheet.getByRole('status')).toContainText('Nạp được tối đa 8 hộp')
      await expect(sheet.getByLabel('Số hộp đã xếp vào ngăn')).toHaveAttribute('aria-invalid', 'true')
    })
  })

  test(`Ảnh + axe: inventory-remove (${theme})`, async ({ page }, testInfo) => {
    await useThemeChoice(page, theme)
    await loginAs(page, 'STAFF')
    await page.goto(`/admin/inventory?machineId=${MACHINE_1}`)
    await ready(page)
    await page.getByRole('button', { name: 'Rút hộp đáy ngăn B1' }).click()
    const sheet = removeSheet(page)
    await sheet.getByRole('button', { name: 'Hộp hết hạn' }).click()
    await auditScreen(page, testInfo, 'inventory-remove', theme, () => expect(sheet.getByLabel('Lý do rút hộp')).toHaveValue('Hộp hết hạn'))
  })
}
