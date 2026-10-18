export type Product = { slot: string; name: string; description: string; price: number; stock: number; image: 'orange' | 'mix'; size: string }
export const products: Product[] = [
  { slot: '1', name: 'Cam tươi', description: 'Cam tách múi, vị ngọt thanh. Hình ảnh minh họa sản phẩm.', price: 25000, stock: 8, image: 'orange', size: 'Hộp 200 g' },
  { slot: '2', name: 'Trái cây mix', description: 'Kết hợp cam, kiwi, dưa hấu và đu đủ. Hình ảnh minh họa sản phẩm.', price: 35000, stock: 6, image: 'mix', size: 'Hộp 250 g' },
  { slot: '3', name: 'Cam tươi', description: 'Cam tách múi, vị ngọt thanh. Hình ảnh minh họa sản phẩm.', price: 30000, stock: 3, image: 'orange', size: 'Hộp 300 g' },
  { slot: '4', name: 'Trái cây mix', description: 'Kết hợp cam, kiwi, dưa hấu và đu đủ. Hình ảnh minh họa sản phẩm.', price: 45000, stock: 0, image: 'mix', size: 'Hộp 350 g' },
  { slot: '5', name: 'Cam tươi', description: 'Cam tách múi, vị ngọt thanh. Hình ảnh minh họa sản phẩm.', price: 25000, stock: 2, image: 'orange', size: 'Hộp 200 g' },
  { slot: '6', name: 'Trái cây mix', description: 'Kết hợp cam, kiwi, dưa hấu và đu đủ. Hình ảnh minh họa sản phẩm.', price: 35000, stock: 5, image: 'mix', size: 'Hộp 250 g' },
]
export type Stage = 'catalog' | 'creating' | 'qr' | 'paid' | 'dispensing' | 'success' | 'expired' | 'cancelled' | 'payment_error' | 'dispense_error' | 'offline' | 'checking'
export type Order = { id: string; product: Product; expiresAt: number; paid: boolean; dispensed: boolean }
export type Session = { version: 1; stage: Stage; items: Product[]; selected: string; order: Order | null; failDispense: boolean }
export const fresh = (): Session => ({ version: 1, stage: 'catalog', items: products.map(p => ({ ...p })), selected: '', order: null, failDispense: false })
export type Event = { type: 'select'; slot: string; id: string; now: number } | { type: 'create'; id: string; now: number } | { type: 'ready' | 'paid' | 'dispense' | 'finish' | 'expire' | 'cancel' | 'home' | 'offline' | 'check' | 'unpaid' | 'payment-error' } | { type: 'fail-dispense'; value: boolean }
export function transition(s: Session, e: Event, now = Date.now()): Session {
  const next = structuredClone(s), o = next.order
  const only = (...stages: Stage[]) => { if (!stages.includes(s.stage)) throw new Error('Thao tác không phù hợp với trạng thái đơn hiện tại.') }
  switch (e.type) {
    case 'select': {
      only('catalog'); const p = next.items.find(p => p.slot === e.slot)
      if (!p) throw new Error('Không tìm thấy mã ngăn này. Vui lòng kiểm tra lại.')
      if (p.stock <= 0) throw new Error('Sản phẩm tại ngăn này đã hết. Vui lòng chọn ngăn khác.')
      next.selected = p.slot; next.order = { id: e.id, product: { ...p }, expiresAt: e.now + 90000, paid: false, dispensed: false }; next.stage = 'creating'; break
    }
    case 'create': {
      only('payment_error'); const p = next.items.find(p => p.slot === s.selected)
      if (!p || p.stock <= 0) throw new Error('Sản phẩm vừa hết hàng. Vui lòng chọn sản phẩm khác.')
      next.order = { id: e.id, product: { ...p }, expiresAt: e.now + 90000, paid: false, dispensed: false }; next.stage = 'creating'; break
    }
    case 'ready': only('creating'); next.stage = o && now >= o.expiresAt ? 'expired' : 'qr'; break
    case 'payment-error': only('creating', 'qr'); next.stage = 'payment_error'; break
    case 'paid':
      only('qr', 'checking'); if (!o) throw new Error('Không tìm thấy đơn hàng.')
      if (s.stage === 'qr' && now >= o.expiresAt) { next.stage = 'expired'; break }
      o.paid = true; next.stage = 'paid'; break
    case 'dispense': only('paid'); if (!o?.paid) throw new Error('Chưa xác nhận thanh toán.'); next.stage = 'dispensing'; break
    case 'finish': {
      only('dispensing'); if (!o?.paid || o.dispensed) throw new Error('Đơn không thể nhả hàng lần nữa.')
      const p = next.items.find(p => p.slot === o.product.slot)
      if (next.failDispense || !p || p.stock <= 0) next.stage = 'dispense_error'
      else { p.stock--; o.dispensed = true; next.stage = 'success' } break
    }
    case 'expire': only('qr'); if (o && now >= o.expiresAt) next.stage = 'expired'; break
    case 'cancel': only('qr'); if (o?.paid) throw new Error('Đơn đã thanh toán không thể hủy.'); next.stage = 'cancelled'; break
    case 'offline': only('catalog', 'qr'); next.stage = 'offline'; break
    case 'check': only('offline', 'expired', 'cancelled'); next.stage = o ? 'checking' : 'catalog'; break
    case 'unpaid': only('checking'); if (o?.paid) throw new Error('Đơn đã có xác nhận thanh toán.'); next.stage = o && now < o.expiresAt ? 'qr' : 'expired'; break
    case 'home': only('success', 'expired', 'cancelled', 'payment_error', 'dispense_error'); next.stage = 'catalog'; next.order = null; next.selected = ''; next.failDispense = false; break
    case 'fail-dispense': next.failDispense = e.value; break
  }
  return next
}
export function restore(raw: string | null, now = Date.now()): Session {
  if (!raw) return fresh()
  try {
    const s = JSON.parse(raw) as Session
    // Preserve existing demo orders and stock when renumbering kiosk slots.
    if (Array.isArray(s.items) && s.items.length === 6 && s.items.every(p => /^(21|22|23|24|25|26)$/.test(p.slot))) {
      const renumber = (slot: string) => /^(21|22|23|24|25|26)$/.test(slot) ? String(Number(slot) - 20) : slot
      s.items = s.items.map(p => ({ ...p, slot: renumber(p.slot) }))
      s.selected = renumber(s.selected)
      if (s.order?.product) s.order.product.slot = renumber(s.order.product.slot)
    }
    if ((s.stage as string) === 'detail') return fresh()
    if (s.version !== 1 || !Array.isArray(s.items) || s.items.length !== products.length || !s.items.every(p => products.some(x => x.slot === p.slot) && Number.isInteger(p.stock) && p.stock >= 0) || !['catalog','creating','qr','paid','dispensing','success','expired','cancelled','payment_error','dispense_error','offline','checking'].includes(s.stage)) return fresh()
    if (!['catalog','offline'].includes(s.stage) && (!s.order || !Number.isFinite(s.order.expiresAt) || !s.order.product?.slot)) return fresh()
    if (s.stage === 'qr' && s.order && now >= s.order.expiresAt) s.stage = 'expired'
    // Reloading an in-flight dispense must never start a second dispense.
    if (['paid','dispensing'].includes(s.stage)) s.stage = 'dispense_error'
    return s
  } catch { return fresh() }
}
