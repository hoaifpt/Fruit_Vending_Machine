// T4 Chi tiết webhook (FE 6.2), ADMIN only, read only: one call of a payment provider and the body the server stored
// (the JSON re-serialised by the server, so key order and spacing may differ from the provider's bytes; a body that was
// not JSON is kept word for word).
// The body is untrusted provider data: it is shown as escaped text inside <pre> (React text), never as HTML, and the
// copy button copies the same text. The signature is never returned by the API.
// A webhook log has no link to its payment in the contract (no FK, and GET /payments has no reference filter), so the
// way back is "every call with this reference"; from a payment, its webhooks are one click away.
import { useEffect, useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { ApiError } from '../../api/client.ts'
import { webhookLogsApi } from '../../api/resources.ts'
import { Button } from '../../components/ui/button.tsx'
import { formatDateTime, formatMoney } from '../../lib/format.ts'
import { ErrorState, Link, Loading, PageHead } from '../kit.tsx'
import { HEADING, HINT, LINK, PANEL, VerifiedBadge } from '../payment-parts.tsx'
import { prettyPayload, storedPayload } from '../payload.ts'
import { payloadAmount, webhookEventText, webhookLogsByReferencePath } from '../payments.ts'
import { useApi } from '../useApi.ts'

const BACK = { to: '/admin/webhook-logs', label: 'Danh sách webhook' }

function WebhookLogDetailPage({ logId }: { logId: string }) {
  const log = useApi(signal => webhookLogsApi.get(logId, signal), logId)
  const data = log.data
  if (log.error && !data) {
    const code = log.error instanceof ApiError ? log.error.status : undefined
    if (code === 404 || code === 400) return <>
      <PageHead title="Không tìm thấy webhook" back={BACK} />
      <div role="alert" className="px-4 py-10 text-center text-muted-foreground">
        <p>Lần gọi webhook này không tồn tại hoặc đường dẫn đã sai. Mở lại từ danh sách webhook.</p>
        <p className="mt-3!"><Button asChild variant="outline" size="sm"><Link to={BACK.to}>Về danh sách webhook</Link></Button></p>
      </div>
    </>
    return <><PageHead title="Webhook" back={BACK} /><ErrorState error={log.error} retry={log.reload} /></>
  }
  if (!data) return <><PageHead title="Webhook" back={BACK} /><Loading label="Đang tải webhook…" rows={6} /></>
  const amount = payloadAmount(data.rawPayload)
  return <>
    <PageHead title={`Webhook ${data.provider ?? ''}`} back={BACK} subtitle="Chỉ xem. Không có thao tác gửi lại hay xóa." />
    <section className={PANEL} aria-labelledby="hook-info">
      <h2 id="hook-info" className={HEADING}>Thông tin lần gọi</h2>
      <dl className="grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-x-4 gap-y-2.5 text-[14px] [&_dt]:text-muted-foreground">
        <dt>Nhận lúc</dt><dd>{formatDateTime(data.receivedAt)}</dd>
        <dt>Nhà cung cấp</dt><dd>{data.provider ?? '—'}</dd>
        <dt>Xác thực</dt><dd className="grid gap-1">
          <VerifiedBadge verified={data.verified} />
          <span className="text-xs text-muted-foreground">{data.verified
            ? 'Chữ ký hợp lệ; kết quả xử lý xem ở thanh toán tương ứng.'
            : 'Chữ ký sai hoặc nội dung không đọc được: hệ thống không xử lý, thanh toán không đổi.'}</span>
        </dd>
        <dt>Sự kiện</dt><dd>{webhookEventText(data.eventType)}</dd>
        <dt>Mã tham chiếu</dt><dd className="min-w-0">
          {data.reference
            ? <><span className="font-mono text-[13px] break-all">{data.reference}</span> · <Link to={webhookLogsByReferencePath(data.reference)} className={LINK}>Mọi lần gọi cùng mã</Link></>
            : '—'}
          <span className="block text-xs text-muted-foreground">Do nhà cung cấp gửi, chưa được kiểm chứng; trùng với mã tham chiếu của thanh toán (không phải mã đơn).</span>
        </dd>
        <dt>Số tiền trong nội dung</dt><dd>{amount === undefined ? '—' : formatMoney(amount)}</dd>
      </dl>
    </section>
    {/* rawPayload is a JSON value on the real backend although the schema says string (see payload.ts). */}
    <Payload rawPayload={data.rawPayload as unknown} rawBody={data.rawBody} />
  </>
}

/** How long the "copied" confirmation stays, so a second copy is announced again. */
const COPIED_MS = 4000

function Payload({ rawPayload, rawBody }: { rawPayload: unknown; rawBody?: string | null }) {
  const verbatim = storedPayload(rawPayload, rawBody)
  const pretty = prettyPayload(rawPayload, rawBody)
  const [formatted, setFormatted] = useState(false)
  const [copied, setCopied] = useState<'' | 'ok' | 'fail'>('')
  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(''), COPIED_MS)
    return () => window.clearTimeout(timer)
  }, [copied])
  const canFormat = verbatim.kind === 'json' && pretty.text !== verbatim.text
  const shown = formatted && canFormat ? pretty.text : verbatim.text
  async function copy() {
    setCopied('')
    try { await navigator.clipboard.writeText(verbatim.text); setCopied('ok') } catch { setCopied('fail') }
  }
  return <section className={PANEL} aria-labelledby="payload-title">
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <h2 id="payload-title" className="text-base font-semibold">{verbatim.kind === 'raw' ? 'Nội dung nguyên văn (không phải JSON)' : 'Nội dung (payload) đã lưu'}</h2>
      {verbatim.text && <div className="flex flex-wrap gap-2">
        {canFormat && <Button type="button" size="sm" variant="outline" aria-pressed={formatted} className="max-sm:h-11" onClick={() => setFormatted(value => !value)}>Xuống dòng cho dễ đọc</Button>}
        <Button type="button" size="sm" variant="outline" className="max-sm:h-11" onClick={copy}>
          {copied === 'ok' ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}Sao chép nội dung
        </Button>
      </div>}
    </div>
    <p className={HINT}>
      {verbatim.kind === 'raw'
        ? 'Nội dung nhận được không phải JSON nên được lưu và hiện đúng từng ký tự. Đây là dữ liệu bên ngoài: chỉ hiện dạng chữ, không chạy mã.'
        : 'JSON máy chủ đã lưu từ nhà cung cấp, không định dạng lại. Máy chủ đã phân tích rồi ghi lại nên thứ tự khóa và khoảng trắng có thể khác bản gốc. Đây là dữ liệu bên ngoài: chỉ hiện dạng chữ, không chạy mã.'}
    </p>
    <p role="status" aria-live="polite" className="sr-only">{copied === 'ok' ? 'Đã sao chép nội dung.' : ''}</p>
    {copied === 'fail' && <p role="alert" className="mb-3! text-[13px] text-destructive">Trình duyệt không cho sao chép. Chọn nội dung trong khung bên dưới rồi nhấn Ctrl+C.</p>}
    {/* Untrusted provider data: React text inside <pre>, never HTML. Focusable so the keyboard can scroll it. */}
    {verbatim.text
      ? <pre tabIndex={0} aria-label="Nội dung webhook" data-payload={formatted && canFormat ? 'formatted' : 'stored'}
        className="max-h-[60vh] overflow-auto rounded-lg border bg-muted p-3 font-mono text-[13px] leading-relaxed whitespace-pre-wrap break-all text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">{shown}</pre>
      : <p className="text-[14px] text-muted-foreground">Máy chủ không lưu nội dung cho lần gọi này.</p>}
  </section>
}

export default WebhookLogDetailPage
