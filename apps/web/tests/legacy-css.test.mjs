// FE 9.4: the legacy per-page CSS (admin.css, App.css, LandingPage.css, PurchasePage.css) and its `a-*` classes are gone;
// styles live in Tailwind utilities plus the tokens of src/styles/app.css and src/index.css.
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { findLegacyCss } from '../scripts/check-dist.mjs'

const SRC = fileURLToPath(new URL('../src', import.meta.url))

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) yield* walk(path)
    else yield relative(SRC, path).split(sep).join('/')
  }
}
const sources = [...walk(SRC)]

/** An `a-*` class: in a className/class string, a CSS selector or an arbitrary variant such as `in-[.a-panel]`. */
const A_CLASS = /(^|[\s"'`{[.])a-[a-z][\w-]*/
const stripComments = text => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

test('src has only the two global stylesheets: Tailwind + tokens (styles/app.css) and index.css', () => {
  assert.deepEqual(sources.filter(file => file.endsWith('.css')).sort(), ['index.css', 'styles/app.css'])
})

test('no a-* class is left in src (.tsx, .ts, .css)', () => {
  const hits = []
  for (const file of sources.filter(name => /\.(tsx?|css)$/.test(name) && !name.endsWith('.d.ts'))) {
    stripComments(readFileSync(join(SRC, file), 'utf8')).split('\n').forEach((line, index) => {
      // aria-*, data-* and similar attribute names are not classes.
      const cleaned = line.replace(/\b(aria|data)-[\w-]+/g, '')
      if (A_CLASS.test(cleaned)) hits.push(`${file}:${index + 1}: ${line.trim().slice(0, 120)}`)
    })
  }
  assert.deepEqual(hits, [])
})

test('no source imports a per-page stylesheet', () => {
  const imports = []
  for (const file of sources.filter(name => /\.tsx?$/.test(name))) {
    for (const match of readFileSync(join(SRC, file), 'utf8').matchAll(/import\s+'([^']+\.css)'/g)) imports.push(`${file} → ${match[1]}`)
  }
  assert.deepEqual(imports.sort(), ['admin/AdminApp.tsx → @fontsource-variable/inter/wght.css', 'main.tsx → ./index.css', 'main.tsx → ./styles/app.css'])
})

test('check-dist flags legacy CSS chunks and rules, and passes the current bundle shape', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fv-css-'))
  try {
    mkdirSync(join(dir, 'assets'))
    writeFileSync(join(dir, 'assets', 'index-abc123.css'), '.sr-only{position:absolute}.buy-app{color:red}.in-\\[\\.ui-root\\]\\:p-2{padding:8px}')
    writeFileSync(join(dir, 'assets', 'AdminApp-def456.css'), "@font-face{font-family:'Inter Variable'}")
    assert.deepEqual(findLegacyCss(dir), [])
    writeFileSync(join(dir, 'assets', 'PurchasePage-x1.css'), '.buy-app{color:red}')
    writeFileSync(join(dir, 'assets', 'index-abc123.css'), '.a-panel{padding:20px}.route-message{margin:auto}.admin-app button:not([data-slot]){border:0}')
    writeFileSync(join(dir, 'assets', 'AdminApp-def456.css'), '.in-\\[\\.a-panel\\]\\:border-0 .x{border:0}')
    assert.deepEqual(findLegacyCss(dir).sort(), [
      ['assets/AdminApp-def456.css', 'a-* class'],
      ['assets/PurchasePage-x1.css', 'legacy CSS file'],
      ['assets/index-abc123.css', '.admin-app control styles'],
      ['assets/index-abc123.css', '.route-message'],
      ['assets/index-abc123.css', 'a-* class'],
    ].sort())
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
