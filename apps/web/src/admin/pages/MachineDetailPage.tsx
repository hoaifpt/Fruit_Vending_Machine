import { useEffect, useRef, useState } from 'react'
import { kioskCredentialsApi, machinesApi, slotsApi } from '../../api/resources.ts'
import type { IssuedKioskCredential, KioskCredential, Slot } from '../../api/resources.ts'
import { formatDateTime, parseInteger } from '../../lib/format.ts'
import { useQueryParams } from '../../lib/router.ts'
import { Badge, ConfirmDialog, DataTable, ErrorState, Field, FormDialog, Link, Loading, PAGE_SIZE, PageHead, Pagination, SelectFilter, STATUS_ACTIONS, StatusDialog, Toolbar, enumOptions, pageParam, useDialog, useForm } from '../kit.tsx'
import { useApi } from '../useApi.ts'
import { MachineDialog, lastSeen } from './MachinesPage.tsx'

type SlotTarget = { kind: 'create' } | { kind: 'capacity'; slot: Slot } | { kind: 'status'; slot: Slot }

function MachineDetailPage({ machineId, isAdmin }: { machineId: string; isAdmin: boolean }) {
  const machine = useApi(signal => machinesApi.get(machineId, signal), machineId)
  const [dialog, setDialog] = useState<'edit' | 'status' | null>(null)
  if (machine.error && !machine.data) return <><PageHead title="Máy bán hàng" back={{ to: '/admin/machines', label: 'Danh sách máy' }} /><ErrorState error={machine.error} retry={machine.reload} /></>
  const data = machine.data
  if (!data) return <Loading />
  return <>
    <PageHead title={`${data.name} (${data.code})`} back={{ to: '/admin/machines', label: 'Danh sách máy' }}
      actions={isAdmin ? <>
        <button type="button" onClick={() => setDialog('edit')}>Cấu hình</button>
        <button type="button" onClick={() => setDialog('status')}>Đổi trạng thái</button>
      </> : undefined} />
    <section className="a-panel" aria-label="Thông tin máy">
      <dl className="a-dl">
        <dt>Trạng thái (quản trị)</dt><dd><Badge value={data.status} /></dd>
        <dt>Vị trí</dt><dd>{data.location || '—'}</dd>
        <dt>Nhiệt độ cho phép</dt><dd>{data.minTemperature} – {data.maxTemperature} °C</dd>
        <dt>Độ ẩm cho phép</dt><dd>{data.minHumidity} – {data.maxHumidity} %</dd>
        <dt>Lần cuối thấy máy</dt><dd>{lastSeen(data)}</dd>
        <dt>Tạo / cập nhật</dt><dd>{formatDateTime(data.createdAt)} / {formatDateTime(data.updatedAt)}</dd>
      </dl>
    </section>
    <SlotsSection machineId={machineId} isAdmin={isAdmin} />
    {isAdmin && <CredentialsSection machineId={machineId} />}
    {dialog === 'edit' && <MachineDialog machine={data} close={() => setDialog(null)} done={machine.reload} />}
    {dialog === 'status' && <StatusDialog title="Trạng thái máy" current={data.status} options={STATUS_ACTIONS.MACHINE} close={() => setDialog(null)}
      onSubmit={async status => { await machinesApi.setStatus(machineId, status as 'ACTIVE'); machine.reload() }} />}
  </>
}

