// Small display pieces shared by the payment and webhook screens (FE 6.2). Meaning never relies on colour alone.
import { CircleCheck, CircleHelp, CircleMinus, CircleX, ShieldCheck, ShieldX } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '../lib/cn.ts'
import { AMOUNT_CHECK_TEXT } from './payments.ts'
import type { AmountCheck } from './payments.ts'

const PILL = 'inline-flex w-fit items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap'
export const PANEL = 'mb-5 min-w-0 rounded-xl border bg-card p-5 shadow-xs max-[680px]:p-4'
export const HEADING = 'mb-3! text-base font-semibold'
export const HINT = 'mb-3! text-[13px] text-muted-foreground'
export const LINK = 'font-medium text-primary underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring max-sm:inline-block max-sm:py-2.5'

export function VerifiedBadge({ verified }: { verified: boolean | undefined }) {
  return verified
    ? <span className={cn(PILL, 'bg-status-success text-status-success-foreground')}><ShieldCheck aria-hidden="true" className="size-3.5" />Đã xác thực</span>
    : <span className={cn(PILL, 'bg-status-danger text-status-danger-foreground')}><ShieldX aria-hidden="true" className="size-3.5" />Bị từ chối</span>
}

const CHECK_LOOK: Record<AmountCheck, { icon: LucideIcon; className: string }> = {
  match: { icon: CircleCheck, className: 'bg-status-success text-status-success-foreground' },
  mismatch: { icon: CircleX, className: 'bg-status-danger text-status-danger-foreground' },
  missing: { icon: CircleX, className: 'bg-status-danger text-status-danger-foreground' },
  unknown: { icon: CircleHelp, className: 'bg-status-warning text-status-warning-foreground' },
  'not-checked': { icon: CircleMinus, className: 'bg-status-neutral text-status-neutral-foreground' },
}

export function AmountCheckBadge({ check, label }: { check: AmountCheck; label?: string }) {
  const look = CHECK_LOOK[check]
  const Icon = look.icon
  return <span data-check={check} className={cn(PILL, look.className)}><Icon aria-hidden="true" className="size-3.5" />{label ?? AMOUNT_CHECK_TEXT[check]}</span>
}
