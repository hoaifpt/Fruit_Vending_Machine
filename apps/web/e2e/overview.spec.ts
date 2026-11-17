// O1 Tổng quan (FE 6.5 + 9.2) on the mock of GET /dashboard/overview (backend #76). Done criterion: "Nhìn một lần biết
// máy nào cần xử lý, bấm vào là tới đúng chỗ": after sign-in the overview opens, each block shows the seeded case, and one
// click on its row lands on the exact place (sensors tab, machine detail, inventory map, alert detail, work orders).
// Also: positive empty states, the dashboard failing / refused, the alerts list failing alone, the 30 s refresh (one
// dashboard request per poll), keyboard, screenshots + axe.
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { auditScreen, loginAs, THEMES, useThemeChoice, VIEWPORTS } from './support.ts'

const id = (prefix: string, n: number) => `${prefix}-0000-0000-0000-${String(n).padStart(12, '0')}`
const MACHINE_2 = id('20000000', 2)
const OFFLINE_ALERT = id('60000000', 2)

const block = (page: Page, name: string) => page.getByRole('region', { name })
const BLOCKS = ['Mất kết nối', 'Đang bảo trì', 'Tồn kho cần xử lý', 'Cảnh báo nghiêm trọng']
const dashboardRequests = (page: Page) => page.evaluate(() => (window as unknown as { __fvMock: { requests: (prefix: string) => unknown[] } }).__fvMock.requests('/dashboard').length)

async function ready(page: Page) {
  await expect(page.locator('[data-generated]')).toBeVisible()
}

for (const role of ['ADMIN', 'STAFF'] as const) {
  test(`Tiêu chí xong (${role}): trang đầu là Tổng quan, mỗi khối bấm một lần tới đúng chỗ`, async ({ page }) => {
    await loginAs(page, role)
    await expect(page).toHaveURL('/admin/overview')
    await expect(page.getByRole('heading', { level: 1, name: 'Tổng quan' })).toBeVisible()
    await ready(page)
    await expect(block(page, 'Mất kết nối').locator('[data-count]')).toHaveAttribute('data-count', '1')
    await expect(block(page, 'Đang bảo trì').locator('[data-count]')).toHaveAttribute('data-count', '1')
    await expect(block(page, 'Tồn kho cần xử lý').locator('[data-count]')).not.toHaveAttribute('data-count', '0')
    await expect(block(page, 'Cảnh báo nghiêm trọng').locator('[data-count]')).not.toHaveAttribute('data-count', '0')

    // OFFLINE → tab Cảm biến & Sự kiện of that machine.
    const offline = block(page, 'Mất kết nối')
    await expect(offline).toContainText(/Mất tín hiệu từ \d{2}\/\d{2}\/\d{4} \d{2}:\d{2} \(hơn 3\d phút\)|Máy báo ngắt kết nối/)
    await offline.getByRole('link', { name: /DEV-MACHINE-02/ }).click()
    await expect(page).toHaveURL(`/admin/machines/${MACHINE_2}?tab=sensors`)
    await expect(page.getByRole('tab', { name: 'Cảm biến & Sự kiện' })).toHaveAttribute('aria-selected', 'true')

    // Maintenance → machine detail.
    await page.goBack()
    await ready(page)
    await block(page, 'Đang bảo trì').getByRole('link', { name: /DEV-MACHINE-02/ }).click()
    await expect(page).toHaveURL(`/admin/machines/${MACHINE_2}`)

    // Stock → inventory map.
    await page.goBack()
    await ready(page)
    await block(page, 'Tồn kho cần xử lý').getByRole('link', { name: 'Ngăn sắp hết hàng' }).click()
    await expect(page).toHaveURL('/admin/inventory')

    // CRITICAL → alert detail.
    await page.goBack()
    await ready(page)
    await block(page, 'Cảnh báo nghiêm trọng').getByRole('link', { name: /^Máy mất kết nối: Máy mất kết nối/ }).click()
    await expect(page).toHaveURL(`/admin/alerts/${OFFLINE_ALERT}`)

    // Work orders → overdue list.
    await page.goBack()
    await ready(page)
    await block(page, 'Phiếu công việc').getByRole('link', { name: 'Quá hạn' }).click()
    await expect(page).toHaveURL('/admin/tickets?overdue=true')

    // Every machine at a glance.
    await page.goBack()
    await ready(page)
    await expect(block(page, 'Tất cả máy').getByRole('link')).toHaveCount(3)
  })
}

