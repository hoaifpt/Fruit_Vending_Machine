// Typed endpoint functions. Types come from schema.d.ts, generated from api-contract/api.yaml (npm run gen:api).
import { api, request } from './client.ts'
import type { components, operations } from './schema'
import type { components as RolesDraft } from './drafts/roles-permissions'
import type { components as DispenseDraft } from './drafts/dispense-commands'
import type { components as AlertsDraft, operations as AlertOperations } from './drafts/alerts'

type S = components['schemas']
export type Product = S['ProductResponse']
export type Machine = S['MachineResponse']
export type Slot = S['MachineSlotResponse']
export type User = S['UserResponse']
export type Batch = S['ProductBatchResponse']
export type InventoryItem = S['InventoryItemResponse']
export type InventorySummary = S['InventorySummaryResponse']
export type InventoryTransaction = S['InventoryTransactionResponse']
export type KioskCredential = S['KioskCredentialResponse']
export type IssuedKioskCredential = S['IssuedKioskCredentialResponse']
export type OrderSummary = S['OrderSummaryResponse']
export type OrderDetail = S['OrderDetailResponse']
export type Payment = S['PaymentResponse']
export type PaymentDetail = S['PaymentDetailResponse']
export type WebhookLogSummary = S['PaymentWebhookLogSummaryResponse']
export type WebhookLogDetail = S['PaymentWebhookLogDetailResponse']

export interface Page<T> { content: T[]; page: number; size: number; totalElements: number; totalPages: number }
type Query<K extends keyof operations> = operations[K] extends { parameters: { query?: infer Q } } ? NonNullable<Q> : never
type Q = Record<string, string | number | boolean | undefined>

const id = encodeURIComponent
const list = <T>(path: string, query: Q, signal?: AbortSignal) => api.get<Page<T>>(path, query, signal)

export const authApi = {
  login: (body: S['LoginRequest']) => request<S['LoginResponse']>('POST', '/auth/login', { body, auth: false }),
}

export const usersApi = {
  list: (query: Query<'listUsers'>, signal?: AbortSignal) => list<User>('/users', query, signal),
  create: (body: S['CreateUserRequest']) => api.post<User>('/users', body),
  update: (userId: string, body: S['UpdateUserRequest']) => api.put<User>(`/users/${id(userId)}`, body),
  setStatus: (userId: string, status: S['UpdateUserStatusRequest']['status']) => api.patch<User>(`/users/${id(userId)}/status`, { status }),
}

export const productsApi = {
  list: (query: Query<'listProducts'>, signal?: AbortSignal) => list<Product>('/products', query, signal),
  create: (body: S['CreateProductRequest']) => api.post<Product>('/products', body),
  update: (productId: string, body: S['UpdateProductRequest']) => api.put<Product>(`/products/${id(productId)}`, body),
  setStatus: (productId: string, status: S['UpdateProductStatusRequest']['status']) => api.patch<Product>(`/products/${id(productId)}/status`, { status }),
}

export const machinesApi = {
  list: (query: Query<'listMachines'>, signal?: AbortSignal) => list<Machine>('/machines', query, signal),
  get: (machineId: string, signal?: AbortSignal) => api.get<Machine>(`/machines/${id(machineId)}`, undefined, signal),
  create: (body: S['CreateMachineRequest']) => api.post<Machine>('/machines', body),
  update: (machineId: string, body: S['UpdateMachineRequest']) => api.put<Machine>(`/machines/${id(machineId)}`, body),
  setStatus: (machineId: string, status: S['UpdateMachineStatusRequest']['status']) => api.patch<Machine>(`/machines/${id(machineId)}/status`, { status }),
}

export const slotsApi = {
  list: (machineId: string, query: Query<'listMachineSlots'>, signal?: AbortSignal) => list<Slot>(`/machines/${id(machineId)}/slots`, query, signal),
  create: (machineId: string, body: S['CreateMachineSlotRequest']) => api.post<Slot>(`/machines/${id(machineId)}/slots`, body),
  update: (machineId: string, slotId: string, body: S['UpdateMachineSlotRequest']) => api.put<Slot>(`/machines/${id(machineId)}/slots/${id(slotId)}`, body),
  setStatus: (machineId: string, slotId: string, status: S['UpdateMachineSlotStatusRequest']['status']) => api.patch<Slot>(`/machines/${id(machineId)}/slots/${id(slotId)}/status`, { status }),
  summary: (machineId: string, slotId: string, signal?: AbortSignal) => api.get<InventorySummary>(`/machines/${id(machineId)}/slots/${id(slotId)}/inventory/summary`, undefined, signal),
}

export const kioskCredentialsApi = {
  list: (machineId: string, signal?: AbortSignal) => api.get<KioskCredential[]>(`/machines/${id(machineId)}/kiosk-credentials`, undefined, signal),
  issue: (machineId: string) => api.post<IssuedKioskCredential>(`/machines/${id(machineId)}/kiosk-credentials`),
  revoke: (machineId: string, credentialId: string) => api.post<KioskCredential>(`/machines/${id(machineId)}/kiosk-credentials/${id(credentialId)}/revoke`),
}

