// Kiosk /buy at the machine's 1280x800 screen, light theme (project "kiosk"), on the mock kiosk API (FM5, screens K1–K8).
// The mock plays the backend: `?scenario=` picks machine/dispense states and window.__freshvendMock.payKioskOrder()
// plays the verified payment webhook, so "PAID ≤ 3 s after the webhook" can be timed. Real API: BE M2 / 3.3 (30/11).
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { auditScreen } from './support.ts'

const KIOSK = [{ name: '1280x800', width: 1280, height: 800 }]
/** Order + payment + client-side QR render; generous because the full suite runs 3 browsers at once on one machine. */
const QR_TIMEOUT = 20_000

async function openKiosk(page: Page, query = '') {
  await page.goto(`/buy${query}`)
  await expect(page.getByRole('heading', { level: 1, name: 'Chạm để chọn sản phẩm' })).toBeVisible()
}

/** Picks the first product and waits for its QR. */
async function buyFirst(page: Page) {
  await page.locator('.buy-product').first().click()
  await expect(page.getByRole('img', { name: /Mã QR thanh toán/ })).toBeVisible({ timeout: QR_TIMEOUT })
}

/** Every visible control on the current screen is at least 64 px tall (kiosk touch target). */
async function expectTouchTargets(page: Page, screen: string) {
  const buttons = page.getByRole('button')
  await expect(buttons.first()).toBeVisible()
  for (const button of await buttons.all()) {
    if (!(await button.isVisible())) continue
    const box = await button.boundingBox()
    if (box) expect(box.height, `${screen}: "${(await button.innerText()).trim()}"`).toBeGreaterThanOrEqual(64)
  }
}

const pay = (page: Page) => page.evaluate(() => (window as unknown as { __freshvendMock: { payKioskOrder: () => string | null } }).__freshvendMock.payKioskOrder())

