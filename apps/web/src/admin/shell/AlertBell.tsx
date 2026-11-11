// Alert bell of the top bar (FE 6.3): number of OPEN alerts, the newest ones in a popover, and a polite announcement
// when new alerts arrive. Polls GET /alerts (draft of BE 3.6) every 30 s, two requests per poll: the five newest open
// alerts and the count of open CRITICAL ones (red bell) while the tab is visible; its requests are
// background ones (no top progress bar). Hidden for good when the endpoint is missing (real backend before 3.6), on
// 403 or 401, so it never spams a server that cannot answer. Rendered only for accounts that hold ALERT_READ.
import { Bell } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import type { MouseEvent } from 'react'
import { markBackground } from '../../api/client.ts'
import { alertsApi } from '../../api/resources.ts'
import { Button } from '../../components/ui/button.tsx'
import { Popover, PopoverContent, PopoverTrigger } from '../../components/ui/popover.tsx'
import { StatusBadge } from '../../components/ui/status-badge.tsx'
import { Tooltip, TooltipContent, TooltipTrigger } from '../../components/ui/tooltip.tsx'
import { cn } from '../../lib/cn.ts'
import { formatDateTime } from '../../lib/format.ts'
import { documentVisibility } from '../../lib/poller.ts'
import { linkHandler } from '../../lib/router.ts'
import { createAlertBell, onAlertsChanged } from '../alert-bell.ts'
import type { AlertBell as Controller, BellData, BellSnapshot } from '../alert-bell.ts'
import { BELL_CRITICAL_QUERY, BELL_POLL_MS, BELL_QUERY, OPEN_ALERTS_PATH, alertPath, alertTypeLabel, badgeText, bellLabel, machinePath } from '../alerts.ts'
import { useSession } from '../useSession.ts'

/** Both requests of one poll; a failed count only loses the red colour, a failed list fails the poll. */
async function loadBell(signal: AbortSignal): Promise<BellData> {
  const background = markBackground(signal)
  const [latest, critical] = await Promise.allSettled([alertsApi.list(BELL_QUERY, background), alertsApi.list(BELL_CRITICAL_QUERY, background)])
  if (latest.status === 'rejected') throw latest.reason
  return { page: latest.value, criticalCount: critical.status === 'fulfilled' ? critical.value.totalElements : undefined }
}
/** Delay between clearing the live region and writing the message, so the same text is read again. */
const ANNOUNCE_DELAY_MS = 120

const LINK = 'rounded-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring'

