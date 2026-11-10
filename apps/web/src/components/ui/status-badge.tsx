import {
  Ban, CalendarX, CircleAlert, CircleCheck, CircleDashed, CircleHelp, CirclePause, CircleX, Clock, Hourglass,
  Info, Lock, PackageCheck, PackageX, Radio, RotateCcw, Send, Truck, TriangleAlert, UserCheck, Wifi, WifiOff, Wrench,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '../../lib/cn.ts'
import { statusMeta } from '../../lib/status.ts'
import type { StatusDomain, StatusIcon, StatusTone } from '../../lib/status.ts'

const ICONS: Record<StatusIcon, LucideIcon> = {
  active: CircleCheck, alert: TriangleAlert, ban: Ban, boxOk: PackageCheck, boxBad: PackageX, critical: CircleAlert,
  dashed: CircleDashed, dispensing: Truck, expired: CalendarX, failed: CircleX, help: CircleHelp, hourglass: Hourglass,
  info: Info, lock: Lock, offline: WifiOff, online: Wifi, pause: CirclePause, pending: Clock, received: UserCheck,
  refund: RotateCcw, sent: Send, signal: Radio, wrench: Wrench,
}

const TONES: Record<StatusTone, string> = {
  success: 'bg-status-success text-status-success-foreground',
  warning: 'bg-status-warning text-status-warning-foreground',
  danger: 'bg-status-danger text-status-danger-foreground',
  info: 'bg-status-info text-status-info-foreground',
  neutral: 'bg-status-neutral text-status-neutral-foreground',
}

interface StatusBadgeProps {
  domain: StatusDomain
  value: string | null | undefined
  /** Show the explanation as visible text; use it where there is room, such as detail pages. */
  explain?: boolean
  className?: string
}

/**
 * Status pill for one backend vocabulary. Meaning never relies on colour alone: every value has its own label and icon.
 * In compact mode the explanation is a mouse tooltip and hidden text for screen readers, so tables gain no tab stops.
 */
export function StatusBadge({ domain, value, explain = false, className }: StatusBadgeProps) {
  if (!value) return <>—</>
  const meta = statusMeta(domain, value)
  const Icon = ICONS[meta.icon]
  const badge = <span
    data-status={value}
    title={explain ? undefined : meta.description}
    className={cn('inline-flex w-fit items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap', TONES[meta.tone], !explain && className)}
  >
    <Icon aria-hidden="true" className="size-3.5 shrink-0" />
    {meta.label}
    {!explain && <span className="sr-only">. {meta.description}</span>}
  </span>
  if (!explain) return badge
  return <span className={cn('inline-flex flex-col items-start gap-1', className)}>
    {badge}
    <span className="text-xs text-muted-foreground">{meta.description}</span>
  </span>
}
