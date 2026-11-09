// Generates src/api/drafts/<name>.d.ts for every api-contract/drafts/<name>.yaml (same tool version as gen:api).
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const draftsDir = resolve(webRoot, '../../api-contract/drafts')
const outDir = join(webRoot, 'src/api/drafts')

const drafts = existsSync(draftsDir) ? readdirSync(draftsDir).filter(name => name.endsWith('.yaml')) : []
if (!drafts.length) {
  console.log('No draft contracts found.')
  process.exit(0)
}
mkdirSync(outDir, { recursive: true })

for (const name of drafts) {
  const output = join(outDir, name.replace(/\.yaml$/, '.d.ts'))
  // shell: npx is a .cmd on Windows, which Node only starts through a shell.
  const result = spawnSync('npx', ['--yes', 'openapi-typescript@7.13.0', `"${join(draftsDir, name)}"`, '-o', `"${output}"`], { cwd: webRoot, stdio: 'inherit', shell: true })
  if (result.status !== 0) process.exit(result.status ?? 1)
}
