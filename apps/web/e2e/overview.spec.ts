// O1 Tổng quan (issue FE 6.5, bước 1) on the mock API. Done criterion: "Nhìn một lần biết máy nào cần xử lý, bấm vào
// là tới đúng chỗ": after sign-in the overview opens, each of the four blocks shows the seeded case, and one click on its
// row lands on the exact place (sensors tab, machine detail, inventory map of the slot, alert detail). Also: positive
// empty states, a block failing / refused / missing on its own, the 30 s refresh, keyboard, screenshots + axe.
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { auditScreen, loginAs, THEMES, useThemeChoice, VIEWPORTS } from './support.ts'

const id = (prefix: string, n: number) => `${prefix}-0000-0000-0000-${String(n).padStart(12, '0')}`
const MACHINE_1 = id('20000000', 1)
const MACHINE_2 = id('20000000', 2)
const SLOT_B1 = id('30000000', 3)
const OFFLINE_ALERT = id('60000000', 2)

const block = (page: Page, name: string) => page.getByRole('region', { name })
const BLOCKS = ['Mất kết nối', 'Đang bảo trì', 'Sắp hết hàng', 'Cảnh báo nghiêm trọng']

async function ready(page: Page) {
  for (const name of BLOCKS) await expect(block(page, name).locator('[data-count]')).not.toHaveAttribute('data-count', '')
}

for (const role of ['ADMIN', 'STAFF'] as const) {
  test(`Tiêu chí xong (${role}): trang đầu là Tổng quan, mỗi khối bấm một lần tới đúng chỗ`, async ({ page }) => {
    await loginAs(page, role)
    await expect(page).toHaveURL('/admin/overview')
    await expect(page.getByRole('heading', { level: 1, name: 'Tổng quan' })).toBeVisible()
    await ready(page)
    for (const name of BLOCKS) await expect(block(page, name).locator('[data-count]')).toHaveAttribute('data-count', '1')

    // OFFLINE → tab Cảm biến & Sự kiện of that machine.
    const offline = block(page, 'Mất kết nối')
    await expect(offline).toContainText(/Mất tín hiệu từ \d{2}\/\d{2}\/\d{4} \d{2}:\d{2} \(hơn 3\d phút\)/)
    await offline.getByRole('link', { name: /DEV-MACHINE-02/ }).click()
    await expect(page).toHaveURL(`/admin/machines/${MACHINE_2}?tab=sensors`)
    await expect(page.getByRole('tab', { name: 'Cảm biến & Sự kiện' })).toHaveAttribute('aria-selected', 'true')

    // Maintenance → machine detail.
    await page.goBack()
    await ready(page)
    await block(page, 'Đang bảo trì').getByRole('link', { name: /DEV-MACHINE-02/ }).click()
    await expect(page).toHaveURL(`/admin/machines/${MACHINE_2}`)

    // Low stock → inventory map of exactly that slot (FM4 URL).
    await page.goBack()
    await ready(page)
    const stock = block(page, 'Sắp hết hàng')
    await expect(stock).toContainText('Hết hàng: còn 0/10 hộp sẵn bán')
    await stock.getByRole('link', { name: /DEV-MACHINE-01 · Ngăn B1/ }).click()
    await expect(page).toHaveURL(`/admin/inventory?machineId=${MACHINE_1}&slotId=${SLOT_B1}`)

    // CRITICAL → alert detail.
    await page.goBack()
    await ready(page)
    await block(page, 'Cảnh báo nghiêm trọng').getByRole('link', { name: /Machine offline/ }).click()
    await expect(page).toHaveURL(`/admin/alerts/${OFFLINE_ALERT}`)
  })
}

test('Bàn phím: mục Tổng quan đứng đầu nhóm Vận hành; Tab tới dòng và Enter mở đúng chỗ', async ({ page }) => {
  await loginAs(page, 'STAFF')
  await ready(page)
  const nav = page.getByRole('navigation', { name: 'Quản trị' })
  await expect(nav.getByRole('link').first()).toHaveText('Tổng quan')
  await expect(nav.getByRole('link', { name: 'Tổng quan', exact: true })).toHaveAttribute('aria-current', 'page')
  const link = block(page, 'Sắp hết hàng').getByRole('link').first()
  await link.focus()
  await expect(link).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(`/admin/inventory?machineId=${MACHINE_1}&slotId=${SLOT_B1}`)
})