export const batchesApi = {
  list: (query: Query<'listProductBatches'>, signal?: AbortSignal) => list<Batch>('/product-batches', query, signal),
  create: (body: S['CreateProductBatchRequest']) => api.post<Batch>('/product-batches', body),
}

export const inventoryApi = {
  list: (query: Query<'listInventory'>, signal?: AbortSignal) => list<InventoryItem>('/inventory', query, signal),
  history: (query: Query<'listInventoryTransactions'>, signal?: AbortSignal) => list<InventoryTransaction>('/inventory/transactions', query, signal),
  load: (body: S['LoadInventoryRequest']) => api.post<S['InventoryLoadResponse']>('/inventory/load', body),
  remove: (itemId: string, reason: string) => api.post<InventoryItem>(`/inventory/${id(itemId)}/remove`, { reason }),
}

export const ordersApi = {
  list: (query: Query<'listOrders'>, signal?: AbortSignal) => list<OrderSummary>('/orders', query, signal),
  get: (orderId: string, signal?: AbortSignal) => api.get<OrderDetail>(`/orders/${id(orderId)}`, undefined, signal),
}

export const paymentsApi = {
  list: (query: Query<'listPayments'>, signal?: AbortSignal) => list<Payment>('/payments', query, signal),
  get: (paymentId: string, signal?: AbortSignal) => api.get<PaymentDetail>(`/payments/${id(paymentId)}`, undefined, signal),
}

export const webhookLogsApi = {
  list: (query: Query<'listPaymentWebhookLogs'>, signal?: AbortSignal) => list<WebhookLogSummary>('/payment-webhook-logs', query, signal),
  get: (logId: string, signal?: AbortSignal) => api.get<WebhookLogDetail>(`/payment-webhook-logs/${id(logId)}`, undefined, signal),
}

// Roles & permissions (screen A3): draft contract copied from backend #48 (api-contract/drafts/roles-permissions.yaml)
// until that branch is merged and the paths move into api.yaml. Every call needs PERMISSION_MANAGE.
type R = RolesDraft['schemas']
export type RoleWithPermissions = R['RoleResponse']
export type PermissionInfo = R['PermissionResponse']
export type ReplaceRolePermissionsBody = R['ReplaceRolePermissionsRequest']

export const rolesApi = {
  permissions: (signal?: AbortSignal) => api.get<PermissionInfo[]>('/permissions', undefined, signal),
  list: (signal?: AbortSignal) => api.get<RoleWithPermissions[]>('/roles', undefined, signal),
  get: (roleId: string, signal?: AbortSignal) => api.get<RoleWithPermissions>(`/roles/${id(roleId)}`, undefined, signal),
  /** Replaces the whole permission set of one role (not a patch): send every code the role keeps. */
  replacePermissions: (roleId: string, body: ReplaceRolePermissionsBody) => api.put<RoleWithPermissions>(`/roles/${id(roleId)}/permissions`, body),
}

// Dispense commands of an order (screen T1, FE 6.1): draft contract api-contract/drafts/dispense-commands.yaml, waiting
// for backend issue 3.3. Until it ships the real backend answers 404 here; the order screen then shows "chưa có dữ liệu"
// (see dispenseAvailability in src/admin/order-detail.ts). When 3.3 lands: move the path into api.yaml, run gen:api,
// switch this type to schema.d.ts and delete the draft.
export type DispenseCommand = DispenseDraft['schemas']['DispenseCommandResponse']

export const dispenseCommandsApi = {
  /** One command per paid bowl of the order, oldest first; empty for an order that was never paid. */
  listForOrder: (orderId: string, signal?: AbortSignal) => api.get<DispenseCommand[]>(`/orders/${id(orderId)}/dispense-commands`, undefined, signal),
}

// Alerts (screen O2 and the alert bell, FE 6.3): draft contract api-contract/drafts/alerts.yaml, waiting for backend
// issue 3.6. Until it ships the real backend answers 404 here; the alerts screen then says "chưa có dữ liệu" and the
// bell hides itself and stops polling (see alertsAvailability in src/admin/alerts.ts). When 3.6 lands: move the paths
// into api.yaml, run gen:api, switch these types to schema.d.ts and delete the draft.
export type Alert = AlertsDraft['schemas']['AlertResponse']
export type AlertListQuery = NonNullable<AlertOperations['listAlerts']['parameters']['query']>
export type ResolveAlertBody = AlertsDraft['schemas']['ResolveAlertRequest']

export const alertsApi = {
  list: (query: AlertListQuery, signal?: AbortSignal) => list<Alert>('/alerts', query, signal),
  get: (alertId: string, signal?: AbortSignal) => api.get<Alert>(`/alerts/${id(alertId)}`, undefined, signal),
  /** OPEN → ACKNOWLEDGED, no body; 409 when someone else changed it first. */
  acknowledge: (alertId: string) => api.post<Alert>(`/alerts/${id(alertId)}/acknowledge`),
  /** OPEN/ACKNOWLEDGED → RESOLVED; the note is only sent when there is one. 409 when already resolved. */
  resolve: (alertId: string, body: ResolveAlertBody) => api.post<Alert>(`/alerts/${id(alertId)}/resolve`, body),
}

export type { Q as QueryParams }
