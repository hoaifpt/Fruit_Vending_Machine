import test from 'node:test'
import assert from 'node:assert/strict'
import { commandScore, plainText } from '../src/lib/command-filter.ts'
import { NAV } from '../src/admin/routes.ts'

/** What the palette shows for a search, best first (cmdk sorts by score, drops 0; ties keep menu order). */
const rank = (search, items = NAV) => items
  .map((item, index) => ({ label: item.label, index, score: commandScore(item.label, search, [item.group]) }))
  .filter(entry => entry.score > 0)
  .sort((a, b) => b.score - a.score || a.index - b.index)
  .map(entry => entry.label)

test('"thanh" + Enter opens Thanh toán, not a screen whose path or group happens to contain those letters', () => {
  assert.equal(rank('thanh')[0], 'Thanh toán')
  assert.deepEqual(rank('thanh'), ['Thanh toán', 'Webhook thanh toán'])
  assert.equal(rank('Thanh toán')[0], 'Thanh toán')
})
test('labels match with or without diacritics, on whole substrings', () => {
  assert.equal(plainText('  Máy  bán hàng '), 'may ban hang')
  assert.equal(plainText('Đơn hàng'), 'don hang')
  assert.equal(rank('may ban')[0], 'Máy bán hàng')
  assert.equal(rank('đơn')[0], 'Đơn hàng')
  assert.equal(rank('ton kho')[0], 'Tồn kho')
  assert.equal(rank('hang')[0], 'Máy bán hàng')
  assert.deepEqual(rank('xyz'), [])
  // Scattered letters no longer match (cmdk's fuzzy match made "thanh" hit "Tồn kho" via "van hanh").
  assert.equal(commandScore('Tồn kho', 'thanh', ['Vận hành']), 0)
})
test('a secondary keyword can find an item but never outranks an item whose label matches', () => {
  assert.ok(commandScore('Máy bán hàng', 'van hanh', ['Vận hành']) > 0)
  assert.ok(commandScore('Máy bán hàng', 'van hanh', ['Vận hành']) < commandScore('Webhook thanh toán', 'toan', ['Giao dịch']))
  assert.equal(commandScore('Thanh toán', '', []), 1)
})
