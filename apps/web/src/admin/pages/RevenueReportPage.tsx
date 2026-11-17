// R1 Báo cáo doanh thu (FE 9.1) on the sales report API of backend #76 (docs/reports.md): a range of Vietnam days, one
// machine or all, one product or all. Filters live in the URL. Totals, the time series (day / ISO week / month), peak
// hours, products and machines are the five GET /reports/sales/* answers for the same filters; "Xuất CSV" / "Xuất PDF"
// download GET /reports/sales/export with those filters (REPORT_EXPORT), a file the server renders from the same query.
// A sale is a delivered order counted at completed_at; refunds count at refunded_at. Rules: ../revenue.ts.
import { useId, useState } from 'react'
import { Download, FileText, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { serverNow } from '../../api/client.ts'
import { machinesApi, productsApi, salesReportsApi } from '../../api/resources.ts'
import type { MachineSales, ProductSales, SalesBucket, SalesExportFormat } from '../../api/resources.ts'
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
  EXPORT_HINT, FIGURES, FILTER_LABELS, GRANULARITIES, GRANULARITY_LABELS, PRESETS, PRODUCT_LIMIT, PRODUCT_SORT_LABELS, WEEKDAYS, bucketKey, bucketLabel, bucketShortLabel,
  busiestHours, chartScale, compactMoney, exportFileName, exportQuery, figureText, figureValue, hasActivity, heatLevel, hourLabel, hoursOfDay, labelEvery,
  loadSalesReport, matrixMax, presetOf, presetRange, readRevenueFilters, refundsByReason, reportRejected, revenueKey, scopeText, shareText, validateRange,
} from '../revenue.ts'
import type { RevenueFilters, SalesReport } from '../revenue.ts'
import { errorMessage, useApi } from '../useApi.ts'
import { useSession } from '../useSession.ts'

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1_000)
}

const money = (value: number | undefined) => formatMoney(value ?? 0)
const count = (value: number | undefined) => (value ?? 0).toLocaleString('vi-VN')