export function AlertBell() {
  const { can } = useSession()
  const canMachines = can('MACHINE_READ')
  const [snapshot, setSnapshot] = useState<BellSnapshot>({ status: 'loading', latest: [], fresh: [], announcement: '', announcementSeq: 0 })
  const live = useRef<HTMLSpanElement>(null)
  const [open, setOpen] = useState(false)
  const controller = useRef<Controller | null>(null)
  const headingId = useId()

  useEffect(() => {
    const bell = createAlertBell({
      load: loadBell,
      intervalMs: BELL_POLL_MS, onChange: setSnapshot, visibility: documentVisibility(),
    })
    controller.current = bell
    bell.start()
    const stop = onAlertsChanged(() => bell.refresh())
    return () => { stop(); bell.dispose(); controller.current = null }
  }, [])

  // New alerts: empty the live region, then write the message, so a message equal to the previous one is read again.
  const { announcement, announcementSeq } = snapshot
  useEffect(() => {
    const region = live.current
    if (!region || !announcementSeq) return
    region.textContent = ''
    const timer = setTimeout(() => { region.textContent = announcement }, ANNOUNCE_DELAY_MS)
    return () => clearTimeout(timer)
  }, [announcement, announcementSeq])

  if (snapshot.status === 'off') return null
  const count = snapshot.openCount
  const go = (to: string) => (event: MouseEvent<HTMLAnchorElement>) => { setOpen(false); linkHandler(to)(event) }
  const label = bellLabel(count, snapshot.criticalCount)
  const critical = (snapshot.criticalCount ?? 0) > 0 || snapshot.latest.some(alert => alert.severity === 'CRITICAL')

  return <>
    {/* Polite: a new alert must not interrupt what the user is reading or typing. */}
    <span ref={live} className="sr-only" role="status" aria-live="polite" aria-atomic="true" />
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="icon-sm" className="relative" aria-label={label} data-open-count={count ?? ''}>
              <Bell className={cn(critical && 'text-destructive')} />
              {!!count && <span aria-hidden="true" className="absolute -top-1 -right-1 grid h-4.5 min-w-4.5 place-items-center rounded-full bg-destructive px-1 text-[11px] leading-none font-semibold text-destructive-foreground tabular-nums">{badgeText(count)}</span>}
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
      <PopoverContent aria-labelledby={headingId} className="w-96">
        <header className="flex items-baseline justify-between gap-3 border-b px-4 py-3">
          <h2 id={headingId} className="text-sm font-semibold">Cảnh báo đang mở</h2>
          {count !== undefined && <span className="text-xs text-muted-foreground">{count} cảnh báo</span>}
        </header>
        <div className="max-h-[min(60vh,420px)] overflow-y-auto px-4 py-3 text-[13px]">
          {snapshot.status === 'error' && <p className="mb-2! text-destructive" role="alert">
            Không tải được cảnh báo{count === undefined ? '' : ' (đang hiện lần tải trước)'}. Hệ thống tự thử lại sau {BELL_POLL_MS / 1000} giây.{' '}
            <Button type="button" variant="link" className="h-auto p-0 text-[13px]" onClick={() => controller.current?.refresh()}>Thử lại ngay</Button>
          </p>}
          {snapshot.status === 'loading' && count === undefined && <p className="text-muted-foreground">Đang tải cảnh báo…</p>}
          {count === 0 && <p className="text-muted-foreground">Không có cảnh báo nào đang mở. Mọi máy đang bình thường hoặc cảnh báo đã có người tiếp nhận.</p>}
          {snapshot.latest.length > 0 && <ul className="grid gap-2" aria-label="Cảnh báo mới nhất">
            {snapshot.latest.map(alert => {
              const isNew = snapshot.fresh.includes(alert.id)
              const machine = machinePath(alert.machineId)
              return <li key={alert.id} className={cn('grid gap-1 rounded-md border px-3 py-2', isNew && 'border-primary/50 bg-primary/5')}>
                <span className="flex flex-wrap items-center gap-1.5">
                  <StatusBadge domain="alertSeverity" value={alert.severity} />
                  {isNew && <span className="rounded-full bg-primary px-1.5 text-[11px] font-semibold text-primary-foreground">Mới</span>}
                </span>
                <a href={alertPath(alert.id)} onClick={go(alertPath(alert.id))} className={cn(LINK, 'text-foreground')}>{alertTypeLabel(alert.type)}: {alert.title}</a>
                <span className="text-xs text-muted-foreground">
                  {canMachines && machine ? <a href={machine} onClick={go(machine)} className={LINK} aria-label={`Máy ${alert.machineCode}, mở chi tiết máy`}>Máy {alert.machineCode}</a> : <>Máy {alert.machineCode}</>}
                  {' · '}{formatDateTime(alert.triggeredAt)}
                </span>
              </li>
            })}
          </ul>}
        </div>
        <footer className="border-t px-4 py-2.5 text-[13px]">
          <a href={OPEN_ALERTS_PATH} onClick={go(OPEN_ALERTS_PATH)} className={LINK}>
            {count && count > snapshot.latest.length ? `Xem tất cả ${count} cảnh báo đang mở` : 'Mở danh sách cảnh báo'}
          </a>
        </footer>
      </PopoverContent>
    </Popover>
  </>
}
