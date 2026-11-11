// FE 6.4 "Chi tiết máy: tab Cảm biến & Sự kiện" on the mock API (draft of BE 3.4/3.5). Done criterion: a machine that
// stops its heartbeat for more than 180 s shows OFFLINE on every screen that shows it — machines list, machine detail
// header, the "Cảm biến & Sự kiện" tab, the inventory machine picker and the inventory map — without reloading the page.
// Playwright's fake clock proves the threshold: still online 179 s after the last message, OFFLINE at 181 s
// (window.__fvMock.stopHeartbeat makes the machine go silent). Also: heartbeat (RSSI level, firmware, uptime), latest
// reading against thresholds and history, events with FAULT and its code, filters on the URL, never-connected machine,
// STAFF, missing endpoint / 403 / 500; screenshots + axe at 1440/768/390 light and dark.
import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'
import { auditScreen, loginAs, THEMES, useThemeChoice } from './support.ts'

const id = (n: number) => `20000000-0000-0000-0000-${String(n).padStart(12, '0')}`
const DEV_01 = `/admin/machines/${id(1)}`
const DEV_02 = `/admin/machines/${id(2)}`
const DEV_03 = `/admin/machines/${id(3)}`
const MISSING = 'Chưa có dữ liệu cảm biến và sự kiện: máy chủ chưa cung cấp chức năng này.'

const tab = (page: Page) => page.getByRole('tablist', { name: 'Thông tin máy' }).getByRole('tab', { name: 'Cảm biến & Sự kiện' })
const statusGroup = (page: Page) => page.getByRole('group', { name: 'Trạng thái máy' })
const heartbeatPanel = (page: Page) => page.getByRole('region', { name: 'Kết nối và bộ điều khiển' })
const eventsTable = (page: Page) => page.getByRole('table', { name: 'Sự kiện của máy' })
const readingsTable = (page: Page) => page.getByRole('table', { name: 'Lịch sử số đo' })

/** The machine goes silent now; returns its last lastSeenAt (ISO). */
async function stopHeartbeat(page: Page, code: string): Promise<string> {
  return page.evaluate(machine => (window as unknown as { __fvMock: { stopHeartbeat: (machine: string) => string } }).__fvMock.stopHeartbeat(machine), code)
}
/**
 * Moves the page clock to `lastSeenAt + seconds` in steps of at most 15 s, letting each poll's answer arrive (real
 * 300 ms) before the next step: one long jump would also fire the 20 s request timeout of a poll started inside the
 * jump, so the screen would rightly say "Chưa rõ" (no up-to-date data) instead of OFFLINE.
 */
async function jumpTo(page: Page, lastSeenAt: string, seconds: number) {
  const target = Date.parse(lastSeenAt) + seconds * 1000
  for (;;) {
    const left = target - await page.evaluate(() => Date.now())
    if (left <= 0) return
    if (left <= 15_000) { await page.clock.fastForward(left); return }
    await page.clock.fastForward(15_000)
    await page.waitForTimeout(300)
  }
}

/**
 * One screen of the acceptance: the badge picks up the machine's last message at the next 30 s reload, stays online at
 * 179 s and shows OFFLINE at 181 s, with no reload of the page.
 */
async function provesThreshold(page: Page, badge: () => Locator) {
  await expect(badge()).toHaveAttribute('data-connection', 'ONLINE')
  const last = await stopHeartbeat(page, 'DEV-MACHINE-01')
  // The next 30 s reload brings that last message (one more interval if the page was still busy; at most 120 s).
  await expect(async () => {
    await page.clock.fastForward(15_000)
    await page.waitForTimeout(300)
    await page.clock.fastForward(15_000)
    await expect(badge()).toHaveAttribute('data-last-seen', last, { timeout: 2_000 })
  }).toPass({ timeout: 10_000, intervals: [0] })
  await jumpTo(page, last, 178)
  await page.waitForTimeout(300)
  await jumpTo(page, last, 179)
  await expect(badge()).toHaveAttribute('data-connection', 'ONLINE')
  await expect(badge()).toContainText('Trực tuyến')
  await jumpTo(page, last, 181)
  await expect(badge()).toHaveAttribute('data-connection', 'OFFLINE')
  await expect(badge()).toContainText('Mất kết nối (OFFLINE)')
}

