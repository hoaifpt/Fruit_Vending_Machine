import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolvePage } from '../src/routing.ts'
import { getContactLinks } from '../src/features/landing/contact.ts'

test('keeps public home and login distinct, including direct trailing-slash URLs', () => {
  assert.equal(resolvePage('/'), 'home')
  assert.equal(resolvePage('/login'), 'login')
  assert.equal(resolvePage('/login/'), 'login')
  assert.equal(resolvePage('/does-not-exist'), 'not-found')
  assert.equal(resolvePage('/login/extra'), 'not-found')
})
test('does not invent contact channels if configuration is missing', () => {
  assert.deepEqual(getContactLinks(), { email: null, phone: null })
})
test('builds email draft and telephone links for confirmed contact information', () => {
  const result = getContactLinks(' partner@example.test ', '+84 (123) 456-789')
  assert.equal(result.email.label, 'partner@example.test')
  assert.match(result.email.href, /^mailto:partner@example\.test\?subject=/)
  assert.equal(result.phone.href, 'tel:+84123456789')
})
test('rejects malformed channels and mail-header/query injection', () => {
  for (const value of ['javascript:alert(1)', 'a@b.test?bcc=other@b.test', 'a@b.test%0A', 'a@b.test\nBcc: other@b.test']) assert.equal(getContactLinks(value).email, null)
  for (const value of ['javascript:alert(1)', '123', '++84123456789', '+84123456789;extra']) assert.equal(getContactLinks(undefined, value).phone, null)
})
test('links the landing page to the purchase screen /buy from the hero, both menus and the footer', () => {
  assert.equal(resolvePage('/buy'), 'purchase')
  assert.equal(resolvePage('/buy/'), 'purchase')
  const source = readFileSync(new URL('../src/pages/LandingPage.tsx', import.meta.url), 'utf8')
  assert.match(source, /const PURCHASE_HREF = '\/buy'/)
  assert.match(source, /const navigation = \[\.\.\.sections, \[PURCHASE_HREF, PURCHASE_LABEL\]\]/)
  // Desktop and mobile navigation both render `navigation`; the hero and the footer link PURCHASE_HREF directly.
  assert.equal(source.match(/navigation\.map\(/g)?.length, 2)
  assert.match(source, /href=\{PURCHASE_HREF\}>\{PURCHASE_LABEL\}/)
  assert.match(source, /\[PURCHASE_HREF, PURCHASE_LABEL\], \['\/login'/)
})
