import test from 'node:test'
import assert from 'node:assert/strict'
import { globSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { STATUS_CATALOG, statusMeta } from '../src/lib/status.ts'

const root = fileURLToPath(new URL('../../../', import.meta.url))
const enumsRoot = 'backend/src/main/java/com/fruitmachine/backend/'
const read = path => readFileSync(root + path, 'utf8')

/** Constant names of a Java enum, in declaration order. */
function javaEnum(path, name) {
  const body = read(path).match(new RegExp(`enum\\s+${name}\\s*\\{([^}]*)\\}`))
  assert.ok(body, `không tìm thấy enum ${name} trong ${path}`)
  return body[1].split(';')[0].replace(/\/\/.*$|\/\*[\s\S]*?\*\//gm, '').split(',').map(item => item.trim()).filter(Boolean)
}

const JAVA_SOURCES = {
  machine: ['machine/enums/MachineStatus.java', 'MachineStatus'],
  box: ['inventory/enums/InventoryStatus.java', 'InventoryStatus'],
  order: ['order/enums/OrderStatus.java', 'OrderStatus'],
  payment: ['payment/enums/PaymentStatus.java', 'PaymentStatus'],
  dispense: ['dispense/enums/DispenseStatus.java', 'DispenseStatus'],
  alert: ['alert/enums/AlertStatus.java', 'AlertStatus'],
  alertSeverity: ['alert/enums/AlertSeverity.java', 'AlertSeverity'],
  slot: ['machine/enums/SlotStatus.java', 'SlotStatus'],
  product: ['product/enums/ProductStatus.java', 'ProductStatus'],
  user: ['user/enums/UserStatus.java', 'UserStatus'],
  kioskCredential: ['machine/kiosk/enums/KioskCredentialStatus.java', 'KioskCredentialStatus'],
  allocation: ['order/enums/AllocationStatus.java', 'AllocationStatus'],
  inventoryTransactionType: ['inventory/enums/InventoryTransactionType.java', 'InventoryTransactionType'],
}
const keys = domain => Object.keys(STATUS_CATALOG[domain])

for (const [domain, [path, name]] of Object.entries(JAVA_SOURCES)) {
  test(`${domain} badges match backend enum ${name} exactly`, () => {
    assert.deepEqual([...keys(domain)].sort(), javaEnum(enumsRoot + path, name).sort())
  })
}

test('connection badges match the MQTT status topic states', () => {
  const states = read('docs/mqtt-dispense.md').match(/"state":"([A-Z_\\|]+)"/)
  assert.ok(states, 'docs/mqtt-dispense.md không còn mô tả state của topic status')
  assert.deepEqual([...keys('connection')].sort(), states[1].split('\\|').sort())
})

test('ticket badges match WorkOrderStatus, or the SRS vocabulary until that enum exists', () => {
  const found = globSync('**/WorkOrderStatus.java', { cwd: root + enumsRoot })
  const expected = found.length
    ? javaEnum(enumsRoot + found[0].replaceAll('\\', '/'), 'WorkOrderStatus')
    : ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']
  assert.deepEqual([...keys('ticket')].sort(), [...expected].sort())
})

test('the catalog covers exactly the agreed domains', () => {
  assert.deepEqual(Object.keys(STATUS_CATALOG).sort(), [...Object.keys(JAVA_SOURCES), 'connection', 'ticket'].sort())
})

test('every status has a Vietnamese label, a mapped icon and a full explanation', () => {
  const component = read('apps/web/src/components/ui/status-badge.tsx')
  const iconMap = component.match(/const ICONS[^{]*\{([\s\S]*?)\n\}/)[1]
  for (const [domain, values] of Object.entries(STATUS_CATALOG)) {
    const labels = Object.values(values).map(meta => meta.label)
    assert.equal(new Set(labels).size, labels.length, `${domain}: hai trạng thái trùng nhãn`)
    for (const [value, meta] of Object.entries(values)) {
      assert.notEqual(meta.label, value, `${domain}.${value}: nhãn chưa dịch`)
      assert.match(iconMap, new RegExp(`\\b${meta.icon}:`), `${domain}.${value}: icon ${meta.icon} chưa được ánh xạ`)
      assert.match(meta.description, /^\p{Lu}.*\.$/u, `${domain}.${value}: câu giải thích phải là câu hoàn chỉnh`)
    }
  }
})

test('the same value is read in its own domain', () => {
  assert.equal(statusMeta('dispense', 'ACKNOWLEDGED').label, 'Máy đã nhận')
  assert.equal(statusMeta('alert', 'ACKNOWLEDGED').label, 'Đã tiếp nhận')
  assert.notEqual(statusMeta('box', 'DISPENSE_FAILED').description, statusMeta('order', 'DISPENSE_FAILED').description)
})

test('values the portal does not know are shown raw, in a neutral tone', () => {
  for (const value of ['NEW_STATE', 'constructor', '__proto__']) {
    const meta = statusMeta('order', value)
    assert.equal(meta.label, value)
    assert.equal(meta.tone, 'neutral')
    assert.equal(meta.icon, 'help')
  }
})

/** WCAG contrast of two `oklch(L C H)` colours, via OKLab and linear sRGB. */
function luminance(color) {
  const [l, c, h] = color.match(/oklch\(([^)]+)\)/)[1].trim().split(/\s+/).map(Number)
  const a = c * Math.cos(h * Math.PI / 180), b = c * Math.sin(h * Math.PI / 180)
  const cube = value => value ** 3
  const L = cube(l + 0.3963377774 * a + 0.2158037573 * b)
  const M = cube(l - 0.1055613458 * a - 0.0638541728 * b)
  const S = cube(l - 0.0894841775 * a - 1.291485548 * b)
  const clamp = value => Math.min(1, Math.max(0, value))
  return 0.2126 * clamp(4.0767416621 * L - 3.3077115913 * M + 0.2309699292 * S)
    + 0.7152 * clamp(-1.2684380046 * L + 2.6097574011 * M - 0.3413193965 * S)
    + 0.0722 * clamp(-0.0041960863 * L - 0.7034186147 * M + 1.707614701 * S)
}
const contrast = (x, y) => {
  const [hi, lo] = [luminance(x), luminance(y)].sort((p, q) => q - p)
  return (hi + 0.05) / (lo + 0.05)
}

test('every tone keeps at least 4.5:1 contrast in light and dark themes', () => {
  const css = read('apps/web/src/styles/app.css')
  const blocks = { light: css.match(/:root\s*\{([\s\S]*?)\n\}/)[1], dark: css.match(/\.dark\s*\{([\s\S]*?)\n\}/)[1] }
  const token = (block, name) => {
    const found = block.match(new RegExp(`--ui-status-${name}:\\s*(oklch\\([^)]+\\))`))
    assert.ok(found, `thiếu token --ui-status-${name}`)
    return found[1]
  }
  const tones = new Set(Object.values(STATUS_CATALOG).flatMap(values => Object.values(values).map(meta => meta.tone)))
  tones.add('neutral')
  for (const [theme, block] of Object.entries(blocks)) {
    for (const tone of tones) {
      const ratio = contrast(token(block, tone), token(block, `${tone}-foreground`))
      assert.ok(ratio >= 4.5, `${theme}/${tone}: tương phản ${ratio.toFixed(2)}:1`)
    }
  }
})
