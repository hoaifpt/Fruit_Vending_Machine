// R1 Báo cáo doanh thu (FE 9.1) and the revenue block of O1 Tổng quan (FE 9.2) on the mock of the sales report API of
// backend #76. Done criteria: "Số trên màn khớp file CSV; tách tiền giảm và tiền hoàn" (the CSV the server renders is
// compared with the tiles, the daily table and the products) and "Số doanh thu khớp màn Báo cáo" (the overview's numbers
// equal the report its links open). Also: URL filters, range errors without a request, 400 with the id named, every
// failure state, STAFF refused, screenshots + axe.
import fs from 'node:fs'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { auditScreen, loginAs, THEMES, useThemeChoice } from './support.ts'

const TILE_KEYS = ['netRevenue', 'netSales', 'grossSales', 'discounts', 'deliveredRefunds', 'ordersSold', 'averageOrderValue', 'moneyCollected', 'moneyRefunded', 'failedDispenses']
const DAY_KEYS = ['ordersSold', 'grossSales', 'discounts', 'netSales', 'deliveredRefunds', 'netRevenue']

/** `35.000 ₫` / `-17.500 ₫` / `1.234` → number. */
const amount = (text: string | null) => {
  const clean = (text ?? '').replace(/[^\d-]/g, '')
  return clean ? Number(clean) : NaN
}

/** CSV of the server: sections `[Name]` then rows (no quoted commas in the mock's numbers). */
function sections(text: string): Record<string, string[][]> {
  const result: Record<string, string[][]> = {}
  let current = ''
  for (const line of text.replace(/^﻿/, '').split(/\r?\n/)) {
    if (/^\[.+\]$/.test(line)) { current = line.slice(1, -1); result[current] = []; continue }
    if (line && current) result[current].push(line.split(','))
  }
  return result
}

async function reportReady(page: Page) {
  await expect(page.locator('[data-total="netRevenue"]')).toBeVisible()
}
async function tiles(page: Page) {
  const values: Record<string, number> = {}
  for (const key of TILE_KEYS) values[key] = amount(await page.locator(`[data-total="${key}"]`).textContent())
  return values
}
async function dayRows(page: Page) {
  return page.locator('tr:has([data-bucket])').evaluateAll((rows, keys) => rows.map(row => ({
    key: row.querySelector('[data-bucket]')?.getAttribute('data-bucket') ?? '',
    figures: (keys as string[]).map(key => Number((row.querySelector(`[data-figure="${key}"]`)?.textContent ?? '').replace(/[^\d-]/g, ''))),
  })), DAY_KEYS)
}
async function downloadCsv(page: Page) {
  const [file] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Xuất CSV' }).click()])
  const location = await file.path()
  return { name: file.suggestedFilename(), csv: sections(fs.readFileSync(location, 'utf8')) }
}
const requests = (page: Page, prefix = '/reports') => page.evaluate(path => (window as unknown as { __fvMock: { requests: (prefix: string) => unknown[] } }).__fvMock.requests(path).length, prefix)

test('Tiêu chí xong 9.1: số trên màn khớp file CSV của máy chủ; tiền giảm và tiền hoàn tách riêng', async ({ page }) => {
  await loginAs(page, 'ADMIN')
  await page.getByRole('navigation', { name: 'Quản trị' }).getByRole('link', { name: 'Báo cáo doanh thu' }).click()
  await expect(page).toHaveURL('/admin/reports/revenue')
  await expect(page.getByRole('heading', { level: 1, name: 'Báo cáo doanh thu' })).toBeVisible()
  await reportReady(page)

  const totals = await tiles(page)
  // Discount (near-expiry order of the seed) and refunds (failed dispenses of the seed) are separate figures.
  expect(totals.discounts).toBe(17_500)
  expect(totals.grossSales - totals.discounts).toBe(totals.netSales)
  expect(totals.netSales - totals.deliveredRefunds).toBe(totals.netRevenue)
  expect(totals.moneyRefunded).toBeGreaterThan(0)
  await expect(page.getByRole('img', { name: /Biểu đồ cột doanh thu thuần theo ngày, 7 cột/ })).toBeVisible()
  await expect(page.getByRole('img', { name: /Biểu đồ cột số đơn theo giờ trong ngày, 24 cột/ })).toBeVisible()

  await expect(page.getByRole('button', { name: 'Xuất CSV' })).toHaveAccessibleDescription(/máy chủ tạo/)
  const { name, csv } = await downloadCsv(page)
  expect(name).toMatch(/^freshvend-sales_\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}\.csv$/)
  const metric = (key: string) => Number(csv.Summary.find(row => row[0] === key)?.[1])
  for (const key of TILE_KEYS.filter(key => key !== 'moneyRefunded')) expect(metric(key), key).toBe(totals[key])
  expect(metric('moneyRefunded')).toBe(totals.moneyRefunded)

  const days = await dayRows(page)
  expect(days).toHaveLength(7)
  const daily = csv.Daily.slice(1) // header row first
  for (const [index, day] of days.entries()) {
    expect(daily[index][0]).toBe(day.key)
    expect(daily[index].slice(1).map(Number)).toEqual(day.figures)
  }
  const productRows = await page.locator('tr:has([data-product])').count()
  expect(productRows).toBe(csv.Products.length - 1)

  const [pdf] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Xuất PDF' }).click()])
  expect(pdf.suggestedFilename()).toMatch(/\.pdf$/)
})

