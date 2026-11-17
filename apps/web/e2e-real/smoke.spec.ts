import { test, expect } from '@playwright/test'
import { apiAs, dataOf, loginAs } from './real.ts'

test('smoke: admin and staff sign in on the real backend; kiosk key works', async ({ page }) => {
  await loginAs(page, 'ADMIN')
  const kiosk = await apiAs('KIOSK')
  const me = await dataOf(await kiosk.get(`${process.env.REAL_API}/kiosk/me`))
  expect(me.machineId).toBe(process.env.REAL_MACHINE_ID)
  const staff = await apiAs('STAFF')
  expect((await staff.get(`${process.env.REAL_API}/users`)).status()).toBe(403)
})
