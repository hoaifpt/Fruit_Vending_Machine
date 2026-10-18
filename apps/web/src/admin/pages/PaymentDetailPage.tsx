import { paymentsApi } from '../../api/resources.ts'
import { formatDateTime, formatMoney } from '../../lib/format.ts'
import { Badge, ErrorState, Link, Loading, PageHead } from '../kit.tsx'
import { useApi } from '../useApi.ts'

function PaymentDetailPage({ paymentId }: { paymentId: string }) {
  const payment = useApi(signal => paymentsApi.get(paymentId, signal), paymentId)
  const back = { to: '/admin/payments', label: 'Danh sách thanh toán' }
  if (payment.error && !payment.data) return <><PageHead title="Thanh toán" back={back} /><ErrorState error={payment.error} retry={payment.reload} /></>
  const data = payment.data
  if (!data) return <Loading />
  return <>
    <PageHead title={`Thanh toán ${data.provider ?? ''}`} back={back} />
    <section className="a-panel" aria-label="Chi tiết thanh toán">
      <dl className="a-dl">
        <dt>Trạng thái</dt><dd><Badge value={data.status} /></dd>
        <dt>Đơn hàng</dt><dd><Link to={`/admin/orders/${data.orderId}`}>{data.orderCode}</Link> · máy {data.machineCode}</dd>
        <dt>Số tiền</dt><dd>{formatMoney(data.amount)}</dd>
        <dt>Mã tham chiếu</dt><dd>{data.paymentReference || '—'}</dd>
        <dt>Mã giao dịch</dt><dd>{data.transactionId || '—'}</dd>
        <dt>Tạo lúc</dt><dd>{formatDateTime(data.createdAt)}</dd>
        <dt>Thanh toán lúc</dt><dd>{formatDateTime(data.paidAt)}</dd>
        <dt>Hết hạn lúc</dt><dd>{formatDateTime(data.expiredAt)}</dd>
        <dt>Nội dung mã QR</dt><dd>{data.qrCode ? <code className="a-code">{data.qrCode}</code> : '—'}</dd>
      </dl>
    </section>
  </>
}

export default PaymentDetailPage
