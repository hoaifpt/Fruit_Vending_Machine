// Builds the UX summary (screens x viewport x theme, overflow, axe by impact) from the records the specs write.
// Pure functions so tests/ux-summary.test.mjs can check them without a browser.

export interface AxeFindingRecord { id: string; impact: string; help: string; helpUrl: string; targets: string[]; known: string | null }
export type UxRecord =
  | { kind: 'screenshot'; screen: string; theme: string; viewport: string; file: string }
  | { kind: 'overflow'; screen: string; theme: string; viewport: string; scrollWidth: number; clientWidth: number; ok: boolean }
  | { kind: 'axe'; screen: string; theme: string; viewport: string; findings: AxeFindingRecord[] }

export const IMPACTS = ['critical', 'serious', 'moderate', 'minor'] as const

export interface AxeRow { impact: string; id: string; help: string; helpUrl: string; screen: string; known: string | null; where: string[]; nodes: number; targets: string[] }
export interface UxSummary {
  generatedAt: string
  screenshots: { screen: string; viewport: string; theme: string; file: string }[]
  overflow: { screen: string; viewport: string; theme: string; scrollWidth: number; clientWidth: number; ok: boolean }[]
  axe: { checks: number; counts: Record<string, number>; blocking: number; known: number; violations: AxeRow[] }
}

const viewportOrder = (value: string) => -Number.parseInt(value, 10) || 0
const byScreen = <T extends { screen: string; viewport: string; theme: string }>(a: T, b: T) =>
  a.screen.localeCompare(b.screen) || viewportOrder(a.viewport) - viewportOrder(b.viewport) || a.theme.localeCompare(b.theme)

/** One row per screen + rule: where it was seen (viewport/theme), how many nodes and a few selectors. */
export function buildSummary(records: UxRecord[], generatedAt = new Date().toISOString()): UxSummary {
  const screenshots = records.filter(record => record.kind === 'screenshot').map(({ screen, viewport, theme, file }) => ({ screen, viewport, theme, file })).sort(byScreen)
  const overflow = records.filter(record => record.kind === 'overflow').map(({ screen, viewport, theme, scrollWidth, clientWidth, ok }) => ({ screen, viewport, theme, scrollWidth, clientWidth, ok })).sort(byScreen)
  const axeRecords = records.filter(record => record.kind === 'axe')
  const rows = new Map<string, AxeRow>()
  for (const record of axeRecords) {
    for (const finding of record.findings) {
      const key = `${record.screen}|${finding.id}`
      const row = rows.get(key) ?? { impact: finding.impact, id: finding.id, help: finding.help, helpUrl: finding.helpUrl, screen: record.screen, known: finding.known, where: [], nodes: 0, targets: [] }
      row.where.push(`${record.viewport}/${record.theme}`)
      row.nodes += finding.targets.length
      for (const target of finding.targets) if (!row.targets.includes(target) && row.targets.length < 5) row.targets.push(target)
      if (!finding.known) row.known = null
      rows.set(key, row)
    }
  }
  const violations = [...rows.values()].sort((a, b) => IMPACTS.indexOf(a.impact as never) - IMPACTS.indexOf(b.impact as never) || a.screen.localeCompare(b.screen) || a.id.localeCompare(b.id))
  const counts: Record<string, number> = Object.fromEntries(IMPACTS.map(impact => [impact, violations.filter(row => row.impact === impact).length]))
  const isBlocking = (row: AxeRow) => (row.impact === 'critical' || row.impact === 'serious') && !row.known
  return {
    generatedAt, screenshots, overflow,
    axe: { checks: axeRecords.length, counts, blocking: violations.filter(isBlocking).length, known: violations.filter(row => row.known).length, violations },
  }
}

const cell = (text: string) => text.replaceAll('|', '\\|').replaceAll('\n', ' ')

export function summaryMarkdown(summary: UxSummary): string {
  const lines = [`# Báo cáo UX/UI tự động`, '', `Tạo lúc: ${summary.generatedAt}. Báo cáo HTML: \`e2e-report/html/index.html\`. Ảnh: \`e2e-report/screenshots/\`.`, '']
  const screens = [...new Set(summary.screenshots.map(shot => shot.screen))]
  const columns = [...new Set(summary.screenshots.map(shot => `${shot.viewport}/${shot.theme}`))]
  lines.push(`## Ảnh chụp (${summary.screenshots.length})`, '')
  if (screens.length) {
    lines.push(`| Màn | ${columns.join(' | ')} |`, `| --- | ${columns.map(() => '---').join(' | ')} |`)
    for (const screen of screens) {
      lines.push(`| ${screen} | ${columns.map(column => {
        const shot = summary.screenshots.find(item => item.screen === screen && `${item.viewport}/${item.theme}` === column)
        return shot ? `[ảnh](${shot.file})` : '—'
      }).join(' | ')} |`)
    }
  } else lines.push('Không có ảnh nào.')
  const overflowing = summary.overflow.filter(item => !item.ok)
  lines.push('', `## Cuộn ngang`, '', overflowing.length
    ? overflowing.map(item => `- **${item.screen} ${item.viewport}px ${item.theme}**: scrollWidth ${item.scrollWidth} > clientWidth ${item.clientWidth}`).join('\n')
    : `Không màn nào cuộn ngang (${summary.overflow.length} lần kiểm).`)
  const { counts } = summary.axe
  lines.push('', `## axe (WCAG 2.0/2.1 A, AA)`, '', `${summary.axe.checks} lần quét. Quy tắc vi phạm theo mức: critical ${counts.critical}, serious ${counts.serious}, moderate ${counts.moderate}, minor ${counts.minor}. Chặn (critical/serious chưa ghi nhận): **${summary.axe.blocking}**; đã biết: ${summary.axe.known}.`, '')
  if (summary.axe.violations.length) {
    lines.push('| Mức | Màn | Quy tắc | Mô tả | Gặp ở | Số nút | Ví dụ selector | Ghi chú |', '| --- | --- | --- | --- | --- | --- | --- | --- |')
    for (const row of summary.axe.violations) {
      lines.push(`| ${row.impact} | ${row.screen} | [${row.id}](${row.helpUrl}) | ${cell(row.help)} | ${row.where.join(', ')} | ${row.nodes} | ${cell(row.targets.slice(0, 3).map(target => `\`${target}\``).join(', '))} | ${row.known ? `đã biết: ${cell(row.known)}` : ''} |`)
    }
  } else lines.push('Không có vi phạm.')
  return lines.join('\n') + '\n'
}
