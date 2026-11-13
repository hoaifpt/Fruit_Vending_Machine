// R1 Báo cáo doanh thu (FE 9.1): revenue of a range of Vietnam days, for all products or one, per day or per hour of
// the day. Filters live in the URL. Totals, chart, tables and the CSV file all come from one response of
// GET /reports/revenue (draft revenue-reports.yaml, mock until BE 6.1), so the file always says what the screen says.
// Discount (near-expiry, FE 7.5) and refunds are separate figures. PDF: the browser's print dialog ("Lưu dưới dạng PDF"),
// with the admin chrome and the filters hidden by print styles. Rules: ../revenue.ts.
import { useId } from 'react'
import { Download, Printer, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { ApiError, serverNow } from '../../api/client.ts'
import { productsApi } from '../../api/resources.ts'
import { Button } from '../../components/ui/button.tsx'
import { DataTable } from '../../components/ui/data-table.tsx'
import type { DataTableColumn } from '../../components/ui/data-table.tsx'
import { FilterBar } from '../../components/ui/filter-bar.tsx'
import { FormField } from '../../components/ui/form-field.tsx'
import { Input, NativeSelect } from '../../components/ui/input.tsx'
import { cn } from '../../lib/cn.ts'
import { formatDateTime, formatMoney } from '../../lib/format.ts'
import { useQueryParams } from '../../lib/router.ts'
import { vietnamDate } from '../maintenance-schedules.ts'
import { ErrorState, Loading, Notice, PageHead } from '../kit.tsx'
import { HINT, PANEL } from '../payment-parts.tsx'
import {
  FIGURES, FILTER_LABELS, GROUP_LABELS, PRESETS, REVENUE_MISSING, bucketKey, bucketLabel, bucketShortLabel, chartScale, compactMoney, consistencyIssues,
  csvFileName, figureText, hasActivity, labelEvery, loadRevenueReport, presetOf, productNotFound, presetRange, readRevenueFilters, revenueCsv, revenueKey, revenueMissing, scopeText, validateRange,
} from '../revenue.ts'
import type { FigureKey, ProductRevenue, RevenueBucket, RevenueFigures, RevenueFilters, RevenueReport } from '../revenue.ts'
import { useApi } from '../useApi.ts'
import { useSession } from '../useSession.ts'

/** Tiles in reading order: what the business keeps first, then how it is made up. */
const TILE_ORDER: FigureKey[] = ['netAmount', 'paidAmount', 'discountAmount', 'refundAmount', 'grossAmount', 'orderCount', 'quantity', 'refundCount']
/** Detail columns hidden at tablet width (still in the tiles, the phone cards and the CSV). */
const SECONDARY: FigureKey[] = ['grossAmount', 'quantity', 'refundCount']

/** The response answers exactly these filters (while new filters load, the previous report is not shown as theirs). */
function answers(report: RevenueReport | undefined, filters: RevenueFilters): report is RevenueReport {
  return !!report && report.fromDate === filters.from && report.toDate === filters.to && (report.productId ?? '') === filters.productId && report.groupBy === filters.groupBy
}

function download(text: string, name: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1_000)
}

function figureColumns<T extends RevenueFigures>(): DataTableColumn<T>[] {
  return FIGURES.map(figure => ({
    head: figure.label, nowrap: true, secondary: SECONDARY.includes(figure.key),
    cell: (row: T) => <span className={cn('tabular-nums', figure.key === 'netAmount' && 'font-semibold', figure.key === 'netAmount' && row.netAmount < 0 && 'text-destructive')} data-figure={figure.key}>{figureText(figure, row[figure.key])}</span>,
  }))
}

