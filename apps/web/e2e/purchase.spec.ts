import { expect, test, type Page } from '@playwright/test'

const product = { productId: 'p1', sku: 'APPLE', name: 'Táo tươi', price: 35000, availableQuantity: 3 }
const identity = { machineId: 'm1', machineCode: 'VM-TEST', machineName: 'Test machine', machineStatus: 'ACTIVE' }

async function mockPurchase(page: Page) {
  let state = 'PENDING_PAYMENT', created = 0
  const calls: string[] = []
  await page.route('**/api/v1/**', async route => {
    const path = new URL(route.request().url()).pathname
    const method = route.request().method()
    calls.push(`${method} ${path}`)
    const order = { id: 'o1', orderCode: 'ORD-TEST', machineId: 'm1', status: state, totalAmount: 35000,
      expiresAt: new Date(Date.now() + 300_000).toISOString(), items: [{ ...product, productName: product.name, quantity: 1, unitPrice: 35000 }],
      currentPayment: { status: 'PENDING', qrCode: 'MOCK-QR|TEST|35000', amount: 35000 } }
    let data: unknown
    if (path.endsWith('/kiosk/me')) data = identity
    else if (path.endsWith('/kiosk/catalog')) data = { ...identity, acceptingOrders: true, products: [product] }
    else if (path.endsWith('/kiosk/orders') && method === 'POST') { created += 1; data = order }
    else if (path.endsWith('/orders/o1/payments')) data = order.currentPayment
    else if (path.endsWith('/orders/o1/dispense-command')) data = { id: 'cmd1', orderId: 'o1', slotId: 'slot1', status: 'PENDING' }
    else if (path.endsWith('/orders/o1') && method === 'GET') data = order
    else throw new Error(`Unexpected purchase request: ${method} ${path}`)
    await route.fulfill({ status: path.endsWith('/kiosk/orders') ? 201 : 200,
      contentType: 'application/json', body: JSON.stringify({ timestamp: new Date().toISOString(), message: 'Test', data }) })
  })
  return { setState: (value: string) => { state = value }, calls, created: () => created }
}

test('PAID stays waiting, DISPENSING stays in progress, only COMPLETED confirms delivery', async ({ page }) => {
  const api = await mockPurchase(page)
  await page.goto('/buy')
  await page.getByRole('button', { name: /Táo tươi, / }).click()
  await expect(page.getByAltText('Mã QR thanh toán')).toBeVisible()
  api.setState('PAID')
  await expect(page.getByRole('heading', { name: 'Đã thanh toán — đang chuẩn bị tô' })).toBeVisible({ timeout: 10_000 })
  await expect.poll(() => api.calls.some(call => call === 'POST /api/v1/kiosk/orders/o1/dispense-command')).toBeTruthy()
  // Regression: the old screen returned to the catalog 12 seconds after PAID.
  await page.waitForTimeout(13_000)
  await expect(page.getByRole('heading', { name: 'Đã thanh toán — đang chuẩn bị tô' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Mua sản phẩm khác' })).toHaveCount(0)
  api.setState('DISPENSING')
  await expect(page.getByRole('heading', { name: 'Máy đang nhả tô' })).toBeVisible({ timeout: 10_000 })
  api.setState('COMPLETED')
  await expect(page.getByRole('heading', { name: 'Mời bạn nhận tô trái cây' })).toBeVisible({ timeout: 10_000 })
  expect(api.calls.some(call => /\/claim|\/results/.test(call))).toBeFalsy()
})

test('a failed dispense requests staff support without another charge or motor retry', async ({ page }) => {
  const api = await mockPurchase(page)
  await page.goto('/buy')
  await page.getByRole('button', { name: /Táo tươi, / }).click()
  api.setState('DISPENSE_FAILED')
  await expect(page.getByRole('heading', { name: 'Cần nhân viên hỗ trợ' })).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText(/Không thanh toán lại; vui lòng báo nhân viên/)).toBeVisible()
  await expect(page.getByAltText('Mã QR thanh toán')).toHaveCount(0)
  expect(api.created()).toBe(1)
})

test('reloading while dispensing recovers the server order without creating a second purchase', async ({ page }) => {
  const api = await mockPurchase(page)
  await page.goto('/buy')
  await page.getByRole('button', { name: /Táo tươi, / }).click()
  await expect(page.getByAltText('Mã QR thanh toán')).toBeVisible()
  api.setState('DISPENSING')
  await expect(page.getByRole('heading', { name: 'Máy đang nhả tô' })).toBeVisible({ timeout: 10_000 })
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Máy đang nhả tô' })).toBeVisible({ timeout: 10_000 })
  expect(api.created()).toBe(1)
  expect(api.calls.some(call => /\/claim|\/results/.test(call))).toBeFalsy()
})
