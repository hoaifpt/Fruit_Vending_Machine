// Typed endpoint functions. Types come from schema.d.ts, generated from api-contract/api.yaml (npm run gen:api).
import { api, request } from './client.ts'
import type { components, operations } from './schema'
import type { components as RolesDraft } from './drafts/roles-permissions'
import type { components as RefundsDraft, operations as RefundOperations } from './drafts/refunds'
import type { components as IncidentDraft, operations as IncidentOperations } from './drafts/incident-reports'

type S = components['schemas']
export type Product = S['ProductResponse']
export type Machine = S['MachineResponse']
export type Slot = S['MachineSlotResponse']
export type User = S['UserResponse']
export type Batch = S['ProductBatchResponse']
// Near-expiry discount (FE 7.5, backend #61): a bowl only carries `discountEligibleToday`; prices and the discount live
// on order lines (originalUnitPrice, unitPrice, discountPercent, discountReason) and orders (discountAmount).
export type InventoryItem = S['InventoryItemResponse']
export type InventorySummary = S['InventorySummaryResponse']
export type InventoryTransaction = S['InventoryTransactionResponse']
export type KioskCredential = S['KioskCredentialResponse']
export type IssuedKioskCredential = S['IssuedKioskCredentialResponse']
export type OrderSummary = S['OrderSummaryResponse']
export type OrderLine = S['OrderItemDetailResponse']
export type OrderDetail = S['OrderDetailResponse']
export type Payment = S['PaymentResponse']
export type PaymentDetail = S['PaymentDetailResponse']
export type WebhookLogSummary = S['PaymentWebhookLogSummaryResponse']
export type WebhookLogDetail = S['PaymentWebhookLogDetailResponse']

export interface Page<T> { content: T[]; page: number; size: number; totalElements: number; totalPages: number }
type Query<K extends keyof operations> = operations[K] extends { parameters: { query?: infer Q } } ? NonNullable<Q> : never
type Q = Record<string, string | number | boolean | undefined | readonly string[]>

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

// Alerts (screen O2 and the alert bell, FE 6.3): GET/POST /alerts of api-contract/api.yaml (backend #58). ALERT_READ to
// read, ALERT_MANAGE to acknowledge/resolve. The list has no `sort` (CRITICAL, WARNING, INFO, then newest first) and,
// without `status`, only returns alerts that are not RESOLVED. POST /alerts/{alertId}/work-orders (WORK_ORDER_MANAGE)
// opens a work order for the alert (workOrdersApi below for the rest).
export type Alert = S['AlertResponse']
export type AlertListQuery = Query<'listAlerts'>
export type ResolveAlertBody = S['ResolveAlertRequest']
export type CreateWorkOrderFromAlertBody = S['CreateWorkOrderFromAlertRequest']
export type WorkOrder = S['WorkOrderResponse']

export const alertsApi = {
  list: (query: AlertListQuery, signal?: AbortSignal) => list<Alert>('/alerts', query, signal),
  get: (alertId: string, signal?: AbortSignal) => api.get<Alert>(`/alerts/${id(alertId)}`, undefined, signal),
  /** OPEN → ACKNOWLEDGED, no body; an ACKNOWLEDGED alert comes back unchanged (200); RESOLVED is 409. */
  acknowledge: (alertId: string) => api.post<Alert>(`/alerts/${id(alertId)}/acknowledge`),
  /** OPEN/ACKNOWLEDGED → RESOLVED; the note (at most 500) is only sent when there is one. 409 when already resolved. */
  resolve: (alertId: string, body: ResolveAlertBody) => api.post<Alert>(`/alerts/${id(alertId)}/resolve`, body),
  /** Work order for the alert (source ALERT, its machine); an OPEN alert becomes ACKNOWLEDGED. 409 ALERT_RESOLVED / ALERT_ALREADY_HANDLED. */
  createWorkOrder: (alertId: string, body: CreateWorkOrderFromAlertBody) => api.post<WorkOrder>(`/alerts/${id(alertId)}/work-orders`, body),
}

// Telemetry and events of a machine (tab "Cảm biến & Sự kiện" of C3, FE 6.4): api-contract/api.yaml (backend #53, #56),
// MACHINE_READ. There is no heartbeat endpoint: connectivity and the last heartbeat's diagnostics (firmware, uptime,
// Wi-Fi RSSI, free heap) are fields of MachineResponse (machinesApi.get).
export type TelemetryReading = S['TelemetryReadingResponse']
export type TelemetryLatest = S['TelemetryLatestResponse']
export type MachineEvent = S['MachineEventResponse']
export type TelemetryQuery = Query<'listTelemetry'>
export type MachineEventQuery = Query<'listMachineEvents'>

