import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { assertNoMockInProduction } from '../vite.config.ts'
import { findDevSecrets, findMockMarkers } from '../scripts/check-dist.mjs'

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

test('check-dist finds a dev-only secret value (Mock Pay webhook) in a bundle; empty or short values are ignored', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fv-dist-'))
  try {
    mkdirSync(join(dir, 'assets'))
    writeFileSync(join(dir, 'assets', 'index.js'), 'const a="dev-only-value-123";export{a}')
    assert.deepEqual(findDevSecrets(dir, { VITE_DEV_MOCK_WEBHOOK_SECRET: 'dev-only-value-123' }), [['assets/index.js', 'VITE_DEV_MOCK_WEBHOOK_SECRET']])
    assert.deepEqual(findDevSecrets(dir, { VITE_DEV_MOCK_WEBHOOK_SECRET: 'another-value-456' }), [])
    assert.deepEqual(findDevSecrets(dir, { VITE_DEV_MOCK_WEBHOOK_SECRET: '' }), [])
    assert.deepEqual(findDevSecrets(dir, { VITE_DEV_MOCK_WEBHOOK_SECRET: undefined }), [])
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('src reads env variables by full name only: never the whole import.meta.env object (it would inline every VITE_* value)', async () => {
  const { readdirSync, readFileSync, statSync } = await import('node:fs')
  const root = new URL('../src/', import.meta.url)
  const offenders = []
  const walk = dir => {
    for (const name of readdirSync(dir)) {
      const path = new URL(name, dir)
      if (statSync(path).isDirectory()) { walk(new URL(`${name}/`, dir)); continue }
      if (!/\.(ts|tsx)$/.test(name) || name.endsWith('.d.ts')) continue
      readFileSync(path, 'utf8').split(/\r?\n/).forEach((line, index) => {
        const code = line.replace(/\/\/.*$/, '')
        if (/import\.meta\.env(?!\.[A-Z_][A-Z0-9_]*\b)|\(import\.meta as[^)]*\)\.env/.test(code)) offenders.push(`${path.pathname.split('/src/')[1]}:${index + 1}`)
      })
    }
  }
  walk(root)
  assert.deepEqual(offenders, [])
})
