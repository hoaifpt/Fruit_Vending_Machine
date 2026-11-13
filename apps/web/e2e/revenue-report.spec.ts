// R1 Báo cáo doanh thu (FE 9.1) and the revenue block of O1 Tổng quan (FE 9.2) on the mock API (draft
// revenue-reports.yaml). Done criteria: "Số trên màn khớp file CSV; tách tiền giảm và tiền hoàn" (the downloaded CSV is
// compared cell by cell with the tiles and both tables) and "Số doanh thu khớp màn Báo cáo" (the overview's numbers equal
// the report its links open). Also: URL filters, range errors without a request, every failure state, STAFF refused,
// print layout, screenshots + axe.
import fs from 'node:fs'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { auditScreen, loginAs, THEMES, useThemeChoice } from './support.ts'

const FIGURE_KEYS = ['orderCount', 'quantity', 'grossAmount', 'discountAmount', 'paidAmount', 'refundCount', 'refundAmount', 'netAmount']

/** `35.000 ₫` / `-17.500 ₫` / `1.234` → number. */
const amount = (text: string | null) => {
  const clean = (text ?? '').replace(/[^\d-]/g, '')
  return clean ? Number(clean) : NaN
}

/** Minimal CSV reader (quoted cells, doubled quotes, CRLF). */
function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = [], cell = '', quoted = false
  const source = text.replace(/^﻿/, '')
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]
    if (quoted) {
      if (char === '"' && source[index + 1] === '"') { cell += '"'; index += 1 } else if (char === '"') quoted = false
      else cell += char
    } else if (char === '"') quoted = true
    else if (char === ',') { row.push(cell); cell = '' } else if (char === '\n') { row.push(cell); rows.push(row); row = []; cell = '' } else if (char !== '\r') cell += char
  }
  if (cell || row.length) { row.push(cell); rows.push(row) }
  return rows
}

async function reportReady(page: Page) {
  await expect(page.locator('[data-total="netAmount"]')).toBeVisible()
}
async function tiles(page: Page) {
  const values: Record<string, number> = {}
  for (const key of FIGURE_KEYS) values[key] = amount(await page.locator(`[data-total="${key}"]`).textContent())
  return values
}
/** Figures of every row of a table, keyed by the row's data-bucket / data-product attribute. */
async function tableRows(page: Page, attribute: 'data-bucket' | 'data-product') {
  return page.locator(`tr:has([${attribute}])`).evaluateAll((rows, [attr, keys]) => rows.map(row => ({
    key: row.querySelector(`[${attr}]`)?.getAttribute(attr as string) ?? '',
    label: (row.querySelector(`[${attr}]`)?.textContent ?? '').trim(),
    figures: (keys as string[]).map(key => (row.querySelector(`[data-figure="${key}"]`)?.textContent ?? '').replace(/[^\d-]/g, '')).map(Number),
  })), [attribute, FIGURE_KEYS] as const)
}
async function downloadCsv(page: Page) {
  const [file] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Xuất CSV' }).click()])
  const location = await file.path()
  return { name: file.suggestedFilename(), rows: parseCsv(fs.readFileSync(location, 'utf8')) }
}
const requests = (page: Page) => page.evaluate(() => (window as unknown as { __fvMock: { requests: (prefix: string) => unknown[] } }).__fvMock.requests('/reports').length)