test('Không có gì cần xử lý: mỗi khối báo rỗng tích cực, không có số đỏ', async ({ page }) => {
  await loginAs(page, 'ADMIN')
  await page.goto('/admin/overview?scenario=empty')
  await ready(page)
  await expect(block(page, 'Mất kết nối')).toContainText('Không có máy mất kết nối')
  await expect(block(page, 'Đang bảo trì')).toContainText('Không có máy đang bảo trì')
  await expect(block(page, 'Sắp hết hàng')).toContainText('Không có ngăn sắp hết hàng')
  await expect(block(page, 'Cảnh báo nghiêm trọng')).toContainText('Không có cảnh báo nghiêm trọng đang mở')
  for (const name of BLOCKS) await expect(block(page, name).locator('[data-count]')).toHaveAttribute('data-count', '0')
})

test('Mỗi khối lỗi riêng: 500 tồn kho có Thử lại, 403 cảnh báo giải thích, các khối khác vẫn hiện', async ({ page }) => {
  await loginAs(page, 'ADMIN')
  await page.goto('/admin/overview?scenario=error500:inventory')
  const stock = block(page, 'Sắp hết hàng')
  await expect(stock.getByRole('alert')).toContainText('Không tải được')
  await expect(stock.getByRole('button', { name: 'Thử lại' })).toBeVisible()
  await expect(block(page, 'Mất kết nối').locator('[data-count]')).toHaveAttribute('data-count', '1')
  // Fixed: retry brings the block back.
  await page.goto('/admin/overview?scenario=none')
  await ready(page)
  await expect(stock.locator('[data-count]')).toHaveAttribute('data-count', '1')

  await page.goto('/admin/overview?scenario=403:alerts')
  await expect(block(page, 'Cảnh báo nghiêm trọng')).toContainText('không có quyền xem mục này')
  await expect(block(page, 'Đang bảo trì').locator('[data-count]')).toHaveAttribute('data-count', '1')

  // Backend without BE 3.6: the block says there is no data yet.
  await page.goto('/admin/overview?scenario=missing:alerts')
  await expect(block(page, 'Cảnh báo nghiêm trọng')).toContainText('Chưa có dữ liệu cảnh báo')
  await expect(block(page, 'Sắp hết hàng').locator('[data-count]')).toHaveAttribute('data-count', '1')
})

test('Tự làm mới mỗi 30 giây', async ({ page }) => {
  await page.clock.install()
  await loginAs(page, 'STAFF')
  await ready(page)
  const count = () => page.evaluate(() => (window as unknown as { __fvMock: { requests: (prefix: string) => unknown[] } }).__fvMock.requests('/inventory').length)
  const before = await count()
  await page.clock.runFor(29_000)
  expect(await count()).toBe(before)
  await page.clock.runFor(1_500)
  await expect.poll(count).toBeGreaterThan(before)
})

for (const theme of THEMES) {
  test(`Ảnh + axe: overview (${theme})`, async ({ page }, testInfo) => {
    await useThemeChoice(page, theme)
    await loginAs(page, 'ADMIN')
    await auditScreen(page, testInfo, 'overview', theme, () => ready(page))
  })
}

test('Rỗng ở 390px (light, dark): không cuộn ngang, axe sạch', async ({ page }, testInfo) => {
  const phone = VIEWPORTS.filter(viewport => viewport.name === '390')
  for (const theme of THEMES) {
    await useThemeChoice(page, theme)
    if (theme === THEMES[0]) await loginAs(page, 'STAFF')
    await page.goto('/admin/overview?scenario=empty')
    await auditScreen(page, testInfo, 'overview-empty', theme, () => ready(page), phone)
  }
})