export const telemetryApi = {
  /** Latest reading with LOW/NORMAL/HIGH against the machine thresholds; reading fields null when there is none yet. */
  latest: (machineId: string, signal?: AbortSignal) => api.get<TelemetryLatest>(`/machines/${id(machineId)}/telemetry/latest`, undefined, signal),
  /** History, newest first; `from` and `to` are required (to after from, at most 31 days). */
  readings: (machineId: string, query: TelemetryQuery, signal?: AbortSignal) => list<TelemetryReading>(`/machines/${id(machineId)}/telemetry`, query, signal),
  /** Event timeline, newest first; MACHINE payloads are untrusted device data (render escaped). */
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
  /** PAYMENT_REFUND (ADMIN): payment SUCCESS → REFUNDED; 409 when already refunded or not a refund case. Never retried. */
  record: (orderId: string, body: RefundBody) => api.post<Refund>(`/orders/${id(orderId)}/refund`, body),
}

// Work orders (screens O3/O4, FE 7.1/7.2): /work-orders of api-contract/api.yaml (backend #66, #68, #70, #74).
// WORK_ORDER_READ_ALL lists everyone's (GET /work-orders), WORK_ORDER_READ_ASSIGNED the caller's own (GET /me), the detail
// and its history; someone else's work order is 404 without READ_ALL. WORK_ORDER_MANAGE creates, edits, assigns,
// unassigns, cancels and links alerts; WORK_ORDER_EXECUTE starts, adds notes and completes (STAFF only their own,
// ADMIN any). Edit, assign, unassign and cancel send the `version` last read (stale → 409 STALE_VERSION).
export type WorkOrderStatus = NonNullable<WorkOrder['status']>
export type WorkOrderType = NonNullable<WorkOrder['type']>
export type WorkOrderPriority = NonNullable<WorkOrder['priority']>
export type WorkOrderSource = NonNullable<WorkOrder['source']>
export type WorkOrderListQuery = Query<'listWorkOrders'>
export type MyWorkOrderQuery = Query<'listMyWorkOrders'>
export type WorkOrderEvent = S['WorkOrderEventResponse']
export type CreateWorkOrderBody = S['CreateWorkOrderRequest']
export type UpdateWorkOrderBody = S['UpdateWorkOrderRequest']
export type AssignWorkOrderBody = S['AssignWorkOrderRequest']
export type StartWorkOrderBody = S['StartWorkOrderRequest']
export type CompleteWorkOrderBody = S['CompleteWorkOrderRequest']
export type CancelWorkOrderBody = S['CancelWorkOrderRequest']
export type LineVariance = S['LineVariance']

export const workOrdersApi = {
  /** WORK_ORDER_READ_ALL. URGENT first, then due time (none last), then oldest; `status` may repeat. */
  list: (query: WorkOrderListQuery, signal?: AbortSignal) => list<WorkOrder>('/work-orders', query, signal),
  /** WORK_ORDER_READ_ASSIGNED: the caller's own work orders, same order and paging. */
  mine: (query: MyWorkOrderQuery, signal?: AbortSignal) => list<WorkOrder>('/work-orders/me', query, signal),
  get: (workOrderId: string, signal?: AbortSignal) => api.get<WorkOrder>(`/work-orders/${id(workOrderId)}`, undefined, signal),
  /** Append-only history, oldest first. */
  events: (workOrderId: string, signal?: AbortSignal) => api.get<WorkOrderEvent[]>(`/work-orders/${id(workOrderId)}/events`, undefined, signal),
  /** Source MANUAL; OPEN, or ASSIGNED with an assignee. RESTOCK lines need RESTOCK_PLAN too. */
  create: (body: CreateWorkOrderBody) => api.post<WorkOrder>('/work-orders', body),
  /** Partial edit of an unfinished work order (title, description, priority, dueAt) with its version. */
  update: (workOrderId: string, body: UpdateWorkOrderBody) => api.patch<WorkOrder>(`/work-orders/${id(workOrderId)}`, body),
  /** OPEN/ASSIGNED → ASSIGNED, IN_PROGRESS stays (reassignment). */
  assign: (workOrderId: string, body: AssignWorkOrderBody) => api.post<WorkOrder>(`/work-orders/${id(workOrderId)}/assign`, body),
  /** ASSIGNED → OPEN. */
  unassign: (workOrderId: string, version: number) => api.post<WorkOrder>(`/work-orders/${id(workOrderId)}/unassign`, { version }),
  /** ASSIGNED → IN_PROGRESS (the machine goes MAINTENANCE for RESTOCK/MAINTENANCE, INCIDENT only with stopMachine). */
  start: (workOrderId: string, body?: StartWorkOrderBody) => api.post<WorkOrder>(`/work-orders/${id(workOrderId)}/start`, body),
  note: (workOrderId: string, note: string) => api.post<WorkOrder>(`/work-orders/${id(workOrderId)}/notes`, { note }),
  /** IN_PROGRESS → DONE with a mandatory resultNote (RESTOCK: lineVariances for lines loaded ≠ planned). */
  complete: (workOrderId: string, body: CompleteWorkOrderBody) => api.post<WorkOrder>(`/work-orders/${id(workOrderId)}/complete`, body),
  /** Any unfinished state → CANCELLED, with a reason and the version. */
  cancel: (workOrderId: string, body: CancelWorkOrderBody) => api.post<WorkOrder>(`/work-orders/${id(workOrderId)}/cancel`, body),
  linkAlert: (workOrderId: string, alertId: string) => api.post<WorkOrder>(`/work-orders/${id(workOrderId)}/alerts`, { alertId }),
}

