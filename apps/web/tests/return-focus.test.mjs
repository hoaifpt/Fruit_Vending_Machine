import test from 'node:test'
import assert from 'node:assert/strict'
import { captureFocus, focusByKey, focusLost, restoreFocus } from '../src/admin/return-focus.ts'

/** Tiny fake DOM: elements with attributes, connection state and a focus log. */
function setup() {
  const log = []
  const element = (name, attributes = {}, extra = {}) => ({ name, isConnected: true, disabled: false, ...extra, getAttribute: key => attributes[key] ?? null, focus() { log.push(name) } })
  const body = element('body'), main = element('main')
  const all = []
  const doc = { activeElement: body, body, querySelectorAll: () => all, getElementById: id => (id === 'admin-main' ? main : null) }
  return { log, element, doc, all, main }
}

test('focus goes back to the opener while it is still on the page', () => {
  const { log, element, doc } = setup()
  const opener = element('create', { 'data-focus-key': 'users-create' })
  doc.activeElement = opener
  const origin = captureFocus(doc)
  assert.deepEqual([origin.element, origin.key], [opener, 'users-create'])
  assert.equal(restoreFocus(origin, doc), 'origin')
  assert.deepEqual(log, ['create'])
})

test('opener re-rendered away: the element with the same data-focus-key takes focus', () => {
  const { log, element, doc, all } = setup()
  const opener = element('old-edit', { 'data-focus-key': 'user-edit-1' })
  doc.activeElement = opener
  const origin = captureFocus(doc)
  opener.isConnected = false
  all.push(element('other', { 'data-focus-key': 'user-edit-2' }), element('disabled', { 'data-focus-key': 'user-edit-1' }, { disabled: true }), element('new-edit', { 'data-focus-key': 'user-edit-1' }))
  assert.equal(restoreFocus(origin, doc), 'key')
  assert.deepEqual(log, ['new-edit'])
})

test('nothing to return to: the page region gets focus instead of <body>', () => {
  const { log, element, doc } = setup()
  assert.deepEqual(captureFocus(doc), { element: null, key: null }, 'body is not an opener')
  const gone = element('gone', {}, { isConnected: false })
  assert.equal(restoreFocus({ element: gone, key: null }, doc), 'main')
  assert.deepEqual(log, ['main'])
})

test('focusByKey: a jump to another tab lands on its main button when it is there, else reports false', () => {
  const { log, element, doc, all } = setup()
  assert.equal(focusByKey(doc, 'slot-create'), false)
  const disabled = element('disabled-create', { 'data-focus-key': 'slot-create' }, { disabled: true })
  all.push(disabled)
  assert.equal(focusByKey(doc, 'slot-create'), false, 'a disabled control is skipped')
  all.push(element('create', { 'data-focus-key': 'slot-create' }))
  assert.equal(focusByKey(doc, 'slot-create'), true)
  assert.deepEqual(log, ['create'])
})

test('focusLost: body, nothing or a removed element count as lost focus', () => {
  const { element, doc } = setup()
  assert.equal(focusLost(doc), true, 'body')
  doc.activeElement = null
  assert.equal(focusLost(doc), true, 'nothing')
  const button = element('status')
  doc.activeElement = button
  assert.equal(focusLost(doc), false)
  button.isConnected = false
  assert.equal(focusLost(doc), true, 'removed after a reload')
})