function RevenueReportPage() {
  const { params, update } = useQueryParams()
  const { can } = useSession()
  const today = vietnamDate(serverNow())
  const { filters, ignored } = readRevenueFilters(params, today)
  const rangeErrors = validateRange(filters.from, filters.to)
  const valid = Object.keys(rangeErrors).length === 0
  const state = useApi(signal => valid ? loadRevenueReport(filters, signal) : Promise.resolve(undefined), `revenue|${revenueKey(filters)}|${valid}`)
  const canProducts = can('PRODUCT_READ')
  const products = useApi(signal => canProducts ? productsApi.list({ page: 0, size: 100, sort: 'name,asc' }, signal) : Promise.resolve(undefined), `revenue-products|${canProducts}`)
  const report = valid && answers(state.data, filters) ? state.data : undefined
  const productList = products.data?.content ?? []
  const product = filters.productId
    ? productList.find(candidate => candidate.id === filters.productId) ?? report?.byProduct.find(row => row.productId === filters.productId)
    : undefined
  const productName = product ? ('name' in product ? product.name : product.productName) : filters.productId ? 'Sản phẩm đang lọc' : undefined
  const productSku = product?.sku

  // 400 from the server: its field errors go next to the matching filter.
  const serverFields = state.error instanceof ApiError && state.error.status === 400 ? state.error.fieldErrors : {}
  const fieldError = (name: 'from' | 'to' | 'productId' | 'group') => rangeErrors[name as 'from' | 'to']
    ?? serverFields[{ from: 'fromDate', to: 'toDate', productId: 'productId', group: 'groupBy' }[name]]

  const preset = presetOf(filters, today)
  const defaults = presetRange('7d', today)
  const activeCount = (preset === '7d' ? 0 : 1) + (filters.productId ? 1 : 0) + (filters.groupBy === 'HOUR_OF_DAY' ? 1 : 0)
  const clear = () => update({ from: undefined, to: undefined, productId: undefined, group: undefined })

  function exportCsv() {
    if (!report) return
    const name = csvFileName(report, productSku)
    download(revenueCsv(report, filters.productId ? productName : undefined), name)
    toast.success('Đã tạo file CSV', { description: `${name}: cùng số liệu đang hiển thị.` })
  }

  const issues = report ? consistencyIssues(report) : []
  const failed = !report && state.error && !state.loading
  return <>
    <PageHead title="Báo cáo doanh thu"
      subtitle="Doanh thu theo khoảng ngày (giờ Việt Nam), tách riêng tiền giảm giá cận hạn và tiền hoàn. Số trên màn, biểu đồ và file CSV dùng cùng một bộ số liệu."
      actions={<div className="flex flex-wrap items-center gap-1.5 print:hidden">
        <Button type="button" variant="outline" onClick={state.reload} disabled={!valid || state.loading} className="max-sm:h-11">
          <RefreshCw aria-hidden="true" className={cn(state.loading && valid && 'motion-safe:animate-spin')} />Làm mới
        </Button>
        <Button type="button" variant="outline" onClick={exportCsv} disabled={!report} className="max-sm:h-11"><Download aria-hidden="true" />Xuất CSV</Button>
        <Button type="button" variant="outline" onClick={() => window.print()} disabled={!report} className="max-sm:h-11"><Printer aria-hidden="true" />In / Lưu PDF</Button>
      </div>} />

    <div className="print:hidden">
      <div role="group" aria-label="Khoảng ngày nhanh" className="mb-3 flex flex-wrap gap-1.5">
        {PRESETS.map(({ key, label }) => <Button key={key} type="button" size="sm" variant={preset === key ? 'default' : 'outline'} aria-pressed={preset === key} className="max-sm:h-11"
          onClick={() => { const range = presetRange(key, today); update({ from: range.from === defaults.from && range.to === defaults.to ? undefined : range.from, to: range.from === defaults.from && range.to === defaults.to ? undefined : range.to }) }}>
          {label}
        </Button>)}
      </div>
      <FilterBar activeCount={activeCount} onClear={clear}>
        <FormField label="Từ ngày" error={fieldError('from')}>
          <Input type="date" value={filters.from} max={filters.to} onChange={event => update({ from: event.target.value || undefined })} />
        </FormField>
        <FormField label="Đến ngày" error={fieldError('to')}>
          <Input type="date" value={filters.to} min={filters.from} onChange={event => update({ to: event.target.value || undefined })} />
        </FormField>
        <FormField label="Sản phẩm" error={fieldError('productId')} hint={!canProducts ? 'Không có quyền xem danh sách sản phẩm.' : products.error ? 'Không tải được danh sách sản phẩm.' : undefined}>
          <NativeSelect value={filters.productId} onChange={event => update({ productId: event.target.value || undefined })}>
            <option value="">Tất cả sản phẩm</option>
            {filters.productId && !productList.some(candidate => candidate.id === filters.productId) && <option value={filters.productId}>{productName}</option>}
            {productList.map(candidate => <option key={candidate.id} value={candidate.id}>{candidate.name} ({candidate.sku}){candidate.status === 'INACTIVE' ? ' · ngừng bán' : ''}</option>)}
          </NativeSelect>
        </FormField>
        <FormField label="Nhóm theo" error={fieldError('group')}>
          <NativeSelect value={filters.groupBy === 'HOUR_OF_DAY' ? 'hour' : 'day'} onChange={event => update({ group: event.target.value === 'hour' ? 'hour' : undefined })}>
            <option value="day">{GROUP_LABELS.DAY}</option>
            <option value="hour">{GROUP_LABELS.HOUR_OF_DAY}</option>
          </NativeSelect>
        </FormField>
      </FilterBar>
      {ignored.length > 0 && <Notice>Đã bỏ qua giá trị không hợp lệ trên địa chỉ trang: {ignored.map(name => FILTER_LABELS[name] ?? name).join(', ')}. Đang dùng giá trị mặc định.</Notice>}
    </div>

    {!valid
      ? <Notice tone="error">Khoảng ngày chưa hợp lệ: {Object.values(rangeErrors).join(' ')} Sửa ngày ở bộ lọc phía trên để xem báo cáo.</Notice>
      : failed && revenueMissing(state.error, !!filters.productId)
        ? <Notice>{REVENUE_MISSING}</Notice>
        : failed && productNotFound(state.error, !!filters.productId)
          ? <div role="alert" className="grid justify-items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-3.5 py-2.5 text-[13px]">
            <p>Không lấy được báo cáo cho sản phẩm đang lọc: máy chủ không tìm thấy sản phẩm này (mã trên địa chỉ trang có thể đã sai), hoặc chưa có API báo cáo.</p>
            <Button type="button" variant="outline" size="sm" className="max-sm:h-11" onClick={() => update({ productId: undefined })}>Xem tất cả sản phẩm</Button>
          </div>
        : failed && state.error instanceof ApiError && state.error.status === 400
          ? <Notice tone="error">Máy chủ không nhận bộ lọc này: {state.error.message}. Sửa bộ lọc được đánh dấu phía trên.</Notice>
          : failed
            ? <ErrorState error={state.error} retry={state.reload} />
            : !report
              ? <Loading label="Đang tải báo cáo doanh thu…" rows={5} />
              : <ReportBody report={report} productName={filters.productId ? productName : undefined} issues={issues} loading={state.loading}
                  refreshError={state.error} onWiden={() => update(presetRange('30d', today))} onAllProducts={filters.productId ? () => update({ productId: undefined }) : undefined} />}
  </>
}

