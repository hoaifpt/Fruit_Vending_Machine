// Mock of the near-expiry discount of backend #61 (docs/near-expiry-pricing.md, api.yaml): plays the BACKEND's rule so the
// screens have data; the web itself never computes a price to charge.
// Rule: today = the business day in Asia/Ho_Chi_Minh; a bowl is eligible when the setting is on and its batch expires on
// today's business day (and has not expired yet); price = floor(list × (100 − percent) / 100), whole VND.
import { conflict, Form, ok } from './http.ts'
import type { Reply } from './http.ts'
import type { MockStore, MockUser } from './seed.ts'
import { vietnamDate } from '../../admin/maintenance-schedules.ts'

export interface PricingSetting { enabled: boolean; percent: number }
/** The row of pricing_settings (V18 seeds enabled, 50 %). */
export interface MockPricing extends PricingSetting { version: number; updatedAt: string; updatedById: string | null }
export const DEFAULT_PRICING: PricingSetting = { enabled: true, percent: 50 }

export interface BoxPrice {
  originalUnitPrice: number
  unitPrice: number
  discountPercent: number
  discountReason: 'NONE' | 'NEAR_EXPIRY'
}

/** Same rule as NearExpiryPricingService: on, not expired yet, and the batch expires on today's business day. */
export function eligibleToday(expiresAt: string | undefined, now: number, setting: PricingSetting = DEFAULT_PRICING): boolean {
  const expiry = expiresAt ? Date.parse(expiresAt) : NaN
  return setting.enabled && Number.isFinite(expiry) && expiry > now && vietnamDate(expiry) === vietnamDate(now)
}

/** Price a bowl sells at now: the list price, or the discounted one (rounded down to a whole VND) when eligible. */
export function boxPrice(listPrice: number, expiresAt: string | undefined, now: number, setting: PricingSetting = DEFAULT_PRICING): BoxPrice {
  if (!eligibleToday(expiresAt, now, setting)) return { originalUnitPrice: listPrice, unitPrice: listPrice, discountPercent: 0, discountReason: 'NONE' }
  return { originalUnitPrice: listPrice, unitPrice: Math.floor(listPrice * (100 - setting.percent) / 100), discountPercent: setting.percent, discountReason: 'NEAR_EXPIRY' }
}

/** Order line fields for `quantity` bowls at `price` (snapshot at order time), as OrderItemDetailResponse carries them. */
export function linePricing(price: BoxPrice, quantity: number) {
  return {
    unitPrice: price.unitPrice, totalPrice: price.unitPrice * quantity, originalUnitPrice: price.originalUnitPrice,
    discountPercent: price.discountPercent, discountReason: price.discountReason,
  }
}
/** discountAmount of an order: original total minus what is charged. */
export const lineDiscount = (line: { originalUnitPrice?: number; unitPrice?: number; quantity?: number }) =>
  ((line.originalUnitPrice ?? line.unitPrice ?? 0) - (line.unitPrice ?? 0)) * (line.quantity ?? 1)

export function pricingView(store: MockStore) {
  const { enabled, percent, version, updatedAt, updatedById } = store.pricing
  const user = store.users.find(candidate => candidate.id === updatedById)
  return { enabled, percent, version, updatedAt, updatedBy: user ? { id: user.id, fullName: user.fullName } : null, businessZone: 'Asia/Ho_Chi_Minh' }
}

/** PUT /pricing/near-expiry-discount: every field required, percent an integer 1..90, version must match (409). */
export function updatePricing(store: MockStore, body: unknown, user: MockUser, now: number): Reply {
  const form = new Form(body, ['enabled', 'percent', 'version'])
  const data = body as Record<string, unknown>
  if (typeof data.enabled !== 'boolean') form.reject('enabled', 'must not be null')
  const percent = form.integer('percent', 1, 90)
  const version = form.integer('version', 0, Number.MAX_SAFE_INTEGER)
  form.done()
  if (version !== store.pricing.version) throw conflict('STALE_VERSION: the setting was changed by someone else; read it again')
  if (data.enabled !== store.pricing.enabled || percent !== store.pricing.percent) {
    Object.assign(store.pricing, { enabled: data.enabled, percent, version: store.pricing.version + 1, updatedAt: new Date(now).toISOString(), updatedById: user.id })
  }
  return ok(pricingView(store))
}
