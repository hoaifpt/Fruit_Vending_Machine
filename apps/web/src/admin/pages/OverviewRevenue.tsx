// O1 Tổng quan (FE 9.2): sales of today and of the last 7 days, and the refunds waiting, for REPORT_SALES_READ holders.
// Today and the pending refunds come with the dashboard (`today`, `refunds`: the server only sends them with that
// permission); the 7 days are GET /reports/sales/summary for the same range as the report the link opens, so the numbers
// equal the report's by construction. Same definitions as the report: a sale is a delivered order at completed_at.
import { Banknote } from 'lucide-react'
import { ApiError, serverNow } from '../../api/client.ts'
import type { DashboardOverview, SalesSummary } from '../../api/resources.ts'
import { Button } from '../../components/ui/button.tsx'
import { cn } from '../../lib/cn.ts'
import { formatDate, formatMoney } from '../../lib/format.ts'
import { Link, Loading } from '../kit.tsx'
import { vietnamDate } from '../maintenance-schedules.ts'
import { OVERVIEW_POLL_MS, REFUNDS_PATH, versusYesterday } from '../overview.ts'
import { LINK } from '../payment-parts.tsx'
import { loadWeekSummary, overviewWeek, revenueHref } from '../revenue.ts'
import { errorMessage, useApi } from '../useApi.ts'
import type { ApiState } from '../useApi.ts'
import { useSession } from '../useSession.ts'

export function OverviewRevenue({ dashboard, refresh }: { dashboard: DashboardOverview; refresh: number }) {
  const { can } = useSession()
  const today = dashboard.today?.date ?? vietnamDate(serverNow())
  const week = overviewWeek(today)
  const state = useApi(signal => loadWeekSummary(today, signal), `overview-week|${today}|${refresh}`, { pollMs: OVERVIEW_POLL_MS })
  const summary = state.data && state.data.filters?.from === week.from && state.data.filters?.to === week.to ? state.data : undefined

  return <section aria-labelledby="overview-revenue" data-block="revenue" className="flex min-w-0 flex-col gap-3 rounded-xl border bg-card p-4 md:col-span-2">
    <header className="flex items-start gap-3">
      <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground"><Banknote className="size-4.5" /></span>
      <div className="min-w-0 flex-1">
        <h2 id="overview-revenue" className="text-base font-semibold">Doanh thu</h2>
        <p className="mt-0.5! text-xs text-muted-foreground">Doanh số tính theo lúc đơn giao xong (giờ Việt Nam); tiền giảm giá và tiền hoàn tách riêng. Cùng số liệu với màn Báo cáo bán hàng.</p>
      </div>
    </header>
    <div className="grid gap-4 sm:grid-cols-3">
      <div data-period="today" className="grid min-w-0 content-start gap-1">
        <h3 className="text-[13px] font-medium text-muted-foreground">Hôm nay ({formatDate(today)})</h3>
        {dashboard.today
          ? <>
            <p className="text-2xl leading-tight font-semibold tabular-nums wrap-break-word">
              <span data-figure="netSales">{formatMoney(dashboard.today.netSales ?? 0)}</span> <span className="text-xs font-normal text-muted-foreground">doanh số</span>
            </p>
            <p className="text-xs text-muted-foreground">
              <span data-figure="ordersSold">{(dashboard.today.ordersSold ?? 0).toLocaleString('vi-VN')}</span> đơn đã giao · {versusYesterday(dashboard.today) ?? '—'}
            </p>
            <Link to={revenueHref({ from: today, to: today })} className={cn(LINK, 'w-fit text-[13px]')}>Mở báo cáo hôm nay</Link>
          </>
          : <p role="status" className="text-[13px] text-muted-foreground">Máy chủ không gửi số doanh thu cho tài khoản này (cần quyền xem báo cáo bán hàng). Liên hệ quản trị viên nếu công việc cần, rồi đăng nhập lại.</p>}
      </div>

      <div data-period="week" className="grid min-w-0 content-start gap-1">
        <h3 className="text-[13px] font-medium text-muted-foreground">7 ngày qua ({formatDate(week.from)} – {formatDate(week.to)})</h3>
        <WeekBody state={state} summary={summary} />
        <Link to={revenueHref(week)} className={cn(LINK, 'w-fit text-[13px]')}>Mở báo cáo 7 ngày</Link>
      </div>

      <div data-period="refunds" className="grid min-w-0 content-start gap-1">
        <h3 className="text-[13px] font-medium text-muted-foreground">Chờ hoàn tiền (hiện tại)</h3>
        {dashboard.refunds
          ? <>
            <p className="text-2xl leading-tight font-semibold tabular-nums wrap-break-word">
              <span data-figure="pendingAmount">{formatMoney(dashboard.refunds.pendingAmount ?? 0)}</span>
            </p>
            <p className="text-xs text-muted-foreground"><span data-figure="pendingCount">{(dashboard.refunds.pendingCount ?? 0).toLocaleString('vi-VN')}</span> khoản cần xem xét hoàn tiền</p>
            {can('REFUND_READ') && <Link to={REFUNDS_PATH} className={cn(LINK, 'w-fit text-[13px]')}>Mở màn Hoàn tiền</Link>}
          </>
          : <p className="text-[13px] text-muted-foreground">—</p>}
      </div>
    </div>
  </section>
}

function WeekBody({ state, summary }: { state: ApiState<SalesSummary>; summary: SalesSummary | undefined }) {
  const status = state.error instanceof ApiError ? state.error.status : undefined
  if (!summary) {
    if (status === 403) return <p role="alert" className="text-[13px] text-muted-foreground">Máy chủ từ chối: tài khoản của bạn không có quyền xem doanh thu. Liên hệ quản trị viên để được cấp quyền, rồi đăng nhập lại.</p>
    if (status === 401) return <p role="status" className="text-[13px] text-muted-foreground">Phiên đăng nhập đã hết hạn. Đang chuyển đến trang đăng nhập…</p>
    if (state.error) return <div role="alert" className="grid justify-items-start gap-2 text-[13px] text-destructive">
      <p>Không tải được: {errorMessage(state.error)}</p>
      <Button type="button" variant="outline" size="sm" className="max-sm:h-11" onClick={state.reload}>Thử lại</Button>
    </div>
    return <Loading label="Đang tải doanh thu 7 ngày…" rows={2} />
  }
  const netRevenue = summary.netRevenue ?? 0
  return <>
    <p className={cn('text-2xl leading-tight font-semibold tabular-nums wrap-break-word', netRevenue < 0 && 'text-destructive')}>
      <span data-figure="netRevenue">{formatMoney(netRevenue)}</span> <span className="text-xs font-normal text-muted-foreground">doanh thu thuần</span>
    </p>
    <p className="text-xs text-muted-foreground">
      <span data-figure="ordersSold">{(summary.ordersSold ?? 0).toLocaleString('vi-VN')}</span> đơn · Doanh số <span data-figure="netSales">{formatMoney(summary.netSales ?? 0)}</span>
      {' '}· Tiền giảm <span data-figure="discounts">{formatMoney(summary.discounts ?? 0)}</span> · Hoàn đơn đã giao <span data-figure="deliveredRefunds">{formatMoney(summary.deliveredRefunds ?? 0)}</span>
    </p>
    {state.error && <p role="status" className="text-xs text-destructive">Chưa làm mới được ({errorMessage(state.error)}); đang hiện số lần trước.</p>}
  </>
}
