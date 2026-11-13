// Typed endpoint functions. Types come from schema.d.ts, generated from api-contract/api.yaml (npm run gen:api).
import { api, request } from './client.ts'
import type { components, operations } from './schema'
import type { components as RolesDraft } from './drafts/roles-permissions'
import type { components as DispenseDraft } from './drafts/dispense-commands'
import type { components as AlertsDraft, operations as AlertOperations } from './drafts/alerts'
import type { components as TelemetryDraft, operations as TelemetryOperations } from './drafts/machine-telemetry'
import type { components as RefundsDraft, operations as RefundOperations } from './drafts/refunds'
import type { components as IncidentDraft, operations as IncidentOperations } from './drafts/incident-reports'
import type { components as TicketsDraft, operations as TicketOperations } from './drafts/work-tickets'
import type { components as SchedulesDraft, operations as ScheduleOperations } from './drafts/maintenance-schedules'
import type { components as MaintenanceDraft, operations as MaintenanceOperations } from './drafts/machine-maintenance'
import type { components as PricingDraft } from './drafts/pricing-discount'

type S = components['schemas']
export type Product = S['ProductResponse']
export type Machine = S['MachineResponse']
export type Slot = S['MachineSlotResponse']
export type User = S['UserResponse']
export type Batch = S['ProductBatchResponse']
// Near-expiry discount fields (FE 7.5): DRAFT api-contract/drafts/pricing-discount.yaml, backend 4.1. Optional, so the
// real API without them still type-checks and shows plain prices; drop the intersections once they reach api.yaml.
type P = PricingDraft['schemas']
export type InventoryItem = S['InventoryItemResponse'] & P['InventoryItemPricing']
export type InventorySummary = S['InventorySummaryResponse']
export type InventoryTransaction = S['InventoryTransactionResponse']
export type KioskCredential = S['KioskCredentialResponse']
export type IssuedKioskCredential = S['IssuedKioskCredentialResponse']
export type OrderSummary = S['OrderSummaryResponse'] & P['OrderPricing']
export type OrderLine = S['OrderItemDetailResponse'] & P['OrderItemPricing']
export type OrderDetail = Omit<S['OrderDetailResponse'], 'items'> & P['OrderPricing'] & { items?: OrderLine[] }
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

// Heartbeat, sensor readings and events of a machine (tab "Cảm biến & Sự kiện" of C3, FE 6.4): draft contract
// api-contract/drafts/machine-telemetry.yaml, waiting for backend issues 3.4/3.5. Until they ship the real backend answers
// 404 here; the tab then says "chưa có dữ liệu" and stops refreshing (see telemetryAvailability in
// src/admin/telemetry.ts). Connectivity (ONLINE/OFFLINE) never needs these: it comes from Machine.lastSeenAt, already in
// api.yaml. When 3.4/3.5 land: move the paths into api.yaml, run gen:api, switch these types to schema.d.ts and delete
// the draft.
export type MachineHeartbeat = TelemetryDraft['schemas']['MachineHeartbeatResponse']
export type SensorReading = TelemetryDraft['schemas']['SensorReadingResponse']
export type MachineEvent = TelemetryDraft['schemas']['MachineEventResponse']
export type SensorReadingQuery = NonNullable<TelemetryOperations['listMachineSensorReadings']['parameters']['query']>
export type MachineEventQuery = NonNullable<TelemetryOperations['listMachineEvents']['parameters']['query']>

export const telemetryApi = {
  heartbeat: (machineId: string, signal?: AbortSignal) => api.get<MachineHeartbeat>(`/machines/${id(machineId)}/heartbeat`, undefined, signal),
  readings: (machineId: string, query: SensorReadingQuery, signal?: AbortSignal) => list<SensorReading>(`/machines/${id(machineId)}/sensor-readings`, query, signal),
  events: (machineId: string, query: MachineEventQuery, signal?: AbortSignal) => list<MachineEvent>(`/machines/${id(machineId)}/events`, query, signal),
}

// Manual refunds (screen T3 / W-12, FE 8.1): draft contract api-contract/drafts/refunds.yaml, waiting for backend issue
// 5.1. Until it ships the real backend answers 404 here; the refunds screen then says the feature is not there yet (see
// refundsAvailability in src/admin/refunds.ts). When 5.1 lands: move the paths into api.yaml, run gen:api, switch these
// types to schema.d.ts and delete the draft.
export type Refund = RefundsDraft['schemas']['RefundResponse']
export type RefundBody = RefundsDraft['schemas']['RefundRequest']
export type RefundListQuery = NonNullable<RefundOperations['listRefunds']['parameters']['query']>

