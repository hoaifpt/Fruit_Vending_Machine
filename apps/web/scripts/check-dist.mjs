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

/**
 * Dev-only secrets that must never reach a production bundle (the kiosk's Mock Pay webhook secret, read only when
 * `import.meta.env.DEV`). `[file, variable]` pairs where the value of one of `values` appears under `dir`; values
 * shorter than 6 characters are ignored (they would match by chance).
 */
export const DEV_SECRET_VARIABLES = ['VITE_DEV_MOCK_WEBHOOK_SECRET']
export function findDevSecrets(dir, values) {
  const found = []
  const secrets = Object.entries(values).filter(([, value]) => typeof value === 'string' && value.trim().length >= 6)
  if (!secrets.length) return found
  for (const path of files(dir, /\.(js|mjs|html|css|map|json)$/)) {
    const text = readFileSync(path, 'utf8')
    for (const [name, value] of secrets) if (text.includes(value.trim())) found.push([relative(dir, path).split(sep).join('/'), name])
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
  // The values Vite would have seen at build time: .env files of the production mode, then the process environment.
  const { loadEnv } = await import('vite')
  const env = { ...loadEnv('production', fileURLToPath(new URL('..', import.meta.url)), 'VITE_DEV_'), ...process.env }
  const secrets = findDevSecrets(dir, Object.fromEntries(DEV_SECRET_VARIABLES.map(name => [name, env[name]])))
  if (secrets.length) {
    console.error('dist chứa giá trị bí mật chỉ dành cho dev, không được triển khai bản build này:')
    for (const [file, name] of secrets) console.error(`  ${file}: ${name}`)
    process.exit(1)
  }
  console.log('check-dist: dist không chứa mã mock, không còn CSS cũ, không chứa bí mật dev.')
}
