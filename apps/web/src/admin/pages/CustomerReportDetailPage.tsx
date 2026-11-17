// Chi tiết phản ánh của khách (backend #74, GET /customer-reports/{id}): what the customer sent (type, description as
// escaped text, photos), what the backend found (order, verdict, batch of the sold bowl), the INCIDENT work order, the
// contact (full only with CUSTOMER_REPORT_MANAGE) and the result. Photos need the session token, so they are read with
// fetch and shown through object URLs (revoked when the page closes), never a raw <img src> to the API.
// CUSTOMER_REPORT_MANAGE (ADMIN): "Nhận xử lý" (NEW → IN_REVIEW), "Giải quyết" (FIXED / NO_ACTION_NEEDED / REFUNDED),
// "Từ chối" (SPAM / DUPLICATE); RESOLVED and REJECTED are final. A refund is recorded on W-12 (link with the order and
// the work order), which closes the open reports of the order by itself. STAFF only reaches reports of their own work
// orders (404 otherwise).
import { useEffect, useState } from 'react'
import { ImageOff } from 'lucide-react'
import { ApiError } from '../../api/client.ts'
import { customerReportsApi } from '../../api/resources.ts'
import type { CustomerReportDetail, ReportResolution } from '../../api/resources.ts'
import { Button } from '../../components/ui/button.tsx'
import { FormField } from '../../components/ui/form-field.tsx'
import { Textarea } from '../../components/ui/input.tsx'
import { formatDate, formatDateTime } from '../../lib/format.ts'
import { Badge, ConfirmDialog, ErrorState, FormDialog, Link, Loading, PageHead, ValidationError, useDialog, useForm } from '../kit.tsx'
import {
  CUSTOMER_REPORTS_PATH, DECISION_NOTE_MAX, REJECT_OPTIONS, RESOLUTION_LABELS, RESOLVE_OPTIONS, contactText, decisionBody, refundLinkOf, reportActionError, reportActions,
  reportNextStep, reportTypeLabel, resolutionLabel, sizeText, validateDecision, verdictHelp, verdictLabel,
} from '../customer-reports.ts'
import { HEADING, HINT, LINK, PANEL } from '../payment-parts.tsx'
import { shortId } from '../order-detail.ts'
import { ticketPath } from '../tickets.ts'
import { useApi } from '../useApi.ts'
import { useSession } from '../useSession.ts'

const BACK = { to: CUSTOMER_REPORTS_PATH, label: 'Danh sách phản ánh' }
const DL = 'grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-x-4 gap-y-2.5 text-[14px] [&_dt]:text-muted-foreground'
type Decision = 'review' | 'resolve' | 'reject'

