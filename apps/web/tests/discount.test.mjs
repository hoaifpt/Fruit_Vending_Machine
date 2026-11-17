// FE 7.5 near-expiry discount on the real API (backend #61, docs/near-expiry-pricing.md): shared price display
// (src/lib/price.ts), the setting rules (src/admin/pricing.ts), the mock of the backend rule (src/api/mock/pricing.ts) and
// the mock data the screens show.
// Done criterion: "35.000 ₫ hiện 17.500 ₫ kèm giá gốc gạch; định dạng tiền thống nhất".
import test from 'node:test'
import assert from 'node:assert/strict'
import { ApiError, configureClient } from '../src/api/client.ts'
import { authApi, inventoryApi, ordersApi, pricingApi } from '../src/api/resources.ts'
import { createKioskApi } from '../src/kiosk/api.ts'
import { createMockFetcher, parseSelection } from '../src/api/mock/fetcher.ts'
import { boxPrice, eligibleToday, linePricing } from '../src/api/mock/pricing.ts'
import { DISCOUNT_TODAY, PRICING_STALE, parsePercent, pricingBody, pricingError, pricingText, pricingValues, validatePricing } from '../src/admin/pricing.ts'
import { MOCK_ACCOUNTS, MOCK_PASSWORDS } from '../src/api/mock/seed.ts'
import { formatMoney } from '../src/lib/format.ts'
import { discountPercentOf, discountReasonText, lineView, orderDiscount, priceView } from '../src/lib/price.ts'

/** Intl writes a no-break space before ₫; compare with a plain space. */
const plain = text => text?.replace(/\s/g, ' ')
const NOW = Date.parse('2026-12-04T03:00:00Z')
const HOUR = 3_600_000
const WATERMELON = '40000000-0000-0000-0000-000000000002'
const MIXED = '40000000-0000-0000-0000-000000000001'
const MACHINE = '20000000-0000-0000-0000-000000000001'

test('done criterion: 35.000 ₫ shows 17.500 ₫ with the original struck and a -50% tag', () => {
  const view = priceView({ price: 17500, originalPrice: 35000, discountPercent: 50 })
  assert.equal(view.discounted, true)
  assert.equal(plain(view.current), '17.500 ₫')
  assert.equal(plain(view.original), '35.000 ₫')
  assert.equal(view.tag, '-50%')
  assert.equal(plain(view.spoken), 'Giá 17.500 ₫, giá gốc 35.000 ₫, giảm 50%')
})

test('one money format everywhere: priceView uses formatMoney', () => {
  for (const amount of [0, 17500, 35000, 1234567]) assert.equal(priceView({ price: amount }).current, formatMoney(amount))
  assert.equal(plain(priceView({ price: 35000 }).current), '35.000 ₫')
  assert.equal(priceView({ price: undefined }).current, '—')
})

test('missing or equal discount fields read as no discount (real API today)', () => {
  for (const input of [{ price: 35000 }, { price: 35000, originalPrice: null }, { price: 35000, originalPrice: 35000, discountPercent: null },
    { price: 35000, originalPrice: 30000 }, { price: undefined, originalPrice: 35000 }, { price: 35000, originalPrice: Number.NaN }, { price: 0, originalPrice: 0 }]) {
    const view = priceView(input)
    assert.equal(view.discounted, false, JSON.stringify(input))
    assert.equal(view.original, undefined)
    assert.equal(view.tag, undefined)
  }
  assert.equal(plain(priceView({ price: 35000 }).spoken), 'Giá 35.000 ₫')
})

test('the tag uses the server percent, else derives it from the two prices within 1..99', () => {
  assert.equal(discountPercentOf(17500, 35000, 50), 50)
  assert.equal(discountPercentOf(16667, 33333, null), 50)
  assert.equal(discountPercentOf(17500, 35000, 150), 50, 'an invalid server percent is ignored')
  assert.equal(discountPercentOf(34999, 35000), 1, 'never shows -0%')
  assert.equal(priceView({ price: 24500, originalPrice: 35000 }).tag, '-30%')
})

