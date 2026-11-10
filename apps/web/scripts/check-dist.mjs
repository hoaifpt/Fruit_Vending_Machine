// Run after `vite build` (npm run build): fails when the production bundle contains the mock API layer.
// The mock is only ever loaded through `installMock` (src/main.tsx); the other markers are strings unique to src/api/mock,
// which survive minification even if the function name does not.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

export const MOCK_MARKERS = ['installMock', 'Mock chưa có handler', '[mock] handler failed', 'mock-admin-password', 'mock-kiosk-key']

function* files(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) yield* files(path)
    else if (/\.(js|mjs|html)$/.test(name)) yield path
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

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const dir = process.argv[2] ?? fileURLToPath(new URL('../dist', import.meta.url))
  const found = findMockMarkers(dir)
  if (found.length) {
    console.error('dist chứa mã mock, không được triển khai bản build này:')
    for (const [file, marker] of found) console.error(`  ${file}: ${marker}`)
    process.exit(1)
  }
  console.log('check-dist: dist không chứa mã mock.')
}