function CustomerReportDetailPage({ reportId }: { reportId: string }) {
  const { can } = useSession()
  const canManage = can('CUSTOMER_REPORT_MANAGE'), canRefund = can('PAYMENT_REFUND'), canOrders = can('ORDER_READ')
  const report = useApi(signal => customerReportsApi.get(reportId, signal), reportId)
  const dialog = useDialog<Decision>()
  const data = report.data

  if (report.error && !data) {
    const code = report.error instanceof ApiError ? report.error.status : undefined
    if (code === 404 || code === 400) return <>
      <PageHead title="Không tìm thấy phản ánh" back={BACK} />
      <div role="alert" className="px-4 py-10 text-center text-muted-foreground">
        <p>Phản ánh này không tồn tại, đường dẫn đã sai, hoặc không thuộc phiếu sự cố được giao cho bạn. Mở lại từ danh sách phản ánh.</p>
        <p className="mt-3!"><Button asChild variant="outline" size="sm"><Link to={BACK.to}>Về danh sách phản ánh</Link></Button></p>
      </div>
    </>
    return <><PageHead title="Phản ánh của khách" back={BACK} /><ErrorState error={report.error} retry={report.reload} /></>
  }
  if (!data) return <><PageHead title="Phản ánh của khách" back={BACK} /><Loading label="Đang tải phản ánh…" rows={6} /></>

  const actions = reportActions(data, canManage)
  const refundLink = refundLinkOf(data, canRefund)
  return <>
    <PageHead title={`Phản ánh ${data.code ?? ''}`} back={BACK} subtitle={`${reportTypeLabel(data.type)} · máy ${data.machineCode ?? '—'} · gửi lúc ${formatDateTime(data.createdAt)}`}
      actions={actions.length ? <div className="flex flex-wrap gap-2">
        {actions.includes('review') && <Button type="button" variant="outline" onClick={() => dialog.open('review')}>Nhận xử lý</Button>}
        {actions.includes('resolve') && <Button type="button" onClick={() => dialog.open('resolve')}>Giải quyết</Button>}
        {actions.includes('reject') && <Button type="button" variant="outline" className="text-destructive" onClick={() => dialog.open('reject')}>Từ chối</Button>}
      </div> : undefined} />
    <section aria-labelledby="report-next" className="mb-5 rounded-xl border bg-muted/40 p-4">
      <h2 id="report-next" className="mb-1.5! flex flex-wrap items-center gap-2 text-base font-semibold"><Badge domain="customerReport" explain value={data.status} /></h2>
      <p className="text-[14px]">{reportNextStep(data, canManage, canRefund)}</p>
      {refundLink && <p className="mt-2! text-[14px]"><Link to={refundLink} className={LINK}>Ghi nhận hoàn tiền cho đơn {data.order?.orderCode ?? ''}</Link></p>}
    </section>
    <div className="grid gap-x-5 lg:grid-cols-2">
      <section className={PANEL} aria-labelledby="report-info">
        <h2 id="report-info" className={HEADING}>Khách báo</h2>
        <dl className={DL}>
          <dt>Loại</dt><dd>{reportTypeLabel(data.type)}</dd>
          <dt>Máy</dt><dd>{data.machineName ? `${data.machineName} (${data.machineCode ?? '—'})` : data.machineCode ?? '—'}</dd>
          <dt>Mã đơn khách nhập</dt><dd className="font-mono text-[13px] break-all">{data.orderCodeInput || '—'}</dd>
          <dt>Mô tả</dt><dd className="break-words whitespace-pre-wrap">{data.description?.trim() || '—'}</dd>
          <dt>Liên hệ</dt><dd className="break-words">{contactText(data.contact)}{data.contact?.masked ? <span className="block text-xs text-muted-foreground">Đã che; chỉ quản trị viên xem được đầy đủ.</span> : null}</dd>
          <dt>Gửi lúc</dt><dd>{formatDateTime(data.createdAt)}</dd>
        </dl>
      </section>
      <section className={PANEL} aria-labelledby="report-check">
        <h2 id="report-check" className={HEADING}>Hệ thống đối chiếu</h2>
        <dl className={DL}>
          <dt>Kết quả</dt><dd><span className="font-medium">{verdictLabel(data.verdict)}</span>{verdictHelp(data.verdict) && <span className="block text-[13px] text-muted-foreground">{verdictHelp(data.verdict)}</span>}</dd>
          <dt>Đơn</dt><dd>{data.order?.id
            ? <span className="flex flex-wrap items-center gap-2">{canOrders ? <Link to={`/admin/orders/${data.order.id}`} className={LINK}>{data.order.orderCode ?? shortId(data.order.id)}</Link> : <span className="font-mono text-[13px]">{data.order.orderCode}</span>}<Badge domain="order" value={data.order.status} /></span>
            : '—'}</dd>
          {data.batch && <><dt>Lô của hộp đã bán</dt><dd>{data.batch.batchCode ?? '—'} · {data.batch.productName ?? ''}{data.batch.expiresAt ? `, hạn ${formatDate(data.batch.expiresAt)}` : ''}</dd></>}
          <dt>Phiếu sự cố</dt><dd>{data.workOrder?.id
            ? <span className="flex flex-wrap items-center gap-2"><Link to={ticketPath(data.workOrder.id)} className={LINK}>{data.workOrder.code ?? shortId(data.workOrder.id)}</Link><Badge domain="ticket" value={data.workOrder.status} /></span>
            : '—'}</dd>
          {data.resolution && <><dt>Kết quả xử lý</dt><dd>{resolutionLabel(data.resolution)}{data.resolvedBy?.fullName ? ` · ${data.resolvedBy.fullName}` : ''}{data.resolvedAt ? ` · ${formatDateTime(data.resolvedAt)}` : ''}
            {data.resolutionNote?.trim() && <span className="block break-words whitespace-pre-wrap text-muted-foreground">{data.resolutionNote}</span>}</dd></>}
        </dl>
      </section>
    </div>
    <Photos report={data} />
    {dialog.value === 'review' && <ConfirmDialog title={`Nhận xử lý phản ánh ${data.code ?? ''}?`} confirmLabel="Nhận xử lý" close={dialog.close}
      successDescription="Phản ánh chuyển sang Đang xử lý."
      message="Phản ánh chuyển sang “Đang xử lý” để các quản trị viên khác biết đã có người kiểm tra. Sau đó giải quyết hoặc từ chối khi có kết quả."
      onConfirm={async () => {
        try { await customerReportsApi.review(reportId) } catch (error) { if (error instanceof ApiError && error.status === 409) report.reload(); throw reportActionError(error) }
        report.reload()
      }} />}
    {(dialog.value === 'resolve' || dialog.value === 'reject') && <DecisionDialog kind={dialog.value} report={data} close={dialog.close} done={report.reload} />}
  </>
}