test('order lines: discount from the server, else (original - unit) x quantity; order total discount', () => {
  const served = lineView({ quantity: 1, unitPrice: 17500, totalPrice: 17500, originalUnitPrice: 35000, discountAmount: 17500, discountPercent: 50 })
  assert.equal(served.discount, 17500)
  assert.equal(plain(served.total), '17.500 ₫')
  assert.equal(plain(served.unit.original), '35.000 ₫')
  assert.equal(lineView({ quantity: 2, unitPrice: 12500, totalPrice: 25000, originalUnitPrice: 25000 }).discount, 25000)
  assert.equal(lineView({ quantity: 1, unitPrice: 35000, totalPrice: 35000 }).discount, 0)
  assert.equal(orderDiscount({ discountAmount: 17500, items: [] }), 17500)
  assert.equal(orderDiscount({ items: [{ quantity: 1, unitPrice: 17500, originalUnitPrice: 35000 }, { quantity: 1, unitPrice: 30000 }] }), 17500)
  assert.equal(orderDiscount({ items: [{ quantity: 1, unitPrice: 35000, totalPrice: 35000 }] }), 0)
  assert.equal(orderDiscount({}), 0)
  assert.equal(discountReasonText('NEAR_EXPIRY'), 'Giảm giá hộp cận hạn')
  assert.equal(discountReasonText('OTHER'), 'Giảm giá')
})


test('mock rule of backend #61: bowls whose batch expires on the business day of today (Vietnam) sell at the percent, rounded down', () => {
  // NOW is 10:00 on 04/12/2026 in Vietnam; the business day ends at 17:00 UTC.
  const today = new Date(NOW + 10 * HOUR).toISOString() // 20:00 Vietnam, same day
  const tomorrow = new Date(NOW + 15 * HOUR).toISOString() // 01:00 Vietnam, next day
  assert.deepEqual(boxPrice(35000, today, NOW), { originalUnitPrice: 35000, unitPrice: 17500, discountPercent: 50, discountReason: 'NEAR_EXPIRY' })
  assert.equal(boxPrice(33333, today, NOW).unitPrice, 16666, 'floor, whole VND')
  assert.equal(boxPrice(35000, today, NOW, { enabled: true, percent: 30 }).unitPrice, 24500)
  assert.deepEqual(boxPrice(35000, tomorrow, NOW), { originalUnitPrice: 35000, unitPrice: 35000, discountPercent: 0, discountReason: 'NONE' })
  assert.equal(boxPrice(35000, new Date(NOW - 1).toISOString(), NOW).discountReason, 'NONE', 'an expired bowl is not sold')
  assert.equal(boxPrice(35000, today, NOW, { enabled: false, percent: 50 }).unitPrice, 35000)
  assert.equal(eligibleToday(today, NOW), true)
  assert.deepEqual(linePricing(boxPrice(35000, today, NOW), 2), { unitPrice: 17500, totalPrice: 35000, originalUnitPrice: 35000, discountPercent: 50, discountReason: 'NEAR_EXPIRY' })
})

test('discount setting: words, form values, PUT body with the version (undefined when unchanged), percent 1..90, 409 explained', () => {
  const setting = { enabled: true, percent: 50, version: 3 }
  assert.match(pricingText(setting), /giảm 50 %/)
  assert.match(pricingText({ ...setting, enabled: false }), /Đang tắt/)
  assert.deepEqual(pricingValues(setting), { enabled: 'true', percent: '50' })
  assert.equal(pricingBody(setting, pricingValues(setting)), undefined)
  assert.deepEqual(pricingBody(setting, { enabled: 'false', percent: '50' }), { enabled: false, percent: 50, version: 3 })
  assert.deepEqual(pricingBody(setting, { enabled: 'true', percent: '30' }), { enabled: true, percent: 30, version: 3 })
  for (const bad of ['0', '91', '50.5', '', 'x']) assert.ok(validatePricing({ enabled: 'true', percent: bad }).percent, bad)
  assert.deepEqual(validatePricing({ enabled: 'true', percent: '90' }), {})
  assert.equal(parsePercent(' 1 '), 1)
  assert.equal(pricingError(new ApiError(409, 'STALE_VERSION: x')).message, PRICING_STALE)
  assert.equal(DISCOUNT_TODAY, 'Giảm giá hôm nay')
})

function setup() {
  const state = { token: null, clock: NOW }
  const fetcher = createMockFetcher(parseSelection('all'), { getSearch: () => '', now: () => state.clock, realFetch: async () => { throw new Error('no network') } })
  configureClient({ baseUrl: '', fetcher, getToken: () => state.token, onUnauthorized: () => {} })
  return state
}

