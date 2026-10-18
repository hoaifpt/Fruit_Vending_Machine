import type { Store } from './domain.ts';
import { dayVN, shiftDay } from './domain.ts';
export function createDemo(now = new Date()): Store {
    const today = dayVN(now), at = now.toISOString();
    const locations = ['Văn phòng An Phú', 'Chung cư Riverside', 'Đại học Thủ Đức', 'Tòa nhà Sông Xanh', 'Khu dân cư Bình An', 'Văn phòng Horizon'];
    const names = ['Dưa hấu cắt sẵn', 'Đu đủ chín', 'Cam tươi', 'Kiwi xanh'];
    const machines: Store['machines'] = locations.map((location, i) => ({ id: `m${i + 1}`, code: `FVM-${String(i + 1).padStart(3, '0')}`, name: `Máy ${location}`, location, status: i === 3 ? 'MAINTENANCE' : 'ACTIVE', online: i !== 3, lastSeen: i === 3 ? `${shiftDay(today, -1)}T18:30:00+07:00` : at, archived: false }));
    const products: Store['products'] = names.map((name, i) => ({ id: `p${i + 1}`, name, description: 'Sản phẩm minh họa, đơn vị bán: hộp.', image: '', archived: false }));
    const slots: Store['slots'] = machines.flatMap(m => products.slice(0, 3).map((p, i) => ({ id: `${m.id}s${i + 1}`, machineId: m.id, code: `A${i + 1}`, productId: p.id, capacity: 20 })));
    const lots: Store['lots'] = slots.flatMap((s, i) => [{ id: `lot-${i}-1`, slotId: s.id, quantity: i % 5 === 0 ? 2 : i % 7 === 0 ? 0 : 7, expiry: shiftDay(today, i % 6 === 0 ? 1 : i % 8 === 0 ? -1 : 4), addedAt: `${shiftDay(today, -2)}T08:00:00+07:00` }, ...(i % 4 === 1 ? [{ id: `lot-${i}-2`, slotId: s.id, quantity: 4, expiry: shiftDay(today, 6), addedAt: at }] : [])]);
    const staff: Store['staff'] = [
        { id: 's1', name: 'Nguyễn Minh Anh', email: 'minhanh@example.test', active: true, machineIds: ['m1', 'm2', 'm3'] },
        { id: 's2', name: 'Trần Quốc Bảo', email: 'quocbao@example.test', active: true, machineIds: ['m4', 'm5', 'm6'] },
        { id: 's3', name: 'Lê Thanh Hà', email: 'thanhha@example.test', active: true, machineIds: [] },
    ];
    const prices = machines.flatMap((m, i) => products.map((p, j) => ({ machineId: m.id, productId: p.id, amount: [25000, 30000, 35000, 45000][j] + i * 1000 })));
    const transactions: Store['transactions'] = [];
    // Times are anchored to today so the demo remains useful on later days.
    for (let i = 0; i < 160; i++) {
        const machine = machines[i % machines.length], product = products[i % products.length];
        const day = i < 80 ? today : shiftDay(today, -(1 + ((i - 80) % 80)));
        const currentHour = new Date(now.getTime() + 7 * 3600000).getUTCHours(); const startHour = Math.min(6, currentHour); const hour = i < 80 ? startHour + i % (currentHour - startHour + 1) : 8 + i % 12;
        const stamp = new Date(`${day}T${String(hour).padStart(2, '0')}:${String((i * 7) % 60).padStart(2, '0')}:00+07:00`);
        const time = stamp > now ? now.toISOString() : stamp.toISOString();
        transactions.push({ id: `FV-${1080 + i}`, machineId: machine.id, machineCode: machine.code, location: machine.location, product: product.name, amount: prices.find(p => p.machineId === machine.id && p.productId === product.id)!.amount, paid: i % 29 !== 0, status: i % 29 === 0 ? 'PENDING_PAYMENT' : i % 23 === 0 ? 'DISPENSE_FAILED' : 'SUCCESS', at: time, incident: 'WAITING', history: [], error: i % 23 === 0 ? 'DROP_SENSOR_TIMEOUT' : undefined });
    }
    transactions.sort((a, b) => b.at.localeCompare(a.at));
    const tasks: Store['tasks'] = [
        { id: 'CV-1001', kind: 'REFILL', machineId: 'm1', staffId: 's1', due: today, description: 'Bổ sung dưa hấu vào ngăn A1.', status: 'ASSIGNED', lines: [{ slotId: 'm1s1', planned: 10 }], actual: [], notes: '', before: '', after: '', history: [{ at, actor: 'Admin (mẫu)', text: 'Đã giao việc' }] },
        { id: 'CV-1002', kind: 'MAINTENANCE', machineId: 'm4', staffId: 's2', due: shiftDay(today, -1), description: 'Kiểm tra cảm biến rơi hàng và đường dẫn khay nhận.', status: 'IN_PROGRESS', lines: [], actual: [], notes: '', before: '', after: '', history: [{ at, actor: 'Admin (mẫu)', text: 'Đã giao bảo trì' }] },
    ];
    return { version: 1, revision: 0, generatedAt: at, machines, products, prices, slots, lots, staff, tasks, transactions, audit: [] };
}

