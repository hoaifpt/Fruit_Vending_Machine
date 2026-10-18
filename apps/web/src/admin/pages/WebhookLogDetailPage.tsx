import { webhookLogsApi } from '../../api/resources.ts'
import { formatDateTime } from '../../lib/format.ts'
import { ErrorState, Loading, PageHead } from '../kit.tsx'
import { prettyPayload } from '../payload.ts'
import { useApi } from '../useApi.ts'

function WebhookLogDetailPage({ logId }: { logId: string }) {
  const log = useApi(signal => webhookLogsApi.get(logId, signal), logId)
  const back = { to: '/admin/webhook-logs', label: 'Danh sách webhook' }
  if (log.error && !log.data) return <><PageHead title="Webhook" back={back} /><ErrorState error={log.error} retry={log.reload} /></>
  const data = log.data
  if (!data) return <Loading />
  const payload = prettyPayload(data.rawPayload, data.rawBody)
  return <>
    <PageHead title={`Webhook ${data.provider ?? ''}`} back={back} />
    <section className="a-panel" aria-label="Chi tiết webhook">
      <dl className="a-dl">
        <dt>Nhận lúc</dt><dd>{formatDateTime(data.receivedAt)}</dd>
        <dt>Xác thực</dt><dd>{data.verified ? 'Đã xác thực' : 'Bị từ chối'}</dd>
        <dt>Sự kiện</dt><dd>{data.eventType || '—'}</dd>
        <dt>Tham chiếu</dt><dd>{data.reference || '—'}</dd>
      </dl>
    </section>
    <section className="a-panel" aria-labelledby="payload-title">
      <h2 id="payload-title">{payload.kind === 'raw' ? 'Nội dung thô' : 'Payload'}</h2>
      {/* Untrusted provider data: rendered as escaped text inside <pre>, never as HTML. */}
      {payload.text ? <pre className="a-code">{payload.text}</pre> : <p className="a-empty">Không có nội dung được lưu.</p>}
    </section>
  </>
}

export default WebhookLogDetailPage