test('Bộ lọc trên URL: khoảng nhanh, máy, sản phẩm, chia theo tuần, xóa bộ lọc; khoảng sai báo ngay, không gọi API', async ({ page }) => {
  await loginAs(page, 'ADMIN')
  await page.goto('/admin/reports/revenue')
  await reportReady(page)
  const presets = page.getByRole('group', { name: 'Khoảng ngày nhanh' })
  await expect(presets.getByRole('button', { name: '7 ngày qua' })).toHaveAttribute('aria-pressed', 'true')
  await presets.getByRole('button', { name: 'Hôm nay' }).click()
  await expect(page).toHaveURL(/from=(\d{4}-\d{2}-\d{2})&to=\1$/)
  await expect(page.locator('[data-scope]')).toContainText(/^Ngày \d{2}\/\d{2}\/\d{4} · Tất cả máy · Tất cả sản phẩm/)

  await presets.getByRole('button', { name: '30 ngày qua' }).click()
  await page.getByLabel('Chia theo').selectOption('WEEK')
  await expect(page).toHaveURL(/granularity=week/)
  await expect(page.getByRole('img', { name: /theo tuần/ })).toBeVisible()

  await page.getByLabel('Máy', { exact: true }).selectOption('20000000-0000-0000-0000-000000000001')
  await expect(page).toHaveURL(/machineId=20000000-0000-0000-0000-000000000001/)
  await expect(page.locator('[data-scope]')).toContainText('Máy DEV-MACHINE-01')
  await expect(page.locator('tr:has([data-machine])')).toHaveCount(1)

  const product = page.getByLabel('Sản phẩm', { exact: true })
  const option = await product.locator('option').nth(1).getAttribute('value')
  await product.selectOption(option!)
  await expect(page).toHaveURL(new RegExp(`productId=${option}`))
  await page.getByRole('button', { name: /Xóa bộ lọc \(4\)/ }).click()
  await expect(page).toHaveURL('/admin/reports/revenue')
  await reportReady(page)

  // Reversed range from the URL: field error and explanation, the API is not called.
  await page.goto('/admin/reports/revenue?from=2026-11-13&to=2026-11-01')
  await expect(page.getByRole('alert')).toContainText('Khoảng ngày chưa hợp lệ')
  await expect(page.getByText('Ngày kết thúc phải bằng hoặc sau ngày bắt đầu.', { exact: true })).toBeVisible()
  await expect(page.getByLabel('Đến ngày')).toHaveAttribute('aria-invalid', 'true')
  await expect(page.getByRole('button', { name: 'Xuất CSV' })).toBeDisabled()
  expect(await requests(page)).toBe(0) // fresh page load: the mock's request log is new

  // Junk in the URL is ignored and said.
  await page.goto('/admin/reports/revenue?productId=abc&granularity=hour')
  await reportReady(page)
  await expect(page.getByRole('status').filter({ hasText: 'Đã bỏ qua giá trị không hợp lệ' })).toContainText('Sản phẩm, Chia theo')

  // A well-formed but unknown product: the server's 400 names it, one click clears the filter.
  await page.goto('/admin/reports/revenue?productId=40000000-0000-0000-0000-000000009999')
  await expect(page.getByRole('alert')).toContainText('Unknown productId: 40000000-0000-0000-0000-000000009999')
  await page.getByRole('button', { name: 'Xem tất cả sản phẩm' }).click()
  await reportReady(page)
})