function RevenueReportPage() {
  const { params, update } = useQueryParams()
  const { can } = useSession()
  const today = vietnamDate(serverNow())
  const { filters, ignored } = readRevenueFilters(params, today)
  const rangeErrors = validateRange(filters.from, filters.to)
  const valid = Object.keys(rangeErrors).length === 0
  const key = revenueKey(filters)
  const state = useApi(signal => valid ? loadSalesReport(filters, signal) : Promise.resolve(undefined), `revenue|${key}|${valid}`)
  const canProducts = can('PRODUCT_READ'), canMachines = can('MACHINE_READ'), canExport = can('REPORT_EXPORT')
  const products = useApi(signal => canProducts ? productsApi.list({ page: 0, size: 100, sort: 'name,asc' }, signal) : Promise.resolve(undefined), `revenue-products|${canProducts}`)
  const machines = useApi(signal => canMachines ? machinesApi.list({ page: 0, size: 100, sort: 'code,asc' }, signal) : Promise.resolve(undefined), `revenue-machines|${canMachines}`)
  const report = valid && state.data?.key === key ? state.data : undefined
  const productList = products.data?.content ?? []
  const machineList = machines.data?.content ?? []
  const product = filters.productId ? productList.find(candidate => candidate.id === filters.productId) : undefined
  const machine = filters.machineId ? machineList.find(candidate => candidate.id === filters.machineId) : undefined
  const productName = filters.productId ? product?.name ?? report?.products.products?.find(row => row.productId === filters.productId)?.name ?? 'Sản phẩm đang lọc' : undefined
  const machineName = filters.machineId ? (machine ? `${machine.code} · ${machine.name}` : report?.machines.machines?.find(row => row.machineId === filters.machineId)?.code ?? 'Máy đang lọc') : undefined
  const [exporting, setExporting] = useState<SalesExportFormat | null>(null)

  // 400 from the server: its field errors go next to the matching filter.
  const rejected = !report && reportRejected(state.error) ? state.error : undefined
  const serverFields = rejected?.fieldErrors ?? {}
  const fieldError = (name: 'from' | 'to' | 'machineId' | 'productId') => (name === 'from' || name === 'to' ? rangeErrors[name] : undefined) ?? serverFields[name]

  const preset = presetOf(filters, today)
  const defaults = presetRange('7d', today)
  const activeCount = (preset === '7d' ? 0 : 1) + (filters.machineId ? 1 : 0) + (filters.productId ? 1 : 0) + (filters.granularity !== 'DAY' ? 1 : 0)
  const clear = () => update({ from: undefined, to: undefined, machineId: undefined, productId: undefined, granularity: undefined, productSort: undefined })
  const setRange = (range: { from: string; to: string }) => {
    const isDefault = range.from === defaults.from && range.to === defaults.to
    update({ from: isDefault ? undefined : range.from, to: isDefault ? undefined : range.to })
  }

  async function exportFile(format: SalesExportFormat) {
    if (!report || exporting) return
    setExporting(format)
    try {
      const file = await salesReportsApi.export(exportQuery(filters, format))
      const name = exportFileName(filters, format, file.fileName)
      download(file.blob, name)
      toast.success(`Đã tải file ${format}`, { description: `${name}: máy chủ tạo từ đúng bộ lọc đang xem.` })
    } catch (error) {
      toast.error(`Không xuất được file ${format}`, { description: errorMessage(error) })
    } finally { setExporting(null) }
  }

  const failed = !report && state.error && !state.loading
  return <>
    <PageHead title="Báo cáo doanh thu"
      subtitle="Doanh số theo khoảng ngày (giờ Việt Nam), theo máy và sản phẩm; tiền giảm giá cận hạn và tiền hoàn tách riêng. Số liệu do máy chủ tính; file CSV/PDF dùng cùng bộ lọc."
      actions={<div className="flex flex-wrap items-center gap-1.5">
        <Button type="button" variant="outline" onClick={state.reload} disabled={!valid || state.loading} className="max-sm:h-11">
          <RefreshCw aria-hidden="true" className={cn(state.loading && valid && 'motion-safe:animate-spin')} />Làm mới
        </Button>
        {canExport && <>
          <Button type="button" variant="outline" onClick={() => exportFile('CSV')} disabled={!report || !!exporting} aria-describedby="revenue-export-hint" className="max-sm:h-11">
            <Download aria-hidden="true" className={cn(exporting === 'CSV' && 'motion-safe:animate-pulse')} />{exporting === 'CSV' ? 'Đang xuất CSV…' : 'Xuất CSV'}
          </Button>
          <Button type="button" variant="outline" onClick={() => exportFile('PDF')} disabled={!report || !!exporting} aria-describedby="revenue-export-hint" className="max-sm:h-11">
            <FileText aria-hidden="true" className={cn(exporting === 'PDF' && 'motion-safe:animate-pulse')} />{exporting === 'PDF' ? 'Đang xuất PDF…' : 'Xuất PDF'}
          </Button>
          <p id="revenue-export-hint" className="basis-full text-xs text-muted-foreground">{EXPORT_HINT}</p>
        </>}
      </div>} />

    <div role="group" aria-label="Khoảng ngày nhanh" className="mb-3 flex flex-wrap gap-1.5">
      {PRESETS.map(({ key: presetKey, label }) => <Button key={presetKey} type="button" size="sm" variant={preset === presetKey ? 'default' : 'outline'} aria-pressed={preset === presetKey} className="max-sm:h-11"
        onClick={() => setRange(presetRange(presetKey, today))}>{label}</Button>)}
    </div>
    <FilterBar activeCount={activeCount} onClear={clear}>
      <FormField label="Từ ngày" error={fieldError('from')}>
        <Input type="date" value={filters.from} max={filters.to} onChange={event => update({ from: event.target.value || undefined })} />
      </FormField>
      <FormField label="Đến ngày" error={fieldError('to')}>
        <Input type="date" value={filters.to} min={filters.from} onChange={event => update({ to: event.target.value || undefined })} />
      </FormField>
      <FormField label="Máy" error={fieldError('machineId')} hint={!canMachines ? 'Không có quyền xem danh sách máy.' : machines.error ? 'Không tải được danh sách máy.' : undefined}>
        <NativeSelect value={filters.machineId} onChange={event => update({ machineId: event.target.value || undefined })}>
          <option value="">Tất cả máy</option>
          {filters.machineId && !machine && <option value={filters.machineId}>{machineName}</option>}
          {machineList.map(candidate => <option key={candidate.id} value={candidate.id}>{candidate.code} · {candidate.name}{candidate.status === 'INACTIVE' ? ' · ngừng hoạt động' : ''}</option>)}
        </NativeSelect>
      </FormField>
      <FormField label="Sản phẩm" error={fieldError('productId')} hint={!canProducts ? 'Không có quyền xem danh sách sản phẩm.' : products.error ? 'Không tải được danh sách sản phẩm.' : undefined}>
        <NativeSelect value={filters.productId} onChange={event => update({ productId: event.target.value || undefined })}>
          <option value="">Tất cả sản phẩm</option>
          {filters.productId && !product && <option value={filters.productId}>{productName}</option>}
          {productList.map(candidate => <option key={candidate.id} value={candidate.id}>{candidate.name} ({candidate.sku}){candidate.status === 'INACTIVE' ? ' · ngừng bán' : ''}</option>)}
        </NativeSelect>
      </FormField>
      <FormField label="Chia theo">
        <NativeSelect value={filters.granularity} onChange={event => update({ granularity: event.target.value === 'DAY' ? undefined : event.target.value.toLowerCase() })}>
          {GRANULARITIES.map(granularity => <option key={granularity} value={granularity}>{GRANULARITY_LABELS[granularity]}</option>)}
        </NativeSelect>
      </FormField>
    </FilterBar>
    {ignored.length > 0 && <Notice>Đã bỏ qua giá trị không hợp lệ trên địa chỉ trang: {ignored.map(name => FILTER_LABELS[name] ?? name).join(', ')}. Đang dùng giá trị mặc định.</Notice>}

    {!valid
      ? <Notice tone="error">Khoảng ngày chưa hợp lệ: {Object.values(rangeErrors).join(' ')} Sửa ngày ở bộ lọc phía trên để xem báo cáo.</Notice>
      : rejected
        ? <div role="alert" className="grid justify-items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-3.5 py-2.5 text-[13px]">
          <p>Máy chủ không nhận bộ lọc này: {rejected.message}. Sửa bộ lọc được đánh dấu phía trên{filters.machineId || filters.productId ? ', hoặc bỏ lọc máy / sản phẩm (mã trên địa chỉ trang có thể đã sai)' : ''}.</p>
          <div className="flex flex-wrap gap-2">
            {filters.machineId && <Button type="button" variant="outline" size="sm" className="max-sm:h-11" onClick={() => update({ machineId: undefined })}>Xem tất cả máy</Button>}
            {filters.productId && <Button type="button" variant="outline" size="sm" className="max-sm:h-11" onClick={() => update({ productId: undefined })}>Xem tất cả sản phẩm</Button>}
          </div>
        </div>
        : failed
          ? <ErrorState error={state.error} retry={state.reload} />
          : !report
            ? <Loading label="Đang tải báo cáo doanh thu…" rows={5} />
            : <ReportBody report={report} filters={filters} machineName={machineName} productName={productName} loading={state.loading}
                onWiden={() => setRange(presetRange('30d', today))} onClearScope={filters.machineId || filters.productId ? () => update({ machineId: undefined, productId: undefined }) : undefined}
                onProductSort={sort => update({ productSort: sort === 'QUANTITY' ? 'quantity' : undefined })} />}
  </>
}

