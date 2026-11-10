// Shared helpers for the UX/UI suite: keyboard login on the mock API, theme, screenshots, horizontal-overflow check
// and axe. Each check writes a small JSON record under e2e-report/data; global-teardown.ts turns them into
// e2e-report/ux-summary.md and .json, whatever reporter the run used.
import AxeBuilder from '@axe-core/playwright'
import { expect } from '@playwright/test'
import type { Page, TestInfo } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { knownViolation, withinSelectors } from './axe-known.ts'

export const REPORT_DIR = path.resolve(import.meta.dirname, '..', 'e2e-report')
export const DATA_DIR = path.join(REPORT_DIR, 'data')
export const SHOTS_DIR = path.join(REPORT_DIR, 'screenshots')

/** Mock accounts from src/api/mock/seed.ts (fake values, mock only). */
export const ACCOUNTS = {
  ADMIN: { email: 'admin@freshvend.test', password: 'mock-admin-password' },
  STAFF: { email: 'staff@freshvend.test', password: 'mock-staff-password' },
} as const
export type Role = keyof typeof ACCOUNTS

export type Theme = 'light' | 'dark'
export const THEMES: Theme[] = ['light', 'dark']
export const VIEWPORTS = [
  { name: '1440', width: 1440, height: 900 },
  { name: '768', width: 768, height: 1024 },
  { name: '390', width: 390, height: 844 },
] as const
export type Viewport = { name: string; width: number; height: number }

/** Same storage key as src/lib/theme.ts; index.html applies it before first paint. Set before every page load. */
export async function useThemeChoice(page: Page, theme: Theme) {
  await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' })
  await page.addInitScript(value => { try { localStorage.setItem('fruit-vending-theme', value) } catch { /* storage blocked */ } }, theme)
}

/** Signs in on an already open /login page using the keyboard only: the email field has focus on load. */
export async function typeLogin(page: Page, email: string, password: string) {
  const emailInput = page.getByLabel('Email')
  await expect(emailInput).toBeFocused()
  await page.keyboard.type(email)
  await page.keyboard.press('Tab')
  await expect(page.locator('#login-password')).toBeFocused()
  await page.keyboard.type(password)
  await page.keyboard.press('Enter')
}

/** Opens /login (optionally with a query) and signs in as `role` by keyboard; waits for the admin shell. */
export async function loginAs(page: Page, role: Role, query = '') {
  await page.goto(`/login${query}`)
  await typeLogin(page, ACCOUNTS[role].email, ACCOUNTS[role].password)
  await page.waitForURL(url => url.pathname.startsWith('/admin/'))
  await expect(page.locator('#admin-main')).toBeVisible()
}

function record(kind: string, data: Record<string, unknown>) {
  fs.mkdirSync(DATA_DIR, { recursive: true })
  const file = path.join(DATA_DIR, `${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`)
  fs.writeFileSync(file, JSON.stringify({ kind, ...data }), 'utf8')
}

/** Lets layout and fonts settle (animations are off through reducedMotion). */
export async function settle(page: Page) {
  await page.evaluate(() => document.fonts.ready.then(() => undefined))
  await page.waitForTimeout(150)
}

/** No horizontal scrolling at this width: the page must not be wider than the viewport. */
export async function checkNoHorizontalScroll(page: Page, screen: string, theme: Theme, viewport: Viewport) {
  const size = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }))
  const ok = size.scrollWidth <= size.clientWidth
  record('overflow', { screen, theme, viewport: viewport.name, ...size, ok })
  expect.soft(size.scrollWidth, `${screen} ${viewport.name}px ${theme}: cuộn ngang (scrollWidth ${size.scrollWidth} > clientWidth ${size.clientWidth})`).toBeLessThanOrEqual(size.clientWidth)
}

/** Full-page screenshot saved as e2e-report/screenshots/<screen>-<width>-<theme>.png and attached to the HTML report. */
export async function shoot(page: Page, testInfo: TestInfo, screen: string, theme: Theme, viewport: Viewport) {
  fs.mkdirSync(SHOTS_DIR, { recursive: true })
  const file = path.join(SHOTS_DIR, `${screen}-${viewport.name}-${theme}.png`)
  await page.screenshot({ path: file, fullPage: true })
  await testInfo.attach(`${screen}-${viewport.name}-${theme}`, { path: file, contentType: 'image/png' })
  record('screenshot', { screen, theme, viewport: viewport.name, file: path.relative(REPORT_DIR, file).replaceAll('\\', '/') })
}

export interface AxeFinding { id: string; impact: string; help: string; helpUrl: string; targets: string[]; known: string | null }

/**
 * axe with WCAG 2.0/2.1 A and AA tags. Critical/serious findings fail the test (soft, so the remaining shots still run)
 * unless listed in axe-known.ts with a reason; moderate/minor are only reported.
 */
export async function checkAxe(page: Page, testInfo: TestInfo, screen: string, theme: Theme, viewport: Viewport) {
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
  const findings: AxeFinding[] = []
  for (const violation of result.violations) {
    const targets = violation.nodes.map(node => node.target.map(String).join(' '))
    const selectors = withinSelectors(screen, violation.id)
    const nodes = await Promise.all(violation.nodes.map(async (node, index) => {
      const last = String(node.target[node.target.length - 1] ?? '')
      const within = selectors.length
        ? await page.evaluate(({ selector, ancestors }) => {
          const element = document.querySelector(selector)
          return Object.fromEntries(ancestors.map(ancestor => [ancestor, !!element?.closest(ancestor)]))
        }, { selector: last, ancestors: selectors }).catch(() => ({}))
        : {}
      return { target: targets[index], within }
    }))
    findings.push({ id: violation.id, impact: violation.impact ?? 'minor', help: violation.help, helpUrl: violation.helpUrl, targets, known: knownViolation(screen, violation.id, nodes) })
  }
  record('axe', { screen, theme, viewport: viewport.name, findings })
  if (findings.length) await testInfo.attach(`axe-${screen}-${viewport.name}-${theme}.json`, { body: JSON.stringify(findings, null, 2), contentType: 'application/json' })
  const blocking = findings.filter(finding => (finding.impact === 'critical' || finding.impact === 'serious') && !finding.known)
  expect.soft(blocking.map(finding => `${finding.impact} ${finding.id}: ${finding.help} → ${finding.targets.slice(0, 3).join(' | ')}`),
    `axe ${screen} ${viewport.name}px ${theme}: vi phạm critical/serious`).toEqual([])
}

/** Screenshot, overflow and axe for one screen at every viewport. `ready` waits for the screen content. */
export async function auditScreen(page: Page, testInfo: TestInfo, screen: string, theme: Theme, ready: () => Promise<void>, viewports: readonly Viewport[] = VIEWPORTS) {
  for (const viewport of viewports) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    await ready()
    await settle(page)
    await checkNoHorizontalScroll(page, screen, theme, viewport)
    await shoot(page, testInfo, screen, theme, viewport)
    await checkAxe(page, testInfo, screen, theme, viewport)
  }
}