function DecisionDialog({ kind, report, close, done }: { kind: 'resolve' | 'reject'; report: CustomerReportDetail; close: () => void; done: () => void }) {
  const options: readonly ReportResolution[] = kind === 'resolve' ? RESOLVE_OPTIONS : REJECT_OPTIONS
  const form = useForm({ resolution: kind === 'reject' ? 'SPAM' : 'FIXED', note: '' })
  const title = kind === 'resolve' ? `Giải quyết phản ánh ${report.code ?? ''}` : `Từ chối phản ánh ${report.code ?? ''}`
  return <FormDialog title={title} submitLabel={kind === 'resolve' ? 'Giải quyết' : 'Từ chối'} danger={kind === 'reject'} close={close} onFieldErrors={form.setErrors}
    onSubmit={async () => {
      const errors = validateDecision(form.values, options)
      if (Object.keys(errors).length) throw new ValidationError(errors)
      const body = decisionBody(form.values)
      try { await (kind === 'resolve' ? customerReportsApi.resolve(report.id ?? '', body) : customerReportsApi.reject(report.id ?? '', body)) } catch (error) {
        if (error instanceof ApiError && error.status === 409) done()
        throw reportActionError(error)
      }
      done()
    }}>
    <fieldset className="mb-3 min-w-0">
      <legend className="mb-1.5 text-[13px] font-medium">Kết quả<span aria-hidden="true" className="text-destructive"> *</span></legend>
      <div className="grid gap-2">
        {options.map(option => <label key={option} className="flex cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2.5 text-[14px] has-checked:border-primary has-checked:bg-accent has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-ring">
          <input type="radio" name={`decision-${kind}`} value={option} checked={form.values.resolution === option} aria-invalid={form.errors.resolution ? true : undefined}
            onChange={() => form.set('resolution')(option)} className="size-4 shrink-0 accent-primary outline-none" />
          <span>{RESOLUTION_LABELS[option]}</span>
        </label>)}
      </div>
      {form.errors.resolution && <small className="mt-1 block text-xs font-medium text-destructive">{form.errors.resolution}</small>}
      {kind === 'resolve' && <p className={`${HINT} mt-2!`}>Chọn “Đã hoàn tiền” chỉ khi tiền đã được ghi nhận hoàn ở màn Hoàn tiền; ghi nhận hoàn tiền ở đó tự giải quyết phản ánh.</p>}
    </fieldset>
    <FormField label="Ghi chú (không bắt buộc)" error={form.errors.note} hint={`${form.values.note.trim().length}/${DECISION_NOTE_MAX} ký tự. Không ghi số tài khoản của khách.`}>
      <Textarea value={form.values.note} maxLength={DECISION_NOTE_MAX} onChange={event => form.set('note')(event.target.value)} />
    </FormField>
    <p className={`${HINT} mt-3!`}>Không hoàn tác được: phản ánh đã giải quyết hoặc từ chối không mở lại.</p>
  </FormDialog>
}

// ---- photos (read with the session token, shown through object URLs)

function Photos({ report }: { report: CustomerReportDetail }) {
  const photos = report.photos ?? []
  return <section className={PANEL} aria-labelledby="report-photos">
    <h2 id="report-photos" className={HEADING}>Ảnh khách gửi</h2>
    {photos.length
      ? <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{photos.map((photo, index) => <li key={photo.id ?? index}>
        <ReportPhoto reportId={report.id ?? ''} photoId={photo.id ?? ''} label={`Ảnh ${index + 1} của phản ánh ${report.code ?? ''}`} size={sizeText(photo.sizeBytes)} />
      </li>)}</ul>
      : <p className="text-[14px] text-muted-foreground">Khách không gửi ảnh.</p>}
  </section>
}

function ReportPhoto({ reportId, photoId, label, size }: { reportId: string; photoId: string; label: string; size: string }) {
  const [state, setState] = useState<{ url?: string; error?: unknown }>({})
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    let url: string | undefined
    customerReportsApi.photo(reportId, photoId, controller.signal).then(
      blob => { if (controller.signal.aborted) return; url = URL.createObjectURL(blob); setState({ url }) },
      error => { if (!controller.signal.aborted) setState({ error }) },
    )
    return () => { controller.abort(); if (url) URL.revokeObjectURL(url) }
  }, [reportId, photoId, attempt])
  if (state.url) return <figure className="grid gap-1.5">
    <a href={state.url} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-lg border focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring" aria-label={`${label}, mở ảnh cỡ lớn`}>
      <img src={state.url} alt={label} className="aspect-4/3 w-full object-cover" />
    </a>
    <figcaption className="text-xs text-muted-foreground">{label} · {size}</figcaption>
  </figure>
  if (state.error) return <div role="alert" className="grid aspect-4/3 place-items-center gap-2 rounded-lg border bg-muted/40 p-3 text-center text-[13px] text-muted-foreground">
    <ImageOff className="size-6" aria-hidden="true" />
    <span>Không tải được {label.toLowerCase()}.</span>
    <Button type="button" size="sm" variant="outline" onClick={() => { setState({}); setAttempt(value => value + 1) }}>Thử lại</Button>
  </div>
  return <div role="status" aria-label={`Đang tải ${label.toLowerCase()}`} className="aspect-4/3 animate-pulse rounded-lg bg-muted motion-reduce:animate-none" />
}

export default CustomerReportDetailPage