function SlotsSection({ machineId, isAdmin }: { machineId: string; isAdmin: boolean }) {
  const { params, update } = useQueryParams()
  const page = pageParam(params), status = params.get('slotStatus') ?? ''
  const state = useApi(signal => slotsApi.list(machineId, { page, size: PAGE_SIZE, status: (status || undefined) as 'ACTIVE' | undefined, sort: 'slotCode,asc' }, signal), `${machineId}|${params}`)
  const dialog = useDialog<SlotTarget>()
  const target = dialog.value
  return <section className="a-panel" aria-labelledby="slots-title">
    <div className="a-section-head">
      <div><h2 id="slots-title">Ngăn chứa</h2><p>Mỗi ngăn chứa tối đa theo sức chứa đã cấu hình.</p></div>
      {isAdmin && <button type="button" className="a-primary" onClick={() => dialog.open({ kind: 'create' })}>Thêm ngăn</button>}
    </div>
    <Toolbar><SelectFilter label="Trạng thái ngăn" value={status} onChange={value => update({ slotStatus: value })} options={enumOptions(STATUS_ACTIONS.SLOT)} /></Toolbar>
    <DataTable state={state} rows={state.data?.content} rowKey={slot => slot.id} columns={[
      { head: 'Mã ngăn', cell: slot => slot.slotCode },
      { head: 'Sức chứa', cell: slot => slot.capacity },
      { head: 'Tồn kho', cell: slot => <SlotSummary machineId={machineId} slot={slot} /> },
      { head: 'Trạng thái', cell: slot => <Badge value={slot.status} /> },
      { head: 'Thao tác', cell: slot => <div className="a-actions">
        <Link to={`/admin/inventory?machineId=${machineId}&slotId=${slot.id}`}>Xem hộp hàng</Link>
        {isAdmin && <><button type="button" onClick={() => dialog.open({ kind: 'capacity', slot })}>Sức chứa</button>
          <button type="button" onClick={() => dialog.open({ kind: 'status', slot })}>Đổi trạng thái</button></>}
      </div> },
    ]} />
    {state.data && <Pagination page={state.data.page} totalPages={state.data.totalPages} totalElements={state.data.totalElements} onPage={next => update({ page: String(next) })} />}
    {target?.kind === 'create' && <SlotDialog machineId={machineId} close={dialog.close} done={state.reload} />}
    {target?.kind === 'capacity' && <SlotDialog machineId={machineId} slot={target.slot} close={dialog.close} done={state.reload} />}
    {target?.kind === 'status' && <StatusDialog title={`Trạng thái ngăn ${target.slot.slotCode}`} current={target.slot.status} options={STATUS_ACTIONS.SLOT} close={dialog.close}
      onSubmit={async next => { await slotsApi.setStatus(machineId, target.slot.id, next as 'ACTIVE'); state.reload() }} />}
  </section>
}

function SlotSummary({ machineId, slot }: { machineId: string; slot: Slot }) {
  const summary = useApi(signal => slotsApi.summary(machineId, slot.id, signal), `${machineId}|${slot.id}|${slot.updatedAt}`)
  if (summary.error) return <small>Không tải được</small>
  const data = summary.data
  if (!data) return <small>…</small>
  return <small>{data.occupiedCount}/{data.capacity} hộp · bán được {data.sellableCount} · hết hạn {data.expiredCount} · giữ chỗ {data.reservedCount}</small>
}

function SlotDialog({ machineId, slot, close, done }: { machineId: string; slot?: Slot; close: () => void; done: () => void }) {
  const form = useForm({ slotCode: slot?.slotCode ?? '', capacity: slot ? String(slot.capacity) : '' })
  const { values, errors } = form
  return <FormDialog title={slot ? `Sức chứa ngăn ${slot.slotCode}` : 'Thêm ngăn'} close={close} onFieldErrors={form.setErrors} onSubmit={async () => {
    const problems: Record<string, string> = {}
    if (!slot && !values.slotCode.trim()) problems.slotCode = 'Vui lòng nhập mã ngăn.'
    const capacity = parseInteger(values.capacity)
    if (capacity === undefined || capacity < 1) problems.capacity = 'Sức chứa phải là số nguyên lớn hơn 0.'
    if (Object.keys(problems).length || capacity === undefined) return form.fail(problems)
    if (slot) await slotsApi.update(machineId, slot.id, { capacity })
    else await slotsApi.create(machineId, { slotCode: values.slotCode.trim(), capacity })
    done()
  }}>
    <Field label="Mã ngăn" error={errors.slotCode} hint={slot ? 'Mã ngăn không thể thay đổi.' : undefined}><input value={values.slotCode} readOnly={!!slot} onChange={event => form.set('slotCode')(event.target.value)} /></Field>
    <Field label="Sức chứa (số hộp)" error={errors.capacity}><input inputMode="numeric" value={values.capacity} onChange={event => form.set('capacity')(event.target.value)} /></Field>
  </FormDialog>
}

type CredentialTarget = { kind: 'issue'; rotate: boolean } | { kind: 'revoke'; credential: KioskCredential }

