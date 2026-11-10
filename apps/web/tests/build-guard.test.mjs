import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { assertNoMockInProduction } from '../vite.config.ts'
import { findMockMarkers } from '../scripts/check-dist.mjs'

test('a production build refuses VITE_API_MOCK; dev, mock mode and an empty value are allowed', () => {
  assert.throws(() => assertNoMockInProduction('build', 'production', 'all'), /VITE_API_MOCK/)
  assert.throws(() => assertNoMockInProduction('build', 'production', 'orders,payments'), /production/)
  assert.doesNotThrow(() => assertNoMockInProduction('build', 'production', ''))
  assert.doesNotThrow(() => assertNoMockInProduction('build', 'production', '  '))
  assert.doesNotThrow(() => assertNoMockInProduction('build', 'production', undefined))
  assert.doesNotThrow(() => assertNoMockInProduction('serve', 'development', 'all'))
  assert.doesNotThrow(() => assertNoMockInProduction('build', 'mock', 'all'))
})

test('check-dist finds mock code in a bundle and passes a clean one', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fv-dist-'))
  try {
    mkdirSync(join(dir, 'assets'))
    writeFileSync(join(dir, 'index.html'), '<script type="module" src="/assets/index.js"></script>')
    writeFileSync(join(dir, 'assets', 'index.js'), 'const a=1;export{a}')
    assert.deepEqual(findMockMarkers(dir), [])
    writeFileSync(join(dir, 'assets', 'mock.js'), 'function installMock(){throw new Error("Mock chưa có handler cho GET")}')
    assert.deepEqual(findMockMarkers(dir), [['assets/mock.js', 'installMock'], ['assets/mock.js', 'Mock chưa có handler']])
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