function ReportBody({ report, productName, issues, loading, refreshError, onWiden, onAllProducts }: {
  report: RevenueReport; productName: string | undefined; issues: string[]; loading: boolean; refreshError: unknown
  onWiden: () => void; onAllProducts?: () => void
}) {
  const bucketHead = report.groupBy === 'DAY' ? 'Ngày' : 'Giờ'
  const bucketColumns: DataTableColumn<RevenueBucket>[] = [{ head: bucketHead, nowrap: true, cell: row => <span data-bucket={bucketKey(row)}>{bucketLabel(row)}</span> }, ...figureColumns<RevenueBucket>()]
  const productColumns: DataTableColumn<ProductRevenue>[] = [
    { head: 'Sản phẩm', cell: row => <span data-product={row.productId}>{row.productName} <span className="font-mono text-xs text-muted-foreground">{row.sku}</span></span> },
    ...figureColumns<ProductRevenue>(),
  ]
  return <div className="grid gap-5" aria-busy={loading}>
    <p className="text-[13px] text-muted-foreground" data-scope>
      {scopeText(report, productName)} · Lập lúc {formatDateTime(report.generatedAt)} (giờ Việt Nam)
    </p>
    {refreshError instanceof Error && <p role="status" className="text-xs text-destructive print:hidden">Chưa làm mới được: {refreshError.message}. Đang hiện số liệu lúc {formatDateTime(report.generatedAt)}.</p>}
    {issues.length > 0 && <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 px-3.5 py-2.5 text-[13px] text-destructive">
      <p className="font-medium">Số liệu máy chủ trả về không khớp nhau. Đừng dùng báo cáo này để đối soát; báo cho đội phát triển kèm khoảng ngày đang xem.</p>
      <ul className="mt-1 list-disc pl-5">{issues.slice(0, 5).map(issue => <li key={issue}>{issue}</li>)}</ul>
    </div>}

    <section aria-labelledby="revenue-totals" className="min-w-0">
      <h2 id="revenue-totals" className="sr-only">Tổng của khoảng đã chọn</h2>
      <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {TILE_ORDER.map(key => {
          const figure = FIGURES.find(candidate => candidate.key === key)!
          const main = key === 'netAmount'
          return <div key={key} className={cn('min-w-0 rounded-xl border bg-card p-3.5', main && 'border-primary/40')}>
            <dt className="text-[13px] font-medium text-muted-foreground">{figure.label}</dt>
            <dd data-total={key} className={cn('mt-1 text-xl font-semibold tabular-nums wrap-break-word', main && report.totals.netAmount < 0 && 'text-destructive')}>{figureText(figure, report.totals[key])}</dd>
            <dd className="mt-0.5 text-xs text-muted-foreground">{figure.hint}</dd>
          </div>
        })}
      </dl>
    </section>

    {!hasActivity(report.totals)
      ? <div className={cn(PANEL, 'grid justify-items-start gap-3')} role="status">
        <p>Không có đơn nào được thanh toán hay hoàn tiền {productName ? `cho sản phẩm ${productName} ` : ''}trong khoảng này.</p>
        <div className="flex flex-wrap gap-2 print:hidden">
          <Button type="button" variant="outline" size="sm" className="max-sm:h-11" onClick={onWiden}>Xem 30 ngày qua</Button>
          {onAllProducts && <Button type="button" variant="outline" size="sm" className="max-sm:h-11" onClick={onAllProducts}>Xem tất cả sản phẩm</Button>}
        </div>
      </div>
      : <>
        <RevenueChart report={report} />
        <section aria-labelledby="revenue-buckets" className="min-w-0">
          <h2 id="revenue-buckets" className="mb-2! text-base font-semibold">Bảng số liệu {GROUP_LABELS[report.groupBy].toLowerCase()}</h2>
          <p className={HINT}>{report.groupBy === 'DAY' ? 'Mỗi dòng một ngày; đơn tính vào ngày thanh toán, tiền hoàn tính vào ngày hoàn.' : 'Mỗi dòng một khung giờ, cộng dồn mọi ngày trong khoảng: cho biết khách mua nhiều vào giờ nào.'}</p>
          <DataTable columns={bucketColumns} rows={report.buckets} rowKey={bucketKey} loading={loading} caption={`Doanh thu ${GROUP_LABELS[report.groupBy].toLowerCase()}`} />
        </section>
        <section aria-labelledby="revenue-products" className="min-w-0">
          <h2 id="revenue-products" className="mb-2! text-base font-semibold">Theo sản phẩm</h2>
          <p className={HINT}>Sản phẩm có bán hoặc hoàn tiền trong khoảng, thực thu cao nhất trước. Một đơn có nhiều sản phẩm được đếm ở mỗi sản phẩm.</p>
          <DataTable columns={productColumns} rows={report.byProduct} rowKey={row => row.productId} loading={loading} caption="Doanh thu theo sản phẩm" empty="Không có sản phẩm nào có doanh thu." />
        </section>
      </>}

    <section aria-labelledby="revenue-rules" className="text-[13px] text-muted-foreground">
      <h2 id="revenue-rules" className="mb-1! text-sm font-semibold text-foreground">Cách tính</h2>
      <ul className="grid list-disc gap-0.5 pl-5">
        <li>Chỉ tính đơn đã thanh toán (đang nhả hàng, đã xong, nhả hàng lỗi hoặc đã hoàn tiền), vào thời điểm thanh toán. Đơn hủy, hết hạn hay thanh toán lỗi không tính.</li>
        <li>Giá gốc − Tiền giảm (giảm giá cận hạn) = Khách trả. Khách trả − Tiền hoàn = Thực thu.</li>
        <li>Tiền hoàn tính vào lúc hoàn tiền, nên có thể rơi vào ngày khác với ngày bán.</li>
        <li>File CSV chứa đúng các số trên màn, số tiền ghi bằng đồng (VND) không dấu phân cách.</li>
      </ul>
    </section>
  </div>
}

