import { useEffect, useRef, useState } from 'react';
import { applyAction } from './domain';
import type { Action, Actor, Store } from './domain';
import { createDemo } from './seed';
export const STORAGE_KEY = 'fruit-vending-admin-demo-v1';
function decode(raw: string): Store {
    const value = JSON.parse(raw);
    if (value?.version !== 1 || !Number.isSafeInteger(value.revision) || typeof value.generatedAt !== 'string')
        throw new Error('Phiên bản dữ liệu mẫu không hợp lệ.');
    for (const name of ['machines', 'products', 'prices', 'slots', 'lots', 'staff', 'tasks', 'transactions', 'audit'])
        if (!Array.isArray(value[name]))
            throw new Error('Dữ liệu mẫu bị thiếu.');
    if (!value.machines.every((m: Store['machines'][number]) => typeof m.id === 'string' && typeof m.code === 'string' && typeof m.name === 'string' && typeof m.location === 'string') || !value.products.every((p: Store['products'][number]) => typeof p.id === 'string' && typeof p.name === 'string') || !value.staff.every((s: Store['staff'][number]) => typeof s.name === 'string' && Array.isArray(s.machineIds)) || !value.tasks.every((t: Store['tasks'][number]) => Array.isArray(t.lines) && Array.isArray(t.actual) && Array.isArray(t.history)) || !value.transactions.every((t: Store['transactions'][number]) => typeof t.at === 'string' && !Number.isNaN(Date.parse(t.at)) && Array.isArray(t.history)) || !value.lots.every((l: Store['lots'][number]) => typeof l.expiry === 'string' && Number.isFinite(l.quantity)))
        throw new Error('Cấu trúc dữ liệu mẫu không hợp lệ.');
    return value as Store;
}
export function useDemoStore() {
    const [initial] = useState(() => {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            return { data: raw ? decode(raw) : createDemo(), error: '' };
        }
        catch {
            return { data: createDemo(), error: 'Không đọc được dữ liệu mẫu đã lưu. Dữ liệu cũ chưa bị ghi đè; hãy đặt lại mẫu để tiếp tục.' };
        }
    });
    const [data, setData] = useState(initial.data);
    const [error, setError] = useState(initial.error);
    const ref = useRef(data);
    useEffect(() => {
        const sync = (event: StorageEvent) => {
            if (event.key !== STORAGE_KEY)
                return;
            try {
                const next = event.newValue ? decode(event.newValue) : createDemo();
                ref.current = next;
                setData(next);
                setError('');
            }
            catch {
                setError('Dữ liệu ở tab khác không hợp lệ. Hãy đặt lại mẫu hoặc tải lại trang.');
            }
        };
        window.addEventListener('storage', sync);
        return () => window.removeEventListener('storage', sync);
    }, []);
    const commit = (action: Action, actor: Actor = { role: 'ADMIN' }) => {
        if (error)
            throw new Error(error);
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
            const latest = decode(raw);
            if (latest.revision !== ref.current.revision) {
                ref.current = latest;
                setData(latest);
                throw new Error('Dữ liệu vừa thay đổi ở tab khác. Vui lòng kiểm tra rồi lưu lại.');
            }
        }
        const next = applyAction(ref.current, action, actor);
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        }
        catch {
            throw new Error('Không thể lưu trên trình duyệt. Có thể bộ nhớ đầy; giảm kích thước ảnh rồi thử lại. Thay đổi chưa được áp dụng.');
        }
        ref.current = next;
        setData(next);
    };
    const reset = () => {
        const next = createDemo();
        next.revision = ref.current.revision + 1;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        ref.current = next;
        setData(next);
        setError('');
    };
    return { data, error, commit, reset };
}
