// A pointer to the server-owned order, not a queue, payment receipt or motor journal.
const ACTIVE_ORDER = 'fruit-vending-active-order-v1'
export function rememberActiveOrder(id: string) {
  try { sessionStorage.setItem(ACTIVE_ORDER, id) } catch { /* memory-only session */ }
}
export function activeOrderId(): string | null {
  try { return sessionStorage.getItem(ACTIVE_ORDER) } catch { return null }
}
export function clearActiveOrder() {
  try { sessionStorage.removeItem(ACTIVE_ORDER) } catch { /* storage unavailable */ }
}
