import { useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { ApiError } from '../../api/client.ts'
import { Button } from '../../components/ui/button.tsx'
import { DataTable as PlainTable } from '../../components/ui/data-table.tsx'
import { FilterBar } from '../../components/ui/filter-bar.tsx'
import { FormField } from '../../components/ui/form-field.tsx'
import { Input, NativeSelect, Textarea } from '../../components/ui/input.tsx'
import { formatDateTime, formatMoney } from '../../lib/format.ts'
import { useQueryParams } from '../../lib/router.ts'
import { activeFilterCount, clearFiltersPatch, oneOf, parseSort, sortParam } from '../../lib/table-query.ts'
import type { SortRule } from '../../lib/table-query.ts'
import { Badge, ConfirmDialog, DataTable, ErrorState, Field, FormDialog, Notice, PageHead, Pagination, SearchFilter, SelectFilter, StatusDialog, Toolbar, enumOptions, useDialog, useForm } from '../kit.tsx'
import type { Column } from '../kit.tsx'
import { useApi } from '../useApi.ts'

/** Sample data only: this screen makes no API call. */
interface DemoOrder { id: string; orderCode: string; status: string; totalAmount: number; createdAt: string }
const STATUSES = ['PAID', 'COMPLETED', 'PENDING_PAYMENT', 'DISPENSE_FAILED'] as const
const ORDERS: DemoOrder[] = Array.from({ length: 8 }, (_, index) => ({
  id: `demo-${index}`,
  orderCode: `FV-2026-${String(1042 - index * 7)}`,
  status: STATUSES[index % STATUSES.length],
  totalAmount: 25000 + index * 10000,
  createdAt: `2026-11-0${9 - index}T06:05:00Z`,
}))
const PAGE = 3
const SORT_RULE: SortRule = { fields: ['createdAt', 'totalAmount', 'orderCode'], fallback: 'createdAt,desc' }
const FILTER_KEYS = ['kit_q', 'kit_status'] as const
const COLUMNS: Column<DemoOrder>[] = [
  { head: 'Mã đơn', sortKey: 'orderCode', cell: order => order.orderCode },
  { head: 'Trạng thái', cell: order => <Badge domain="order" value={order.status} /> },
  { head: 'Tổng tiền', sortKey: 'totalAmount', firstDirection: 'desc', cell: order => formatMoney(order.totalAmount) },
  { head: 'Tạo lúc', sortKey: 'createdAt', firstDirection: 'desc', cell: order => formatDateTime(order.createdAt) },
]
const idle = { loading: false, reload: () => {} }
const wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return <section className="mb-10 min-w-0">
    <h2>{title}</h2>
    {note && <p className="mt-1! mb-4! max-w-[80ch] text-[13px] text-muted-foreground">{note}</p>}
    {!note && <div className="mb-4" />}
    {children}
  </section>
}
function Sample({ label, children }: { label: string; children: ReactNode }) {
  return <div className="min-w-0">
    <p className="mb-2! text-xs font-medium text-muted-foreground">{label}</p>
    {children}
  </div>
}

function ListSection() {
  const { params, update } = useQueryParams()
  const sort = parseSort(params.get('kit_sort'), SORT_RULE)
  const status = oneOf(params.get('kit_status'), STATUSES), search = params.get('kit_q') ?? ''
  const page = Math.max(0, Number(params.get('kit_page')) || 0)
  const filtered = ORDERS.filter(order => (!status || order.status === status) && order.orderCode.toLowerCase().includes(search.toLowerCase()))
  const sign = sort.direction === 'asc' ? 1 : -1
  const sorted = [...filtered].sort((a, b) => {
    const left = a[sort.field as keyof DemoOrder], right = b[sort.field as keyof DemoOrder]
    return sign * (left < right ? -1 : left > right ? 1 : 0)
  })
  return <Section title="DataTable + FilterBar: có dữ liệu" note="Sắp xếp, phân trang và bộ lọc lưu trên URL (tham số kit_*). Ở trang thật, máy chủ sắp xếp và lọc; tại đây dữ liệu mẫu được xử lý tại chỗ.">
    <FilterBar activeCount={activeFilterCount([search, status])} onClear={() => update(clearFiltersPatch(FILTER_KEYS))}>
      <SearchFilter label="Mã đơn" value={search} onCommit={value => update({ kit_q: value })} />
      <SelectFilter label="Trạng thái" value={status} onChange={value => update({ kit_status: value })} options={enumOptions('order', STATUSES)} />
    </FilterBar>
    <DataTable state={idle} rows={sorted.slice(page * PAGE, page * PAGE + PAGE)} rowKey={order => order.id} columns={COLUMNS} sort={sort} caption="Đơn hàng mẫu"
      onSort={next => update({ kit_sort: sortParam(next, SORT_RULE) })} empty="Không có đơn nào khớp bộ lọc. Hãy xóa bộ lọc để xem lại." />
    <Pagination page={page} totalPages={Math.ceil(sorted.length / PAGE)} totalElements={sorted.length} onPage={next => update({ kit_page: String(next) })} />
  </Section>
}

