// Typed endpoint functions. Types come from schema.d.ts, generated from api-contract/api.yaml (npm run gen:api).
import { api, request } from './client.ts'
import type { components, operations } from './schema'

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

export type { Q as QueryParams }
