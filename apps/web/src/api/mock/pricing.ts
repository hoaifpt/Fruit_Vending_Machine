// Mock of the near-expiry discount proposed to backend 4.1 (draft api-contract/drafts/pricing-discount.yaml, FE 7.5).
// This plays the BACKEND's rule so the screens have data; the web itself never computes a price to charge.
// Rule: a box whose batch expires within 24 hours (and is still sellable) sells at 50% off, rounded half-up to a whole VND.
import type { components as PricingDraft } from '../drafts/pricing-discount'

type P = PricingDraft['schemas']
const HOUR = 3_600_000
export const NEAR_EXPIRY_WINDOW_MS = 24 * HOUR
export const NEAR_EXPIRY_PERCENT = 50

export interface BoxPrice {
  originalUnitPrice: number
  unitPrice: number
  discountPercent: number | null
  discountReason: P['DiscountReason'] | null
}

/** Whole VND, half up (positive amounts only). */
export const roundVnd = (amount: number) => Math.floor(amount + 0.5)

/** Price a box sells at now: list price, or 50% off when its expiry is within the near-expiry window. */
export function boxPrice(listPrice: number, expiresAt: string | undefined, now: number): BoxPrice {
  const expiry = expiresAt ? Date.parse(expiresAt) : NaN
  const near = Number.isFinite(expiry) && expiry > now && expiry - now <= NEAR_EXPIRY_WINDOW_MS
  if (!near) return { originalUnitPrice: listPrice, unitPrice: listPrice, discountPercent: null, discountReason: null }
  return { originalUnitPrice: listPrice, unitPrice: roundVnd(listPrice * (100 - NEAR_EXPIRY_PERCENT) / 100), discountPercent: NEAR_EXPIRY_PERCENT, discountReason: 'NEAR_EXPIRY' }
}

/** Order line fields for `quantity` boxes at `price` (snapshot at order time). */
export function linePricing(price: BoxPrice, quantity: number) {
  return {
    unitPrice: price.unitPrice, totalPrice: price.unitPrice * quantity, originalUnitPrice: price.originalUnitPrice,
    discountAmount: (price.originalUnitPrice - price.unitPrice) * quantity, discountPercent: price.discountPercent, discountReason: price.discountReason,
  }
}
