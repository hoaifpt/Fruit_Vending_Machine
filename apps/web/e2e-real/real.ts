// Shared helpers for the real-backend suite (playwright.real.config.ts). Accounts and the kiosk key come from
// apps/web/.env.e2e-real, loaded by the config. Records created by tests start with E2E- so they are easy to find.
import { expect, request as pwRequest } from '@playwright/test'
import type { APIRequestContext, Page } from '@playwright/test'

export const API = process.env.REAL_API || 'http://localhost:8080/api/v1'
export const MACHINE_ID = process.env.REAL_MACHINE_ID || ''
export const KIOSK_KEY = process.env.REAL_KIOSK_KEY || ''

export const ACCOUNTS = {
  ADMIN: { email: process.env.REAL_ADMIN_EMAIL || '', password: process.env.REAL_ADMIN_PASSWORD || '' },
  STAFF: { email: process.env.REAL_STAFF_EMAIL || '', password: process.env.REAL_STAFF_PASSWORD || '' },
} as const
export type Role = keyof typeof ACCOUNTS

/** A short unique suffix for names, SKUs, batch codes (uppercase, so it survives server normalisation). */
export const uniq = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`.toUpperCase()

/** Signs in through the real login form and waits for the admin shell. */
export async function loginAs(page: Page, role: Role) {
  await page.goto('/login')
  await page.getByLabel('Email').fill(ACCOUNTS[role].email)
  await page.locator('#login-password').fill(ACCOUNTS[role].password)
  await page.keyboard.press('Enter')
  await page.waitForURL(url => url.pathname.startsWith('/admin/'))
  await expect(page.locator('#admin-main')).toBeVisible()
}

/** Bearer token of `role` from the real POST /auth/login. */
export async function tokenFor(role: Role): Promise<string> {
  const ctx = await pwRequest.newContext()
  const response = await ctx.post(`${API}/auth/login`, { data: ACCOUNTS[role] })
  expect(response.status(), `login ${role}`).toBe(200)
  const token = (await response.json()).data.accessToken as string
  await ctx.dispose()
  return token
}

/** An API client authenticated as `role` (or with the kiosk key, or anonymous). */
export async function apiAs(who: Role | 'KIOSK' | 'PUBLIC'): Promise<APIRequestContext> {
  const headers: Record<string, string> = {}
  if (who === 'KIOSK') headers['X-Kiosk-Key'] = KIOSK_KEY
  else if (who !== 'PUBLIC') headers.Authorization = `Bearer ${await tokenFor(who)}`
  return pwRequest.newContext({ extraHTTPHeaders: headers })
}

/** Reads `data` of a 2xx envelope, failing with the body when the status differs. */
export async function dataOf<T = any>(response: import('@playwright/test').APIResponse, status = 200): Promise<T> {
  const text = await response.text()
  expect(response.status(), text.slice(0, 500)).toBe(status)
  return (text ? JSON.parse(text).data : undefined) as T
}

/** The error envelope of a non-2xx answer: { status, message, fieldErrors }. */
export async function errorOf(response: import('@playwright/test').APIResponse, status: number) {
  const text = await response.text()
  expect(response.status(), text.slice(0, 500)).toBe(status)
  return text ? JSON.parse(text) as { status: number; message?: string; fieldErrors?: Record<string, string> } : { status }
}
