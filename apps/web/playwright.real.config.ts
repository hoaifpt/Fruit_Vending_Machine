// Functional test suite against the REAL backend (not the mock): FE at REAL_BASE_URL (vite without --mode mock, which
// proxies /api to the backend) and the backend API at REAL_API. Credentials and the kiosk key come from the untracked
// file apps/web/.env.e2e-real (ignored by .gitignore), never from the repository.
//
//   npx playwright test -c playwright.real.config.ts [e2e-real/<area>.spec.ts]
//
// Tests write real rows into the local development database; every created record is named with the E2E- prefix.
// No webServer: start the backend and `npx vite --port 5800` first.
import { defineConfig, devices } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'

const envFile = path.resolve(import.meta.dirname, '.env.e2e-real')
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z_]+)=(.*)$/)
    if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2]
  }
}
const channel = process.env.PW_CHANNEL === 'chromium' ? undefined : (process.env.PW_CHANNEL || 'msedge')

export default defineConfig({
  testDir: './e2e-real',
  testMatch: '**/*.spec.ts',
  outputDir: process.env.PW_OUTPUT || './e2e-report/real-results',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  use: {
    baseURL: process.env.REAL_BASE_URL || 'http://localhost:5800',
    channel,
    locale: 'vi-VN',
    timezoneId: 'Asia/Ho_Chi_Minh',
    trace: 'off',
    screenshot: 'only-on-failure',
    ...devices['Desktop Chrome'],
    viewport: { width: 1440, height: 900 },
  },
})