function CredentialsSection({ machineId }: { machineId: string }) {
  const state = useApi(signal => kioskCredentialsApi.list(machineId, signal), machineId)
  const dialog = useDialog<CredentialTarget>()
  // The plaintext key lives only in this component state while the modal is open; it is never persisted.
  const [issued, setIssued] = useState<IssuedKioskCredential | null>(null)
  const target = dialog.value
  const hasActive = !!state.data?.some(credential => credential.status === 'ACTIVE')
  return <section className="a-panel" aria-labelledby="credentials-title">
    <div className="a-section-head">
      <div><h2 id="credentials-title">Khóa API kiosk</h2><p>Mỗi máy dùng một khóa. Chỉ quản trị viên xem được danh sách này.</p></div>
      <button type="button" className="a-primary" onClick={() => dialog.open({ kind: 'issue', rotate: hasActive })}>{hasActive ? 'Cấp khóa mới (xoay khóa)' : 'Cấp khóa'}</button>
    </div>
    <DataTable state={state} rows={state.data} rowKey={credential => credential.credentialId ?? ''} empty="Máy chưa có khóa nào." columns={[
      { head: 'Tiền tố khóa', cell: credential => credential.keyPrefix },
      { head: 'Trạng thái', cell: credential => <Badge value={credential.status} /> },
      { head: 'Cấp lúc', cell: credential => formatDateTime(credential.createdAt) },
      { head: 'Thu hồi lúc', cell: credential => formatDateTime(credential.revokedAt) },
      { head: 'Thao tác', cell: credential => credential.status === 'ACTIVE'
        ? <button type="button" className="a-danger" onClick={() => dialog.open({ kind: 'revoke', credential })}>Thu hồi</button> : null },
    ]} />
    {target?.kind === 'issue' && <ConfirmDialog title={target.rotate ? 'Cấp khóa mới' : 'Cấp khóa kiosk'} confirmLabel={target.rotate ? 'Cấp khóa và vô hiệu khóa cũ' : 'Cấp khóa'} danger={target.rotate} close={dialog.close}
      message={target.rotate ? 'Khóa mới sẽ vô hiệu hóa khóa hiện tại ngay lập tức. Kiosk đang dùng khóa cũ sẽ ngừng hoạt động cho đến khi cấu hình khóa mới.' : 'Khóa chỉ hiển thị một lần sau khi cấp.'}
      onConfirm={async () => { const result = await kioskCredentialsApi.issue(machineId); setIssued(result); state.reload() }} />}
    {target?.kind === 'revoke' && <ConfirmDialog title="Thu hồi khóa" confirmLabel="Thu hồi" danger close={dialog.close}
      message={`Khóa ${target.credential.keyPrefix} sẽ ngừng hoạt động ngay. Không thể hoàn tác.`}
      onConfirm={async () => { await kioskCredentialsApi.revoke(machineId, target.credential.credentialId ?? ''); state.reload() }} />}
    {issued && <IssuedKeyDialog credential={issued} close={() => setIssued(null)} />}
  </section>
}

function IssuedKeyDialog({ credential, close }: { credential: IssuedKioskCredential; close: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  const [copied, setCopied] = useState<'ok' | 'fail' | ''>('')
  useEffect(() => { const dialog = ref.current; dialog?.showModal(); return () => dialog?.close() }, [])
  async function copy() {
    try { await navigator.clipboard.writeText(credential.apiKey ?? ''); setCopied('ok') } catch { setCopied('fail') }
  }
  return <dialog ref={ref} className="a-modal admin-app" aria-labelledby="issued-key-title" onCancel={event => event.preventDefault()}>
    <header><h2 id="issued-key-title">Khóa API kiosk mới</h2></header>
    <div className="a-modal-body">
      <p className="a-error" role="alert">Sao chép khóa ngay bây giờ. Khóa này chỉ hiển thị một lần và không thể xem lại sau khi đóng.</p>
      <code className="a-key">{credential.apiKey}</code>
      <div className="a-actions"><button type="button" className="a-primary" onClick={copy}>Sao chép khóa</button>
        <span role="status">{copied === 'ok' ? 'Đã sao chép.' : copied === 'fail' ? 'Không thể tự sao chép; hãy bôi đen và sao chép thủ công.' : ''}</span></div>
    </div>
    <footer><button type="button" onClick={close}>Tôi đã lưu khóa, đóng</button></footer>
  </dialog>
}

export default MachineDetailPage
