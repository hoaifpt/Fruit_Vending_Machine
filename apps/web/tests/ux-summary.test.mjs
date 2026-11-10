import test from 'node:test'
import assert from 'node:assert/strict'
import { buildSummary, summaryMarkdown } from '../e2e/summary.ts'
import { KNOWN_VIOLATIONS, knownViolation, withinSelectors } from '../e2e/axe-known.ts'

const finding = (id, impact, targets, known = null) => ({ id, impact, help: `${id} help`, helpUrl: `https://example.test/${id}`, targets, known })

test('UX summary: screenshots ordered by screen, widest first; overflow and axe grouped by screen + rule', () => {
  const summary = buildSummary([
    { kind: 'screenshot', screen: 'orders', theme: 'light', viewport: '390', file: 'screenshots/orders-390-light.png' },
    { kind: 'screenshot', screen: 'orders', theme: 'dark', viewport: '1440', file: 'screenshots/orders-1440-dark.png' },
    { kind: 'screenshot', screen: 'login', theme: 'light', viewport: '1440', file: 'screenshots/login-1440-light.png' },
    { kind: 'overflow', screen: 'orders', theme: 'light', viewport: '390', scrollWidth: 420, clientWidth: 390, ok: false },
    { kind: 'overflow', screen: 'login', theme: 'light', viewport: '1440', scrollWidth: 1440, clientWidth: 1440, ok: true },
    { kind: 'axe', screen: 'orders', theme: 'light', viewport: '1440', findings: [finding('color-contrast', 'serious', ['.a', '.b']), finding('region', 'moderate', ['.c'])] },
    { kind: 'axe', screen: 'orders', theme: 'dark', viewport: '1440', findings: [finding('color-contrast', 'serious', ['.a'])] },
    { kind: 'axe', screen: 'kit', theme: 'light', viewport: '390', findings: [finding('color-contrast', 'serious', ['.d'], 'đang tải lại')] },
    { kind: 'axe', screen: 'login', theme: 'light', viewport: '1440', findings: [] },
  ], '2026-11-10T00:00:00Z')

  assert.deepEqual(summary.screenshots.map(shot => `${shot.screen}-${shot.viewport}-${shot.theme}`), ['login-1440-light', 'orders-1440-dark', 'orders-390-light'])
  assert.equal(summary.axe.checks, 4)
  assert.deepEqual(summary.axe.counts, { critical: 0, serious: 2, moderate: 1, minor: 0 })
  assert.equal(summary.axe.blocking, 1, 'the known kit finding does not block')
  assert.equal(summary.axe.known, 1)
  const contrast = summary.axe.violations.find(row => row.screen === 'orders' && row.id === 'color-contrast')
  assert.deepEqual(contrast.where, ['1440/light', '1440/dark'])
  assert.equal(contrast.nodes, 3)
  assert.deepEqual(contrast.targets, ['.a', '.b'])
  assert.equal(summary.axe.violations.at(-1).impact, 'moderate', 'sorted by impact')

  const markdown = summaryMarkdown(summary)
  assert.match(markdown, /\| Màn \| 1440\/light \| 1440\/dark \| 390\/light \|/)
  assert.match(markdown, /\| orders \| — \| \[ảnh\]\(screenshots\/orders-1440-dark\.png\) \| \[ảnh\]\(screenshots\/orders-390-light\.png\) \|/)
  assert.match(markdown, /orders 390px light\*\*: scrollWidth 420 > clientWidth 390/)
  assert.match(markdown, /critical 0, serious 2, moderate 1, minor 0\. Chặn \(critical\/serious chưa ghi nhận\): \*\*1\*\*/)
  assert.match(markdown, /đã biết: đang tải lại/)
})

test('UX summary: empty run still produces a readable report', () => {
  const markdown = summaryMarkdown(buildSummary([], 'now'))
  assert.match(markdown, /Không có ảnh nào\./)
  assert.match(markdown, /Không có vi phạm\./)
})

test('axe known list: every entry has a reason and only matches its own screen, rule and nodes', () => {
  for (const entry of KNOWN_VIOLATIONS) {
    assert.ok(entry.reason.length > 20, `${entry.screen}/${entry.rule} needs a reason`)
    assert.ok(entry.target || entry.within, `${entry.screen}/${entry.rule} must be narrowed to some nodes`)
  }
  const node = (target, within = {}) => ({ target, within })
  assert.ok(knownViolation('kiosk-catalog', 'label-content-name-mismatch', [node('button[aria-label="Táo, 35.000 ₫"]')]))
  assert.equal(knownViolation('kiosk-catalog', 'label-content-name-mismatch', [node('button[aria-label="Táo"]'), node('.other')]), null, 'one uncovered node keeps it blocking')
  assert.equal(knownViolation('orders', 'label-content-name-mismatch', [node('button[aria-label="x"]')]), null, 'other screens are not covered')
  // The reloading DataTable keeps full contrast now: no contrast finding on the kit is excused any more.
  assert.deepEqual(withinSelectors('kit', 'color-contrast'), [])
  assert.equal(knownViolation('kit', 'color-contrast', [node('.badge', { '[aria-busy="true"]': true })]), null)
})

test('axe known list: a `within` entry covers only nodes inside its container', () => {
  const node = (target, within = {}) => ({ target, within })
  const entry = { screen: 'test-screen', rule: 'color-contrast', within: '[data-sample]', reason: 'mục thử cho bài kiểm tra cơ chế within' }
  KNOWN_VIOLATIONS.push(entry)
  try {
    assert.deepEqual(withinSelectors('test-screen', 'color-contrast'), ['[data-sample]'])
    assert.ok(knownViolation('test-screen', 'color-contrast', [node('.badge', { '[data-sample]': true })]))
    assert.equal(knownViolation('test-screen', 'color-contrast', [node('.badge', { '[data-sample]': false })]), null, 'outside the container still blocks')
  } finally { KNOWN_VIOLATIONS.splice(KNOWN_VIOLATIONS.indexOf(entry), 1) }
})