function StatesSection() {
  return <Section title="DataTable: các trạng thái">
    <div className="grid gap-6 lg:grid-cols-2">
      <Sample label="Đang tải lần đầu"><DataTable state={{ ...idle, loading: true }} rows={undefined} rowKey={(order: DemoOrder) => order.id} columns={COLUMNS} /></Sample>
      <Sample label="Đang tải lại (giữ dữ liệu cũ)"><DataTable state={{ ...idle, loading: true }} rows={ORDERS.slice(0, 2)} rowKey={order => order.id} columns={COLUMNS} /></Sample>
      <Sample label="Rỗng"><DataTable state={idle} rows={[]} rowKey={(order: DemoOrder) => order.id} columns={COLUMNS} empty="Chưa có đơn hàng nào. Đơn mới sẽ xuất hiện tại đây." /></Sample>
      <Sample label="Lỗi hệ thống (có Thử lại)"><DataTable state={{ ...idle, error: new ApiError(500, 'Hệ thống đang gặp lỗi. Vui lòng thử lại sau.') }} rows={undefined} rowKey={(order: DemoOrder) => order.id} columns={COLUMNS} /></Sample>
      <Sample label="403: không có quyền"><DataTable state={{ ...idle, error: new ApiError(403, 'Bạn không có quyền xem dữ liệu này.') }} rows={undefined} rowKey={(order: DemoOrder) => order.id} columns={COLUMNS} /></Sample>
      <Sample label="401: hết phiên"><DataTable state={{ ...idle, error: new ApiError(401, 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.') }} rows={undefined} rowKey={(order: DemoOrder) => order.id} columns={COLUMNS} /></Sample>
      <Sample label="Thẻ trên mobile (khung rộng 390px)">
        <div className="max-w-[390px] rounded-xl border border-dashed p-3">
          <PlainTable rows={ORDERS.slice(0, 3)} rowKey={order => order.id} columns={COLUMNS} sort={{ field: 'createdAt', direction: 'desc' }} onSort={() => {}} />
        </div>
      </Sample>
    </div>
  </Section>
}

function FormFieldSection() {
  const [text, setText] = useState('Kiwi vàng')
  return <Section title="FormField" note="Nhãn gắn với ô nhập; gợi ý và lỗi được liên kết qua aria-describedby, lỗi đặt aria-invalid.">
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <FormField label="Tên sản phẩm" required hint="Hiển thị trên kiosk."><Input value={text} onChange={event => setText(event.target.value)} /></FormField>
      <FormField label="Giá bán (VND)" error="Giá phải lớn hơn 0 và tối đa 2 chữ số thập phân."><Input defaultValue="-1" inputMode="decimal" /></FormField>
      <FormField label="SKU" disabled hint="Không thể đổi SKU sau khi tạo."><Input defaultValue="FV-KIWI-01" /></FormField>
      <FormField label="Mã ngăn (chỉ đọc)" hint="Đang khóa."><Input defaultValue="A1" readOnly /></FormField>
      <FormField label="Trạng thái"><NativeSelect defaultValue="ACTIVE"><option value="ACTIVE">Hoạt động</option><option value="INACTIVE">Ngừng hoạt động</option></NativeSelect></FormField>
      <FormField label="Ghi chú" hint="Tối đa 500 ký tự."><Textarea defaultValue="Hộp 2 miếng, giao buổi sáng." /></FormField>
      <Field label="Field của kit" hint="FormField có sẵn lề dưới, dùng trong biểu mẫu."><Input defaultValue="35000" /></Field>
      <Field label="Field của kit, có lỗi" error="Vui lòng chọn ngăn."><NativeSelect defaultValue=""><option value="">Chọn ngăn</option></NativeSelect></Field>
    </div>
  </Section>
}

type DialogKind = 'normal' | 'danger' | 'pending' | 'failing' | 'form' | 'status'

function DialogSection() {
  const dialog = useDialog<DialogKind>()
  const form = useForm({ code: '' })
  const close = () => { dialog.close(); form.setErrors({}) }
  return <Section title="AlertDialog và FormDialog" note="Hộp thoại xác nhận luôn có Hủy; nút hành động nguy hiểm màu đỏ. Mọi thao tác nguy hiểm đều là đổi trạng thái hoặc thu hồi.">
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" onClick={() => dialog.open('normal')}>Xác nhận thường</Button>
      <Button variant="destructive" onClick={() => dialog.open('danger')}>Xác nhận nguy hiểm</Button>
      <Button variant="outline" onClick={() => dialog.open('pending')}>Đang xử lý (3 giây)</Button>
      <Button variant="outline" onClick={() => dialog.open('failing')}>Lỗi 409 trong hộp thoại</Button>
      <Button variant="outline" onClick={() => dialog.open('form')}>Biểu mẫu</Button>
      <Button variant="outline" onClick={() => dialog.open('status')}>Đổi trạng thái</Button>
    </div>
    {dialog.value === 'normal' && <ConfirmDialog title="Cấp khóa kiosk" message="Khóa mới chỉ hiện một lần. Hãy chuẩn bị nơi lưu trước khi tiếp tục." confirmLabel="Cấp khóa" close={close} onConfirm={() => wait(300)} />}
    {dialog.value === 'danger' && <ConfirmDialog danger title="Thu hồi khóa" message="Khóa sẽ ngừng hoạt động ngay. Không thể hoàn tác." confirmLabel="Thu hồi" close={close} onConfirm={() => wait(300)} />}
    {dialog.value === 'pending' && <ConfirmDialog title="Xác nhận gỡ hộp" message="Hộp đang chọn sẽ chuyển sang trạng thái Đã gỡ." confirmLabel="Gỡ hộp" close={close} onConfirm={() => wait(3000)} />}
    {dialog.value === 'failing' && <ConfirmDialog danger title="Thu hồi khóa" message="Thử xem lỗi hiển thị trong hộp thoại." confirmLabel="Thu hồi" close={close} onConfirm={async () => { await wait(300); throw new ApiError(409, 'Khóa đã được thu hồi trước đó. Hãy tải lại danh sách.') }} />}
    {dialog.value === 'form' && <FormDialog title="Thêm ngăn" close={close} onFieldErrors={form.setErrors} onSubmit={async () => { await wait(300); if (!form.values.code.trim()) form.fail({ code: 'Vui lòng nhập mã ngăn.' }) }}>
      <Field label="Mã ngăn" error={form.errors.code}><Input value={form.values.code} onChange={event => form.set('code')(event.target.value)} /></Field>
      <Field label="Ghi chú"><Textarea /></Field>
    </FormDialog>}
    {dialog.value === 'status' && <StatusDialog title="Trạng thái: Kiwi vàng" domain="product" current="ACTIVE" options={['ACTIVE', 'INACTIVE']} close={close} onSubmit={() => wait(300)} note="Sản phẩm ngừng hoạt động không hiện trên kiosk." />}
  </Section>
}

type PollMode = 'ok' | 'fail' | 'forbidden'

/** useApi with `pollMs`: a local loader (no API call) so the schedule can be watched without a backend. */
function PollingSection() {
  const [mode, setMode] = useState<PollMode>('ok')
  const modeRef = useRef<PollMode>('ok')
  const choose = (next: PollMode) => { modeRef.current = next; setMode(next) }
  const loads = useRef(0)
  const state = useApi(async signal => {
    await wait(600)
    signal.throwIfAborted()
    loads.current += 1
    if (modeRef.current === 'fail') throw new ApiError(500, 'Hệ thống đang gặp lỗi. Vui lòng thử lại sau.')
    if (modeRef.current === 'forbidden') throw new ApiError(403, 'Bạn không có quyền thực hiện thao tác này.')
    return { count: loads.current }
  }, 'kit-poll', { pollMs: 5000 })
  const status = state.loading ? 'Đang tải…' : state.refreshing ? 'Đang làm mới nền…' : 'Chờ lượt kế tiếp'
  return <Section title="useApi: polling" note="Làm mới mỗi 5 giây, không chồng request; tạm dừng khi tab bị ẩn và làm mới ngay khi hiện lại. Lần làm mới nền giữ dữ liệu cũ, không hiện khung chờ. Lỗi 401/403 dừng polling; lỗi khác giữ dữ liệu và thử lại ở lượt sau.">
    <div className="mb-3 flex flex-wrap gap-2">
      <Button size="sm" variant={mode === 'ok' ? 'default' : 'outline'} aria-pressed={mode === 'ok'} onClick={() => choose('ok')}>Phản hồi thành công</Button>
      <Button size="sm" variant={mode === 'fail' ? 'default' : 'outline'} aria-pressed={mode === 'fail'} onClick={() => choose('fail')}>Lỗi 500 ở lượt sau</Button>
      <Button size="sm" variant={mode === 'forbidden' ? 'default' : 'outline'} aria-pressed={mode === 'forbidden'} onClick={() => choose('forbidden')}>Lỗi 403 ở lượt sau</Button>
      <Button size="sm" variant="outline" onClick={state.reload}>Tải lại (khởi động lại polling)</Button>
    </div>
    <div className="rounded-xl border bg-card p-4" aria-live="polite">
      {state.data && <p>Số lần đã tải: <strong>{state.data.count}</strong>{state.updatedAt && <> · cập nhật lúc {formatDateTime(new Date(state.updatedAt).toISOString())}</>}</p>}
      <p className="text-[13px] text-muted-foreground">{status}</p>
      {state.error && <ErrorState error={state.error} retry={state.reload} />}
    </div>
  </Section>
}

function OthersSection() {
  return <Section title="Thành phần khác">
    <div className="grid gap-4">
      <Sample label="Toolbar (giữ cho các trang cũ)"><Toolbar><SearchFilter label="Tìm kiếm" value="" onCommit={() => {}} /><SelectFilter label="Trạng thái" value="" onChange={() => {}} options={enumOptions('product')} /></Toolbar></Sample>
      <Sample label="Badge"><div className="flex flex-wrap gap-2"><Badge domain="machine" value="ACTIVE" /><Badge domain="machine" value="MAINTENANCE" /><Badge domain="user" value="LOCKED" /><Badge value="soon" /></div></Sample>
      <Sample label="Notice"><Notice>Danh sách này chỉ để tham khảo.</Notice><Notice tone="error">Không lưu được thay đổi. Hãy thử lại.</Notice></Sample>
      <Sample label="Pagination"><Pagination page={1} totalPages={4} totalElements={72} onPage={() => {}} /></Sample>
    </div>
  </Section>
}

/** Reference for the shared components. Only present in dev and mock builds (see AdminApp). */
function KitPage() {
  return <>
    <PageHead title="Bộ thành phần giao diện" subtitle="Trang tham khảo cho lập trình viên: chỉ có trong dev và bản mock, dùng dữ liệu mẫu." actions={<Button size="sm" variant="outline" onClick={() => window.location.reload()}>Tải lại</Button>} />
    <ListSection />
    <StatesSection />
    <FormFieldSection />
    <DialogSection />
    <PollingSection />
    <OthersSection />
  </>
}

export default KitPage
