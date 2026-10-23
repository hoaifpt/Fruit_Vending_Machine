import test from 'node:test'
import assert from 'node:assert/strict'
import { activeOrderId, clearActiveOrder, rememberActiveOrder } from '../src/kiosk/active-order.ts'

test('reload recovery stores only an order pointer, never payment state or a motor command', () => {
  const values = new Map()
  globalThis.sessionStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) }
  rememberActiveOrder('server-order-id')
  assert.equal(activeOrderId(), 'server-order-id')
  assert.deepEqual([...values.values()], ['server-order-id'])
  clearActiveOrder()
  assert.equal(activeOrderId(), null)
  delete globalThis.sessionStorage
})
