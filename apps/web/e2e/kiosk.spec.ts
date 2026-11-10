// Kiosk /buy at the machine's 1280x800 screen, light theme (project "kiosk"), on the mock kiosk API: the catalog and the
// QR payment screen. The kiosk is outside FM2: axe findings are reported, blocking ones only via axe-known.ts.
import { expect, test } from '@playwright/test'
import { auditScreen } from './support.ts'

const KIOSK = [{ name: '1280x800', width: 1280, height: 800 }]

test('Kiosk: danh mục và màn thanh toán QR ở 1280×800', async ({ page }, testInfo) => {
  await page.goto('/buy')
  const heading = page.getByRole('heading', { level: 1, name: 'Chạm để chọn sản phẩm' })
  await auditScreen(page, testInfo, 'kiosk-catalog', 'light', () => expect(heading).toBeVisible(), KIOSK)

  await page.locator('.buy-product').first().click()
  await auditScreen(page, testInfo, 'kiosk-payment', 'light', () => expect(page.getByRole('img', { name: 'Mã QR thanh toán' })).toBeVisible(), KIOSK)
})
