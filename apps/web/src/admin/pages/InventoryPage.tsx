import { useState } from 'react'
import { inventoryApi, slotsApi } from '../../api/resources.ts'
import type { InventoryItem } from '../../api/resources.ts'
import { formatDateTime, parseInteger } from '../../lib/format.ts'
import { useQueryParams } from '../../lib/router.ts'
import { Badge, DataTable, Field, FormDialog, Link, PAGE_SIZE, PageHead, Pagination, SelectFilter, Toolbar, enumOptions, pageParam, useDialog, useForm } from '../kit.tsx'
import { useBatchOptions, useMachineOptions, useSlotOptions } from '../options.ts'
import { useApi } from '../useApi.ts'

export const ITEM_STATUSES = ['AVAILABLE', 'RESERVED', 'SOLD', 'EXPIRED', 'REMOVED', 'DISPENSE_FAILED'] as const
const REMOVABLE = new Set(['AVAILABLE', 'EXPIRED'])
const SORTS = [{ value: 'loadedAt,desc', label: 'Nạp gần nhất' }, { value: 'updatedAt,desc', label: 'Cập nhật gần nhất' }, { value: 'status,asc', label: 'Trạng thái' }]

export function InventoryTabs({ current }: { current: 'items' | 'history' }) {
  return <nav className="a-tabs" aria-label="Tồn kho">
    <Link to="/admin/inventory" className={current === 'items' ? 'is-current' : ''}>Hộp hàng</Link>
    <Link to="/admin/inventory/history" className={current === 'history' ? 'is-current' : ''}>Lịch sử</Link>
  </nav>
}

function InventoryPage() {
  const { params, update } = useQueryParams()
  const machineId = params.get('machineId') ?? '', slotId = params.get('slotId') ?? '', batchId = params.get('batchId') ?? ''
  const status = params.get('status') ?? '', expired = params.get('expired') ?? '', sort = params.get('sort') ?? 'loadedAt,desc', page = pageParam(params)
  const machines = useMachineOptions(), slots = useSlotOptions(machineId), batches = useBatchOptions()
  const state = useApi(signal => inventoryApi.list({
    page, size: PAGE_SIZE, machineId: machineId || undefined, slotId: slotId || undefined, batchId: batchId || undefined,
    status: (status || undefined) as 'AVAILABLE' | undefined, expired: expired ? expired === 'true' : undefined, sort,
  }, signal), params.toString())
  const dialog = useDialog<'load' | InventoryItem>()
  const target = dialog.value
  const [refresh, setRefresh] = useState(0)
  const changed = () => { state.reload(); setRefresh(count => count + 1) }

  return <>
    <PageHead title="Tồn kho" subtitle="Mỗi hộp là một bản ghi riêng." actions={<button type="button" className="a-primary" onClick={() => dialog.open('load')}>Nạp hàng</button>} />
    <InventoryTabs current="items" />
    <Toolbar>
      <SelectFilter label="Máy" value={machineId} onChange={value => update({ machineId: value, slotId: '' })} options={machines} />
      <SelectFilter label="Ngăn" value={slotId} onChange={value => update({ slotId: value })} options={slots} empty={machineId ? 'Tất cả ngăn' : 'Chọn máy trước'} />
      <SelectFilter label="Lô hàng" value={batchId} onChange={value => update({ batchId: value })} options={batches} />
      <SelectFilter label="Trạng thái" value={status} onChange={value => update({ status: value })} options={enumOptions(ITEM_STATUSES)} />
      <SelectFilter label="Hạn dùng" value={expired} onChange={value => update({ expired: value })} options={[{ value: 'true', label: 'Đã quá hạn' }, { value: 'false', label: 'Chưa quá hạn' }]} />
      <SelectFilter label="Sắp xếp" value={sort} onChange={value => update({ sort: value })} options={SORTS} empty="Mặc định" />
    </Toolbar>
    {machineId && slotId && <SlotSummaryPanel machineId={machineId} slotId={slotId} refresh={refresh} />}
    <DataTable state={state} rows={state.data?.content} rowKey={item => item.id ?? ''} columns={[
      { head: 'Sản phẩm', cell: item => item.productName },
      { head: 'Lô', cell: item => item.batchCode },
      { head: 'Ngăn', cell: item => item.slotCode },
      { head: 'Trạng thái', cell: item => <Badge value={item.status} /> },
      { head: 'Hết hạn', cell: item => <>{formatDateTime(item.expiresAt)}{item.expired && <> <Badge value="expired" /></>}</> },
      { head: 'Nạp lúc', cell: item => formatDateTime(item.loadedAt) },
      { head: 'Thao tác', cell: item => <div className="a-actions">
        <Link to={`/admin/inventory/history?inventoryItemId=${item.id}`}>Lịch sử</Link>
        <button type="button" className="a-danger" disabled={!REMOVABLE.has(item.status ?? '')} title={REMOVABLE.has(item.status ?? '') ? undefined : 'Chỉ gỡ được hộp Sẵn sàng hoặc Hết hạn'} onClick={() => dialog.open(item)}>Gỡ hộp</button>
      </div> },
    ]} />
    {state.data && <Pagination page={state.data.page} totalPages={state.data.totalPages} totalElements={state.data.totalElements} onPage={next => update({ page: String(next) })} />}
    {target === 'load' && <LoadDialog close={dialog.close} done={changed} />}
    {target && target !== 'load' && <RemoveDialog item={target} close={dialog.close} done={changed} />}
  </>
}