test('Tiêu chí xong 9.1: số trên màn khớp file CSV; tiền giảm và tiền hoàn tách riêng', async ({ page }) => {
  await loginAs(page, 'ADMIN')
  await page.getByRole('navigation', { name: 'Quản trị' }).getByRole('link', { name: 'Báo cáo doanh thu' }).click()
  await expect(page).toHaveURL('/admin/reports/revenue')
  await expect(page.getByRole('heading', { level: 1, name: 'Báo cáo doanh thu' })).toBeVisible()
  await reportReady(page)

  const totals = await tiles(page)
  // Discount (near-expiry order of the seed) and refunds (REFUNDED orders) are separate, non-zero figures.
  expect(totals.discountAmount).toBe(17_500)
  expect(totals.refundAmount).toBeGreaterThan(0)
  expect(totals.refundCount).toBeGreaterThan(0)
  expect(totals.grossAmount - totals.discountAmount).toBe(totals.paidAmount)
  expect(totals.paidAmount - totals.refundAmount).toBe(totals.netAmount)
  await expect(page.getByRole('img', { name: /Biểu đồ cột thực thu theo ngày, 7 cột/ })).toBeVisible()

  await expect(page.getByRole('button', { name: 'Xuất CSV' })).toHaveAccessibleDescription(/Dữ liệu > Từ văn bản\/CSV/)
  const { name, rows } = await downloadCsv(page)
  expect(rows[1][1]).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  expect(name).toMatch(/^doanh-thu_\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}\.csv$/)
  const totalRow = rows.find(row => row[0] === 'Tổng' && row.length > 1)!
  expect(totalRow.slice(1).map(Number)).toEqual(FIGURE_KEYS.map(key => totals[key]))

  const days = await tableRows(page, 'data-bucket')
  expect(days).toHaveLength(7)
  const dayHead = rows.findIndex(row => row[0] === 'Ngày')
  for (const [index, day] of days.entries()) {
    // Screen 13/11/2026, CSV ISO 2026-11-13 (Excel reads it the same date in any region): both name the same day.
    expect(rows[dayHead + 1 + index][0]).toBe(day.key)
    expect(day.label).toBe(`${day.key.slice(8, 10)}/${day.key.slice(5, 7)}/${day.key.slice(0, 4)}`)
    expect(rows[dayHead + 1 + index].slice(1).map(Number)).toEqual(day.figures)
  }
  const products = await tableRows(page, 'data-product')
  expect(products.length).toBeGreaterThan(0)
  const productHead = rows.findIndex(row => row[0] === 'SKU')
  for (const [index, product] of products.entries()) {
    const csvRow = rows[productHead + 1 + index]
    expect(product.label).toContain(csvRow[1])
    expect(csvRow.slice(2).map(Number)).toEqual(product.figures)
  }
})

test('Bộ lọc trên URL: khoảng nhanh, sản phẩm, theo giờ, xóa bộ lọc; khoảng sai báo ngay, không gọi API', async ({ page }) => {
  await loginAs(page, 'ADMIN')
  await page.goto('/admin/reports/revenue')
  await reportReady(page)
  const presets = page.getByRole('group', { name: 'Khoảng ngày nhanh' })
  await expect(presets.getByRole('button', { name: '7 ngày qua' })).toHaveAttribute('aria-pressed', 'true')
  await presets.getByRole('button', { name: 'Hôm nay' }).click()
  await expect(page).toHaveURL(/from=(\d{4}-\d{2}-\d{2})&to=\1$/)
  await expect(page.locator('[data-scope]')).toContainText(/^Ngày \d{2}\/\d{2}\/\d{4} · Tất cả sản phẩm · Theo ngày/)
  await expect(page.locator('tr:has([data-bucket])')).toHaveCount(1)

  await page.getByLabel('Nhóm theo').selectOption('hour')
  await expect(page).toHaveURL(/group=hour/)
  await expect(page.locator('tr:has([data-bucket])')).toHaveCount(24)
  await expect(page.locator('[data-bucket="h0"]')).toHaveText('00:00–00:59')

  const product = page.getByLabel('Sản phẩm', { exact: true })
  const option = await product.locator('option').nth(1).getAttribute('value')
  await product.selectOption(option!)
  await expect(page).toHaveURL(new RegExp(`productId=${option}`))
  await expect(page.locator('[data-scope]')).toContainText('Sản phẩm ')
  await page.getByRole('button', { name: /Xóa bộ lọc \(3\)/ }).click()
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
  await page.goto('/admin/reports/revenue?productId=abc&group=week')
  await reportReady(page)
  await expect(page.getByRole('status').filter({ hasText: 'Đã bỏ qua giá trị không hợp lệ' })).toContainText('Sản phẩm, Nhóm theo')
})