export const refundsApi = {
  list: (query: RefundListQuery, signal?: AbortSignal) => list<Refund>('/refunds', query, signal),
  /** REFUND_RECORD (ADMIN): payment SUCCESS → REFUNDED; 409 when already refunded or not a refund case. Never retried. */
  record: (orderId: string, body: RefundBody) => api.post<Refund>(`/orders/${id(orderId)}/refund`, body),
}

// Work tickets (screen O3, FE 7.1): draft contract api-contract/drafts/work-tickets.yaml, waiting for backend issue 4.3.
// Until it ships the real backend answers 404 here; the screens then say "chưa có dữ liệu" (ticketsAvailability in
// src/admin/tickets.ts). A caller without TICKET_WRITE only receives its own tickets (server-side). When 4.3 lands: move
// the paths into api.yaml, run gen:api, switch these types to schema.d.ts and delete the draft.
type T = TicketsDraft['schemas']
export type WorkTicket = T['WorkTicketResponse']
export type WorkTicketListQuery = NonNullable<TicketOperations['listWorkTickets']['parameters']['query']>
export type CreateWorkTicketBody = T['CreateWorkTicketRequest']
export type AssignWorkTicketBody = T['AssignWorkTicketRequest']
export type CompleteWorkTicketBody = T['CompleteWorkTicketRequest']
export type CancelWorkTicketBody = T['CancelWorkTicketRequest']
// Restock lines of a RESTOCK ticket (FE 7.2, screen O4): same draft, waiting for backend issue 4.4.
export type RestockLine = T['RestockLineResponse']
export type RestockReconciliation = T['RestockReconciliation']
export type LoadRestockLineBody = T['LoadRestockLineRequest']
export type RemoveRestockItemBody = T['RemoveRestockItemRequest']

export const ticketsApi = {
  list: (query: WorkTicketListQuery, signal?: AbortSignal) => list<WorkTicket>('/work-tickets', query, signal),
  get: (ticketId: string, signal?: AbortSignal) => api.get<WorkTicket>(`/work-tickets/${id(ticketId)}`, undefined, signal),
  /** OPEN, or ASSIGNED when assigneeId is sent. Only fields of CreateWorkTicketRequest. */
  create: (body: CreateWorkTicketBody) => api.post<WorkTicket>('/work-tickets', body),
  /** OPEN/ASSIGNED → ASSIGNED (also a reassignment). */
  assign: (ticketId: string, body: AssignWorkTicketBody) => api.post<WorkTicket>(`/work-tickets/${id(ticketId)}/assign`, body),
  /** ASSIGNED → IN_PROGRESS, assignee only, no body. */
  start: (ticketId: string) => api.post<WorkTicket>(`/work-tickets/${id(ticketId)}/start`),
  /** IN_PROGRESS → COMPLETED, assignee only; the note only when there is one. */
  complete: (ticketId: string, body: CompleteWorkTicketBody) => api.post<WorkTicket>(`/work-tickets/${id(ticketId)}/complete`, body),
  /** Any state before COMPLETED → CANCELLED, with a mandatory reason. */
  cancel: (ticketId: string, body: CancelWorkTicketBody) => api.post<WorkTicket>(`/work-tickets/${id(ticketId)}/cancel`, body),
  /** RESTOCK, IN_PROGRESS, assignee: bowls placed in the line's slot (rules of POST /inventory/load). Answers the ticket. */
  loadLine: (ticketId: string, lineId: string, body: LoadRestockLineBody) => api.post<WorkTicket>(`/work-tickets/${id(ticketId)}/restock-lines/${id(lineId)}/load`, body),
  /** RESTOCK, IN_PROGRESS, assignee: a bowl of the line's slot taken out by hand (rules of POST /inventory/{id}/remove). */
  removeItem: (ticketId: string, lineId: string, body: RemoveRestockItemBody) => api.post<WorkTicket>(`/work-tickets/${id(ticketId)}/restock-lines/${id(lineId)}/remove`, body),
}