function SlotSummaryPanel({ machineId, slotId, refresh }: { machineId: string; slotId: string; refresh: number }) {
  const summary = useApi(signal => slotsApi.summary(machineId, slotId, signal), `${machineId}|${slotId}|${refresh}`)
  const data = summary.data
  if (!data) return null
  const cells: [string, number | undefined][] = [['Sức chứa', data.capacity], ['Đang có', data.occupiedCount], ['Sẵn sàng', data.availableCount], ['Quá hạn', data.expiredCount], ['Giữ chỗ', data.reservedCount], ['Còn trống', data.remainingCapacity]]
  return <section className="a-stats" aria-label="Tóm tắt ngăn">{cells.map(([label, value]) => <div key={label}><strong>{value}</strong><small>{label}</small></div>)}</section>
}

function LoadDialog({ close, done }: { close: () => void; done: () => void }) {
  const [machineId, setMachineId] = useState('')
  const machines = useMachineOptions(), slots = useSlotOptions(machineId), batches = useBatchOptions()
  const form = useForm({ batchId: '', slotId: '', quantity: '' })
  const { values, errors } = form
  return <FormDialog title="Nạp hàng vào ngăn" submitLabel="Nạp hàng" close={close} onFieldErrors={form.setErrors} onSubmit={async () => {
    const problems: Record<string, string> = {}
    if (!values.batchId) problems.batchId = 'Vui lòng chọn lô hàng.'
    if (!values.slotId) problems.slotId = 'Vui lòng chọn ngăn.'
    const quantity = parseInteger(values.quantity)
    if (quantity === undefined || quantity < 1) problems.quantity = 'Số lượng phải là số nguyên lớn hơn 0.'
    if (Object.keys(problems).length || quantity === undefined) return form.fail(problems)
    await inventoryApi.load({ batchId: values.batchId, slotId: values.slotId, quantity })
    done()
  }}>
    <Field label="Lô hàng" error={errors.batchId}><select value={values.batchId} onChange={event => form.set('batchId')(event.target.value)}>
      <option value="">Chọn lô…</option>{batches.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></Field>
    <Field label="Máy"><select value={machineId} onChange={event => { setMachineId(event.target.value); form.set('slotId')('') }}>
      <option value="">Chọn máy…</option>{machines.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></Field>
    <Field label="Ngăn" error={errors.slotId}><select value={values.slotId} disabled={!machineId} onChange={event => form.set('slotId')(event.target.value)}>
      <option value="">Chọn ngăn…</option>{slots.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></Field>
    <Field label="Số hộp nạp" error={errors.quantity} hint="Vượt sức chứa ngăn hoặc số lượng khai báo của lô sẽ bị từ chối."><input inputMode="numeric" value={values.quantity} onChange={event => form.set('quantity')(event.target.value)} /></Field>
  </FormDialog>
}

function RemoveDialog({ item, close, done }: { item: InventoryItem; close: () => void; done: () => void }) {
  const form = useForm({ reason: '' })
  return <FormDialog title="Gỡ hộp khỏi ngăn" submitLabel="Gỡ hộp" danger close={close} onFieldErrors={form.setErrors} onSubmit={async () => {
    if (!form.values.reason.trim()) return form.fail({ reason: 'Vui lòng nhập lý do.' })
    await inventoryApi.remove(item.id ?? '', form.values.reason.trim())
    done()
  }}>
    <p>{item.productName} · lô {item.batchCode} · ngăn {item.slotCode}</p>
    <Field label="Lý do" error={form.errors.reason}><textarea value={form.values.reason} onChange={event => form.set('reason')(event.target.value)} /></Field>
  </FormDialog>
}

export default InventoryPage
