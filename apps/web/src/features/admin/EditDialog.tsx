import { useState } from 'react';
import type { Action, Actor, Store, Task } from './domain';
import { dayVN, inventory, dateVN } from './domain';
import { Field, Modal, Photo, Select, Badge } from './ui';
export type Editor = {
    kind: string;
    id?: string;
    machineId?: string;
    staffId?: string;
};
type Props = {
    editor: Editor;
    store: Store;
    close: () => void;
    commit: (a: Action, actor?: Actor) => void;
};
export default function EditDialog({ editor: e, store: s, close, commit }: Props) {
    const machine = s.machines.find(x => x.id === e.id), product = s.products.find(x => x.id === e.id), staff = s.staff.find(x => x.id === e.id), slot = s.slots.find(x => x.id === e.id), task = s.tasks.find(x => x.id === e.id), transaction = s.transactions.find(x => x.id === e.id), lot = s.lots.find(x => x.id === e.id);
    const [name, setName] = useState(e.kind === 'machine' ? machine?.name || '' : e.kind === 'product' ? product?.name || '' : staff?.name || '');
    const [code, setCode] = useState(e.kind === 'slot' ? slot?.code || '' : machine?.code || '');
    const [location, setLocation] = useState(machine?.location || '');
    const [status, setStatus] = useState(e.kind === 'incident' ? (transaction?.incident === 'WAITING' ? 'PROCESSING' : 'RESOLVED') : machine?.status || 'ACTIVE');
    const [mid, setMid] = useState(e.machineId || slot?.machineId || task?.machineId || '');
    const [pid, setPid] = useState(slot?.productId || e.kind === 'price' && e.id || '');
    const [sid, setSid] = useState(task?.staffId || '');
    const [description, setDescription] = useState(e.kind === 'product' ? product?.description || '' : task?.description || '');
    const [email, setEmail] = useState(staff?.email || '');
    const [active, setActive] = useState(staff?.active ?? true);
    const [assigned, setAssigned] = useState(staff?.machineIds || []);
    const [amount, setAmount] = useState(String(slot?.capacity || lot?.quantity || ''));
    const [image, setImage] = useState(product?.image || '');
    const [before, setBefore] = useState(''), [after, setAfter] = useState('');
    const [kind, setKind] = useState<Task['kind']>(task?.kind || 'REFILL');
    const [due, setDue] = useState(task?.due || dayVN());
    const [lines, setLines] = useState<Task['lines']>(task?.lines || []);
    const [actual, setActual] = useState<Task['actual']>(task?.lines.map(l => ({ slotId: l.slotId, quantity: l.planned, expiry: '' })) || []);
    const [note, setNote] = useState('');
    const machines = s.machines.filter(x => !x.archived).map(x => ({ id: x.id, name: `${x.code} · ${x.location}` })), products = s.products.filter(x => !x.archived);
    const title: Record<string, string> = { machine: e.id ? 'Sửa thông tin máy' : 'Thêm máy', product: e.id ? 'Sửa sản phẩm' : 'Thêm sản phẩm', staff: e.id ? 'Cập nhật nhân viên' : 'Thêm nhân viên mẫu', slot: e.id ? 'Cấu hình ngăn' : 'Thêm ngăn máy', price: 'Giá bán theo máy', task: e.id ? 'Sửa phân công' : 'Phân công công việc', complete: 'Hoàn thành công việc', incident: 'Xử lý nhả hàng thất bại', remove: 'Ghi nhận lấy hàng ra', archiveMachine: 'Ngừng sử dụng máy', archiveProduct: 'Ngừng sử dụng sản phẩm', cancel: 'Hủy công việc', help: 'Yêu cầu hỗ trợ', detail: 'Chi tiết công việc', transaction: 'Chi tiết giao dịch' };
    function save() {
        if (e.kind === 'machine')
            commit({ type: 'machine', value: { id: e.id, code, name, location, status: status as 'ACTIVE' } });
        if (e.kind === 'product')
            commit({ type: 'product', value: { id: e.id, name, description, image } });
        if (e.kind === 'staff')
            commit({ type: 'staff', value: { id: e.id, name, email, active, machineIds: assigned } });
        if (e.kind === 'slot')
            commit({ type: 'slot', value: { id: e.id, machineId: mid, productId: pid, code, capacity: Number(amount) } });
        if (e.kind === 'price')
            commit({ type: 'price', machineId: mid, productId: pid, amount: Number(amount) });
        if (e.kind === 'task')
            commit({ type: 'task', value: { id: e.id, machineId: mid, staffId: sid, kind, due, description, lines } });
        if (e.kind === 'complete')
            commit({ type: 'complete', id: e.id!, actual, notes: note, before, after }, { role: 'STAFF', id: e.staffId! });
        if (e.kind === 'incident')
            commit({ type: 'incident', id: e.id!, status: status as 'PROCESSING', note });
        if (e.kind === 'remove')
            commit({ type: 'remove-lot', id: e.id!, quantity: Number(amount), reason: note });
        if (e.kind.startsWith('archive'))
            commit({ type: 'archive', entity: e.kind === 'archiveMachine' ? 'machines' : 'products', id: e.id! });
        if (e.kind === 'cancel' || e.kind === 'help')
            commit({ type: 'task-status', id: e.id!, status: e.kind === 'cancel' ? 'CANCELLED' : 'NEEDS_HELP', note }, e.kind === 'help' ? { role: 'STAFF', id: e.staffId! } : { role: 'ADMIN' });
    }
    const machineSelect = <Select label="Máy" value={mid} onChange={v => { setMid(v); setLines([]); }} items={machines}/>;
    return <Modal title={title[e.kind] || 'Chi tiết'} close={close} onSave={['detail', 'transaction'].includes(e.kind) ? undefined : save} save={e.kind === 'complete' ? 'Hoàn thành & cập nhật' : e.kind.startsWith('archive') ? 'Xác nhận ngừng sử dụng' : 'Lưu thay đổi'}>
 {['machine', 'product', 'staff'].includes(e.kind) && <Field label={e.kind === 'staff' ? 'Họ và tên' : 'Tên'}><input required value={name} onChange={x => setName(x.target.value)}/></Field>}
 {e.kind === 'machine' && <><Field label="Mã máy"><input required value={code} onChange={x => setCode(x.target.value)}/></Field><Field label="Vị trí lắp đặt"><input required value={location} onChange={x => setLocation(x.target.value)}/></Field><Select label="Trạng thái vận hành" value={status} onChange={setStatus} items={[{ id: 'ACTIVE', name: 'Hoạt động' }, { id: 'MAINTENANCE', name: 'Bảo trì' }, { id: 'INACTIVE', name: 'Ngừng hoạt động' }]}/><p className="a-hint">Trạng thái kết nối là dữ liệu mô phỏng. Máy mới sẽ hiển thị chưa có kết nối.</p></>}
 {e.kind === 'product' && <><Field label="Thông tin sản phẩm"><textarea value={description} onChange={x => setDescription(x.target.value)}/></Field><Photo label="Ảnh sản phẩm (tùy chọn)" value={image} onChange={setImage}/><p className="a-hint">Giá bán được thiết lập riêng tại từng máy.</p></>}
 {e.kind === 'staff' && <><Field label="Email"><input required type="email" value={email} onChange={x => setEmail(x.target.value)}/></Field><label className="a-check"><input type="checkbox" checked={active} onChange={x => setActive(x.target.checked)}/>Đang hoạt động</label><fieldset><legend>Máy được phân công</legend>{machines.map(m => <label className="a-check" key={m.id}><input type="checkbox" checked={assigned.includes(m.id)} onChange={x => setAssigned(x.target.checked ? [...assigned, m.id] : assigned.filter(id => id !== m.id))}/>{m.name}</label>)}</fieldset><p className="a-hint">Hồ sơ mẫu, chưa tạo tài khoản đăng nhập thực tế.</p></>}
 {['slot', 'price', 'task'].includes(e.kind) && (!e.id || e.kind !== 'slot' ? machineSelect : <p>Máy: {machines.find(m => m.id === mid)?.name}</p>)}
 {['slot', 'price'].includes(e.kind) && <><Select label="Sản phẩm" value={pid} onChange={setPid} items={products}/>{e.kind === 'slot' && <Field label="Mã ngăn"><input required value={code} onChange={x => setCode(x.target.value)}/></Field>}<Field label={e.kind === 'slot' ? 'Sức chứa tối đa (hộp)' : 'Giá bán (₫)'}><input required type="number" min="1" step="1" value={amount} onChange={x => setAmount(x.target.value)}/></Field>{e.kind === 'price' && <p>Giá hiện tại: {s.prices.find(p => p.machineId === mid && p.productId === pid)?.amount.toLocaleString('vi-VN') || 'Chưa thiết lập'} ₫</p>}</>}
 {e.kind === 'task' && <><Select label="Loại công việc" value={kind} onChange={v => setKind(v as Task['kind'])} items={[{ id: 'REFILL', name: 'Refill hàng' }, { id: 'MAINTENANCE', name: 'Bảo trì máy' }]}/><Select label="Nhân viên thực hiện" value={sid} onChange={setSid} items={s.staff.filter(x => x.active)}/><Field label="Hạn hoàn thành"><input required type="date" value={due} onInput={x => setDue(x.currentTarget.value)} onChange={x => setDue(x.target.value)}/></Field><Field label="Mô tả công việc / lỗi"><textarea required value={description} onChange={x => setDescription(x.target.value)}/></Field>{kind === 'REFILL' && <fieldset><legend>Chọn ngăn & số hộp dự kiến</legend>{s.slots.filter(x => x.machineId === mid).map(slot => <div className="a-refill-line" key={slot.id}><label className="a-check"><input type="checkbox" checked={lines.some(l => l.slotId === slot.id)} onChange={x => setLines(x.target.checked ? [...lines, { slotId: slot.id, planned: 1 }] : lines.filter(l => l.slotId !== slot.id))}/>{slot.code} · {s.products.find(p => p.id === slot.productId)?.name}<small>Còn {inventory(s, slot.id).total}/{slot.capacity} hộp</small></label>{lines.some(l => l.slotId === slot.id) && <input aria-label={`Số hộp dự kiến ngăn ${slot.code}`} type="number" min="1" required value={lines.find(l => l.slotId === slot.id)?.planned} onChange={x => setLines(lines.map(l => l.slotId === slot.id ? { ...l, planned: Number(x.target.value) } : l))}/>}</div>)}</fieldset>}<p className="a-hint">Máy sẽ được thêm vào phạm vi phụ trách của nhân viên khi giao việc.</p></>}
 {e.kind === 'complete' && task && <><p>{task.description}</p>{task.kind === 'REFILL' ? <>{task.lines.map(line => <fieldset key={line.slotId}><legend>Ngăn {s.slots.find(x => x.id === line.slotId)?.code} · dự kiến {line.planned} hộp</legend>{actual.map((a, i) => a.slotId === line.slotId && <div className="a-lot-entry" key={i}><Field label="Số hộp thực tế"><input required type="number" min="1" value={a.quantity} onChange={x => setActual(actual.map((v, j) => j === i ? { ...v, quantity: Number(x.target.value) } : v))}/></Field><Field label="Hạn dùng"><input required type="date" min={dayVN()} value={a.expiry} onInput={x => { const expiry = x.currentTarget.value; setActual(previous => previous.map((v, j) => j === i ? { ...v, expiry } : v)); }} onChange={x => { const expiry = x.target.value; setActual(previous => previous.map((v, j) => j === i ? { ...v, expiry } : v)); }}/></Field><button type="button" onClick={() => setActual(actual.filter((_, j) => i !== j))}>Bỏ lô</button></div>)}<button type="button" onClick={() => setActual([...actual, { slotId: line.slotId, quantity: 1, expiry: '' }])}>+ Thêm lô hạn dùng khác</button></fieldset>)}<p className="a-hint">Nhập số lượng đã thực sự refill. Xóa dòng lô nếu không nạp được hàng và ghi rõ lý do.</p></> : <><Photo label="Ảnh trước bảo trì" value={before} onChange={setBefore}/><Photo label="Ảnh sau bảo trì" value={after} onChange={setAfter}/></>}</>}
 {e.kind === 'incident' && transaction && <><p><strong>{transaction.id}</strong> · {transaction.machineCode}</p><p>{transaction.location}</p><Badge value={transaction.incident}/><Select label="Trạng thái tiếp theo" value={status} onChange={setStatus} items={transaction.incident === 'WAITING' ? [{ id: 'PROCESSING', name: 'Đang xử lý' }] : [{ id: 'RESOLVED', name: 'Đã giải quyết' }, { id: 'REFUNDED', name: 'Đã hoàn tiền' }]}/><p className="a-hint">Chỉ ghi nhận trạng thái trên dữ liệu mẫu. Thao tác này không chuyển tiền và không cộng doanh thu.</p></>}
 {e.kind === 'remove' && <><p>Lô {lot?.id} · hạn dùng {lot?.expiry}</p><Field label="Số hộp lấy ra"><input required type="number" min="1" max={lot?.quantity} value={amount} onChange={x => setAmount(x.target.value)}/></Field></>}
 {['complete', 'incident', 'remove', 'cancel', 'help'].includes(e.kind) && <Field label="Ghi chú / kết quả"><textarea required={e.kind !== 'complete' || task?.kind === 'MAINTENANCE'} value={note} onChange={x => setNote(x.target.value)}/></Field>}
 {e.kind.startsWith('archive') && <p>Ngừng sử dụng <strong>{e.kind === 'archiveMachine' ? machine?.name : product?.name}</strong>? Lịch sử vẫn được giữ. Chỉ thực hiện khi đã lấy hết hàng và kết thúc công việc liên quan.</p>}
 {e.kind === 'detail' && task && <><Badge value={task.status}/><p>{task.description}</p><p>Hạn hoàn thành: {task.due}</p>{task.lines.map(l => <p key={l.slotId}>Ngăn {s.slots.find(x => x.id === l.slotId)?.code}: dự kiến {l.planned}, thực tế {task.actual.filter(a => a.slotId === l.slotId).reduce((n, a) => n + a.quantity, 0)} hộp</p>)}{task.actual.map((a, i) => <p key={i}>{a.quantity} hộp · HSD {a.expiry}</p>)}<p>{task.notes}</p>{task.before && <img className="a-photo" src={task.before} alt="Trước bảo trì"/>}{task.after && <img className="a-photo" src={task.after} alt="Sau bảo trì"/>}</>}
 {e.kind === 'transaction' && transaction && <><p><strong>{transaction.id}</strong> · {dateVN(transaction.at)}</p><p>{transaction.machineCode} · {transaction.location}</p><p>{transaction.product} · {transaction.amount.toLocaleString('vi-VN')} ₫</p><Badge value={transaction.status}/><p>Thanh toán: {transaction.paid ? 'Đã thanh toán' : 'Chưa thanh toán'}</p>{transaction.error && <p>Mã lỗi: {transaction.error}</p>}</>}
 {['detail', 'incident', 'transaction'].includes(e.kind) && <div className="a-history"><h3>Lịch sử</h3>{(e.kind === 'detail' ? task?.history : transaction?.history)?.map((h, i) => <p key={i}><small>{dateVN(h.at)} · {h.actor}</small><br />{h.text}</p>)}</div>}
 </Modal>;
}