test('Rỗng, lỗi 500, 403, 401, chưa có API: mỗi trạng thái có lời giải thích và bước tiếp theo', async ({ page }) => {
  await loginAs(page, 'ADMIN')
  await page.goto('/admin/reports/revenue?from=2020-01-01&to=2020-01-07')
  await expect(page.getByText('Không có đơn nào được thanh toán hay hoàn tiền trong khoảng này.')).toBeVisible()
  await page.getByRole('button', { name: 'Xem 30 ngày qua' }).click()
  await reportReady(page)
  await expect(page.getByRole('group', { name: 'Khoảng ngày nhanh' }).getByRole('button', { name: '30 ngày qua' })).toHaveAttribute('aria-pressed', 'true')

  await page.goto('/admin/reports/revenue?scenario=error500:reports')
  await expect(page.getByRole('alert')).toContainText('Hệ thống đang gặp sự cố')
  await page.goto('/admin/reports/revenue?scenario=none')
  await reportReady(page)

  await page.goto('/admin/reports/revenue?scenario=403:reports')
  await expect(page.getByRole('heading', { name: 'Không có quyền truy cập' })).toBeVisible()

  await page.goto('/admin/reports/revenue?scenario=missing:reports')
  await expect(page.getByText(/máy chủ chưa có API báo cáo \(BE 6\.1\)/)).toBeVisible()

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
  await expect(week.locator('[data-figure="netAmount"]')).toBeVisible()
  const read = async (period: typeof today) => Object.fromEntries(await Promise.all(['netAmount', 'orderCount', 'paidAmount', 'discountAmount', 'refundAmount']
    .map(async key => [key, amount(await period.locator(`[data-figure="${key}"]`).textContent())])))
  const weekFigures = await read(week)
  const todayFigures = await read(today)
  expect(weekFigures.discountAmount).toBe(17_500)
  expect(weekFigures.refundAmount).toBeGreaterThan(0)

  await week.getByRole('link', { name: 'Mở báo cáo 7 ngày' }).click()
  await expect(page).toHaveURL(/\/admin\/reports\/revenue\?from=\d{4}-\d{2}-\d{2}&to=\d{4}-\d{2}-\d{2}$/)
  await reportReady(page)
  const report = await tiles(page)
  for (const key of Object.keys(weekFigures)) expect(report[key], key).toBe(weekFigures[key])

  await page.goBack()
  await expect(today.locator('[data-figure="netAmount"]')).toBeVisible()
  await today.getByRole('link', { name: 'Mở báo cáo hôm nay' }).click()
  await expect(page).toHaveURL(/from=(\d{4}-\d{2}-\d{2})&to=\1$/)
  await reportReady(page)
  const todayReport = await tiles(page)
  for (const key of Object.keys(todayFigures)) expect(todayReport[key], key).toBe(todayFigures[key])
})

test('Tổng quan: khối doanh thu lỗi riêng, các khối khác vẫn hiện', async ({ page }) => {
  await loginAs(page, 'ADMIN')
  await page.goto('/admin/overview?scenario=error500:reports')
  const block = page.getByRole('region', { name: 'Doanh thu' })
  await expect(block.getByRole('alert')).toContainText('Không tải được')
  await expect(block.getByRole('button', { name: 'Thử lại' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Đang bảo trì' }).locator('[data-count]')).toHaveAttribute('data-count', '1')
  await page.goto('/admin/overview?scenario=missing:reports')
  await expect(block).toContainText('máy chủ chưa có API báo cáo')
})

test('In / Lưu PDF: khi in chỉ còn nội dung báo cáo (không thanh bên, không bộ lọc)', async ({ page }) => {
  await loginAs(page, 'ADMIN')
  await page.goto('/admin/reports/revenue')
  await reportReady(page)
  await page.emulateMedia({ media: 'print' })
  await expect(page.getByRole('navigation', { name: 'Quản trị' })).toBeHidden()
  await expect(page.getByRole('group', { name: 'Khoảng ngày nhanh' })).toBeHidden()
  await expect(page.getByRole('button', { name: 'Xuất CSV' })).toBeHidden()
  await expect(page.locator('[data-scope]')).toBeVisible()
  await expect(page.locator('[data-total="netAmount"]')).toBeVisible()
  // A4 width falls in the tablet range where detail columns hide on screen: the printout keeps them all.
  await page.setViewportSize({ width: 794, height: 1123 })
  await expect(page.getByRole('columnheader', { name: 'Giá gốc' }).first()).toBeVisible()
  await page.emulateMedia({ media: 'screen' })
  await expect(page.getByRole('columnheader', { name: 'Giá gốc' }).first()).toBeHidden()
  await expect(page.getByRole('button', { name: 'Xuất CSV' })).toBeVisible()
})

for (const theme of THEMES) {
  test(`Ảnh + axe: báo cáo doanh thu (${theme})`, async ({ page }, testInfo) => {
    await useThemeChoice(page, theme)
    await loginAs(page, 'ADMIN')
    await page.goto('/admin/reports/revenue')
    await auditScreen(page, testInfo, 'revenue-report', theme, () => reportReady(page))
  })
}
