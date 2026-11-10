// Writes e2e-report/ux-summary.md and .json from the records left by the specs (runs with any reporter).
import fs from 'node:fs'
import path from 'node:path'
import { buildSummary, summaryMarkdown } from './summary.ts'
import type { UxRecord } from './summary.ts'

const REPORT_DIR = path.resolve(import.meta.dirname, '..', 'e2e-report')

export default function globalTeardown() {
  const dataDir = path.join(REPORT_DIR, 'data')
  const records: UxRecord[] = fs.existsSync(dataDir)
    ? fs.readdirSync(dataDir).filter(name => name.endsWith('.json')).map(name => JSON.parse(fs.readFileSync(path.join(dataDir, name), 'utf8')) as UxRecord)
    : []
  const summary = buildSummary(records)
  fs.mkdirSync(REPORT_DIR, { recursive: true })
  fs.writeFileSync(path.join(REPORT_DIR, 'ux-summary.json'), JSON.stringify(summary, null, 2), 'utf8')
  fs.writeFileSync(path.join(REPORT_DIR, 'ux-summary.md'), summaryMarkdown(summary), 'utf8')
  const { counts } = summary.axe
  console.log(`\nUX summary: ${summary.screenshots.length} ảnh, axe critical ${counts.critical} / serious ${counts.serious} / moderate ${counts.moderate} / minor ${counts.minor} (chặn ${summary.axe.blocking}) → ${path.join(REPORT_DIR, 'ux-summary.md')}`)
}