test.describe('Tiêu chí xong: máy mất heartbeat > 180 s hiện OFFLINE ở mọi màn (179 s vẫn trực tuyến, 181 s OFFLINE)', () => {
  test.beforeEach(async ({ page }) => {
    await page.clock.install()
    await loginAs(page, 'ADMIN')
  })

  test('Danh sách máy', async ({ page }) => {
    await page.goto('/admin/machines')
    const row = () => page.getByRole('table', { name: 'Danh sách máy' }).getByRole('row').filter({ hasText: 'DEV-MACHINE-01' })
    await provesThreshold(page, () => row().locator('[data-connection]'))
    await expect(row()).toContainText(/Mất tín hiệu từ \d{2}\/\d{2}\/\d{4} \d{2}:\d{2} \(hơn 3 phút\)/)
    // The administrative status is untouched.
    await expect(row()).toContainText('Đang mở bán (kiosk nhận đơn khi có hàng).')
    await expect(page).toHaveURL('/admin/machines')
  })

  test('Chi tiết máy: đầu trang (mọi thẻ) và cảnh báo OFFLINE', async ({ page }) => {
    await page.goto(DEV_01)
    const header = () => statusGroup(page).locator('[data-connection]')
    await expect(page.getByText('Máy mất kết nối (OFFLINE)')).toHaveCount(0)
    await provesThreshold(page, header)
    await expect(page.getByText(/^Máy mất kết nối \(OFFLINE\): mất tín hiệu từ/)).toBeVisible()
    await expect(page.getByText(/Lệnh nhả hàng có thể không tới được máy/)).toBeVisible()
  })

  test('Chi tiết máy: thẻ Cảm biến & Sự kiện', async ({ page }) => {
    await page.goto(`${DEV_01}?tab=sensors`)
    await provesThreshold(page, () => heartbeatPanel(page).locator('[data-connection]'))
  })

  test('Tồn kho: chọn máy', async ({ page }) => {
    await page.goto('/admin/inventory')
    await provesThreshold(page, () => page.getByRole('button', { name: /Development fruit machine/ }).locator('[data-connection]'))
  })

  test('Tồn kho: sơ đồ ngăn của máy', async ({ page }) => {
    await page.goto(`/admin/inventory?machineId=${id(1)}`)
    const map = () => page.getByRole('region', { name: /Sơ đồ ngăn/ })
    await expect(map().getByRole('list', { name: 'Các ngăn của máy' })).toBeVisible()
    await provesThreshold(page, () => map().locator('[data-connection]'))
    await expect(map().getByText(/^Máy mất kết nối \(OFFLINE\)/)).toBeVisible()
  })
})