/** Bar chart of Thực thu per day / hour. Decorative copy of the table above it for sighted users (the table is the data). */
function RevenueChart({ report }: { report: RevenueReport }) {
  const titleId = useId()
  const values = report.buckets.map(bucket => bucket.netAmount)
  const scale = chartScale(values)
  const count = Math.max(values.length, 1)
  const width = count * 10, height = 100
  const y = (value: number) => height - ((value - scale.min) / (scale.max - scale.min)) * height
  const every = labelEvery(count, 8)
  const best = report.buckets.reduce<RevenueBucket | undefined>((top, bucket) => !top || bucket.netAmount > top.netAmount ? bucket : top, undefined)
  const summary = `Biểu đồ cột thực thu ${GROUP_LABELS[report.groupBy].toLowerCase()}, ${report.buckets.length} cột${best && best.netAmount > 0 ? `; cao nhất ${bucketLabel(best)}: ${formatMoney(best.netAmount)}` : ''}. Số liệu chi tiết ở bảng bên dưới.`
  return <figure aria-labelledby={titleId} className={cn(PANEL, 'mb-0 break-inside-avoid')}>
    <figcaption id={titleId} className="mb-3 text-base font-semibold">Thực thu {GROUP_LABELS[report.groupBy].toLowerCase()}</figcaption>
    <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2">
      <div className="relative h-48 w-14 text-right text-[11px] text-muted-foreground tabular-nums" aria-hidden="true">
        {scale.ticks.map(tick => <span key={tick} className="absolute right-0 -translate-y-1/2 whitespace-nowrap" style={{ top: `${(y(tick) / height) * 100}%` }}>{compactMoney(tick)}</span>)}
      </div>
      <svg role="img" aria-label={summary} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="h-48 w-full overflow-visible">
        {scale.ticks.map(tick => <line key={tick} x1={0} x2={width} y1={y(tick)} y2={y(tick)} vectorEffect="non-scaling-stroke" strokeWidth={1}
          className={tick === 0 ? 'stroke-muted-foreground' : 'stroke-border'} />)}
        {report.buckets.map((bucket, index) => {
          const value = bucket.netAmount
          const top = y(Math.max(value, 0)), bottom = y(Math.min(value, 0))
          return <rect key={bucketKey(bucket)} x={index * 10 + 1.5} width={7} y={top} height={Math.max(bottom - top, 0)} className={value < 0 ? 'fill-destructive' : 'fill-primary'}>
            <title>{bucketLabel(bucket)}: {formatMoney(value)}</title>
          </rect>
        })}
      </svg>
      <span />
      <div className="mt-1.5 flex text-[11px] text-muted-foreground" aria-hidden="true">
        {report.buckets.map((bucket, index) => <span key={bucketKey(bucket)} className="min-w-0 flex-1 overflow-visible text-center whitespace-nowrap">{index % every === 0 ? bucketShortLabel(bucket) : ''}</span>)}
      </div>
    </div>
    <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
      <span aria-hidden="true" className="inline-block size-2.5 rounded-sm bg-primary" />Thực thu (khách trả − tiền hoàn)
      {values.some(value => value < 0) && <><span aria-hidden="true" className="ml-3 inline-block size-2.5 rounded-sm bg-destructive" />Âm: tiền hoàn nhiều hơn tiền thu</>}
    </p>
  </figure>
}

export default RevenueReportPage
