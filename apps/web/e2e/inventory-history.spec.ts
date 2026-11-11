// I4 Lịch sử kho (issue FE 4.4) on the mock API. Done criterion: filters live in the URL and a reload keeps them.
// Also: Back/Forward step through filter changes, another machine clears the slot, quick filters from a row, ids that
// are not UUIDs (URL and typed) never become a raw 400, filtered vs plain empty, 400/403/500/401, the RESERVE and
// ADJUSTMENT rows of machine 02 read correctly, screenshots + axe at 1440/768/390 light and dark.
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { auditScreen, loginAs, THEMES, useThemeChoice } from './support.ts'

const PATH = '/admin/inventory/history'
const MACHINE_1 = '20000000-0000-0000-0000-000000000001'
const MACHINE_2 = '20000000-0000-0000-0000-000000000002'
const SLOT_M2_A1 = '30000000-0000-0000-0000-000000000004'
const BOX_FAILED = '70000000-0000-0000-0000-000000000301'
const ORDER_FAILED = '93000000-0000-0000-0000-000000000001'
const MACHINE_2_LABEL = 'Maintenance test machine (DEV-MACHINE-02)'

const table = (page: Page) => page.getByRole('table', { name: 'Lịch sử kho, mới nhất ở trên' })
const rows = (page: Page) => table(page).locator('tbody tr')
const field = (page: Page, label: string) => page.getByLabel(label, { exact: true })
const ready = (page: Page) => expect(rows(page).first()).toBeVisible()
const query = (page: Page) => new URL(page.url()).searchParams