function ReportBody({ report, filters, machineName, productName, loading, onWiden, onClearScope, onProductSort }: {
  report: SalesReport; filters: RevenueFilters; machineName: string | undefined; productName: string | undefined; loading: boolean
  onWiden: () => void; onClearScope?: () => void; onProductSort: (sort: RevenueFilters['productSort']) => void
}) {
  const { summary } = report
  const granularity = report.series.granularity ?? filters.granularity
  const buckets = report.series.buckets ?? []
  const pending = summary.pendingRefunds
  const bucketColumns: DataTableColumn<SalesBucket>[] = [
    { head: granularity === 'DAY' ? 'Ngày' : granularity === 'WEEK' ? 'Tuần' : 'Tháng', nowrap: true, cell: row => <span data-bucket={bucketKey(row)}>{bucketLabel(row, granularity)}</span> },
    { head: 'Số đơn', nowrap: true, cell: row => <span className="tabular-nums" data-figure="ordersSold">{count(row.ordersSold)}</span> },
    { head: 'Doanh số gốc', nowrap: true, secondary: true, cell: row => <span className="tabular-nums" data-figure="grossSales">{money(row.grossSales)}</span> },
    { head: 'Tiền giảm', nowrap: true, secondary: true, cell: row => <span className="tabular-nums" data-figure="discounts">{money(row.discounts)}</span> },
    { head: 'Doanh số sau giảm', nowrap: true, cell: row => <span className="tabular-nums" data-figure="netSales">{money(row.netSales)}</span> },
    { head: 'Hoàn đơn đã giao', nowrap: true, cell: row => <span className="tabular-nums" data-figure="deliveredRefunds">{money(row.deliveredRefunds)}</span> },
    { head: 'Doanh thu thuần', nowrap: true, cell: row => <span className={cn('tabular-nums font-semibold', (row.netRevenue ?? 0) < 0 && 'text-destructive')} data-figure="netRevenue">{money(row.netRevenue)}</span> },
  ]
  const productColumns: DataTableColumn<ProductSales>[] = [
    { head: 'Sản phẩm', cell: row => <span data-product={row.productId}>{row.name} <span className="font-mono text-xs text-muted-foreground">{row.sku}</span>{row.status === 'INACTIVE' ? <span className="text-xs text-muted-foreground"> · ngừng bán</span> : null}</span> },
    { head: 'Số hộp', nowrap: true, cell: row => <span className="tabular-nums" data-figure="quantity">{count(row.quantity)}</span> },
    { head: 'Doanh số gốc', nowrap: true, secondary: true, cell: row => <span className="tabular-nums" data-figure="grossSales">{money(row.grossSales)}</span> },
    { head: 'Tiền giảm', nowrap: true, secondary: true, cell: row => <span className="tabular-nums" data-figure="discounts">{money(row.discounts)}</span> },
    { head: 'Doanh số sau giảm', nowrap: true, cell: row => <span className="tabular-nums font-semibold" data-figure="netSales">{money(row.netSales)}</span> },
    { head: 'Hoàn đơn đã giao', nowrap: true, cell: row => <span className="tabular-nums" data-figure="deliveredRefunds">{money(row.deliveredRefunds)}</span> },
    { head: 'Tỷ trọng', nowrap: true, cell: row => <span className="tabular-nums" data-figure="sharePercent">{shareText(row.sharePercent)}</span> },
  ]
  const machineColumns: DataTableColumn<MachineSales>[] = [
    { head: 'Máy', cell: row => <span data-machine={row.machineId}><span className="font-mono">{row.code}</span> · {row.name}</span> },
    { head: 'Số đơn', nowrap: true, cell: row => <span className="tabular-nums" data-figure="ordersSold">{count(row.ordersSold)}</span> },
    { head: 'Doanh số sau giảm', nowrap: true, cell: row => <span className="tabular-nums" data-figure="netSales">{money(row.netSales)}</span> },
    { head: 'Hoàn đơn đã giao', nowrap: true, cell: row => <span className="tabular-nums" data-figure="deliveredRefunds">{money(row.deliveredRefunds)}</span> },
    { head: 'Doanh thu thuần', nowrap: true, cell: row => <span className={cn('tabular-nums font-semibold', (row.netRevenue ?? 0) < 0 && 'text-destructive')} data-figure="netRevenue">{money(row.netRevenue)}</span> },
  ]
  const byReason = refundsByReason(summary)

  return <div className="grid gap-5" aria-busy={loading}>
    <p className="text-[13px] text-muted-foreground" data-scope>
      {scopeText(filters, machineName, productName)} · Lập lúc {formatDateTime(summary.generatedAt)} (giờ Việt Nam)
    </p>

    <section aria-labelledby="revenue-totals" className="min-w-0">
      <h2 id="revenue-totals" className="sr-only">Tổng của khoảng đã chọn</h2>
      <dl className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        {FIGURES.map(figure => {
          const value = figureValue(summary, figure.key)
          const main = figure.key === 'netRevenue'
          return <div key={figure.key} className={cn('min-w-0 rounded-xl border bg-card p-3.5', main && 'border-primary/40')}>
            <dt className="text-[13px] font-medium text-muted-foreground">{figure.label}</dt>
            <dd data-total={figure.key} className={cn('mt-1 text-xl font-semibold tabular-nums wrap-break-word', main && value < 0 && 'text-destructive')}>{figureText(figure, value)}</dd>
            <dd className="mt-0.5 text-xs text-muted-foreground">{figure.hint}</dd>
          </div>
        })}
      </dl>
      <p className="mt-3 text-[13px] text-muted-foreground" data-pending>
        Đang chờ hoàn tiền (tại thời điểm xem, không theo bộ lọc): <strong className="font-medium text-foreground tabular-nums">{count(pending?.count)}</strong> khoản,
        {' '}<strong className="font-medium text-foreground tabular-nums">{money(pending?.amount)}</strong>.
      </p>
    </section>

    {!hasActivity(summary)
      ? <div className={cn(PANEL, 'grid justify-items-start gap-3')} role="status">
        <p>Không có đơn nào được giao, thanh toán hay hoàn tiền {machineName ? `ở máy ${machineName} ` : ''}{productName ? `cho sản phẩm ${productName} ` : ''}trong khoảng này.</p>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" className="max-sm:h-11" onClick={onWiden}>Xem 30 ngày qua</Button>
          {onClearScope && <Button type="button" variant="outline" size="sm" className="max-sm:h-11" onClick={onClearScope}>Xem tất cả máy và sản phẩm</Button>}
        </div>
      </div>
      : <>
        <BarChart title={`Doanh thu thuần ${GRANULARITY_LABELS[granularity].toLowerCase()}`} legend="Doanh thu thuần (doanh số sau giảm − hoàn đơn đã giao)" negativeLegend="Âm: tiền hoàn nhiều hơn doanh số"
          bars={buckets.map(bucket => ({ key: bucketKey(bucket), label: bucketLabel(bucket, granularity), short: bucketShortLabel(bucket, granularity), value: bucket.netRevenue ?? 0 }))}
          format={formatMoney} axis={compactMoney} />
        <section aria-labelledby="revenue-buckets" className="min-w-0">
          <h2 id="revenue-buckets" className="mb-2! text-base font-semibold">Bảng số liệu {GRANULARITY_LABELS[granularity].toLowerCase()}</h2>
          <p className={HINT}>{granularity === 'WEEK' ? 'Tuần bắt đầu thứ Hai; tuần đầu và cuối được cắt theo khoảng ngày. ' : granularity === 'MONTH' ? 'Tháng dương lịch; tháng đầu và cuối được cắt theo khoảng ngày. ' : ''}Đơn tính vào ngày giao xong, tiền hoàn tính vào ngày hoàn.</p>
          <DataTable columns={bucketColumns} rows={buckets} rowKey={bucketKey} loading={loading} caption={`Doanh thu ${GRANULARITY_LABELS[granularity].toLowerCase()}`} />
        </section>
        <PeakHoursSection report={report} />
        <section aria-labelledby="revenue-products" className="min-w-0">
          <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
            <h2 id="revenue-products" className="text-base font-semibold">Theo sản phẩm</h2>
            <FormField label="Sắp xếp sản phẩm" className="w-56 max-sm:w-full">
              <NativeSelect value={filters.productSort} onChange={event => onProductSort(event.target.value === 'QUANTITY' ? 'QUANTITY' : 'NET_SALES')}>
                {(['NET_SALES', 'QUANTITY'] as const).map(sort => <option key={sort} value={sort}>{PRODUCT_SORT_LABELS[sort]}</option>)}
              </NativeSelect>
            </FormField>
          </div>
          <p className={HINT}>Sản phẩm có doanh số hoặc hoàn tiền trong khoảng (kể cả sản phẩm ngừng bán), tối đa {PRODUCT_LIMIT} dòng; file xuất có đủ mọi sản phẩm. Tỷ trọng = doanh số sau giảm của sản phẩm / tổng.</p>
          <DataTable columns={productColumns} rows={report.products.products ?? []} rowKey={row => row.productId ?? row.sku ?? ''} loading={loading} caption="Doanh thu theo sản phẩm" empty="Không có sản phẩm nào có doanh số trong khoảng này." />
        </section>
        <section aria-labelledby="revenue-machines" className="min-w-0">
          <h2 id="revenue-machines" className="mb-2! text-base font-semibold">Theo máy</h2>
          <p className={HINT}>Mọi máy (hoặc máy đang lọc), kể cả máy không bán được đơn nào.</p>
          <DataTable columns={machineColumns} rows={report.machines.machines ?? []} rowKey={row => row.machineId ?? row.code ?? ''} loading={loading} caption="Doanh thu theo máy" empty="Chưa có máy nào." />
        </section>
      </>}

    <section aria-labelledby="revenue-refunds" className="min-w-0">
      <h2 id="revenue-refunds" className="mb-2! text-base font-semibold">Tiền đã hoàn theo lý do</h2>
      <p className={HINT}>Mọi khoản hoàn có thời điểm hoàn trong khoảng. Chỉ hoàn vì chất lượng hoặc lý do khác của đơn đã giao mới trừ vào doanh thu; hoàn đơn nhả hàng lỗi, thanh toán muộn hoặc trùng chưa từng là doanh số.</p>
      <dl className="grid gap-x-6 gap-y-1 text-[13px] sm:grid-cols-2 lg:grid-cols-3">
        {byReason.map(row => <div key={row.reason} className="flex justify-between gap-3 border-b py-1" data-reason={row.reason}>
          <dt className="text-muted-foreground">{row.label}</dt><dd className="font-medium tabular-nums">{money(row.amount)}</dd>
        </div>)}
      </dl>
    </section>

    <section aria-labelledby="revenue-rules" className="text-[13px] text-muted-foreground">
      <h2 id="revenue-rules" className="mb-1! text-sm font-semibold text-foreground">Cách tính</h2>
      <ul className="grid list-disc gap-0.5 pl-5">
        <li>Doanh số chỉ gồm đơn đã giao hộp, tính vào thời điểm đơn hoàn tất (nhả hộp xong), theo giờ Việt Nam. Đơn hủy, hết hạn, thanh toán lỗi hay nhả hàng lỗi không phải doanh số.</li>
        <li>Doanh số gốc − Tiền giảm (giảm giá cận hạn) = Doanh số sau giảm. Doanh số sau giảm − Hoàn đơn đã giao = Doanh thu thuần (có thể âm khi kỳ chỉ có tiền hoàn).</li>
        <li>Tiền hoàn tính vào lúc hoàn tiền, nên có thể rơi vào kỳ sau ngày bán. Tiền đã thu tính theo lúc khách trả (góc nhìn dòng tiền), nên có thể khác doanh số.</li>
        <li>Mọi con số do máy chủ tính. File CSV và PDF do máy chủ tạo từ cùng bộ lọc: số tiền là đồng (VND), ngày dạng năm-tháng-ngày.</li>
      </ul>
    </section>
  </div>
}

