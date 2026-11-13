// O1 Tổng quan bước 2 (FE 9.2): revenue of today and of the last 7 days. Same source and same parameters as the report
// screen (R1): the block loads the "7 ngày qua" report through loadRevenueReport, shows its totals and today's row, and
// links to the report with exactly those parameters, so the numbers match the report by construction. ADMIN only
// (REPORT_READ); refreshed with the other blocks. See overview-revenue rules in ../revenue.ts.
import { Banknote } from 'lucide-react'
import { ApiError, serverNow } from '../../api/client.ts'
import { Button } from '../../components/ui/button.tsx'
import { cn } from '../../lib/cn.ts'
import { formatDate, formatDateTime, formatMoney } from '../../lib/format.ts'
import { Link, Loading } from '../kit.tsx'
import { vietnamDate } from '../maintenance-schedules.ts'
import { OVERVIEW_POLL_MS } from '../overview.ts'
import { LINK } from '../payment-parts.tsx'
import { REVENUE_MISSING, figuresOfDay, loadRevenueReport, overviewRevenueFilters, revenueHref, revenueKey, revenueMissing } from '../revenue.ts'
import type { RevenueFigures } from '../revenue.ts'
import { errorMessage, useApi } from '../useApi.ts'

export function OverviewRevenue({ refresh }: { refresh: number }) {
  const today = vietnamDate(serverNow())
  const week = overviewRevenueFilters(today)
  const state = useApi(signal => loadRevenueReport(week, signal), `overview-revenue|${revenueKey(week)}|${refresh}`, { pollMs: OVERVIEW_POLL_MS, stopOn: revenueMissing })
  const report = state.data && state.data.fromDate === week.from && state.data.toDate === week.to ? state.data : undefined
  const status = state.error instanceof ApiError ? state.error.status : undefined

  let body
  if (!report && state.error && revenueMissing(state.error)) body = <p role="status" className="text-[13px] text-muted-foreground">{REVENUE_MISSING}</p>
  else if (!report && status === 403) body = <p role="alert" className="text-[13px] text-muted-foreground">Máy chủ từ chối: tài khoản của bạn không có quyền xem doanh thu. Liên hệ quản trị viên để được cấp quyền, rồi đăng nhập lại.</p>
  else if (!report && status === 401) body = <p role="status" className="text-[13px] text-muted-foreground">Phiên đăng nhập đã hết hạn. Đang chuyển đến trang đăng nhập…</p>
  else if (!report && state.error) body = <div role="alert" className="grid justify-items-start gap-2 text-[13px] text-destructive">
    <p>Không tải được: {errorMessage(state.error)}</p>
    <Button type="button" variant="outline" size="sm" className="max-sm:h-11" onClick={state.reload}>Thử lại</Button>
  </div>
  else if (!report) body = <Loading label="Đang tải mục Doanh thu…" rows={2} />
  else body = <div className="grid gap-4 sm:grid-cols-2">
    <Period id="today" title={`Hôm nay (${formatDate(today)})`} figures={figuresOfDay(report, today)} to={revenueHref({ from: today, to: today })} linkLabel="Mở báo cáo hôm nay" />
    <Period id="week" title={`7 ngày qua (${formatDate(week.from)} – ${formatDate(week.to)})`} figures={report.totals} to={revenueHref(week)} linkLabel="Mở báo cáo 7 ngày" />
  </div>

  return <section aria-labelledby="overview-revenue" data-block="revenue" className="flex min-w-0 flex-col gap-3 rounded-xl border bg-card p-4 md:col-span-2">
    <header className="flex items-start gap-3">
      <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground"><Banknote className="size-4.5" /></span>
      <div className="min-w-0 flex-1">
        <h2 id="overview-revenue" className="text-base font-semibold">Doanh thu</h2>
        <p className="mt-0.5! text-xs text-muted-foreground">Thực thu = khách trả − tiền hoàn; tiền giảm giá cận hạn và tiền hoàn tách riêng. Cùng số liệu với màn Báo cáo doanh thu.</p>
      </div>
    </header>
    {body}
    {report && state.error && <p role="status" className="text-xs text-destructive">
      Chưa làm mới được ({errorMessage(state.error)}). Đang hiện dữ liệu lúc {formatDateTime(report.generatedAt)}.
    </p>}
  </section>
}

function Period({ id, title, figures, to, linkLabel }: { id: string; title: string; figures: RevenueFigures; to: string; linkLabel: string }) {
  return <div data-period={id} className="grid min-w-0 content-start gap-1">
    <h3 className="text-[13px] font-medium text-muted-foreground">{title}</h3>
    <p className={cn('text-2xl leading-tight font-semibold tabular-nums wrap-break-word', figures.netAmount < 0 && 'text-destructive')}>
      <span data-figure="netAmount">{formatMoney(figures.netAmount)}</span> <span className="text-xs font-normal text-muted-foreground">thực thu</span>
    </p>
    <p className="text-xs text-muted-foreground">
      <span data-figure="orderCount">{figures.orderCount.toLocaleString('vi-VN')}</span> đơn · Khách trả <span data-figure="paidAmount">{formatMoney(figures.paidAmount)}</span>
      {' '}· Tiền giảm <span data-figure="discountAmount">{formatMoney(figures.discountAmount)}</span> · Tiền hoàn <span data-figure="refundAmount">{formatMoney(figures.refundAmount)}</span>
    </p>
    <Link to={to} className={cn(LINK, 'w-fit text-[13px]')}>{linkLabel}</Link>
  </div>
}
