// Display of prices with a near-expiry discount (FE 7.5, screens K1, T1, I2), shared by the kiosk and the admin so every
// screen writes money the same way (formatMoney: `35.000 ₫`). Display only: the backend decides the discount and the
// amount to pay (draft api-contract/drafts/pricing-discount.yaml); these helpers never compute a price to charge. A
// response without the discount fields (the real API today) reads as "no discount" and shows the plain price.
import { formatMoney } from './format.ts'

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

export interface PriceInput {
  /** What is paid now (catalog `price`, order line `unitPrice`, box `unitPrice`), after any discount. */
  price?: number | null
  /** Price before discount (`originalUnitPrice`); missing or equal to `price` means no discount. */
  originalPrice?: number | null
  /** Percent off from the server (`discountPercent`); derived from the two prices only when it is missing. */
  discountPercent?: number | null
}

export interface PriceView {
  /** Formatted price to pay, `17.500 ₫` (`—` when unknown). */
  current: string
  discounted: boolean
  /** Formatted original price, only when discounted. */
  original?: string
  /** Whole percent off (1..99), only when discounted. */
  percent?: number
  /** Visible tag, `-50%`, only when discounted. */
  tag?: string
  /** Whole sentence for screen readers: `Giá 17.500 ₫, giá gốc 35.000 ₫, giảm 50%`. */
  spoken: string
}

/** Percent shown on the tag: the server's when valid, otherwise from the two prices, kept within 1..99. */
export function discountPercentOf(price: number, original: number, serverPercent?: number | null): number {
  if (finite(serverPercent) && Number.isInteger(serverPercent) && serverPercent >= 1 && serverPercent <= 99) return serverPercent
  return Math.min(99, Math.max(1, Math.round((1 - price / original) * 100)))
}

export function priceView({ price, originalPrice, discountPercent }: PriceInput): PriceView {
  const current = formatMoney(price)
  if (!finite(price) || !finite(originalPrice) || originalPrice <= 0 || originalPrice <= price) return { current, discounted: false, spoken: `Giá ${current}` }
  const percent = discountPercentOf(price, originalPrice, discountPercent)
  const original = formatMoney(originalPrice)
  return { current, discounted: true, original, percent, tag: `-${percent}%`, spoken: `Giá ${current}, giá gốc ${original}, giảm ${percent}%` }
}

export interface LineInput {
  quantity?: number | null
  unitPrice?: number | null
  totalPrice?: number | null
  originalUnitPrice?: number | null
  discountAmount?: number | null
  discountPercent?: number | null
}

export interface LineView {
  unit: PriceView
  /** Money taken off this line (0 without discount): the server's `discountAmount`, else (original − unit) × quantity. */
  discount: number
  /** Formatted line total as charged. */
  total: string
}

/** One order line: unit price (with the original struck when discounted), discount of the line and its total. */
export function lineView(line: LineInput): LineView {
  const unit = priceView({ price: line.unitPrice, originalPrice: line.originalUnitPrice, discountPercent: line.discountPercent })
  let discount = 0
  if (finite(line.discountAmount) && line.discountAmount > 0) discount = line.discountAmount
  else if (unit.discounted) discount = (line.originalUnitPrice! - line.unitPrice!) * (finite(line.quantity) && line.quantity > 0 ? line.quantity : 1)
  return { unit, discount, total: formatMoney(line.totalPrice) }
}

/** Total discount of an order: the server's `discountAmount`, else the sum of its lines; 0 when nothing was taken off. */
export function orderDiscount(order: { discountAmount?: number | null; items?: readonly LineInput[] | null }): number {
  if (finite(order.discountAmount) && order.discountAmount >= 0) return order.discountAmount
  return (order.items ?? []).reduce((sum, line) => sum + lineView(line).discount, 0)
}

/** Reason in words for the tag; only NEAR_EXPIRY exists, an unknown reason still reads as a discount. */
export function discountReasonText(reason: string | null | undefined): string {
  return reason === 'NEAR_EXPIRY' ? 'Giảm giá hộp cận hạn' : 'Giảm giá'
}