// Restock of a RESTOCK work order (FE 7.2, backend #68). RESTOCK_PLAN (ADMIN): suggestions, work order from suggestions,
// planned lines (only while nothing was loaded against them). RESTOCK_EXECUTE: bowls loaded per line from one batch,
// while the work order is IN_PROGRESS. Old bowls are taken out with maintenance commands carrying workOrderId.
export type RestockView = S['RestockViewResponse']
export type RestockLine = S['RestockLineResponse']
export type RestockLoad = S['RestockLoad']
export type LinkedMaintenanceCommand = S['LinkedMaintenanceCommand']
export type RestockSuggestions = S['RestockSuggestionResponse']
export type SlotSuggestion = S['SlotSuggestion']
export type RestockLineInput = S['RestockLineInput']
export type UpdateRestockLineBody = S['UpdateRestockLineRequest']
export type RestockLoadBody = S['RestockLoadRequest']
export type RestockLoadResult = S['RestockLoadResponse']
export type CreateRestockWorkOrderBody = S['CreateRestockWorkOrderRequest']

export const restockApi = {
  /** Lines with their loads, linked maintenance commands and bowls removed by reason (same visibility as the work order). */
  view: (workOrderId: string, signal?: AbortSignal) => api.get<RestockView>(`/work-orders/${id(workOrderId)}/restock`, undefined, signal),
  suggestions: (machineId: string, signal?: AbortSignal) => api.get<RestockSuggestions>(`/machines/${id(machineId)}/restock-suggestions`, undefined, signal),
  /** One line per slot whose suggestion is not NONE; 409 NOTHING_TO_RESTOCK when nothing needs it. */
  createFromSuggestions: (machineId: string, body: CreateRestockWorkOrderBody) => api.post<WorkOrder>(`/machines/${id(machineId)}/restock-work-orders`, body),
  addLine: (workOrderId: string, body: RestockLineInput) => api.post<RestockLine>(`/work-orders/${id(workOrderId)}/restock-lines`, body),
  /** Only while nothing was loaded against the line (409 LINE_ALREADY_LOADED). */
  updateLine: (workOrderId: string, lineId: string, body: UpdateRestockLineBody) => api.patch<RestockLine>(`/work-orders/${id(workOrderId)}/restock-lines/${id(lineId)}`, body),
  /** Bowls physically placed in the line's column from one batch; never retried automatically. */
  load: (workOrderId: string, lineId: string, body: RestockLoadBody) => api.post<RestockLoadResult>(`/work-orders/${id(workOrderId)}/restock-lines/${id(lineId)}/loads`, body),
}

// Maintenance plans (screen O5, FE 7.3): /maintenance-plans of api.yaml (backend #70). MAINTENANCE_PLAN_READ reads,
// MAINTENANCE_PLAN_MANAGE (ADMIN) changes. Dates are Vietnam calendar days; never deleted, only deactivated.
export type MaintenancePlan = S['MaintenancePlanResponse']
export type MaintenancePlanListQuery = Query<'listMaintenancePlans'>
export type UpcomingPlanQuery = Query<'listUpcomingMaintenance'>
export type CreateMaintenancePlanBody = S['CreateMaintenancePlanRequest']
export type UpdateMaintenancePlanBody = S['UpdateMaintenancePlanRequest']
export type PlanWorkOrder = S['PlanWorkOrderResponse']