test.describe('Lịch sử kho (Quản trị viên)', () => {
  test.beforeEach(async ({ page }) => { await loginAs(page, 'ADMIN') })

  test('Lọc máy → ngăn → loại lưu trên URL; tải lại giữ nguyên; Back/Forward đi qua từng bước lọc', async ({ page }) => {
    await page.goto(PATH)
    await ready(page)
    await field(page, 'Máy').selectOption({ label: MACHINE_2_LABEL })
    await expect.poll(() => query(page).get('machineId')).toBe(MACHINE_2)
    await expect(rows(page)).toHaveCount(8)
    await field(page, 'Ngăn').selectOption({ label: 'Ngăn A1' })
    await expect.poll(() => query(page).get('slotId')).toBe(SLOT_M2_A1)
    await expect(rows(page)).toHaveCount(6)
    await field(page, 'Loại giao dịch').selectOption({ label: 'Giữ chỗ' })
    await expect.poll(() => query(page).get('type')).toBe('RESERVE')
    await expect(rows(page)).toHaveCount(1)

    // F5: same filters in the controls and the same rows.
    await page.reload()
    await expect(rows(page)).toHaveCount(1)
    await expect(field(page, 'Máy')).toHaveValue(MACHINE_2)
    await expect(field(page, 'Ngăn')).toHaveValue(SLOT_M2_A1)
    await expect(field(page, 'Loại giao dịch')).toHaveValue('RESERVE')
    await expect(page.getByRole('button', { name: 'Xóa bộ lọc (3)' })).toBeVisible()

    // Back: the type goes, then the slot; Forward brings the slot back.
    await page.goBack()
    await expect.poll(() => query(page).get('type')).toBeNull()
    await expect(field(page, 'Loại giao dịch')).toHaveValue('')
    await expect(rows(page)).toHaveCount(6)
    await page.goBack()
    await expect.poll(() => query(page).get('slotId')).toBeNull()
    await expect(rows(page)).toHaveCount(8)
    await page.goForward()
    await expect(field(page, 'Ngăn')).toHaveValue(SLOT_M2_A1)
    await expect(rows(page)).toHaveCount(6)

    // Page is in the URL too.
    await page.goto(PATH)
    await ready(page)
    await page.getByRole('button', { name: 'Sau' }).click()
    await expect.poll(() => query(page).get('page')).toBe('1')
    await page.reload()
    await expect(page.getByText(/^Trang 2 \//)).toBeVisible()
  })

  test('Đổi máy xóa ngăn của máy cũ', async ({ page }) => {
    await page.goto(`${PATH}?machineId=${MACHINE_2}&slotId=${SLOT_M2_A1}&type=LOAD`)
    await expect(rows(page)).toHaveCount(4)
    await field(page, 'Máy').selectOption({ label: 'Development fruit machine (DEV-MACHINE-01)' })
    await expect.poll(() => query(page).get('machineId')).toBe(MACHINE_1)
    expect(query(page).get('slotId')).toBeNull()
    expect(query(page).get('type')).toBe('LOAD')
    await expect(field(page, 'Ngăn')).toHaveValue('')
    // Measured (FE 4.4 review): with 3 parallel browsers every admin page (also /admin/inventory and /admin/batches)
    // stalls 2–10 s at some point after a full load, no JS long task, timers just do not run; with 1 worker the slots
    // arrive in ~0.3 s. The page sends one slots request per machine (the rows reuse the picker's slots), so the extra
    // time only absorbs that environment stall.
    await expect(field(page, 'Ngăn').locator('option', { hasText: 'Ngăn B1' })).toHaveCount(1, { timeout: 20_000 })
    // Clearing the machine removes the slot picker.
    await field(page, 'Máy').selectOption('')
    await expect(field(page, 'Ngăn')).toHaveCount(0)
  })

  test('Hộp nhả hàng thất bại ở máy 02: Điều chỉnh và Giữ chỗ đọc được; lọc nhanh theo hộp và theo đơn', async ({ page }) => {
    await page.goto(`${PATH}?machineId=${MACHINE_2}&slotId=${SLOT_M2_A1}`)
    await expect(rows(page)).toHaveCount(6)
    const adjustment = rows(page).filter({ hasText: 'Điều chỉnh' })
    await expect(adjustment).toHaveCount(1)
    await expect(adjustment).toContainText('Máy không nhả được hộp')
    await expect(adjustment).toContainText('Đã giữ chỗ')
    await expect(adjustment).toContainText('Nhả hàng thất bại')
    await expect(adjustment).toContainText('Máy không phản hồi khi nhả hàng')
    await expect(adjustment).toContainText('Hệ thống')
    await expect(adjustment).toContainText('Ngăn A1')
    await expect(adjustment).toContainText('DEV-MACHINE-02')
    await expect(adjustment).toContainText('Lô SEED-PINEAPPLE-01')
    await expect(adjustment).toContainText('Đơn hàng')
    await expect(adjustment.getByRole('link', { name: 'Mở đơn hàng' })).toHaveAttribute('href', `/admin/orders/${ORDER_FAILED}`)
    // Times in Vietnam, dd/MM/yyyy HH:mm.
    await expect(adjustment.locator('td').first()).toHaveText(/^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/)
    // Loads: new → available, by the staff member, with the load slip reference.
    const load = rows(page).filter({ hasText: 'Nạp hàng' }).first()
    await expect(load).toContainText('Mới')
    await expect(load).toContainText('Sẵn sàng')
    await expect(load).toContainText('Phiếu nạp')
    await expect(load).toContainText('Nhân viên vận hành')

    // Quick filter by box: the whole life of that box, newest first.
    await adjustment.getByRole('link', { name: 'Chỉ xem lịch sử hộp …00000301' }).click()
    await expect.poll(() => query(page).get('inventoryItemId')).toBe(BOX_FAILED)
    await expect(rows(page)).toHaveCount(3)
    // Focus does not fall back to <body>: it lands on the results heading.
    await expect(page.getByRole('heading', { name: '3 giao dịch khớp bộ lọc, mới nhất ở trên' })).toBeFocused()
    await expect(rows(page).nth(0)).toContainText('Điều chỉnh')
    await expect(rows(page).nth(1)).toContainText('Giữ chỗ')
    await expect(rows(page).nth(2)).toContainText('Nạp hàng')
    await expect(field(page, 'Mã hộp')).toHaveValue(BOX_FAILED)
    // Quick filter by order on top of it.
    await rows(page).nth(0).getByRole('link', { name: /Chỉ xem mọi giao dịch của đơn/ }).click()
    await expect.poll(() => query(page).get('referenceId')).toBe(ORDER_FAILED)
    await expect(rows(page)).toHaveCount(2)
    expect(await page.evaluate(() => document.activeElement?.tagName)).toBe('H2')
    await page.goBack()
    await expect(rows(page)).toHaveCount(3)
  })

  test('Sơ đồ ngăn: "Lịch sử ngăn" và "Lịch sử hộp" của hộp đáy chặn ngăn mở lịch sử đã lọc', async ({ page }) => {
    await page.goto(`/admin/inventory?machineId=${MACHINE_2}`)
    await page.getByRole('link', { name: 'Lịch sử ngăn A1' }).click()
    await page.waitForURL(url => url.pathname === PATH && url.searchParams.get('slotId') === SLOT_M2_A1 && url.searchParams.get('machineId') === MACHINE_2)
    await expect(rows(page)).toHaveCount(6)
    await page.goBack()
    await page.getByRole('link', { name: 'Lịch sử hộp đáy ngăn A1' }).click()
    await page.waitForURL(url => url.searchParams.get('inventoryItemId') === BOX_FAILED)
    await expect(rows(page)).toHaveCount(3)
  })

  test('Link "Lịch sử" ở danh sách hộp mở lịch sử đã lọc theo hộp', async ({ page }) => {
    await page.goto(`/admin/inventory?view=list&machineId=${MACHINE_2}`)
    await page.getByRole('table', { name: 'Danh sách hộp' }).getByRole('link', { name: /^Lịch sử hộp, .+, ngăn A[0-9], lô SEED-/ }).first().click()
    await page.waitForURL(/\/admin\/inventory\/history\?inventoryItemId=/)
    await ready(page)
    const id = query(page).get('inventoryItemId')!
    await expect(field(page, 'Mã hộp')).toHaveValue(id)
    await expect(rows(page).filter({ hasText: 'Nạp hàng' })).toHaveCount(1)
  })

  // That a bad id never reaches the API is covered by tests/inventory-history.test.mjs (the mock runs inside the page, so
  // its requests are not visible to Playwright); here: what the person sees.
  test('Mã không hợp lệ: trên URL bị bỏ qua có giải thích; gõ tay báo lỗi ở ô', async ({ page }) => {
    await page.goto(`${PATH}?machineId=abc&inventoryItemId=123&type=DELETE&slotId=${SLOT_M2_A1}`)
    const note = page.getByRole('note').filter({ hasText: 'Đường dẫn có bộ lọc không dùng được' })
    await expect(note).toContainText('Máy “abc”: không phải mã đầy đủ dạng UUID.')
    await expect(note).toContainText('Mã hộp “123”')
    await expect(note).toContainText('Loại giao dịch “DELETE”')
    await expect(note).toContainText('Ngăn')
    await ready(page)
    await expect(page.getByRole('button', { name: /^Xóa bộ lọc/ })).toHaveCount(0)
    await note.getByRole('button', { name: 'Bỏ khỏi đường dẫn' }).click()
    await expect(note).toHaveCount(0)
    expect(new URL(page.url()).search).toBe('')

    const box = field(page, 'Mã hộp')
    await box.fill('70000000-0000')
    await box.press('Enter')
    await expect(box).toHaveAccessibleDescription(/Mã phải là mã đầy đủ 36 ký tự/)
    expect(new URL(page.url()).search).toBe('')
    // Pasting a full id (upper case) applies it at once.
    await box.fill(BOX_FAILED.toUpperCase())
    await expect.poll(() => query(page).get('inventoryItemId')).toBe(BOX_FAILED)
    await expect(rows(page)).toHaveCount(3)

    // Text typed but never applied is dropped by "Xóa bộ lọc".
    const reference = field(page, 'Phiếu nạp / đơn hàng')
    await reference.fill('abc')
    await reference.press('Enter')
    await expect(reference).toHaveAccessibleDescription(/Mã phải là mã đầy đủ/)
    await page.getByRole('button', { name: 'Xóa bộ lọc (1)' }).click()
    await expect.poll(() => new URL(page.url()).search).toBe('')
    await expect(reference).toHaveValue('')
    await expect(reference).not.toHaveAccessibleDescription(/Mã phải là mã đầy đủ/)
  })

  test('Rỗng: phân biệt rỗng do lọc (có nút xóa lọc) và chưa có dữ liệu', async ({ page }) => {
    await page.goto(`${PATH}?machineId=${MACHINE_1}&type=EXPIRE`)
    await expect(page.getByText(/Không có giao dịch nào khớp bộ lọc \(Development fruit machine \(DEV-MACHINE-01\), loại “Hết hạn”\)/)).toBeVisible()
    await page.locator('[data-slot="data-table"]').getByRole('button', { name: 'Xóa bộ lọc' }).click()
    await expect.poll(() => new URL(page.url()).search).toBe('')
    await ready(page)

    await page.goto(`${PATH}?scenario=empty`)
    await expect(page.getByText(/Chưa có giao dịch kho nào/)).toBeVisible()
    await expect(page.getByRole('link', { name: 'Mở Tồn kho' })).toBeVisible()
    await page.goto(`${PATH}?scenario=none`)
    await ready(page)
  })

  test('Trạng thái: đang tải, 400, 500, 403, 401', async ({ page }) => {
    await page.goto(`${PATH}?scenario=slow:/inventory/transactions`)
    await expect(page.getByRole('status').filter({ hasText: 'Đang tải dữ liệu…' })).toBeAttached()
    await ready(page)

    await page.goto(`${PATH}?machineId=${MACHINE_2}&scenario=400:/inventory/transactions`)
    await expect(page.getByRole('alert')).toContainText('Máy chủ không nhận bộ lọc hiện tại')
    await expect(page.getByRole('alert').getByRole('button', { name: 'Xóa bộ lọc' })).toBeVisible()

    await page.goto(`${PATH}?scenario=error500:/inventory/transactions`)
    await expect(page.getByRole('button', { name: 'Thử lại' })).toBeVisible()
    await page.goto(`${PATH}?scenario=none`)
    await ready(page)

    await page.goto(`${PATH}?scenario=403:/inventory/transactions`)
    await expect(page.getByRole('heading', { name: 'Không có quyền truy cập' })).toBeVisible()
    await expect(page.getByRole('group', { name: 'Bộ lọc' })).toHaveCount(0)
    await page.goto(`${PATH}?scenario=none`)
    await ready(page)

    await page.goto(`${PATH}?machineId=${MACHINE_2}&scenario=expire`)
    await page.waitForURL(/\/login\?next=/)
    expect(decodeURIComponent(page.url())).toContain(`${PATH}?machineId=${MACHINE_2}`)
  })
})

test('Nhân viên xem được lịch sử, không có thao tác sửa/xóa; người thực hiện hiện là "Bạn"', async ({ page }) => {
  await loginAs(page, 'STAFF')
  await page.goto(`${PATH}?machineId=${MACHINE_2}&type=LOAD`)
  await expect(rows(page)).toHaveCount(5)
  await expect(rows(page).first()).toContainText('Bạn')
  await expect(page.getByRole('button', { name: /xóa|xoá|delete|sửa/i }).filter({ hasNotText: 'Xóa bộ lọc' })).toHaveCount(0)
})

test('390px: link lọc nhanh trên thẻ cao ít nhất 44px, không cuộn ngang', async ({ page }) => {
  await loginAs(page, 'ADMIN')
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`${PATH}?machineId=${MACHINE_2}`)
  await expect(rows(page)).toHaveCount(8)
  const links = rows(page).first().getByRole('link')
  const count = await links.count()
  expect(count).toBeGreaterThan(2)
  for (let index = 0; index < count; index += 1) {
    const box = await links.nth(index).boundingBox()
    expect(box!.height, await links.nth(index).getAttribute('aria-label') ?? '').toBeGreaterThanOrEqual(44)
  }
})

for (const theme of THEMES) {
  test(`Ảnh + axe: inventory-history (${theme})`, async ({ page }, testInfo) => {
    await useThemeChoice(page, theme)
    await loginAs(page, 'ADMIN')
    await page.goto(`${PATH}?machineId=${MACHINE_2}`)
    await auditScreen(page, testInfo, 'inventory-history', theme, () => expect(rows(page)).toHaveCount(8))
  })
}
