// Price with an optional near-expiry discount (FE 7.5): the price to pay first, then the original price struck through
// (<s>, announced as "Giá gốc …") and a "-50%" tag in text. Meaning never relies on colour or the strike alone.
// Without discount fields it is just the formatted price, as before. Values come from priceView (src/lib/price.ts).
import { cn } from '../../lib/cn.ts'
import { discountReasonText } from '../../lib/price.ts'
import type { PriceView } from '../../lib/price.ts'

export const DISCOUNT_TAG = 'inline-flex items-center rounded-full bg-status-danger px-1.5 text-[11px] leading-5 font-semibold text-status-danger-foreground'

export function PriceTag({ view, reason, className, strong = false }: {
  view: PriceView
  /** Server discountReason, read out after the tag. */
  reason?: string | null
  className?: string
  /** Emphasise the price to pay (totals). */
  strong?: boolean
}) {
  if (!view.discounted) return <span className={className}>{view.current}</span>
  return <span data-price-discounted="" className={cn('inline-flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5', className)}>
    <span className={cn('tabular-nums', strong && 'font-semibold')}>{view.current}</span>
    <s className="text-[0.9em] text-muted-foreground tabular-nums"><span className="sr-only">Giá gốc </span>{view.original}</s>
    <span className={DISCOUNT_TAG}>{view.tag}<span className="sr-only"> ({discountReasonText(reason).toLowerCase()})</span></span>
  </span>
}
