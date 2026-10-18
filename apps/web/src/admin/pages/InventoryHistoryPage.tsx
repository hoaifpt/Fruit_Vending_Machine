import { inventoryApi } from '../../api/resources.ts'
import { formatDateTime } from '../../lib/format.ts'
import { useQueryParams } from '../../lib/router.ts'
import { Badge, DataTable, PAGE_SIZE, PageHead, Pagination, SelectFilter, TextInput, Toolbar, enumOptions, pageParam } from '../kit.tsx'
import { useMachineOptions, useSlotOptions } from '../options.ts'
import { useApi } from '../useApi.ts'
import { InventoryTabs } from './InventoryPage.tsx'

const TYPES = ['LOAD', 'RESERVE', 'SALE', 'EXPIRE', 'REMOVE', 'RETURN', 'ADJUSTMENT'] as const

function InventoryHistoryPage() {
  const { params, update } = useQueryParams()
  const machineId = params.get('machineId') ?? '', slotId = params.get('slotId') ?? '', type = params.get('type') ?? ''
  const referenceId = params.get('referenceId') ?? '', inventoryItemId = params.get('inventoryItemId') ?? '', page = pageParam(params)
  const machines = useMachineOptions(), slots = useSlotOptions(machineId)
  const state = useApi(signal => inventoryApi.history({
    page, size: PAGE_SIZE, machineId: machineId || undefined, slotId: slotId || undefined, type: (type || undefined) as 'LOAD' | undefined,
    referenceId: referenceId || undefined, inventoryItemId: inventoryItemId || undefined,
  }, signal), params.toString())
  return <>
    <PageHead title="Lịch sử tồn kho" subtitle="Nhật ký chỉ ghi thêm: không thể sửa hoặc xóa." />
    <InventoryTabs current="history" />
    <Toolbar>
      <SelectFilter label="Máy" value={machineId} onChange={value => update({ machineId: value, slotId: '' })} options={machines} />
      <SelectFilter label="Ngăn" value={slotId} onChange={value => update({ slotId: value })} options={slots} empty={machineId ? 'Tất cả ngăn' : 'Chọn máy trước'} />
      <SelectFilter label="Loại" value={type} onChange={value => update({ type: value })} options={enumOptions(TYPES)} />
      <TextInput label="Mã hộp hàng (UUID)" value={inventoryItemId} onCommit={value => update({ inventoryItemId: value })} />
      <TextInput label="Mã tham chiếu (UUID)" value={referenceId} onCommit={value => update({ referenceId: value })} />
    </Toolbar>
    <DataTable state={state} rows={state.data?.content} rowKey={entry => entry.id ?? ''} columns={[
      { head: 'Thời gian', cell: entry => formatDateTime(entry.createdAt) },
      { head: 'Loại', cell: entry => <Badge value={entry.type} /> },
      { head: 'Lô', cell: entry => entry.batchCode },
      { head: 'Trước → sau', cell: entry => <><Badge value={entry.statusBefore} /> → <Badge value={entry.statusAfter} /></> },
      { head: 'Lý do', cell: entry => entry.reason || '—' },
      { head: 'Hộp hàng', cell: entry => <small>{entry.inventoryItemId}</small> },
    ]} />
    {state.data && <Pagination page={state.data.page} totalPages={state.data.totalPages} totalElements={state.data.totalElements} onPage={next => update({ page: String(next) })} />}
  </>
}

export default InventoryHistoryPage
