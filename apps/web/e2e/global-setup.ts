// Starts each run with an empty summary: old screenshots and records would otherwise leak into the new report.
import fs from 'node:fs'
import path from 'node:path'

const REPORT_DIR = path.resolve(import.meta.dirname, '..', 'e2e-report')

export default function globalSetup() {
  for (const dir of ['data', 'screenshots']) fs.rmSync(path.join(REPORT_DIR, dir), { recursive: true, force: true })
  for (const file of ['ux-summary.md', 'ux-summary.json']) fs.rmSync(path.join(REPORT_DIR, file), { force: true })
}