test.describe('Thẻ Cảm biến & Sự kiện (Quản trị viên)', () => {
  test.beforeEach(async ({ page }) => { await loginAs(page, 'ADMIN') })

  test('Máy đang lỗi và mất kết nối: FAULT kèm mã nổi bật, RSSI yếu, firmware, sự kiện lọc trên URL', async ({ page }) => {
    await page.goto(DEV_02)
    await tab(page).click()
    await page.waitForURL(/\?tab=sensors$/)
    await expect(statusGroup(page)).toContainText('Bảo trì')
    await expect(statusGroup(page)).toContainText('Mất kết nối (OFFLINE)')

    const fault = page.getByRole('region', { name: /Bộ nhả hàng đang báo lỗi FAULT/ })
    await expect(fault).toContainText('mã CYCLE_INTERRUPTED')
    await expect(fault).toContainText('Chu trình nhả hàng bị dừng giữa chừng')
    await expect(fault).toContainText('Việc cần làm: Kiểm tra tại máy hai cửa đã đóng')

    const beat = heartbeatPanel(page)
    await expect(beat).toContainText('-86 dBm (Rất yếu, dễ mất kết nối)')
    await expect(beat).toContainText('0.2.1')
    await expect(beat).toContainText('Ngắt kết nối (tin nhắn Last Will')
    await expect(beat.locator('[data-connection]')).toHaveAttribute('data-connection', 'OFFLINE')

    // Events: newest first; the FAULT row carries its code; "Chỉ lỗi FAULT" filters on the server and lands on the URL.
    await expect(eventsTable(page).locator('tbody tr').first()).toContainText('Máy báo ngắt kết nối')
    await expect(eventsTable(page)).toContainText('FAULT · CYCLE_INTERRUPTED')
    await expect(eventsTable(page)).toContainText('Máy đang ở trạng thái FAULT nên không nhả hàng')
    await page.getByRole('button', { name: 'Chỉ lỗi FAULT' }).click()
    await page.waitForURL(/eventType=FAULT/)
    await expect(page.getByRole('button', { name: 'Chỉ lỗi FAULT' })).toHaveAttribute('aria-pressed', 'true')
    await expect(eventsTable(page).locator('tbody tr')).toHaveCount(1)
    await expect(page.getByLabel('Loại sự kiện')).toHaveValue('FAULT')
    // The raw payload is text, opened with the keyboard.
    const raw = eventsTable(page).getByText('Dữ liệu máy gửi')
    await raw.focus()
    await page.keyboard.press('Enter')
    await expect(eventsTable(page).locator('pre')).toContainText('"code": "CYCLE_INTERRUPTED"')
    // Filters replace the history entry; pressing the toggle again shows every event.
    await page.getByRole('button', { name: 'Chỉ lỗi FAULT' }).click()
    await page.waitForURL(/\?tab=sensors$/)
    await expect(eventsTable(page).locator('tbody tr')).toHaveCount(6)
  })

  test('Máy trực tuyến: số đo gần nhất so với ngưỡng, lịch sử theo khoảng thời gian, lỗi cũ đã gỡ, mã lạ vẫn hiện', async ({ page }) => {
    await page.goto(`${DEV_01}?tab=sensors`)
    await expect(page.getByRole('region', { name: /Bộ nhả hàng đang báo lỗi FAULT/ })).toHaveCount(0)
    const beat = heartbeatPanel(page)
    await expect(beat).toContainText('-58 dBm (Tốt)')
    await expect(beat).toContainText('0.3.0')
    await expect(beat).toContainText('2 ngày 3 giờ')
    await expect(beat).toContainText('Sẵn sàng')
    const latest = page.getByRole('region', { name: 'Nhiệt độ và độ ẩm gần nhất' })
    await expect(latest).toContainText('4 °C')
    await expect(latest).toContainText('60 %')
    await expect(latest).toContainText('Cho phép 2 °C – 8 °C')
    await expect(latest).toContainText('Trong ngưỡng cho phép của máy.')
    await expect(readingsTable(page).locator('tbody tr')).toHaveCount(20)
    await expect(readingsTable(page).locator('tbody tr').nth(2)).toContainText('9,5 °C')
    await expect(readingsTable(page).locator('tbody tr').nth(2)).toContainText('Nhiệt độ cao hơn ngưỡng 8 °C')
    await expect(page.getByRole('navigation', { name: 'Phân trang' }).first()).toContainText('24 bản ghi')
    await page.getByLabel('Khoảng thời gian').selectOption('7d')
    await page.waitForURL(/range=7d/)
    await page.getByRole('button', { name: 'Chỉ lỗi FAULT' }).click()
    await expect(eventsTable(page).locator('tbody tr')).toHaveCount(2)
    await expect(eventsTable(page)).toContainText('Mã lỗi GATE_POSITION_LOST chưa có mô tả trên hệ thống.')
    // Switching tab drops the filters of this one.
    await page.getByRole('tab', { name: 'Ngăn' }).click()
    await page.waitForURL(/\?tab=slots$/)
  })

  test('Trang vượt quá trang cuối nói rõ và có đường về; hai nút xóa bộ lọc có tên riêng', async ({ page }) => {
    await page.goto(`${DEV_01}?tab=sensors&eventPage=7&readingPage=9&range=7d&eventType=FAULT`)
    const events = page.getByRole('region', { name: 'Sự kiện của máy' })
    await expect(events).toContainText('Trang này không còn dòng nào')
    await expect(page.getByRole('region', { name: 'Lịch sử nhiệt độ và độ ẩm' })).toContainText('Trang này không còn dòng nào')
    await expect(page.getByRole('button', { name: 'Xóa bộ lọc (1) – sự kiện' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Xóa bộ lọc (1) – số đo' })).toBeVisible()
    await events.getByRole('button', { name: 'Về trang đầu' }).click()
    await expect(eventsTable(page).locator('tbody tr')).toHaveCount(2)
  })

  test('Màn 390 px: thẻ đang chọn luôn nằm trong tầm nhìn của thanh thẻ', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(`${DEV_01}?tab=kiosk`)
    const kiosk = page.getByRole('tablist', { name: 'Thông tin máy' }).getByRole('tab', { name: 'Khóa kiosk' })
    await expect(kiosk).toHaveAttribute('aria-selected', 'true')
    await expect(kiosk).toBeInViewport({ ratio: 0.95 })
    await page.getByRole('tablist', { name: 'Thông tin máy' }).getByRole('tab', { name: 'Tổng quan' }).click()
    await page.getByRole('tablist', { name: 'Thông tin máy' }).getByRole('tab', { name: 'Tổng quan' }).focus()
    await page.keyboard.press('End')
    await page.waitForURL(/\?tab=kiosk$/)
    await expect(kiosk).toBeInViewport({ ratio: 0.95 })
  })

  test('Máy chưa từng kết nối: nói rõ, không có số đo hay sự kiện', async ({ page }) => {
    await page.goto(`${DEV_03}?tab=sensors`)
    await expect(page.getByText('Máy chưa từng kết nối.', { exact: false }).first()).toBeVisible()
    await expect(heartbeatPanel(page)).toContainText('Chưa từng kết nối')
    await expect(heartbeatPanel(page)).toContainText('Chưa có số đo (máy chưa gửi RSSI)')
    await expect(page.getByText('Máy chưa gửi số đo nào.', { exact: false })).toBeVisible()
    await expect(page.getByText('Máy chưa gửi sự kiện nào.')).toBeVisible()
  })

  test('Máy chủ chưa có API (404): một thông báo gọn, kết nối vẫn đúng; 403 và 500 có lời giải thích', async ({ page }) => {
    await page.goto(`${DEV_01}?tab=sensors&scenario=missing:telemetry`)
    await expect(page.getByRole('status').filter({ hasText: MISSING })).toBeVisible()
    await expect(page.getByRole('table')).toHaveCount(0)
    await expect(statusGroup(page)).toContainText('Trực tuyến')

    await page.goto(`${DEV_01}?tab=sensors&scenario=403:telemetry`)
    await expect(page.getByRole('heading', { name: 'Không có quyền truy cập' })).toHaveCount(1)
    await expect(page.getByRole('table')).toHaveCount(0)

    await page.goto(`${DEV_01}?tab=sensors&scenario=error500:telemetry`)
    await expect(heartbeatPanel(page).getByRole('button', { name: 'Thử lại' })).toBeVisible()
    await page.goto(`${DEV_01}?tab=sensors&scenario=none`)
    await expect(heartbeatPanel(page)).toContainText('-58 dBm')
  })
})

test('Nhân viên (MACHINE_READ) xem được thẻ Cảm biến & Sự kiện, chỉ đọc', async ({ page }) => {
  await loginAs(page, 'STAFF')
  await page.goto(`${DEV_02}?tab=sensors`)
  await expect(tab(page)).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('region', { name: /Bộ nhả hàng đang báo lỗi FAULT/ })).toContainText('CYCLE_INTERRUPTED')
  await expect(page.getByRole('button', { name: /xóa|xoá|delete|gỡ|reset/i }).filter({ hasNotText: /bộ lọc/i })).toHaveCount(0)
})

for (const theme of THEMES) {
  test(`Ảnh + axe: machine-sensors (${theme})`, async ({ page }, testInfo) => {
    await useThemeChoice(page, theme)
    await loginAs(page, 'ADMIN')
    await page.goto(`${DEV_02}?tab=sensors`)
    await auditScreen(page, testInfo, 'machine-sensors', theme, () => expect(eventsTable(page).locator('tbody tr')).toHaveCount(6))
  })
}
