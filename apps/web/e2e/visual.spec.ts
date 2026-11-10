// Screenshots, horizontal-overflow check and axe for the FM2 screens at 1440/768/390 in light and dark.
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { auditScreen, loginAs, THEMES, useThemeChoice } from './support.ts'
import type { Role } from './support.ts'

interface Screen { name: string; role?: Role; url: string; ready: (page: Page) => Promise<void> }

const SCREENS: Screen[] = [
  { name: 'login', url: '/login', ready: page => expect(page.getByRole('heading', { level: 1, name: 'Đăng nhập' })).toBeVisible() },
  { name: 'orders', role: 'ADMIN', url: '/admin/orders', ready: page => expect(page.getByRole('navigation', { name: 'Phân trang' })).toBeVisible() },
  { name: 'kit', role: 'ADMIN', url: '/admin/_kit', ready: page => expect(page.getByRole('heading', { level: 1, name: 'Bộ thành phần giao diện' })).toBeVisible() },
  { name: 'forbidden', role: 'STAFF', url: '/admin/users', ready: page => expect(page.getByRole('heading', { level: 1, name: 'Không có quyền truy cập' })).toBeVisible() },
]

for (const screen of SCREENS) {
  for (const theme of THEMES) {
    test(`Ảnh + axe: ${screen.name} (${theme})`, async ({ page }, testInfo) => {
      await useThemeChoice(page, theme)
      if (screen.role) await loginAs(page, screen.role)
      await page.goto(screen.url)
      await expect(page.locator('html')).toHaveClass(theme === 'dark' ? /\bdark\b/ : /^(?!.*\bdark\b)/)
      await auditScreen(page, testInfo, screen.name, theme, () => screen.ready(page))
    })
  }
}