test('Rỗng, lỗi 500, 403, 401: mỗi trạng thái có lời giải thích và bước tiếp theo', async ({ page }) => {
  await loginAs(page, 'ADMIN')
  await page.goto('/admin/reports/revenue?from=2020-01-01&to=2020-01-07')
  await expect(page.getByText(/Không có đơn nào được giao, thanh toán hay hoàn tiền trong khoảng này\./)).toBeVisible()
  await page.getByRole('button', { name: 'Xem 30 ngày qua' }).click()
  await reportReady(page)
  await expect(page.getByRole('group', { name: 'Khoảng ngày nhanh' }).getByRole('button', { name: '30 ngày qua' })).toHaveAttribute('aria-pressed', 'true')

  await page.goto('/admin/reports/revenue?scenario=error500:reports')
  await expect(page.getByRole('alert')).toContainText('Hệ thống đang gặp sự cố')
  await page.goto('/admin/reports/revenue?scenario=none')
  await reportReady(page)

  await page.goto('/admin/reports/revenue?scenario=403:reports')
  await expect(page.getByRole('heading', { name: 'Không có quyền truy cập' })).toBeVisible()

  await page.goto('/admin/reports/revenue?scenario=none')
  await reportReady(page)
  await page.goto('/admin/reports/revenue?scenario=403:/reports/sales/export')
  await reportReady(page)
  await page.getByRole('button', { name: 'Xuất CSV' }).click()
  await expect(page.getByText('Không xuất được file CSV')).toBeVisible()

  await page.goto('/admin/reports/revenue?scenario=401:reports')
  await expect(page).toHaveURL(/\/login\?next=/)
})

test('STAFF: không có mục Báo cáo doanh thu, mở thẳng địa chỉ thì bị chặn trước khi gọi API, Tổng quan không có khối doanh thu', async ({ page }) => {
  await loginAs(page, 'STAFF')
  await expect(page.getByRole('navigation', { name: 'Quản trị' }).getByRole('link', { name: 'Báo cáo doanh thu' })).toHaveCount(0)
  await expect(page.getByRole('region', { name: 'Mất kết nối' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Doanh thu' })).toHaveCount(0)
  await page.goto('/admin/reports/revenue')
  await expect(page.getByRole('heading', { level: 1, name: 'Không có quyền truy cập' })).toBeVisible()
  expect(await requests(page)).toBe(0)
})

test('Tiêu chí xong 9.2: số doanh thu ở Tổng quan khớp màn Báo cáo (hôm nay và 7 ngày)', async ({ page }) => {
  await loginAs(page, 'ADMIN')
  await expect(page).toHaveURL('/admin/overview')
  const block = page.getByRole('region', { name: 'Doanh thu' })
  const today = block.locator('[data-period="today"]')
  const week = block.locator('[data-period="week"]')
  await expect(week.locator('[data-figure="netRevenue"]')).toBeVisible()
  const read = async (period: typeof today, keys: string[]) => Object.fromEntries(await Promise.all(keys.map(async key => [key, amount(await period.locator(`[data-figure="${key}"]`).textContent())])))
  const weekFigures = await read(week, ['netRevenue', 'ordersSold', 'netSales', 'discounts', 'deliveredRefunds'])
  const todayFigures = await read(today, ['netSales', 'ordersSold'])
  expect(weekFigures.discounts).toBe(17_500)

  await week.getByRole('link', { name: 'Mở báo cáo 7 ngày' }).click()
  await expect(page).toHaveURL(/\/admin\/reports\/revenue\?from=\d{4}-\d{2}-\d{2}&to=\d{4}-\d{2}-\d{2}$/)
  await reportReady(page)
  const report = await tiles(page)
  for (const key of Object.keys(weekFigures)) expect(report[key], key).toBe(weekFigures[key])

  await page.goBack()
  await expect(today.locator('[data-figure="netSales"]')).toBeVisible()
  await today.getByRole('link', { name: 'Mở báo cáo hôm nay' }).click()
  await expect(page).toHaveURL(/from=(\d{4}-\d{2}-\d{2})&to=\1$/)
  await reportReady(page)
  const todayReport = await tiles(page)
  for (const key of Object.keys(todayFigures)) expect(todayReport[key], key).toBe(todayFigures[key])
})

test('Tổng quan: 7 ngày lỗi riêng có Thử lại, các khối khác vẫn hiện', async ({ page }) => {
  await loginAs(page, 'ADMIN')
  await page.goto('/admin/overview?scenario=error500:reports')
  const block = page.getByRole('region', { name: 'Doanh thu' })
  await expect(block.getByRole('alert')).toContainText('Không tải được')
  await expect(block.getByRole('button', { name: 'Thử lại' })).toBeVisible()
  await expect(block.locator('[data-period="today"] [data-figure="netSales"]')).toBeVisible()
  await expect(page.getByRole('region', { name: 'Đang bảo trì' }).locator('[data-count]')).toHaveAttribute('data-count', '1')
})

for (const theme of THEMES) {
  test(`Ảnh + axe: báo cáo doanh thu (${theme})`, async ({ page }, testInfo) => {
    await useThemeChoice(page, theme)
    await loginAs(page, 'ADMIN')
    await page.goto('/admin/reports/revenue')
    await auditScreen(page, testInfo, 'revenue-report', theme, () => reportReady(page))
  })
}