export const maintenancePlansApi = {
  /** By next due date (no sort parameter). */
  list: (query: MaintenancePlanListQuery, signal?: AbortSignal) => list<MaintenancePlan>('/maintenance-plans', query, signal),
  get: (planId: string, signal?: AbortSignal) => api.get<MaintenancePlan>(`/maintenance-plans/${id(planId)}`, undefined, signal),
  /** Active plans due within `days` (1..90), overdue ones included. */
  upcoming: (query: UpcomingPlanQuery, signal?: AbortSignal) => api.get<MaintenancePlan[]>('/maintenance-plans/upcoming', query, signal),
  create: (body: CreateMaintenancePlanBody) => api.post<MaintenancePlan>('/maintenance-plans', body),
  /** Partial change with the version last read. */
  update: (planId: string, body: UpdateMaintenancePlanBody) => api.patch<MaintenancePlan>(`/maintenance-plans/${id(planId)}`, body),
  activate: (planId: string) => api.post<MaintenancePlan>(`/maintenance-plans/${id(planId)}/activate`),
  deactivate: (planId: string) => api.post<MaintenancePlan>(`/maintenance-plans/${id(planId)}/deactivate`),
  /** The work order of the current occurrence now, regardless of lead days. */
  generateNow: (planId: string) => api.post<WorkOrder>(`/maintenance-plans/${id(planId)}/generate-now`),
  /** Work orders generated by the plan, newest occurrence first. */
  workOrders: (planId: string, signal?: AbortSignal) => api.get<PlanWorkOrder[]>(`/maintenance-plans/${id(planId)}/work-orders`, undefined, signal),
}

// Maintenance commands (tab "Bảo trì" of C3, FE 7.4; also the restock of FE 7.2): api.yaml (backend #64, #68).
// MAINTENANCE_COMMAND_EXECUTE sends a column command and reconciles; MACHINE_RESET (ADMIN) resets the controller;
// MAINTENANCE_COMMAND_READ lists. POSTs need an Idempotency-Key: one per click, the same one when retrying that click.
export type MaintenanceCommand = S['MaintenanceCommandResponse']
export type MaintenanceOperation = NonNullable<MaintenanceCommand['operation']>
export type MaintenanceCommandStatus = NonNullable<MaintenanceCommand['status']>
export type MaintenanceReason = NonNullable<S['CreateMaintenanceCommandRequest']['reason']>
export type CreateMaintenanceCommandBody = S['CreateMaintenanceCommandRequest']
export type ResetMachineBody = S['ResetMachineRequest']
export type ReconcileMaintenanceCommandBody = S['ReconcileMaintenanceCommandRequest']
export type MaintenanceCommandQuery = Query<'listMaintenanceCommands'>
const idempotent = (key: string) => ({ 'Idempotency-Key': key })

export const maintenanceCommandsApi = {
  /** Newest first. */
  list: (query: MaintenanceCommandQuery, signal?: AbortSignal) => list<MaintenanceCommand>('/maintenance-commands', query, signal),
  get: (commandId: string, signal?: AbortSignal) => api.get<MaintenanceCommand>(`/maintenance-commands/${id(commandId)}`, undefined, signal),
  /** PENDING command for one column; the same key and body answer the existing command (200). */
  create: (machineId: string, slotId: string, body: CreateMaintenanceCommandBody, idempotencyKey: string) =>
    api.post<MaintenanceCommand>(`/machines/${id(machineId)}/slots/${id(slotId)}/maintenance-commands`, body, idempotent(idempotencyKey)),
  /** RESET of the controller (MACHINE_RESET). */
  reset: (machineId: string, body: ResetMachineBody, idempotencyKey: string) =>
    api.post<MaintenanceCommand>(`/machines/${id(machineId)}/reset`, body, idempotent(idempotencyKey)),
  /** NEEDS_RECONCILIATION → RECONCILED with what Staff found at the machine. */
  reconcile: (commandId: string, body: ReconcileMaintenanceCommandBody) => api.post<MaintenanceCommand>(`/maintenance-commands/${id(commandId)}/reconcile`, body),
}

// Near-expiry discount setting (FE 7.5, backend #61): PRICING_READ reads, PRICING_MANAGE (ADMIN) replaces it with the
// version last read (stale → 409).
export type NearExpiryDiscount = S['NearExpiryDiscountResponse']
export type UpdateNearExpiryDiscountBody = S['UpdateNearExpiryDiscountRequest']
export const pricingApi = {
  get: (signal?: AbortSignal) => api.get<NearExpiryDiscount>('/pricing/near-expiry-discount', undefined, signal),
  update: (body: UpdateNearExpiryDiscountBody) => api.put<NearExpiryDiscount>('/pricing/near-expiry-discount', body),
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
  /** FE 8.3, ADMIN (PAYMENT_REFUND): reports for W-12; `flagged: true` = orders still to check for a refund. */
  list: (query: IncidentReportListQuery, signal?: AbortSignal) => list<IncidentReport>('/incident-reports', query, signal),
}