// Maintenance schedules (screen O5, FE 7.3): draft contract api-contract/drafts/maintenance-schedules.yaml, waiting for
// backend issue 4.5. Until it ships the real backend answers 404 here; the screen then says "chưa có dữ liệu"
// (schedulesAvailability in src/admin/maintenance-schedules.ts). nextDueAt is always the server's. When 4.5 lands: move
// the paths into api.yaml, run gen:api, switch these types to schema.d.ts and delete the draft.
type MS = SchedulesDraft['schemas']
export type MaintenanceSchedule = MS['MaintenanceScheduleResponse']
export type MaintenanceScheduleListQuery = NonNullable<ScheduleOperations['listMaintenanceSchedules']['parameters']['query']>
export type CreateMaintenanceScheduleBody = MS['CreateMaintenanceScheduleRequest']
export type UpdateMaintenanceScheduleBody = MS['UpdateMaintenanceScheduleRequest']

export const maintenanceSchedulesApi = {
  list: (query: MaintenanceScheduleListQuery, signal?: AbortSignal) => list<MaintenanceSchedule>('/maintenance-schedules', query, signal),
  get: (scheduleId: string, signal?: AbortSignal) => api.get<MaintenanceSchedule>(`/maintenance-schedules/${id(scheduleId)}`, undefined, signal),
  /** Only fields of CreateMaintenanceScheduleRequest; the answer carries the server's nextDueAt. */
  create: (body: CreateMaintenanceScheduleBody) => api.post<MaintenanceSchedule>('/maintenance-schedules', body),
  /** Partial update: only the changed fields. */
  update: (scheduleId: string, body: UpdateMaintenanceScheduleBody) => api.patch<MaintenanceSchedule>(`/maintenance-schedules/${id(scheduleId)}`, body),
  /** active → paused, no body; 409 when already paused. Schedules are never deleted. */
  deactivate: (scheduleId: string) => api.post<MaintenanceSchedule>(`/maintenance-schedules/${id(scheduleId)}/deactivate`),
  /** paused → active, no body; nextDueAt recomputed. 409 when already active. */
  activate: (scheduleId: string) => api.post<MaintenanceSchedule>(`/maintenance-schedules/${id(scheduleId)}/activate`),
}

// Maintenance commands of a machine (tab "Bảo trì" of C3, FE 7.4; reused by the restock ticket of FE 7.2): draft contract
// api-contract/drafts/machine-maintenance.yaml, waiting for backend issue 4.2. Until it ships the real backend answers 404
// here; the tab then says "chưa có" (maintenanceAvailability in src/admin/maintenance-commands.ts, which also builds the
// bodies and words the errors). When 4.2 lands: move the paths into api.yaml, run gen:api, switch these types to
// schema.d.ts and delete the draft.
export type MaintenanceCommand = MaintenanceDraft['schemas']['MaintenanceCommandResponse']
export type MaintenanceCommandType = MaintenanceDraft['schemas']['MaintenanceCommandType']
export type CreateMaintenanceCommandBody = MaintenanceDraft['schemas']['CreateMaintenanceCommandRequest']
export type MaintenanceCommandQuery = NonNullable<MaintenanceOperations['listMachineMaintenanceCommands']['parameters']['query']>

export const maintenanceCommandsApi = {
  /** Newest first (fixed order), unfinished commands included. MACHINE_READ. */
  list: (machineId: string, query: MaintenanceCommandQuery, signal?: AbortSignal) => list<MaintenanceCommand>(`/machines/${id(machineId)}/maintenance-commands`, query, signal),
  /** Creates the command PENDING (MACHINE_MAINTENANCE). Build the body with maintenanceCommandBody. */
  create: (machineId: string, body: CreateMaintenanceCommandBody) => api.post<MaintenanceCommand>(`/machines/${id(machineId)}/maintenance-commands`, body),
}

export type { Q as QueryParams }

// Draft of backend 5.2 (api-contract/drafts/incident-reports.yaml, FE 8.2): public, no Authorization header, body is
// multipart/form-data built by features/incident/incident.ts (buildIncidentForm). When 5.2 lands: move the path into
// api.yaml, run gen:api, switch the type to schema.d.ts and delete the draft.
export type IncidentReportReceipt = IncidentDraft['schemas']['IncidentReportReceipt']
export type IncidentReport = IncidentDraft['schemas']['IncidentReportResponse']
export type IncidentReportListQuery = NonNullable<IncidentOperations['listIncidentReports']['parameters']['query']>
export const incidentReportsApi = {
  create: (form: FormData, signal?: AbortSignal) => request<IncidentReportReceipt>('POST', '/public/incident-reports', { body: form, auth: false, signal }),
  /** FE 8.3, ADMIN (REFUND_RECORD): reports for W-12; `flagged: true` = orders still to check for a refund. */
  list: (query: IncidentReportListQuery, signal?: AbortSignal) => list<IncidentReport>('/incident-reports', query, signal),
}
