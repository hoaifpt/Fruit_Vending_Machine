import { useEffect, useId, useRef, useState } from 'react';
import type { ReactNode, FormEvent } from 'react';
const labels: Record<string, string> = { ACTIVE: 'Hoạt động', MAINTENANCE: 'Bảo trì', INACTIVE: 'Ngừng hoạt động', SUCCESS: 'Thành công', DISPENSE_FAILED: 'Nhả hàng thất bại', PENDING_PAYMENT: 'Chờ thanh toán', WAITING: 'Chờ xử lý', PROCESSING: 'Đang xử lý', REFUNDED: 'Đã hoàn tiền', RESOLVED: 'Đã giải quyết', ASSIGNED: 'Đã phân công', IN_PROGRESS: 'Đang thực hiện', NEEDS_HELP: 'Cần hỗ trợ', DONE: 'Hoàn thành', CANCELLED: 'Đã hủy', REFILL: 'Refill' };
export function Badge({ value }: {
    value: string;
}) { const tone = value.startsWith('Sắp') ? 'a-warning' : value === 'Đã hết hạn' ? 'a-expired' : `a-${value.toLowerCase()}`; return <span className={`a-badge ${tone}`}>{labels[value] || value}</span>; }
export function Field({ label, children }: {
    label: string;
    children: ReactNode;
}) { return <label className="a-field"><span>{label}</span>{children}</label>; }
export function Select({ label, value, onChange, items, empty = 'Chọn…' }: {
    label: string;
    value: string;
    onChange: (v: string) => void;
    items: {
        id: string;
        name: string;
    }[];
    empty?: string;
}) { return <Field label={label}><select value={value} onChange={e => onChange(e.target.value)}><option value="">{empty}</option>{items.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>; }
export function Modal({ title, close, children, onSave, save = 'Lưu thay đổi' }: {
    title: string;
    close: () => void;
    children: ReactNode;
    onSave?: () => void;
    save?: string;
}) {
    const ref = useRef<HTMLDialogElement>(null), id = useId();
    const [error, setError] = useState('');
    useEffect(() => { const d = ref.current; d?.showModal(); return () => d?.close(); }, []);
    function submit(e: FormEvent) { e.preventDefault(); try {
        onSave?.();
        close();
    }
    catch (e) {
        setError(e instanceof Error ? e.message : 'Không thể lưu. Vui lòng thử lại.');
    } }
    return <dialog ref={ref} className="a-modal admin-app" aria-labelledby={id} onCancel={close}><form onSubmit={submit}><header><h2 id={id}>{title}</h2><button type="button" aria-label="Đóng" onClick={close}>×</button></header><div className="a-modal-body">{children}{error && <p className="a-error" role="alert">{error}</p>}</div><footer><button type="button" onClick={close}>Đóng</button>{onSave && <button className="a-primary" type="submit">{save}</button>}</footer></form></dialog>;
}
export function Photo({ label, value, onChange }: {
    label: string;
    value: string;
    onChange: (s: string) => void;
}) {
    const [error, setError] = useState('');
    return <Field label={label}><input type="file" accept="image/png,image/jpeg,image/webp" onChange={e => { const f = e.target.files?.[0]; if (!f)
        return; if (!['image/png', 'image/jpeg', 'image/webp'].includes(f.type) || f.size > 400000) {
        setError('Chọn ảnh PNG/JPG/WebP tối đa 400 KB.');
        return;
    } const reader = new FileReader(); reader.onload = () => { const value = String(reader.result); const img = new Image(); img.onload = () => { onChange(value); setError(''); }; img.onerror = () => setError('Không đọc được ảnh.'); img.src = value; }; reader.readAsDataURL(f); }}/>{value && <img className="a-photo" src={value} alt={label}/>}<small>Tối đa 400 KB · PNG, JPG, WebP</small>{error && <span role="alert" className="a-error">{error}</span>}</Field>;
}
export function Table({ heads, rows, empty = 'Không có kết quả phù hợp.' }: {
    heads: string[];
    rows: {
        id: string;
        cells: ReactNode[];
    }[];
    empty?: string;
}) {
    const [page, setPage] = useState(1);
    const pages = Math.max(1, Math.ceil(rows.length / 8)), p = Math.min(page, pages);
    return <><div className="a-table-wrap"><table><thead><tr>{heads.map(h => <th key={h}>{h}</th>)}</tr></thead><tbody>{rows.slice((p - 1) * 8, p * 8).map(r => <tr key={r.id}>{r.cells.map((c, i) => <td key={i} data-label={heads[i]}>{c}</td>)}</tr>)}</tbody></table>{!rows.length && <div className="a-empty">{empty}</div>}</div><div className="a-pagination"><span>{rows.length} kết quả · Trang {p}/{pages}</span><div><button disabled={p === 1} onClick={() => setPage(p - 1)} aria-label="Trang trước">←</button><button disabled={p === pages} onClick={() => setPage(p + 1)} aria-label="Trang sau">→</button></div></div></>;
}
export function Search({ value, onChange, placeholder = 'Tìm kiếm…' }: {
    value: string;
    onChange: (v: string) => void;
    placeholder?: string;
}) { return <input className="a-search" aria-label={placeholder} type="search" value={value} placeholder={placeholder} onChange={e => onChange(e.target.value)}/>; }