test('Bàn phím: mục Tổng quan đứng đầu nhóm Vận hành; Tab tới dòng và Enter mở đúng chỗ', async ({ page }) => {
  await loginAs(page, 'STAFF')
  await ready(page)
  const nav = page.getByRole('navigation', { name: 'Quản trị' })
  await expect(nav.getByRole('link').first()).toHaveText('Tổng quan')
  await expect(nav.getByRole('link', { name: 'Tổng quan', exact: true })).toHaveAttribute('aria-current', 'page')
  const link = block(page, 'Đang bảo trì').getByRole('link').first()
  await link.focus()
  await expect(link).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(`/admin/machines/${MACHINE_2}`)
})

test('Không có gì cần xử lý: mỗi khối báo rỗng tích cực, không có số đỏ', async ({ page }) => {
  await loginAs(page, 'ADMIN')
  await page.goto('/admin/overview?scenario=empty')
  await ready(page)
  await expect(block(page, 'Mất kết nối')).toContainText('Không có máy mất kết nối')
  await expect(block(page, 'Đang bảo trì')).toContainText('Không có máy đang bảo trì')
  await expect(block(page, 'Tồn kho cần xử lý')).toContainText('Không có ngăn sắp hết hàng')
  await expect(block(page, 'Cảnh báo nghiêm trọng')).toContainText('Không có cảnh báo nghiêm trọng đang mở')
  await expect(block(page, 'Phiếu công việc')).toContainText('Không có phiếu công việc')
  for (const name of BLOCKS) await expect(block(page, name).locator('[data-count]')).toHaveAttribute('data-count', '0')
  await expect(block(page, 'Tất cả máy')).toContainText('Chưa có máy nào được đăng ký.')
})

test('Lỗi: dashboard 500 có Thử lại, 403 giải thích; danh sách cảnh báo lỗi riêng, các khối khác vẫn hiện', async ({ page }) => {
  await loginAs(page, 'ADMIN')
  await page.goto('/admin/overview?scenario=error500:dashboard')
  await expect(page.getByRole('alert')).toContainText('Hệ thống đang gặp sự cố')
  await page.goto('/admin/overview?scenario=none')
  await ready(page)

  await page.goto('/admin/overview?scenario=403:dashboard')
  await expect(page.getByRole('heading', { name: 'Không có quyền truy cập' })).toBeVisible()

  await page.goto('/admin/overview?scenario=403:alerts')
  await expect(block(page, 'Cảnh báo nghiêm trọng')).toContainText('không có quyền xem danh sách cảnh báo')
  await expect(block(page, 'Đang bảo trì').locator('[data-count]')).toHaveAttribute('data-count', '1')

  await page.goto('/admin/overview?scenario=error500:alerts')
  await expect(block(page, 'Cảnh báo nghiêm trọng').getByRole('button', { name: 'Thử lại' })).toBeVisible()
  await page.goto('/admin/overview?scenario=none')
  await ready(page)
})

test('Tự làm mới mỗi 30 giây: mỗi lần một yêu cầu dashboard', async ({ page }) => {
  await page.clock.install()
  await loginAs(page, 'STAFF')
  await ready(page)
  const before = await dashboardRequests(page)
  await page.clock.runFor(29_000)
  expect(await dashboardRequests(page)).toBe(before)
  await page.clock.runFor(1_500)
  await expect.poll(() => dashboardRequests(page)).toBe(before + 1)
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
