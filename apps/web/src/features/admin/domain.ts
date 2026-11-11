export type Machine = {
    id: string;
    code: string;
    name: string;
    location: string;
    status: 'ACTIVE' | 'MAINTENANCE' | 'INACTIVE';
    online: boolean;
    lastSeen: string;
    archived: boolean;
};
export type Product = {
    id: string;
    name: string;
    description: string;
    image: string;
    archived: boolean;
};
export type Price = {
    machineId: string;
    productId: string;
    amount: number;
};
export type Slot = {
    id: string;
    machineId: string;
    code: string;
    productId: string;
    capacity: number;
};
export type Lot = {
    id: string;
    slotId: string;
    quantity: number;
    expiry: string;
    addedAt: string;
    taskId?: string;
};
export type Staff = {
    id: string;
    name: string;
    email: string;
    active: boolean;
    machineIds: string[];
};
export type History = {
    at: string;
    actor: string;
    text: string;
};
export type Task = {
    id: string;
    kind: 'REFILL' | 'MAINTENANCE';
    machineId: string;
    staffId: string;
    due: string;
    description: string;
    status: 'ASSIGNED' | 'IN_PROGRESS' | 'NEEDS_HELP' | 'DONE' | 'CANCELLED';
    lines: {
        slotId: string;
        planned: number;
    }[];
    actual: {
        slotId: string;
        quantity: number;
        expiry: string;
    }[];
    notes: string;
    before: string;
    after: string;
    history: History[];
};
export type Transaction = {
    id: string;
    machineId: string;
    machineCode: string;
    location: string;
    product: string;
    amount: number;
    paid: boolean;
    status: 'SUCCESS' | 'DISPENSE_FAILED' | 'PENDING_PAYMENT';
    at: string;
    incident: 'WAITING' | 'PROCESSING' | 'REFUNDED' | 'RESOLVED';
    history: History[];
    error?: string;
};
export type Store = {
    version: 1;
    revision: number;
    generatedAt: string;
    machines: Machine[];
    products: Product[];
    prices: Price[];
    slots: Slot[];
    lots: Lot[];
    staff: Staff[];
    tasks: Task[];
    transactions: Transaction[];
    audit: History[];
};
export type Actor = {
    role: 'ADMIN';
} | {
    role: 'STAFF';
    id: string;
};
export const money = (value: number) => new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND', maximumFractionDigits: 0 }).format(value);
export const dateVN = (value: string) => new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date(value));
export function dayVN(value: Date | string = new Date()) { return new Date(new Date(value).getTime() + 7 * 3600000).toISOString().slice(0, 10); }
export function shiftDay(day: string, offset: number) { const d = new Date(`${day}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + offset); return d.toISOString().slice(0, 10); }
export function validDay(value: string) { return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value; }
export function inventory(store: Pick<Store, 'lots'>, slotId: string, today = dayVN()) {
    const lots = store.lots.filter(l => l.slotId === slotId && l.quantity > 0);
    const total = lots.reduce((sum, l) => sum + l.quantity, 0);
    const sellable = lots.filter(l => l.expiry >= today).reduce((sum, l) => sum + l.quantity, 0);
    return { lots, total, sellable, low: sellable <= 2, expired: lots.some(l => l.expiry < today), expiring: lots.some(l => l.expiry >= today && l.expiry <= shiftDay(today, 1)) };
}
export function inPeriod(t: Transaction, mode: string, value: string) { const d = dayVN(t.at); return mode === 'day' ? d === value : mode === 'month' ? d.slice(0, 7) === value : d.slice(0, 4) === value; }
export function revenue(transactions: Transaction[], mode: string, value: string, machineId = '') {
    const filtered = transactions.filter(t => (!machineId || t.machineId === machineId) && inPeriod(t, mode, value));
    const successful = filtered.filter(t => t.paid && t.status === 'SUCCESS');
    const count = mode === 'day' ? 24 : mode === 'year' ? 12 : new Date(Number(value.slice(0, 4)), Number(value.slice(5, 7)), 0).getDate();
    const buckets = Array.from({ length: count }, (_, i) => ({ label: mode === 'day' ? `${i}h` : `${i + 1}`, amount: 0 }));
    for (const t of successful) {
        const local = new Date(new Date(t.at).getTime() + 7 * 3600000);
        const index = mode === 'day' ? local.getUTCHours() : mode === 'year' ? local.getUTCMonth() : local.getUTCDate() - 1;
        if (buckets[index])
            buckets[index].amount += t.amount;
    }
    return { total: successful.reduce((sum, t) => sum + t.amount, 0), successful: successful.length, failed: filtered.filter(t => t.paid && t.status === 'DISPENSE_FAILED').length, buckets, transactions: filtered };
}
function requireValue(value: unknown, message: string): asserts value { if (!value)
    throw new Error(message); }
function text(value: string, label: string) { requireValue(value.trim(), `Vui lòng nhập ${label}.`); return value.trim(); }
function integer(value: number, minimum: number, label: string) { requireValue(Number.isSafeInteger(value) && value >= minimum, `${label} phải là số nguyên từ ${minimum}.`); }
function admin(actor: Actor) { requireValue(actor.role === 'ADMIN', 'Bạn không có quyền thực hiện thao tác này.'); }
function id() { return crypto.randomUUID(); }
function photo(value: string) { return /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(value) && value.length <= 600000; }
export type Action = {
    type: 'machine';
    value: Omit<Machine, 'id' | 'online' | 'lastSeen' | 'archived'> & {
        id?: string;
    };
} | {
    type: 'product';
    value: Omit<Product, 'id' | 'archived'> & {
        id?: string;
    };
} | {
    type: 'staff';
    value: Omit<Staff, 'id'> & {
        id?: string;
    };
} | {
    type: 'archive';
    entity: 'machines' | 'products';
    id: string;
} | {
    type: 'price';
    machineId: string;
    productId: string;
    amount: number;
} | {
    type: 'slot';
    value: Omit<Slot, 'id'> & {
        id?: string;
    };
} | {
    type: 'remove-lot';
    id: string;
    quantity: number;
    reason: string;
} | {
    type: 'task';
    value: Pick<Task, 'kind' | 'machineId' | 'staffId' | 'due' | 'description' | 'lines'> & {
        id?: string;
    };
} | {
    type: 'task-status';
    id: string;
    status: 'IN_PROGRESS' | 'NEEDS_HELP' | 'CANCELLED';
    note: string;
} | {
    type: 'complete';
    id: string;
    actual: Task['actual'];
    notes: string;
    before: string;
    after: string;
} | {
    type: 'incident';
    id: string;
    status: Transaction['incident'];
    note: string;
};
// Local demo domain boundary only. A real backend must enforce the same checks atomically.
export function applyAction(current: Store, action: Action, actor: Actor = { role: 'ADMIN' }, now = new Date()): Store {
    const store = structuredClone(current);
    const at = now.toISOString(), today = dayVN(now);
    const actorName = actor.role === 'ADMIN' ? 'Admin (mẫu)' : store.staff.find(s => s.id === actor.id)?.name ?? 'Staff';
    const audit = (message: string) => store.audit.unshift({ at, actor: actorName, text: message });
    const activeMachine = (machineId: string) => { const m = store.machines.find(m => m.id === machineId && !m.archived); requireValue(m && m.status !== 'INACTIVE', 'Máy không tồn tại hoặc đã ngừng sử dụng.'); return m; };
    const activeProduct = (productId: string) => { requireValue(store.products.some(p => p.id === productId && !p.archived), 'Sản phẩm không tồn tại hoặc đã ngừng sử dụng.'); };
    const openTask = (taskId: string) => {
        const task = store.tasks.find(t => t.id === taskId);
        requireValue(task, 'Không tìm thấy công việc.');
        requireValue(task.status !== 'DONE' && task.status !== 'CANCELLED', 'Công việc đã kết thúc; không thể cập nhật hoặc cộng hàng lần nữa.');
        if (actor.role === 'STAFF')
            requireValue(store.staff.some(s => s.id === actor.id && s.active && s.machineIds.includes(task.machineId)) && task.staffId === actor.id, 'Công việc hoặc máy không được phân công cho bạn.');
        return task;
    };
    switch (action.type) {
        case 'machine': {
            admin(actor);
            const v = action.value;
            const code = text(v.code, 'mã máy');
            const name = text(v.name, 'tên máy');
            const location = text(v.location, 'vị trí');
            requireValue(!store.machines.some(m => m.id !== v.id && m.code.toLowerCase() === code.toLowerCase()), 'Mã máy đã tồn tại, kể cả trong lịch sử.');
            requireValue(['ACTIVE', 'MAINTENANCE', 'INACTIVE'].includes(v.status), 'Trạng thái máy không hợp lệ.');
            if (v.status === 'INACTIVE')
                requireValue(!store.tasks.some(t => t.machineId === v.id && !['DONE', 'CANCELLED'].includes(t.status)), 'Hãy hoàn thành hoặc hủy công việc trước khi ngừng máy.');
            if (v.id) {
                const existing = store.machines.find(m => m.id === v.id && !m.archived);
                requireValue(existing, 'Máy không tồn tại.');
                Object.assign(existing, { code, name, location, status: v.status });
            }
            else
                store.machines.unshift({ id: id(), code, name, location, status: v.status, online: false, lastSeen: '', archived: false });
            audit(`Cập nhật máy ${code}`);
            break;
        }
        case 'product': {
            admin(actor);
            const v = action.value;
            const name = text(v.name, 'tên sản phẩm');
            requireValue(!v.image || photo(v.image), 'Ảnh sản phẩm không hợp lệ hoặc quá lớn.');
            if (v.id) {
                const p = store.products.find(p => p.id === v.id && !p.archived);
                requireValue(p, 'Không tìm thấy sản phẩm.');
                Object.assign(p, { name, description: v.description.trim(), image: v.image });
            }
            else
                store.products.unshift({ id: id(), name, description: v.description.trim(), image: v.image, archived: false });
            audit(`Cập nhật sản phẩm ${name}`);
            break;
        }
        case 'archive': {
            admin(actor);
            const item = store[action.entity].find(i => i.id === action.id && !i.archived);
            requireValue(item, 'Bản ghi không còn tồn tại.');
            const relevantSlots = store.slots.filter(s => action.entity === 'machines' ? s.machineId === action.id : s.productId === action.id);
            requireValue(!relevantSlots.some(s => inventory(store, s.id, today).total > 0), 'Còn hàng trong ngăn. Hãy ghi nhận lấy hàng ra trước khi xóa/ngừng sử dụng.');
            requireValue(!store.tasks.some(t => !['DONE', 'CANCELLED'].includes(t.status) && (action.entity === 'machines' ? t.machineId === action.id : t.lines.some(l => relevantSlots.some(s => s.id === l.slotId)))), 'Còn công việc chưa kết thúc liên quan đến bản ghi này.');
            item.archived = true;
            audit(`Ngừng sử dụng ${item.name}; giữ nguyên lịch sử`);
            break;
        }
        case 'price': {
            admin(actor);
            activeMachine(action.machineId);
            activeProduct(action.productId);
            integer(action.amount, 1, 'Giá bán');
            const price = store.prices.find(p => p.machineId === action.machineId && p.productId === action.productId);
            if (price)
                price.amount = action.amount;
            else
                store.prices.push({ machineId: action.machineId, productId: action.productId, amount: action.amount });
            audit('Cập nhật giá tại một máy');
            break;
        }
        case 'slot': {
            admin(actor);
            const v = action.value;
            activeMachine(v.machineId);
            activeProduct(v.productId);
            integer(v.capacity, 1, 'Sức chứa');
            const code = text(v.code, 'mã ngăn');
            requireValue(!store.slots.some(s => s.machineId === v.machineId && s.id !== v.id && s.code.toLowerCase() === code.toLowerCase()), 'Mã ngăn đã tồn tại tại máy.');
            if (v.id) {
                const slot = store.slots.find(s => s.id === v.id);
                requireValue(slot && slot.machineId === v.machineId, 'Ngăn không hợp lệ.');
                const count = inventory(store, slot.id, today).total;
                requireValue(v.capacity >= count, 'Sức chứa không được nhỏ hơn số hộp đang có.');
                if (v.productId !== slot.productId) {
                    requireValue(count === 0, 'Ngăn còn hàng; không thể đổi loại sản phẩm.');
                    requireValue(!store.tasks.some(t => !['DONE', 'CANCELLED'].includes(t.status) && t.lines.some(l => l.slotId === slot.id)), 'Ngăn đang có công việc refill. Hãy kết thúc công việc trước.');
                }
                Object.assign(slot, { code, capacity: v.capacity, productId: v.productId });
            }
            else
                store.slots.push({ id: id(), code, capacity: v.capacity, productId: v.productId, machineId: v.machineId });
            audit('Cập nhật cấu hình ngăn');
            break;
        }
        case 'remove-lot': {
            admin(actor);
            const lot = store.lots.find(l => l.id === action.id);
            requireValue(lot, 'Không tìm thấy lô.');
            integer(action.quantity, 1, 'Số lấy ra');
            requireValue(action.quantity <= lot.quantity, 'Số lấy ra vượt số còn lại.');
            text(action.reason, 'lý do lấy hàng');
            lot.quantity -= action.quantity;
            audit(`Lấy ${action.quantity} hộp khỏi lô ${lot.id}: ${action.reason.trim()}`);
            break;
        }
        case 'staff': {
            admin(actor);
            const v = action.value;
            const name = text(v.name, 'họ tên');
            const email = text(v.email, 'email');
            requireValue(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email), 'Email không hợp lệ.');
            requireValue(!store.staff.some(s => s.id !== v.id && s.email.toLowerCase() === email.toLowerCase()), 'Email nhân viên đã tồn tại.');
            requireValue(v.machineIds.every(mid => store.machines.some(m => m.id === mid && !m.archived)), 'Máy phân công không hợp lệ.');
            const pending = store.tasks.filter(t => t.staffId === v.id && !['DONE', 'CANCELLED'].includes(t.status));
            requireValue(pending.every(t => v.active && v.machineIds.includes(t.machineId)), 'Hãy giao lại hoặc hủy công việc đang mở trước khi khóa/bỏ máy phân công.');
            if (v.id) {
                const staff = store.staff.find(s => s.id === v.id);
                requireValue(staff, 'Không tìm thấy nhân viên.');
                Object.assign(staff, { name, email, active: v.active, machineIds: [...new Set(v.machineIds)] });
            }
            else
                store.staff.push({ id: id(), name, email, active: v.active, machineIds: [...new Set(v.machineIds)] });
            audit(`Cập nhật nhân viên ${name}`);
            break;
        }
        case 'task': {
            admin(actor);
            const v = action.value;
            activeMachine(v.machineId);
            const staff = store.staff.find(s => s.id === v.staffId && s.active);
            requireValue(staff, 'Chọn nhân viên đang hoạt động.');
            requireValue(validDay(v.due), 'Vui lòng chọn hạn hoàn thành hợp lệ.');
            text(v.description, 'mô tả công việc');
            requireValue(v.kind === 'REFILL' || v.kind === 'MAINTENANCE', 'Loại công việc không hợp lệ.');
            if (v.kind === 'REFILL') {
                requireValue(v.lines.length && new Set(v.lines.map(l => l.slotId)).size === v.lines.length, 'Chọn ít nhất một ngăn; không chọn trùng ngăn.');
                for (const line of v.lines) {
                    const slot = store.slots.find(s => s.id === line.slotId && s.machineId === v.machineId);
                    requireValue(slot, 'Ngăn không thuộc máy đã chọn.');
                    activeProduct(slot.productId);
                    integer(line.planned, 1, 'Số lượng dự kiến');
                    requireValue(line.planned + inventory(store, slot.id, today).total <= slot.capacity, 'Số lượng dự kiến vượt sức chứa ngăn.');
                }
            }
            if (!staff.machineIds.includes(v.machineId))
                staff.machineIds.push(v.machineId);
            if (v.id) {
                const task = openTask(v.id);
                requireValue(task.status === 'ASSIGNED', 'Chỉ sửa phân công khi công việc chưa bắt đầu.');
                Object.assign(task, { ...v, lines: v.kind === 'REFILL' ? v.lines : [] });
                task.history.push({ at, actor: actorName, text: 'Cập nhật phân công' });
            }
            else
                store.tasks.unshift({ ...v, id: id(), lines: v.kind === 'REFILL' ? v.lines : [], status: 'ASSIGNED', actual: [], notes: '', before: '', after: '', history: [{ at, actor: actorName, text: 'Đã phân công' }] });
            audit('Phân công công việc');
            break;
        }
        case 'task-status': {
            const task = openTask(action.id);
            if (action.status === 'CANCELLED') {
                admin(actor);
                text(action.note, 'lý do hủy');
            }
            else {
                requireValue(actor.role === 'STAFF', 'Hãy mở chế độ staff mẫu để bắt đầu công việc.');
                if (action.status === 'NEEDS_HELP')
                    text(action.note, 'nội dung cần hỗ trợ');
                requireValue(['IN_PROGRESS', 'NEEDS_HELP'].includes(action.status), 'Trạng thái không hợp lệ.');
            }
            task.status = action.status;
            task.history.push({ at, actor: actorName, text: `${action.status}: ${action.note.trim()}` });
            audit(`Cập nhật công việc ${task.id}`);
            break;
        }
        case 'complete': {
            const task = openTask(action.id);
            requireValue(actor.role === 'STAFF', 'Chỉ staff được giao mới hoàn thành công việc.');
            requireValue(task.status === 'IN_PROGRESS' || task.status === 'NEEDS_HELP', 'Hãy bắt đầu công việc trước khi hoàn thành.');
            activeMachine(task.machineId);
            if (task.kind === 'REFILL') {
                requireValue(action.actual.every(a => task.lines.some(l => l.slotId === a.slotId)), 'Có ngăn nằm ngoài phân công.');
                for (const line of task.lines) {
                    const slot = store.slots.find(s => s.id === line.slotId);
                    requireValue(slot, 'Ngăn không còn tồn tại.');
                    activeProduct(slot.productId);
                    const entries = action.actual.filter(a => a.slotId === line.slotId);
                    let added = 0;
                    for (const entry of entries) {
                        integer(entry.quantity, 1, 'Số thực tế theo lô');
                        requireValue(validDay(entry.expiry) && entry.expiry >= today, 'Mỗi lô cần hạn dùng hợp lệ, không được đã hết hạn.');
                        added += entry.quantity;
                    }
                    requireValue(added + inventory(store, slot.id, today).total <= slot.capacity, 'Tồn kho đã thay đổi hoặc vượt sức chứa. Kiểm tra lại số thực tế.');
                    if (added !== line.planned)
                        text(action.notes, 'ghi chú chênh lệch số lượng');
                }
                for (const entry of action.actual)
                    store.lots.push({ id: id(), slotId: entry.slotId, quantity: entry.quantity, expiry: entry.expiry, addedAt: at, taskId: task.id });
                task.actual = action.actual;
            }
            else {
                text(action.notes, 'kết quả bảo trì');
                requireValue(photo(action.before) && photo(action.after), 'Cần ảnh trước và sau hợp lệ (PNG/JPG/WebP, tối đa 400 KB mỗi ảnh).');
                task.before = action.before;
                task.after = action.after;
            }
            task.status = 'DONE';
            task.notes = action.notes.trim();
            task.history.push({ at, actor: actorName, text: 'Hoàn thành; đã cập nhật dữ liệu mẫu' });
            audit(`Hoàn thành ${task.kind} ${task.id}`);
            break;
        }
        case 'incident': {
            admin(actor);
            const t = store.transactions.find(t => t.id === action.id);
            requireValue(t && t.paid && t.status === 'DISPENSE_FAILED', 'Chỉ xử lý đơn đã thanh toán nhưng nhả hàng thất bại.');
            const allowed = t.incident === 'WAITING' ? ['PROCESSING'] : t.incident === 'PROCESSING' ? ['REFUNDED', 'RESOLVED'] : [];
            requireValue(allowed.includes(action.status), 'Chuyển trạng thái không hợp lệ.');
            text(action.note, 'ghi chú xử lý');
            t.history.push({ at, actor: actorName, text: `${t.incident} → ${action.status}: ${action.note.trim()}` });
            t.incident = action.status;
            audit(`Xử lý sự cố ${t.id}`);
            break;
        }
    }
    store.revision++;
    return store;
}
export function staffView(store: Store, staffId: string) {
    const staff = store.staff.find(s => s.id === staffId && s.active);
    const machines = staff ? store.machines.filter(m => staff.machineIds.includes(m.id) && !m.archived) : [];
    const slots = store.slots.filter(s => machines.some(m => m.id === s.machineId));
    return { staff, machines, slots, lots: store.lots.filter(l => slots.some(s => s.id === l.slotId)), products: store.products.filter(p => slots.some(s => s.productId === p.id)), tasks: staff ? store.tasks.filter(t => t.staffId === staffId && machines.some(m => m.id === t.machineId)) : [] };
}