test('K1: danh mục và màn thanh toán QR ở 1280×800', async ({ page }, testInfo) => {
  await openKiosk(page, '?scenario=pending&incident=on')
  const heading = page.getByRole('heading', { level: 1, name: 'Chạm để chọn sản phẩm' })
  await auditScreen(page, testInfo, 'kiosk-catalog', 'light', () => expect(heading).toBeVisible(), KIOSK)
  // Large touch targets: product cards, help and the incident corner button.
  await expect(page.locator('.buy-product')).toHaveCount(2)
  await expectTouchTargets(page, 'danh mục')
  // The card shows the server price of the box that will be sold, and the payment screen charges that same total.
  const card = page.locator('.buy-product').first()
  const price = (await card.locator('strong').innerText()).trim()
  await expect(card).toContainText('1 hộp')
  await buyFirst(page)
  await expect(page.locator('.buy-pay-total dd')).toHaveText(price)
  await expect(page.locator('.buy-qr-amount strong')).toHaveText(price)
  await auditScreen(page, testInfo, 'kiosk-payment', 'light', () => expect(page.getByRole('img', { name: /Mã QR thanh toán/ })).toBeVisible(), KIOSK)
  await expectTouchTargets(page, 'màn QR')
  await page.getByRole('button', { name: 'Hủy đơn và chọn lại' }).click()
  await expect(page.getByRole('dialog', { name: 'Hủy đơn hàng?' })).toBeVisible()
  await expectTouchTargets(page, 'dialog hủy')
  await page.getByRole('button', { name: 'Xác nhận hủy đơn' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Đơn hàng đã hủy' })).toBeVisible()
  await expectTouchTargets(page, 'màn đã hủy')
})

test('K1: chọn món chỉ bằng bàn phím', async ({ page }) => {
  await openKiosk(page, '?scenario=pending')
  await page.locator('.buy-product').first().focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('img', { name: /Mã QR thanh toán/ })).toBeVisible({ timeout: QR_TIMEOUT })
})

for (const [scenario, title, next, screen] of [
  ['maintenance', 'Máy đang bảo trì', 'Máy sẽ mở bán lại ngay khi bảo trì xong', 'kiosk-maintenance'],
  ['network', 'Máy đang mất kết nối', 'Máy tự kết nối lại sau mỗi 15 giây', 'kiosk-offline'],
  ['401', 'Máy chưa được cấu hình', 'Vui lòng liên hệ nhân viên vận hành', 'kiosk-unconfigured'],
  ['empty', 'Máy đã hết hàng', 'Nhân viên sẽ sớm nạp thêm', 'kiosk-sold-out'],
] as const) {
  test(`K7: trạng thái máy "${title}" có lời giải thích và bước tiếp theo`, async ({ page }, testInfo) => {
    await page.goto(`/buy?scenario=${scenario}`)
    await auditScreen(page, testInfo, screen, 'light', () => expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible(), KIOSK)
    await expect(page.getByText(next)).toBeVisible()
  })
}

test('K2 → K3 → K4: thấy đã thanh toán ≤ 3 giây sau webhook, rồi nhả hàng và cảm ơn', async ({ page }, testInfo) => {
  await openKiosk(page, '?scenario=pending')
  await buyFirst(page)
  await expect(page.getByRole('timer')).toContainText(/^Thời gian còn lại\s*[45]:\d\d$/)
  const orderCode = (await page.locator('.buy-pay-code strong').innerText()).trim()
  const paidAt = Date.now()
  expect(await pay(page)).toBe(orderCode)
  await expect(page.getByRole('heading', { level: 1, name: /Đang gửi lệnh nhả hàng|Máy đang nhả hàng/ })).toBeVisible({ timeout: 3_000 })
  const seenAfter = Date.now() - paidAt
  testInfo.annotations.push({ type: 'PAID sau webhook', description: `${seenAfter} ms` })
  expect(seenAfter).toBeLessThanOrEqual(3_000)
  await expect(page.locator('.buy-order-code strong')).toHaveText(orderCode)
  await auditScreen(page, testInfo, 'kiosk-dispensing', 'light', () => expect(page.getByRole('heading', { level: 1, name: 'Máy đang nhả hàng' })).toBeVisible(), KIOSK)
  await auditScreen(page, testInfo, 'kiosk-thanks', 'light', () => expect(page.getByRole('heading', { level: 1, name: 'Mời bạn lấy trái cây' })).toBeVisible({ timeout: 10_000 }), KIOSK)
  await expect(page.locator('.buy-order-code strong')).toHaveText(orderCode)
  await expect(page.getByText(/Tự về màn hình chính sau (\d|1[0-2]) giây/)).toBeVisible()
  await expectTouchTargets(page, 'màn cảm ơn')
})

test('K5: nhả lỗi hiện mã đơn to và giữ màn hình đủ lâu', async ({ page }, testInfo) => {
  await openKiosk(page, '?scenario=dispense-failed')
  await buyFirst(page)
  const orderCode = (await page.locator('.buy-pay-code strong').innerText()).trim()
  await pay(page)
  await auditScreen(page, testInfo, 'kiosk-dispense-failed', 'light', () => expect(page.getByRole('heading', { level: 1, name: 'Máy chưa nhả được hàng' })).toBeVisible({ timeout: 10_000 }), KIOSK)
  const code = page.locator('.buy-order-code-large strong')
  await expect(code).toHaveText(orderCode)
  expect(parseFloat(await code.evaluate(element => getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(40)
  await expect(page.getByText(/Tự về màn hình chính sau (5\d|60) giây/)).toBeVisible()
  await expectTouchTargets(page, 'màn nhả lỗi')
})

test('K3: nhả hàng lâu bất thường thì giải thích thay vì quay mãi', async ({ page }) => {
  await page.clock.install()
  await openKiosk(page, '?scenario=dispense-slow')
  await buyFirst(page)
  await pay(page)
  await expect(page.getByRole('heading', { level: 1, name: 'Máy đang nhả hàng' })).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText('Máy đang xử lý lâu hơn bình thường.')).toHaveCount(0)
  await page.clock.fastForward(46_000)
  await expect(page.getByText('Máy đang xử lý lâu hơn bình thường.')).toBeVisible()
  await expect(page.locator('.buy-order-code-large strong')).toBeVisible()
  // No report at all from the machine: after 2.5 minutes the kiosk stops waiting and keeps the order code on screen.
  await page.clock.fastForward(105_000)
  await expect(page.getByRole('heading', { level: 1, name: 'Máy chưa báo kết quả nhả hàng' })).toBeVisible()
  await expect(page.locator('.buy-order-code-large strong')).toBeVisible()
})

test('K6: hủy đơn nói rõ chưa bị trừ tiền', async ({ page }, testInfo) => {
  await openKiosk(page, '?scenario=pending')
  await buyFirst(page)
  await page.getByRole('button', { name: 'Hủy đơn và chọn lại' }).click()
  const dialog = page.getByRole('dialog', { name: 'Hủy đơn hàng?' })
  await expect(dialog).toContainText('Bạn chưa bị trừ tiền')
  await dialog.getByRole('button', { name: 'Xác nhận hủy đơn' }).click()
  await auditScreen(page, testInfo, 'kiosk-cancelled', 'light', () => expect(page.getByRole('heading', { level: 1, name: 'Đơn hàng đã hủy' })).toBeVisible(), KIOSK)
  await expect(page.getByText('Bạn chưa bị trừ tiền.')).toBeVisible()
})

test('K6: hết giờ giữ hàng nói rõ chưa bị trừ tiền', async ({ page }, testInfo) => {
  await page.clock.install()
  await openKiosk(page, '?scenario=pending')
  await buyFirst(page)
  // Nobody touches the kiosk while paying on the phone: a live QR is never cancelled by the idle timer, only by its
  // reservation deadline.
  await page.clock.fastForward(150_000)
  await expect(page.getByRole('img', { name: /Mã QR thanh toán/ })).toBeVisible()
  await expect(page.getByRole('timer')).toContainText(/[23]:\d\d/)
  await page.clock.fastForward(155_000)
  // The clock keeps running in real time, so the screen is checked before its 10-second automatic return.
  await auditScreen(page, testInfo, 'kiosk-expired', 'light', () => expect(page.getByRole('heading', { level: 1, name: 'Đơn hàng đã hết hạn' })).toBeVisible({ timeout: 10_000 }), KIOSK)
  await expect(page.getByText('Bạn chưa bị trừ tiền.')).toBeVisible()
})

test('K8: nút Báo sự cố ẩn mặc định; bật cờ thì hiện và QR mở đúng link máy', async ({ page }, testInfo) => {
  await openKiosk(page)
  await expect(page.getByRole('button', { name: 'Báo sự cố' })).toHaveCount(0)

  await openKiosk(page, '?incident=on')
  await page.getByRole('button', { name: 'Báo sự cố' }).click()
  const dialog = page.getByRole('dialog', { name: 'Báo sự cố với máy' })
  await auditScreen(page, testInfo, 'kiosk-incident', 'light', () => expect(dialog.getByRole('img', { name: /báo sự cố/ })).toBeVisible(), KIOSK)
  const origin = new URL(page.url()).origin
  await expect(dialog.locator('.buy-incident-url')).toHaveText(`${origin}/bao-su-co?machine=DEV-MACHINE-01`)
  await dialog.getByRole('button', { name: 'Đóng' }).click()
  await expect(dialog).toBeHidden()
})
