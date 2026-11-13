// Run after `vite build` (npm run build): fails when the production bundle contains the mock API layer, or when the
// legacy per-page CSS removed in FE 9.4 (admin.css, LandingPage.css, PurchasePage.css) comes back.
// The mock is only ever loaded through `installMock` (src/main.tsx); the other markers are strings unique to src/api/mock,
// which survive minification even if the function name does not.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

export const MOCK_MARKERS = ['installMock', 'Mock chưa có handler', '[mock] handler failed', 'mock-admin-password', 'mock-kiosk-key']

/**
 * Legacy CSS markers: an `a-*` class selector (also when escaped inside a utility such as `in-[.a-panel]`), the old
 * message page and the old admin control look. Today's CSS is src/styles/app.css (Tailwind + tokens), src/index.css and
 * the Inter font CSS of the admin chunk.
 */
export const LEGACY_CSS_MARKERS = [
  ['a-* class', /(^|[^\w-])\.a-[a-z]/m],
  ['.route-message', /\.route-message\b/],
  ['.admin-app control styles', /\.admin-app (button|input|select|textarea)/],
]
/** Per-page stylesheets that must not come back as their own CSS chunk. */
export const LEGACY_CSS_FILE = /^(admin|App|LandingPage|PurchasePage)(-[\w-]+)?\.css$/

function* files(dir, pattern = /\.(js|mjs|html)$/) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) yield* files(path, pattern)
    else if (pattern.test(name)) yield path
  }
}

/** `[file, marker]` pairs found under `dir`. */
export function findMockMarkers(dir) {
  const found = []
  for (const path of files(dir)) {
    const text = readFileSync(path, 'utf8')
    for (const marker of MOCK_MARKERS) if (text.includes(marker)) found.push([relative(dir, path).split(sep).join('/'), marker])
  }
  return found
}

/** `[file, marker]` pairs of legacy CSS under `dir`: a legacy file name, or a legacy rule inside any CSS file. */
export function findLegacyCss(dir) {
  const found = []
  for (const path of files(dir, /\.css$/)) {
    const file = relative(dir, path).split(sep).join('/')
    if (LEGACY_CSS_FILE.test(file.slice(file.lastIndexOf('/') + 1))) found.push([file, 'legacy CSS file'])
    const text = readFileSync(path, 'utf8')
    for (const [label, pattern] of LEGACY_CSS_MARKERS) if (pattern.test(text)) found.push([file, label])
  }
  return found
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const dir = process.argv[2] ?? fileURLToPath(new URL('../dist', import.meta.url))
  const found = findMockMarkers(dir)
  if (found.length) {
    console.error('dist chứa mã mock, không được triển khai bản build này:')
    for (const [file, marker] of found) console.error(`  ${file}: ${marker}`)
    process.exit(1)
  }
  const legacy = findLegacyCss(dir)
  if (legacy.length) {
    console.error('dist chứa CSS cũ đã gỡ ở FE 9.4; dùng Tailwind và token trong src/styles/app.css, src/index.css:')
    for (const [file, marker] of legacy) console.error(`  ${file}: ${marker}`)
    process.exit(1)
  }
  console.log('check-dist: dist không chứa mã mock và không còn CSS cũ.')
}
