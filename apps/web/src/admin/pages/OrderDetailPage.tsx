import { ordersApi } from '../../api/resources.ts'
import { formatDateTime, formatMoney } from '../../lib/format.ts'
import { Badge, DataTable, ErrorState, Link, Loading, PageHead } from '../kit.tsx'
import { useApi } from '../useApi.ts'
import { useSession } from '../useSession.ts'

function OrderDetailPage({ orderId }: { orderId: string }) {
  const { isAdmin } = useSession()
  const order = useApi(signal => ordersApi.get(orderId, signal), orderId)
  const back = { to: '/admin/orders', label: 'Danh sách đơn hàng' }
  if (order.error && !order.data) return <><PageHead title="Đơn hàng" back={back} /><ErrorState error={order.error} retry={order.reload} /></>
  const data = order.data
  if (!data) return <Loading />
  const none = { loading: false, error: undefined, reload: order.reload }
  return <>
    <PageHead title={`Đơn ${data.orderCode}`} back={back} />
    <section className="a-panel" aria-label="Thông tin đơn">
      <dl className="a-dl">
        <dt>Trạng thái</dt><dd><Badge value={data.status} /></dd>
        <dt>Máy</dt><dd>{data.machineCode}</dd>
        <dt>Tạm tính / Tổng tiền</dt><dd>{formatMoney(data.subtotal)} / {formatMoney(data.totalAmount)}</dd>
        <dt>Tạo lúc</dt><dd>{formatDateTime(data.createdAt)}</dd>
        <dt>Hết hạn thanh toán</dt><dd>{formatDateTime(data.expiresAt)}</dd>
        <dt>Thanh toán lúc</dt><dd>{formatDateTime(data.paidAt)}</dd>
        <dt>Hoàn tất lúc</dt><dd>{formatDateTime(data.completedAt)}</dd>
        <dt>Hủy lúc</dt><dd>{formatDateTime(data.cancelledAt)}</dd>
      </dl>
    </section>
    <section className="a-panel" aria-labelledby="items-title">
      <h2 id="items-title">Sản phẩm (giá tại thời điểm đặt)</h2>
      <DataTable state={none} rows={data.items} rowKey={item => item.id ?? ''} columns={[
        { head: 'SKU', cell: item => item.sku },
        { head: 'Sản phẩm', cell: item => item.productName },
        { head: 'Số lượng', cell: item => item.quantity },
        { head: 'Đơn giá', cell: item => formatMoney(item.unitPrice) },
        { head: 'Thành tiền', cell: item => formatMoney(item.totalPrice) },
      ]} />
    </section>
    <section className="a-panel" aria-labelledby="alloc-title">
      <h2 id="alloc-title">Hộp hàng được giữ</h2>
      <DataTable state={none} rows={data.items?.flatMap(item => item.allocations ?? [])} rowKey={allocation => allocation.id ?? ''} empty="Chưa có hộp nào được giữ cho đơn này." columns={[
        { head: 'Ngăn', cell: allocation => allocation.slotCode },
        { head: 'Lô', cell: allocation => allocation.batchCode },
        { head: 'Hạn lô', cell: allocation => formatDateTime(allocation.batchExpiresAt) },
        { head: 'Trạng thái', cell: allocation => <Badge value={allocation.status} /> },
        { head: 'Nhả giữ chỗ lúc', cell: allocation => formatDateTime(allocation.releasedAt) },
      ]} />
    </section>
    <section className="a-panel" aria-labelledby="pay-title">
      <h2 id="pay-title">Thanh toán</h2>
      <DataTable state={none} rows={data.payments} rowKey={payment => payment.id ?? ''} empty="Chưa có lần thanh toán nào." columns={[
        { head: 'Nhà cung cấp', cell: payment => isAdmin ? <Link to={`/admin/payments/${payment.id}`}>{payment.provider}</Link> : payment.provider },
        { head: 'Trạng thái', cell: payment => <Badge value={payment.status} /> },
        { head: 'Số tiền', cell: payment => formatMoney(payment.amount) },
        { head: 'Tạo lúc', cell: payment => formatDateTime(payment.createdAt) },
        { head: 'Thanh toán lúc', cell: payment => formatDateTime(payment.paidAt) },
      ]} />
    </section>
  </>
}

export default OrderDetailPage
