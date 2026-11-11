// Connectivity on screen (FE 6.4): the badge "Trực tuyến" / "Mất kết nối (OFFLINE)" with when the machine was last heard
// from, and the warning shown on a machine's own screens while it is OFFLINE. Every screen that shows a machine uses these,
// so the 180 s rule (connection.ts) is the same everywhere and flips on screen without a reload (useConnection.ts).
// `source` (the screen's load state behind lastSeenAt): when its last reload failed or is overdue, OFFLINE is never
// claimed; the badge says "Chưa rõ" and since when the data could not be updated.
import { CircleHelp, WifiOff } from 'lucide-react'
import { StatusBadge } from '../components/ui/status-badge.tsx'
import { cn } from '../lib/cn.ts'
import { NEVER_HELP, OFFLINE_HELP, connectionDetail, unknownDetail } from './connection.ts'
import type { ConnectionSource } from './connection.ts'
import { useConnection } from './useConnection.ts'

interface Props { lastSeenAt: string | null | undefined; source?: ConnectionSource; className?: string }

/**
 * Badge plus "Tín hiệu lần cuối …" / "Mất tín hiệu từ … (hơn 3 phút)" / "Chưa từng kết nối" / "Chưa rõ – …".
 * `detail={false}` keeps the badge alone, for tight places such as buttons (no hidden explanation there, so the
 * button's name stays short).
 */
export function ConnectionStatus({ lastSeenAt, source, detail = true, className }: Props & { detail?: boolean }) {
  const connection = useConnection(lastSeenAt, source)
  const unknown = connection.shown === 'UNKNOWN'
  return <span className={cn('grid justify-items-start gap-1 text-left', className)} data-connection={connection.shown} data-last-seen={lastSeenAt ?? ''}>
    {unknown
      ? <span className="inline-flex w-fit items-center gap-1 rounded-full bg-status-neutral px-2 py-0.5 text-xs font-medium whitespace-nowrap text-status-neutral-foreground">
        <CircleHelp aria-hidden="true" className="size-3.5 shrink-0" />Chưa rõ</span>
      : <StatusBadge domain="connection" value={connection.shown} describe={false} />}
    {detail && <span className="text-xs text-muted-foreground">{unknown ? unknownDetail(connection.staleSince) : connectionDetail(connection, lastSeenAt)}</span>}
  </span>
}

/**
 * Warning while the machine is OFFLINE (nothing when online or unknown). The polite live region stays mounted, so the
 * moment a machine drops is read out once by screen readers.
 */
export function OfflineNotice({ lastSeenAt, source, className }: Props) {
  const connection = useConnection(lastSeenAt, source)
  const offline = connection.shown === 'OFFLINE'
  return <div aria-live="polite" className={cn(offline && 'mb-4', className)}>
    {offline && <p className="flex gap-2.5 rounded-lg border border-destructive/30 bg-destructive/8 px-3.5 py-2.5 text-[13px] text-destructive">
      <WifiOff aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <span>
        <strong className="font-semibold">{connection.never ? 'Máy chưa từng kết nối.' : `Máy mất kết nối (OFFLINE): ${connectionDetail(connection, lastSeenAt).toLowerCase()}.`}</strong>{' '}
        {connection.never ? NEVER_HELP : OFFLINE_HELP}
      </span>
    </p>}
  </div>
}