interface Bar { key: string; label: string; short: string; value: number }

/** Bar chart (SVG): a decorative copy of the table next to it for sighted users (the table holds the data). */
function BarChart({ title, bars, legend, negativeLegend, format, axis, room = 8 }: {
  title: string; bars: Bar[]; legend: string; negativeLegend?: string; format: (value: number) => string; axis: (value: number) => string; room?: number
}) {
  const titleId = useId()
  const values = bars.map(bar => bar.value)
  const scale = chartScale(values)
  const total = Math.max(values.length, 1)
  const width = total * 10, height = 100
  const y = (value: number) => height - ((value - scale.min) / (scale.max - scale.min)) * height
  const every = labelEvery(total, room)
  const best = bars.reduce<Bar | undefined>((top, bar) => !top || bar.value > top.value ? bar : top, undefined)
  const summary = `Biểu đồ cột ${title.toLowerCase()}, ${bars.length} cột${best && best.value > 0 ? `; cao nhất ${best.label}: ${format(best.value)}` : ''}. Số liệu chi tiết ở bảng.`
  return <figure aria-labelledby={titleId} className={cn(PANEL, 'mb-0 break-inside-avoid')}>
    <figcaption id={titleId} className="mb-3 text-base font-semibold">{title}</figcaption>
    <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2">
      <div className="relative h-48 w-14 text-right text-[11px] text-muted-foreground tabular-nums" aria-hidden="true">
        {scale.ticks.map(tick => <span key={tick} className="absolute right-0 -translate-y-1/2 whitespace-nowrap" style={{ top: `${(y(tick) / height) * 100}%` }}>{axis(tick)}</span>)}
      </div>
      <svg role="img" aria-label={summary} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="h-48 w-full overflow-visible">
        {scale.ticks.map(tick => <line key={tick} x1={0} x2={width} y1={y(tick)} y2={y(tick)} vectorEffect="non-scaling-stroke" strokeWidth={1}
          className={tick === 0 ? 'stroke-muted-foreground' : 'stroke-border'} />)}
        {bars.map((bar, index) => {
          const top = y(Math.max(bar.value, 0)), bottom = y(Math.min(bar.value, 0))
          return <rect key={bar.key} x={index * 10 + 1.5} width={7} y={top} height={Math.max(bottom - top, 0)} className={bar.value < 0 ? 'fill-destructive' : 'fill-primary'}>
            <title>{bar.label}: {format(bar.value)}</title>
          </rect>
        })}
      </svg>
      <span />
      <div className="mt-1.5 flex text-[11px] text-muted-foreground" aria-hidden="true">
        {bars.map((bar, index) => <span key={bar.key} className="min-w-0 flex-1 overflow-visible text-center whitespace-nowrap">{index % every === 0 ? bar.short : ''}</span>)}
      </div>
    </div>
    <p className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
      <span aria-hidden="true" className="inline-block size-2.5 rounded-sm bg-primary" />{legend}
      {negativeLegend && values.some(value => value < 0) && <><span aria-hidden="true" className="ml-3 inline-block size-2.5 rounded-sm bg-destructive" />{negativeLegend}</>}
    </p>
  </figure>
}

