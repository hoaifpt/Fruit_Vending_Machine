// FE 7.5 near-expiry discount: shared price display (src/lib/price.ts), the mock of the rule proposed to backend 4.1
// (src/api/mock/pricing.ts, draft api-contract/drafts/pricing-discount.yaml) and the mock data the screens show.
// Done criterion: "35.000 ₫ hiện 17.500 ₫ kèm giá gốc gạch; định dạng tiền thống nhất".
import test from 'node:test'
import assert from 'node:assert/strict'
import { configureClient } from '../src/api/client.ts'
import { authApi, inventoryApi, ordersApi } from '../src/api/resources.ts'
import { createKioskApi } from '../src/kiosk/api.ts'
import { createMockFetcher, parseSelection } from '../src/api/mock/fetcher.ts'
import { boxPrice, linePricing, NEAR_EXPIRY_WINDOW_MS, roundVnd } from '../src/api/mock/pricing.ts'
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

test('mock rule (proposal to backend 4.1): 50% off within 24 h of expiry, whole VND half up', () => {
  assert.deepEqual(boxPrice(35000, new Date(NOW + 10 * HOUR).toISOString(), NOW), { originalUnitPrice: 35000, unitPrice: 17500, discountPercent: 50, discountReason: 'NEAR_EXPIRY' })
  assert.equal(boxPrice(33333, new Date(NOW + HOUR).toISOString(), NOW).unitPrice, 16667)
  assert.equal(boxPrice(25001, new Date(NOW + HOUR).toISOString(), NOW).unitPrice, 12501)
  assert.equal(roundVnd(12500.5), 12501)
  assert.equal(roundVnd(12500.49), 12500)
  // Window edges: exactly 24 h is near expiry, a minute more is not; an expired box is never discounted (it is not sold).
  assert.equal(boxPrice(35000, new Date(NOW + NEAR_EXPIRY_WINDOW_MS).toISOString(), NOW).unitPrice, 17500)
  assert.equal(boxPrice(35000, new Date(NOW + NEAR_EXPIRY_WINDOW_MS + 60_000).toISOString(), NOW).discountPercent, null)
  assert.equal(boxPrice(35000, new Date(NOW - 1).toISOString(), NOW).unitPrice, 35000)
  assert.equal(boxPrice(35000, undefined, NOW).unitPrice, 35000)
  assert.deepEqual(linePricing(boxPrice(35000, new Date(NOW + HOUR).toISOString(), NOW), 2),
    { unitPrice: 17500, totalPrice: 35000, originalUnitPrice: 35000, discountAmount: 35000, discountPercent: 50, discountReason: 'NEAR_EXPIRY' })
})

function setup() {
  const state = { token: null }
  const fetcher = createMockFetcher(parseSelection('all'), { getSearch: () => '', now: () => Date.now(), realFetch: async () => { throw new Error('no network') } })
  configureClient({ baseUrl: '', fetcher, getToken: () => state.token, onUnauthorized: () => {} })
  return state
}

test('mock kiosk: the near-expiry watermelon is sold at 12.500 ₫ (25.000 ₫ struck) and the order snapshots the discount', async () => {
  setup()
  const kiosk = createKioskApi('any-kiosk-key')
  const products = (await kiosk.catalog()).data.products
  const watermelon = products.find(product => product.productId === WATERMELON)
  assert.deepEqual([watermelon.price, watermelon.originalUnitPrice, watermelon.discountPercent, watermelon.discountReason], [12500, 25000, 50, 'NEAR_EXPIRY'])
  const mixed = products.find(product => product.productId === MIXED)
  assert.deepEqual([mixed.price, mixed.originalUnitPrice, mixed.discountPercent], [35000, 35000, null], 'fresh boxes keep the list price')

  const order = (await kiosk.createOrder(WATERMELON)).data
  assert.equal(order.totalAmount, 12500, 'the amount to pay is the discounted price')
  assert.equal(order.subtotal, 12500)
  assert.equal(order.discountAmount, 12500)
  assert.deepEqual(order.items.map(line => [line.unitPrice, line.totalPrice, line.originalUnitPrice, line.discountAmount, line.discountPercent]), [[12500, 12500, 25000, 12500, 50]])
  const payment = (await kiosk.createPayment(order.id)).data
  assert.equal(payment.amount, 12500, 'the QR charges the order total')
})

test('mock admin: order 13 is 35.000 ₫ sold at 17.500 ₫; orders without discount still answer 0; boxes carry their price', async () => {
  const state = setup()
  state.token = (await authApi.login({ email: MOCK_ACCOUNTS.staff, password: MOCK_PASSWORDS.staff })).accessToken
  const order = await ordersApi.get('90000000-0000-0000-0000-000000000013')
  assert.equal(order.status, 'COMPLETED')
  assert.deepEqual([order.totalAmount, order.discountAmount], [17500, 17500])
  const [line] = order.items
  assert.deepEqual([line.unitPrice, line.originalUnitPrice, line.discountAmount, line.discountPercent, line.discountReason], [17500, 35000, 17500, 50, 'NEAR_EXPIRY'])
  assert.equal(order.payments.every(payment => payment.amount === 17500), true)
  const view = lineView(line)
  assert.deepEqual([plain(view.unit.current), plain(view.unit.original), view.unit.tag, plain(formatMoney(view.discount))], ['17.500 ₫', '35.000 ₫', '-50%', '17.500 ₫'])

  const plainOrder = await ordersApi.get('90000000-0000-0000-0000-000000000001')
  assert.equal(plainOrder.discountAmount, 0)
  assert.equal(orderDiscount(plainOrder), 0)
  assert.equal(lineView(plainOrder.items[0]).unit.discounted, false)

  const row = (await ordersApi.list({ search: '00000013', size: 5 })).content[0]
  assert.equal(row.discountAmount, 17500)

  const boxes = (await inventoryApi.list({ machineId: MACHINE, size: 100 })).content
  const discounted = boxes.filter(box => priceView({ price: box.unitPrice, originalPrice: box.originalUnitPrice, discountPercent: box.discountPercent }).discounted)
  assert.ok(discounted.length > 0 && discounted.every(box => box.productId === WATERMELON && box.unitPrice === 12500), 'only the near-expiry watermelon boxes')
  const expired = boxes.filter(box => box.expired)
  assert.ok(expired.length > 0 && expired.every(box => box.discountPercent === null), 'an expired box is not discounted')
})
