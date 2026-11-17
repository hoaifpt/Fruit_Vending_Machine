// Near-expiry discount setting (FE 7.5, backend #61, docs/near-expiry-pricing.md): GET/PUT /pricing/near-expiry-discount.
// PRICING_READ sees it, PRICING_MANAGE (ADMIN) replaces it with the version last read (stale → 409). The server applies
// it at once to the kiosk catalog and new orders; the web only shows and edits it. Unit-tested in tests/discount.test.mjs.
import { ApiError } from '../api/client.ts'
import type { NearExpiryDiscount, UpdateNearExpiryDiscountBody } from '../api/resources.ts'

export const PRICING_LIMITS = { min: 1, max: 90 } as const
export const DISCOUNT_TODAY = 'Giảm giá hôm nay'
export const PRICING_STALE = 'Cài đặt giảm giá vừa được người khác thay đổi. Đã tải lại giá trị mới nhất; kiểm tra rồi lưu lại.'

/** One sentence for the inventory page: on/off and the percent, in words. */
export function pricingText(setting: Pick<NearExpiryDiscount, 'enabled' | 'percent'>): string {
  return setting.enabled
    ? `Đang bật: hộp có lô hết hạn trong ngày hôm nay (giờ Việt Nam) được bán giảm ${setting.percent} %.`
    : 'Đang tắt: mọi hộp bán đúng giá niêm yết, kể cả hộp hết hạn trong ngày.'
}

export interface PricingValues { enabled: 'true' | 'false'; percent: string; [key: string]: string }
export function pricingValues(setting: Pick<NearExpiryDiscount, 'enabled' | 'percent'>): PricingValues {
  return { enabled: setting.enabled ? 'true' : 'false', percent: String(setting.percent) }
}

/** The percent as an integer 1..90 (what the server accepts), or undefined. */
export function parsePercent(raw: string): number | undefined {
  const text = raw.trim()
  if (!/^\d{1,2}$/.test(text)) return undefined
  const value = Number(text)
  return value >= PRICING_LIMITS.min && value <= PRICING_LIMITS.max ? value : undefined
}
export function validatePricing(values: PricingValues): Record<string, string> {
  return parsePercent(values.percent) === undefined ? { percent: `Nhập số nguyên từ ${PRICING_LIMITS.min} đến ${PRICING_LIMITS.max}.` } : {}
}

/** PUT body: every field (the server refuses a missing one) with the version last read; undefined when nothing changed. */
export function pricingBody(setting: Pick<NearExpiryDiscount, 'enabled' | 'percent' | 'version'>, values: PricingValues): UpdateNearExpiryDiscountBody | undefined {
  const enabled = values.enabled === 'true', percent = parsePercent(values.percent) ?? setting.percent
  if (enabled === setting.enabled && percent === setting.percent) return undefined
  return { enabled, percent, version: setting.version }
}

/** A 409 means someone saved in between: explained, and the caller reloads. Other errors keep their message. */
export function pricingError(error: unknown): unknown {
  return error instanceof ApiError && error.status === 409 ? new ApiError(409, PRICING_STALE) : error
}