const HEAT = ['', 'bg-primary/15', 'bg-primary/30', 'bg-primary/50', 'bg-primary text-primary-foreground']

/** Peak hours: orders per hour of the day (chart + busiest hours) and the weekday × hour matrix as a real table. */
function PeakHoursSection({ report }: { report: SalesReport }) {
  const hours = hoursOfDay(report.peak)
  const busiest = busiestHours(report.peak)
  const matrix = report.peak.weekdayHours ?? []
  const max = matrixMax(matrix)
  return <section aria-labelledby="revenue-peak" className="grid min-w-0 gap-3">
    <h2 id="revenue-peak" className="text-base font-semibold">Giờ cao điểm</h2>
    <p className={HINT}>
      Theo giờ đơn giao xong, cộng dồn mọi ngày trong khoảng.
      {busiest.length > 0 && <> Đông nhất: {busiest.map(row => `${hourLabel(row.hour)} (${count(row.ordersSold)} đơn)`).join(', ')}.</>}
    </p>
    <BarChart title="Số đơn theo giờ trong ngày" legend="Số đơn đã giao trong khung giờ" room={12}
      bars={hours.map(row => ({ key: `h${row.hour}`, label: hourLabel(row.hour), short: `${row.hour}h`, value: row.ordersSold }))}
      format={value => `${count(value)} đơn`} axis={value => count(value)} />
    <details className={cn(PANEL, 'mb-0')}>
      <summary className="cursor-pointer text-sm font-medium">Bảng theo thứ trong tuần và giờ</summary>
      <div className="mt-3 overflow-x-auto" tabIndex={0} role="region" aria-label="Bảng số đơn theo thứ và giờ, cuộn ngang">
        <table className="w-max border-collapse text-[11px] tabular-nums">
          <caption className="sr-only">Số đơn đã giao theo thứ (thứ Hai trước) và giờ trong ngày</caption>
          <thead><tr><th scope="col" className="px-1 py-0.5 text-left font-medium">Thứ</th>
            {Array.from({ length: 24 }, (_, hour) => <th key={hour} scope="col" className="w-7 px-0.5 py-0.5 text-center font-medium text-muted-foreground">{hour}h</th>)}</tr></thead>
          <tbody>{WEEKDAYS.map((day, index) => <tr key={day.short}>
            <th scope="row" className="px-1 py-0.5 text-left font-medium"><abbr title={day.long} className="no-underline">{day.short}</abbr></th>
            {Array.from({ length: 24 }, (_, hour) => {
              const value = matrix[index]?.[hour] ?? 0
              return <td key={hour} className={cn('h-6 w-7 border border-border/60 text-center', HEAT[heatLevel(value, max)], !value && 'text-muted-foreground/60')}
                title={`${day.long}, ${hourLabel(hour)}: ${count(value)} đơn`}>{value || ''}</td>
            })}
          </tr>)}</tbody>
        </table>
      </div>
    </details>
  </section>
}

export default RevenueReportPage
