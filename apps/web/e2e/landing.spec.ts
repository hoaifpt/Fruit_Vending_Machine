// Landing page `/` (FE 9.3): direction A on Tailwind tokens. Screenshots, no horizontal scroll and axe (WCAG 2.0/2.1
// A + AA) at 1440/768/390; the page stays light when the admin theme is dark; keyboard: skip link, mobile menu
// (Escape returns focus to the toggle), FAQ disclosure.
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { auditScreen, useThemeChoice } from './support.ts'

async function ready(page: Page) {
  await expect(page.getByRole('heading', { level: 1, name: /Trái cây tươi/ })).toBeVisible()
  // Make the lazy partnership illustration load so the full-page screenshot is complete.
  await page.locator('img[loading="lazy"]').first().scrollIntoViewIfNeeded()
  await page.evaluate(() => window.scrollTo(0, 0))
}

for (const theme of ['light', 'dark'] as const) {
  test(`landing: ảnh chụp, không cuộn ngang và axe ở 3 khổ (theme admin ${theme})`, async ({ page }, testInfo) => {
    await useThemeChoice(page, theme)
    await page.goto('/')
    await auditScreen(page, testInfo, 'landing', theme, () => ready(page))
    // Direction A has no dark variant: the page background stays white even when <html> has .dark.
    const background = await page.locator('.landing').evaluate(element => getComputedStyle(element).backgroundColor)
    expect(background).toMatch(/oklch\(1 0 0\)|rgb\(255, 255, 255\)/)
  })
}

test('landing: liên kết bỏ qua, focus thấy rõ và hỏi đáp bằng bàn phím', async ({ page }) => {
  await useThemeChoice(page, 'light')
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1, name: /Trái cây tươi/ })).toBeVisible()
  await page.keyboard.press('Tab')
  const skip = page.getByRole('link', { name: 'Đến nội dung chính' })
  await expect(skip).toBeFocused()
  const box = await skip.boundingBox()
  expect(box && box.y >= 0).toBe(true)
  await page.keyboard.press('Enter')
  await expect(page.locator('#noi-dung')).toBeFocused()

  const cta = page.getByRole('banner').getByRole('link', { name: 'Hợp tác đặt máy' })
  await cta.focus()
  const outline = await cta.evaluate(element => { const style = getComputedStyle(element); return { width: style.outlineWidth, style: style.outlineStyle } })
  expect(outline).toEqual({ width: '3px', style: 'solid' })

  const summary = page.locator('summary', { hasText: 'Fruit Vending là gì?' })
  await summary.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByText('kết hợp màn hình chọn hàng, thanh toán QR')).toBeVisible()
  await page.keyboard.press('Enter')
  await expect(page.getByText('kết hợp màn hình chọn hàng, thanh toán QR')).toBeHidden()
})

test('landing 390px: menu mở/đóng bằng bàn phím, Escape trả focus về nút menu', async ({ page }) => {
  await useThemeChoice(page, 'light')
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await expect(page.getByRole('navigation', { name: 'Điều hướng chính' })).toBeHidden()
  const toggle = page.getByRole('button', { name: 'Mở menu' })
  await toggle.focus()
  await page.keyboard.press('Enter')
  const close = page.getByRole('button', { name: 'Đóng menu' })
  await expect(close).toHaveAttribute('aria-expanded', 'true')
  const mobileNav = page.getByRole('navigation', { name: 'Điều hướng điện thoại' })
  await expect(mobileNav.getByRole('link')).toHaveCount(4)
  await expect(mobileNav.getByRole('link', { name: 'Mua trái cây' })).toHaveAttribute('href', '/buy')
  await page.keyboard.press('Escape')
  await expect(mobileNav).toBeHidden()
  await expect(page.getByRole('button', { name: 'Mở menu' })).toBeFocused()

  // A section link closes the menu and lands on the section.
  await page.getByRole('button', { name: 'Mở menu' }).click()
  await mobileNav.getByRole('link', { name: 'Hợp tác' }).click()
  await expect(mobileNav).toBeHidden()
  await expect(page).toHaveURL(/#hop-tac$/)
})

test('landing: đường dẫn "Mua trái cây" tới /buy ở hero, menu và cuối trang', async ({ page }) => {
  await useThemeChoice(page, 'light')
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1, name: /Trái cây tươi/ })).toBeVisible()
  const hero = page.locator('section[aria-labelledby="hero-title"]').getByRole('link', { name: 'Mua trái cây' })
  const desktopNav = page.getByRole('navigation', { name: 'Điều hướng chính' }).getByRole('link', { name: 'Mua trái cây' })
  const footer = page.getByRole('navigation', { name: 'Điều hướng cuối trang' }).getByRole('link', { name: 'Mua trái cây' })
  for (const link of [hero, desktopNav, footer]) {
    await expect(link).toBeVisible()
    await expect(link).toHaveAttribute('href', '/buy')
    const box = await link.boundingBox()
    expect(box && box.height >= 44).toBe(true)
  }
  // Secondary to the main CTA: it follows "Hợp tác đặt máy" in the hero.
  const heroLinks = await page.locator('section[aria-labelledby="hero-title"] a').allTextContents()
  expect(heroLinks.map(text => text.trim()).slice(0, 2)).toEqual(['Hợp tác đặt máy', 'Mua trái cây'])
  await hero.focus()
  const outline = await hero.evaluate(element => { const style = getComputedStyle(element); return { width: style.outlineWidth, style: style.outlineStyle } })
  expect(outline).toEqual({ width: '3px', style: 'solid' })

  await hero.click()
  await expect(page).toHaveURL(/\/buy$/)
  await expect(page.getByRole('heading', { level: 1, name: /Trái cây tươi/ })).toHaveCount(0)

  for (const name of ['Điều hướng chính', 'Điều hướng cuối trang']) {
    await page.goto('/')
    await page.getByRole('navigation', { name }).getByRole('link', { name: 'Mua trái cây' }).click()
    await expect(page).toHaveURL(/\/buy$/)
  }
})

test('landing 390px: mục "Mua trái cây" trong menu điện thoại đóng menu và tới /buy', async ({ page }) => {
  await useThemeChoice(page, 'light')
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  const hero = page.locator('section[aria-labelledby="hero-title"]').getByRole('link', { name: 'Mua trái cây' })
  await expect(hero).toBeVisible()
  const box = await hero.boundingBox()
  expect(box && box.height >= 44 && box.x >= 0 && box.x + box.width <= 390).toBe(true)
  await page.getByRole('button', { name: 'Mở menu' }).click()
  const mobileNav = page.getByRole('navigation', { name: 'Điều hướng điện thoại' })
  await mobileNav.getByRole('link', { name: 'Mua trái cây' }).click()
  await expect(page).toHaveURL(/\/buy$/)
  await expect(mobileNav).toHaveCount(0)
})