test('mock kiosk: the watermelon expiring today is sold at 12.500 ₫ (25.000 ₫ struck) and the order snapshots the discount', async () => {
  setup()
  const kiosk = createKioskApi('any-kiosk-key')
  const products = (await kiosk.catalog()).data.products
  const watermelon = products.find(product => product.productId === WATERMELON)
  assert.deepEqual([watermelon.price, watermelon.originalPrice, watermelon.discountPercent, watermelon.discountReason], [12500, 25000, 50, 'NEAR_EXPIRY'])
  const mixed = products.find(product => product.productId === MIXED)
  assert.deepEqual([mixed.price, mixed.originalPrice, mixed.discountPercent, mixed.discountReason], [35000, 35000, 0, 'NONE'], 'fresh bowls keep the list price')
  const order = (await kiosk.createOrder(WATERMELON)).data
  assert.deepEqual([order.subtotal, order.discountAmount, order.totalAmount], [25000, 12500, 12500], 'subtotal at list price, total is what is paid')
  assert.deepEqual(order.items.map(line => [line.unitPrice, line.totalPrice, line.originalUnitPrice, line.discountPercent, line.discountReason]), [[12500, 12500, 25000, 50, 'NEAR_EXPIRY']])
  const payment = (await kiosk.createPayment(order.id)).data
  assert.equal(payment.amount, 12500, 'the QR charges the order total')
})

test('mock admin: order 13 is 35.000 ₫ sold at 17.500 ₫; others answer 0 / NONE; bowls carry discountEligibleToday only', async () => {
  const state = setup()
  state.token = (await authApi.login({ email: MOCK_ACCOUNTS.staff, password: MOCK_PASSWORDS.staff })).accessToken
  const order = await ordersApi.get('90000000-0000-0000-0000-000000000013')
  assert.deepEqual([order.status, order.subtotal, order.totalAmount, order.discountAmount], ['COMPLETED', 35000, 17500, 17500])
  const [line] = order.items
  assert.deepEqual([line.unitPrice, line.originalUnitPrice, line.discountPercent, line.discountReason], [17500, 35000, 50, 'NEAR_EXPIRY'])
  const view = lineView(line)
  assert.deepEqual([plain(view.unit.current), plain(view.unit.original), view.unit.tag, plain(formatMoney(view.discount))], ['17.500 ₫', '35.000 ₫', '-50%', '17.500 ₫'])
  const plainOrder = await ordersApi.get('90000000-0000-0000-0000-000000000001')
  assert.deepEqual([plainOrder.discountAmount, plainOrder.items[0].discountReason, plainOrder.items[0].discountPercent], [0, 'NONE', 0])
  assert.equal(lineView(plainOrder.items[0]).unit.discounted, false)
  assert.equal((await ordersApi.list({ search: '00000013', size: 5 })).content[0].discountAmount, 17500)

  const bowls = (await inventoryApi.list({ machineId: MACHINE, size: 100 })).content
  assert.ok(bowls.every(bowl => !('unitPrice' in bowl) && typeof bowl.discountEligibleToday === 'boolean'), 'no price on a bowl, only the flag')
  const eligible = bowls.filter(bowl => bowl.discountEligibleToday)
  assert.ok(eligible.length > 0 && eligible.every(bowl => bowl.productId === WATERMELON), 'only the watermelon expiring today')
  assert.ok(bowls.filter(bowl => bowl.expired).every(bowl => !bowl.discountEligibleToday), 'an expired bowl is not discounted')
})

test('mock setting: PRICING_READ for staff, PRICING_MANAGE for admin; a stale version is 409; turning it off removes the flag', async () => {
  const state = setup()
  state.token = (await authApi.login({ email: MOCK_ACCOUNTS.staff, password: MOCK_PASSWORDS.staff })).accessToken
  const setting = await pricingApi.get()
  assert.deepEqual([setting.enabled, setting.percent, setting.businessZone], [true, 50, 'Asia/Ho_Chi_Minh'])
  await assert.rejects(pricingApi.update({ enabled: false, percent: 50, version: setting.version }), error => error.status === 403)
  state.token = (await authApi.login({ email: MOCK_ACCOUNTS.admin, password: MOCK_PASSWORDS.admin })).accessToken
  await assert.rejects(pricingApi.update({ enabled: true, percent: 91, version: setting.version }), error => error.status === 400 && !!error.fieldErrors.percent)
  await assert.rejects(pricingApi.update({ enabled: false, percent: 50, version: setting.version - 1 }), error => error.status === 409 && pricingError(error).message === PRICING_STALE)
  const off = await pricingApi.update({ enabled: false, percent: 50, version: setting.version })
  assert.deepEqual([off.enabled, off.version, off.updatedBy.fullName], [false, setting.version + 1, 'Quản trị viên'])
  assert.equal((await pricingApi.update({ enabled: false, percent: 50, version: off.version })).version, off.version, 'unchanged: same version')
  assert.ok((await inventoryApi.list({ machineId: MACHINE, size: 100 })).content.every(bowl => !bowl.discountEligibleToday))
  const kiosk = createKioskApi('any-kiosk-key')
  assert.equal((await kiosk.catalog()).data.products.find(product => product.productId === WATERMELON).price, 25000)
})
