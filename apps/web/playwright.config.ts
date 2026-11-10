// UX/UI end-to-end suite (issue FE 2.6): Playwright flows for ADMIN/STAFF on the mock API, screenshots at
// 1440/768/390 in light and dark, kiosk at 1280x800, and axe (WCAG 2.0/2.1 A + AA). No backend needed.
//
// Browser: the Microsoft Edge already installed on the machine (`channel: 'msedge'`), so `playwright install` is not
// needed. Override with PW_CHANNEL (e.g. `PW_CHANNEL=chromium` on CI after `npx playwright install chromium`).
// Port: PW_PORT (default 5199, separate from `npm run dev`); a server already running there is reused.
import { defineConfig, devices } from '@playwright/test'

const port = Number(process.env.PW_PORT ?? 5199)
const baseURL = `http://localhost:${port}`
const channel = process.env.PW_CHANNEL === 'chromium' ? undefined : (process.env.PW_CHANNEL || 'msedge')

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  outputDir: './e2e-report/test-results',
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
  fullyParallel: true,
  workers: process.env.PW_WORKERS ? Number(process.env.PW_WORKERS) : 3,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { outputFolder: './e2e-report/html', open: 'never' }]],
  use: {
    baseURL,
    channel,
    locale: 'vi-VN',
    timezoneId: 'Asia/Ho_Chi_Minh',
    reducedMotion: 'reduce',
    trace: 'off',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'admin', testIgnore: '**/kiosk.spec.ts', use: { ...devices['Desktop Chrome'], channel, viewport: { width: 1440, height: 900 } } },
    { name: 'kiosk', testMatch: '**/kiosk.spec.ts', use: { ...devices['Desktop Chrome'], channel, viewport: { width: 1280, height: 800 }, colorScheme: 'light' } },
  ],
  webServer: {
    command: `npx vite --mode mock --port ${port} --strictPort`,
    url: baseURL,
    reuseExistingServer: true,
    timeout: 120_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
})
