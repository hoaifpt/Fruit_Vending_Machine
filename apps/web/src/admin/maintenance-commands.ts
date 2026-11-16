// Maintenance commands (FE 7.4, screen O6: tab "Bảo trì" of the machine detail page). Shared on purpose: the restock of
// FE 7.2 sends REMOVE_ITEM / EMPTY_COLUMN / OPEN_REFILL / CLOSE_REFILL with the same wording, body builder, lock rules,
// idempotency keys and error text. Pure and unit-tested (tests/maintenance-commands.test.mjs).
// Contract: api-contract/api.yaml, backend #64/#68 (docs/maintenance-commands.md): POST
// /machines/{machineId}/slots/{slotId}/maintenance-commands (one column), POST /machines/{machineId}/reset (MACHINE_RESET),
// GET /maintenance-commands, POST /maintenance-commands/{id}/reconcile. Life cycle PENDING → SENT → ACCEPTED → COMPLETED,
// FAILED when the machine does not take it, NEEDS_RECONCILIATION when it took it but did not report, then RECONCILED by
// Staff. Commands need the machine in MAINTENANCE and online, one unfinished command per machine; stock only changes on
// COMPLETED (or a reconciliation DONE). Every POST carries an Idempotency-Key: a new one per click, the same one when
// retrying that click after a network error. Nothing is ever deleted.
import { ApiError } from '../api/client.ts'
import { maintenanceCommandsApi } from '../api/resources.ts'
import type {
  CreateMaintenanceCommandBody, InventorySummary, MaintenanceCommand, MaintenanceCommandStatus, MaintenanceOperation, MaintenanceReason,
  ReconcileMaintenanceCommandBody,
} from '../api/resources.ts'
import { formatDateTime } from '../lib/format.ts'
import { statusMeta } from '../lib/status.ts'
import type { ShownConnection } from './connection.ts'
import type { MachineStatus } from './machines.ts'
import { errorCode } from './form-error.ts'

export type ColumnOperation = Exclude<MaintenanceOperation, 'RESET'>
export const MAINTENANCE_OPERATIONS = ['OPEN_REFILL', 'CLOSE_REFILL', 'REMOVE_ITEM', 'EMPTY_COLUMN', 'RESET'] as const satisfies readonly MaintenanceOperation[]
/** Operations on one column (POST .../slots/{slotId}/maintenance-commands); RESET has its own endpoint. */
export const COLUMN_OPERATIONS = ['OPEN_REFILL', 'CLOSE_REFILL', 'REMOVE_ITEM', 'EMPTY_COLUMN'] as const satisfies readonly ColumnOperation[]
/** Operations that take bowls out: a reason is required (and only allowed) for them. */
export const REMOVAL_OPERATIONS: readonly MaintenanceOperation[] = ['REMOVE_ITEM', 'EMPTY_COLUMN']
export const isRemoval = (operation: MaintenanceOperation) => REMOVAL_OPERATIONS.includes(operation)
export const NOTE_MAX = 500

export const REASONS = ['EXPIRED', 'DAMAGED', 'DISPENSE_FAILED', 'RESTOCK', 'INSPECTION', 'OTHER'] as const satisfies readonly MaintenanceReason[]
export const REASON_LABELS: Readonly<Record<MaintenanceReason, string>> = {
  EXPIRED: 'Hộp hết hạn', DAMAGED: 'Hộp dập, hỏng', DISPENSE_FAILED: 'Hộp nhả hàng thất bại', RESTOCK: 'Xả ngăn để nạp hàng mới', INSPECTION: 'Lấy ra kiểm tra', OTHER: 'Lý do khác',
}
export const REASON_OPTIONS = REASONS.map(reason => ({ value: reason, label: REASON_LABELS[reason] }))
export const reasonLabel = (reason: string | null | undefined) => (reason ? REASON_LABELS[reason as MaintenanceReason] ?? reason : '')

export interface CommandInfo {
  /** Button and history label. */
  label: string
  /** What the machine will do, in one or two sentences (shown next to the button and in the confirmation). */
  does: string
  /** Asks before sending (it changes stock or restarts the controller). */
  confirm: boolean
  /** Confirm button styled as destructive (cannot be undone). */
  danger: boolean
}

export const COMMAND_INFO: Readonly<Record<MaintenanceOperation, CommandInfo>> = {
  OPEN_REFILL: {
    label: 'Mở cổng nạp', confirm: false, danger: false,
    does: 'Máy mở cổng trên của ngăn và giữ mở để xếp hộp vào từ trên. Trong lúc cổng mở, ngăn không bán và không bật Hoạt động được. Tồn kho không đổi.',
  },
  CLOSE_REFILL: {
    label: 'Đóng cổng nạp', confirm: false, danger: false,
    does: 'Máy đóng cổng trên của ngăn. Luôn gửi được, kể cả để khôi phục. Mọi cổng nạp phải đóng trước khi hoàn tất phiếu nạp hàng.',
  },
  REMOVE_ITEM: {
    label: 'Rút hộp đáy ngăn', confirm: true, danger: false,
    does: 'Máy mở cổng dưới khoảng 1 giây để hộp ở đáy ngăn (hộp sẽ bán tiếp theo) rơi ra, rồi cho hộp kế tiếp xuống. Khi máy báo xong, chỉ hộp đáy lúc gửi lệnh chuyển Đã rút.',
  },
  EMPTY_COLUMN: {
    label: 'Xả cả ngăn', confirm: true, danger: true,
    does: 'Máy mở cổng dưới khoảng 5 giây để xả cả ngăn. Khi máy báo xong, mọi hộp Sẵn sàng, Hết hạn, Nhả hàng thất bại của ngăn chuyển Đã rút và không bán lại được.',
  },
  RESET: {
    label: 'Khởi động lại bộ điều khiển', confirm: true, danger: false,
    does: 'Máy xóa lỗi FAULT của bộ điều khiển. Không đổi tồn kho; máy vẫn ở Bảo trì cho tới khi quản trị viên bật lại.',
  },
}
export const commandLabel = (operation: string | undefined) => COMMAND_INFO[operation as MaintenanceOperation]?.label ?? operation ?? '—'

// ---- status of a command

export const UNFINISHED: readonly MaintenanceCommandStatus[] = ['PENDING', 'SENT', 'ACCEPTED']
export const isUnfinished = (command: Pick<MaintenanceCommand, 'status'>) => !!command.status && UNFINISHED.includes(command.status)
/** The unfinished command of a machine (the server allows one at a time), from the newest-first history. */
export function runningCommand<T extends Pick<MaintenanceCommand, 'status'>>(commands: readonly T[] | undefined): T | undefined {
  return commands?.find(isUnfinished)
}
export const commandStatusLabel = (status: string | undefined) => statusMeta('maintenanceCommand', status ?? '').label
export const commandStatusText = (status: string | undefined) => statusMeta('maintenanceCommand', status ?? '').description

/** failureReason of a FAILED or NEEDS_RECONCILIATION command in words; unknown codes are shown as they are. */
const FAILURES: Readonly<Record<string, string>> = {
  ACCEPT_TIMEOUT: 'Máy không nhận lệnh trong 30 giây (có thể đang mất kết nối). Không có gì thay đổi.',
  COMPLETE_TIMEOUT: 'Máy đã nhận lệnh nhưng không báo xong trong 90 giây.',
  HEAD_CHANGED: 'Hộp ở đáy ngăn đã đổi so với lúc gửi lệnh nên hệ thống không tự rút hộp nào.',
  ACCEPTED_AFTER_TIMEOUT: 'Máy nhận lệnh sau khi đã quá giờ, có thể máy vẫn đã làm.',
  CONTROLLER_FAULT: 'Bộ điều khiển đang lỗi FAULT nên từ chối lệnh. Khởi động lại bộ điều khiển rồi gửi lại.',
}
export function failureText(code: string | null | undefined): string {
  if (!code) return 'Máy không gửi lý do.'
  if (FAILURES[code]) return FAILURES[code]
  if (code.startsWith('ABORTED')) return 'Máy dừng giữa chừng. Kiểm tra ngăn và khay tại máy.'
  return `Máy báo mã ${code}. Kiểm tra tại máy.`
}

/** One line under a command in the history: column, target bowl, outcome. */
export function commandDetail(command: MaintenanceCommand): string {
  const parts: string[] = []
  if (command.slotCode) parts.push(`Ngăn ${command.slotCode}`)
  if (command.targetItem?.productName) parts.push(`hộp ${command.targetItem.productName}${command.targetItem.batchCode ? ` (lô ${command.targetItem.batchCode})` : ''}`)
  if (command.reason) parts.push(reasonLabel(command.reason))
  const applied = command.status === 'COMPLETED' || (command.status === 'RECONCILED' && command.reconciliationOutcome === 'DONE')
  if (applied && typeof command.removedCount === 'number' && isRemoval(command.operation!)) parts.push(`đã rút ${command.removedCount} hộp`)
  if (command.status === 'FAILED' || command.status === 'NEEDS_RECONCILIATION') parts.push(failureText(command.failureReason))
  if (command.status === 'RECONCILED') parts.push(command.reconciliationOutcome === 'DONE' ? 'đối soát: máy đã làm' : 'đối soát: máy chưa làm, không đổi tồn kho')
  return parts.join(' · ')
}

/** Refill gate of a column as the slot reports it (refillGateOpen, updated when OPEN/CLOSE_REFILL completes). */
export function gateText(open: boolean | undefined): string {
  return open ? 'Cổng nạp đang mở: ngăn không bán.' : 'Cổng nạp đang đóng.'
}

// ---- when the buttons are locked, and why

export type LockCode = 'missing' | 'permission' | 'status' | 'offline' | 'running'
export interface Lock { code: LockCode; reason: string; next: string }
export interface LockInput {
  /** The account holds MAINTENANCE_COMMAND_EXECUTE. */
  canMaintain: boolean
  /** The account may change the machine status (MACHINE_WRITE), so the next step can be done by itself. */
  canChangeStatus: boolean
  machineStatus: MachineStatus
  /** Connectivity as shown in the page header (UNKNOWN never locks: the data is old, not the machine). */
  connection: ShownConnection
  neverConnected?: boolean
  running?: Pick<MaintenanceCommand, 'operation' | 'status' | 'createdAt'>
  /** The backend does not have the endpoints (404/501 on the list). */
  missing?: boolean
}

export const NOT_MAINTENANCE_NEXT_ADMIN = 'Chuyển máy sang Bảo trì ở thẻ Tổng quan (nút “Chuyển sang Bảo trì”), hoặc bắt đầu một phiếu nạp hàng / bảo trì của máy (máy tự chuyển sang Bảo trì).'
export const NOT_MAINTENANCE_NEXT_STAFF = 'Bắt đầu phiếu nạp hàng hoặc bảo trì của máy (máy tự chuyển sang Bảo trì), hoặc nhờ Quản trị viên chuyển máy sang Bảo trì.'

/** Why every command of the machine is locked right now, or null when they can be sent. Checked in this order. */
export function machineLock(input: LockInput): Lock | null {
  if (input.missing) return { code: 'missing', reason: 'Máy chủ chưa hỗ trợ lệnh bảo trì nên chưa gửi được lệnh nào.', next: 'Trong thời gian này, thao tác trực tiếp tại máy.' }
  if (!input.canMaintain) return { code: 'permission', reason: 'Tài khoản của bạn chưa có quyền gửi lệnh bảo trì.', next: 'Nhờ Quản trị viên cấp quyền rồi đăng nhập lại.' }
  if (input.machineStatus !== 'MAINTENANCE') {
    return {
      code: 'status',
      reason: `Máy đang ở trạng thái ${statusMeta('machine', input.machineStatus).label}. Lệnh bảo trì chỉ gửi được khi máy ở trạng thái Bảo trì, để kiosk không bán hàng trong lúc cổng mở hay hộp đang được rút.`,
      next: input.canChangeStatus ? NOT_MAINTENANCE_NEXT_ADMIN : NOT_MAINTENANCE_NEXT_STAFF,
    }
  }
  if (input.connection === 'OFFLINE') {
    return {
      code: 'offline',
      reason: input.neverConnected ? 'Máy chưa từng kết nối nên lệnh không tới được máy.' : 'Máy đang mất kết nối (OFFLINE) nên lệnh không tới được máy.',
      next: 'Kiểm tra nguồn điện và Wi-Fi của máy. Các nút tự mở lại khi máy có tín hiệu.',
    }
  }
  if (input.running) {
    const { operation, status, createdAt } = input.running
    return {
      code: 'running',
      reason: `Đang chờ lệnh “${commandLabel(operation)}” gửi lúc ${formatDateTime(createdAt)} xong (${commandStatusLabel(status).toLowerCase()}). Mỗi máy chỉ chạy một lệnh một lúc.`,
      next: 'Lịch sử bên dưới tự cập nhật; các nút mở lại khi lệnh kết thúc.',
    }
  }
  return null
}

/** Bowls a column command would take out, or why it cannot run on this column (from the slot's summary and gate). */
export interface SlotPlan { count: number; blocked?: string }
type Summary = Pick<InventorySummary, 'occupiedCount' | 'reservedCount' | 'headStatus'>
export function slotPlan(operation: ColumnOperation, summary: Summary | undefined, refillGateOpen = false): SlotPlan {
  if (operation === 'CLOSE_REFILL') return { count: 0 }
  if (!summary) return { count: 0, blocked: 'Chọn ngăn trước.' }
  const occupied = summary.occupiedCount ?? 0
  const reserved = summary.reservedCount ?? 0
  if (operation === 'OPEN_REFILL') {
    if (refillGateOpen) return { count: 0, blocked: 'Cổng nạp của ngăn đã mở.' }
    if (reserved > 0) return { count: 0, blocked: `Ngăn có ${reserved} hộp đang được giữ cho đơn chưa xong. Chờ đơn kết thúc rồi mở cổng.` }
    return { count: 0 }
  }
  if (occupied === 0) return { count: 0, blocked: 'Ngăn đang trống, không có hộp nào để rút.' }
  if (refillGateOpen) return { count: 0, blocked: 'Cổng nạp của ngăn đang mở. Đóng cổng nạp trước rồi rút hộp.' }
  if (reserved > 0 || summary.headStatus === 'RESERVED') return { count: 0, blocked: `Ngăn có ${Math.max(reserved, 1)} hộp đang được giữ cho đơn chưa xong. Chờ đơn kết thúc rồi rút.` }
  return { count: operation === 'REMOVE_ITEM' ? 1 : occupied }
}

// ---- request body, validation, idempotency, errors

export interface CommandInput { reason?: MaintenanceReason | ''; note?: string; inventoryItemId?: string; workOrderId?: string }

/** Client checks before sending: a reason for removals (with a note for OTHER), the note length. */
export function validateCommand(operation: MaintenanceOperation, input: CommandInput): Record<string, string> {
  const errors: Record<string, string> = {}
  const note = (input.note ?? '').trim()
  if (isRemoval(operation)) {
    if (!input.reason) errors.reason = 'Chọn lý do rút hộp.'
    else if (input.reason === 'OTHER' && !note) errors.note = 'Ghi rõ lý do khác.'
  }
  if (note.length > NOTE_MAX) errors.note = `Tối đa ${NOTE_MAX} ký tự.`
  return errors
}

/**
 * Body of a column command: only fields of CreateMaintenanceCommandRequest. `reason` for removals only, inventoryItemId
 * for REMOVE_ITEM only (when given), note only when not blank, workOrderId only when given.
 */
export function maintenanceCommandBody(operation: ColumnOperation, input: CommandInput = {}): CreateMaintenanceCommandBody {
  const body: CreateMaintenanceCommandBody = { operation }
  if (isRemoval(operation) && input.reason) body.reason = input.reason
  const note = input.note?.trim()
  if (note) body.note = note
  if (operation === 'REMOVE_ITEM' && input.inventoryItemId) body.inventoryItemId = input.inventoryItemId
  if (input.workOrderId) body.workOrderId = input.workOrderId
  return body
}

/** A fresh Idempotency-Key (UUID: 36 characters of the allowed alphabet). */
export const newIdempotencyKey = (): string => crypto.randomUUID()

/** Errors after which the same click may be retried with the same key: the request may or may not have arrived. */
export function retryable(error: unknown): boolean {
  return !(error instanceof ApiError) || error.status === 0 || error.status >= 500
}

/**
 * Keys of the clicks still in doubt, by what they send (machine, column, body). A new click gets a new key; a retry of a
 * click that failed on the network or with a 5xx sends the same key (and body), so the server answers the command it may
 * already have created instead of creating a second one. A success or a business refusal forgets the key.
 */
export function createAttempts() {
  const pending = new Map<string, string>()
  return {
    keyFor(signature: string): string {
      const key = pending.get(signature) ?? newIdempotencyKey()
      pending.set(signature, key)
      return key
    },
    settle(signature: string, error?: unknown) {
      if (error === undefined || !retryable(error)) pending.delete(signature)
    },
    has: (signature: string) => pending.has(signature),
  }
}
export type Attempts = ReturnType<typeof createAttempts>

export type MaintenanceAvailability = 'missing' | 'forbidden' | 'unauthorized' | 'error'
/** 404/405/501 on the list: the backend has no maintenance commands. */
export function maintenanceAvailability(error: unknown): MaintenanceAvailability {
  const status = error instanceof ApiError ? error.status : undefined
  if (status === 404 || status === 405 || status === 501) return 'missing'
  if (status === 403) return 'forbidden'
  if (status === 401) return 'unauthorized'
  return 'error'
}
export const isMaintenanceMissing = (error: unknown) => maintenanceAvailability(error) === 'missing'
export const MAINTENANCE_MISSING = 'Chưa có chức năng lệnh bảo trì: máy chủ chưa hỗ trợ phần này. Trong thời gian này, thao tác trực tiếp tại máy; trạng thái máy và tồn kho ở các thẻ khác vẫn đúng.'

export const MAINTENANCE_TARGET_GONE = 'Không tìm thấy máy, ngăn hoặc phiếu này nữa (có thể vừa bị thay đổi, hoặc phiếu không còn giao cho bạn). Trang đã tải lại; kiểm tra rồi gửi lại.'

const CONFLICTS: Readonly<Record<string, string>> = {
  MACHINE_NOT_IN_MAINTENANCE: 'Máy không còn ở trạng thái Bảo trì (có thể vừa được đổi ở nơi khác). Trang đã tải lại trạng thái máy.',
  MACHINE_OFFLINE: 'Máy đang mất kết nối nên máy chủ không gửi lệnh. Kiểm tra nguồn điện và Wi-Fi của máy rồi thử lại.',
  MACHINE_COMMAND_IN_PROGRESS: 'Máy đang chạy một lệnh khác (bảo trì hoặc nhả hàng, có thể do người khác gửi). Chờ lệnh đó kết thúc rồi gửi lại.',
  SLOT_HAS_RESERVED_ITEM: 'Ngăn có hộp đang được giữ cho một đơn chưa xong. Chờ đơn kết thúc rồi gửi lại.',
  SLOT_EMPTY: 'Ngăn đã trống (có thể vừa được rút ở nơi khác). Số hộp đã được tải lại.',
  HEAD_NOT_REMOVABLE: 'Hộp ở đáy ngăn không rút được bằng lệnh (đang giữ cho đơn). Số hộp đã được tải lại.',
  NOT_HEAD_ITEM: 'Hộp ở đáy ngăn đã thay đổi từ lúc bạn mở trang. Số hộp đã được tải lại; kiểm tra rồi gửi lại.',
  REFILL_GATE_OPEN: 'Cổng nạp của ngăn đang mở. Đóng cổng nạp trước rồi gửi lại.',
  IDEMPOTENCY_KEY_REUSED: 'Lần gửi lại khác nội dung lần trước. Trang đã tải lại; bấm lại nút để gửi lệnh mới.',
  WORK_ORDER_NOT_IN_PROGRESS: 'Phiếu không còn ở trạng thái đang thực hiện (có thể đã hoàn tất hoặc bị hủy). Trang đã tải lại.',
  WORK_ORDER_OTHER_MACHINE: 'Phiếu này thuộc máy khác nên không gắn được với lệnh. Trang đã tải lại.',
  NOT_RECONCILABLE: 'Lệnh này đã được đối soát hoặc không cần đối soát nữa. Lịch sử đã được tải lại.',
  EFFECT_NOT_POSSIBLE: 'Không áp dụng được “máy đã làm”: hộp ở đáy ngăn không còn là hộp của lệnh. Chọn “Máy chưa làm” hoặc kiểm tra lại tại máy.',
}

/** POST errors in Vietnamese with the next step; 400 keeps its fieldErrors. */
export function describeMaintenanceError(error: unknown): unknown {
  if (!(error instanceof ApiError)) return error
  if (error.status === 409) {
    const code = errorCode(error)
    return new ApiError(409, (code && CONFLICTS[code]) || 'Máy chủ từ chối lệnh vì trạng thái máy hoặc ngăn vừa thay đổi. Trang đã tải lại; kiểm tra rồi gửi lại.')
  }
  // The API client replaces every 404 message with a generic one, so a 404 on POST cannot tell "machine/slot gone" from
  // "work order not yours" or "endpoint missing". The tab only enables sending once the history loaded (the endpoint
  // exists), so a 404 here means the target is gone or not the caller's.
  if (error.status === 404) return new ApiError(404, MAINTENANCE_TARGET_GONE)
  if (error.status === 403) return new ApiError(403, 'Tài khoản của bạn không có quyền gửi lệnh này. Nhờ Quản trị viên cấp quyền rồi đăng nhập lại.')
  if (error.status === 501 || error.status === 405) return new ApiError(error.status, MAINTENANCE_MISSING)
  if (error.status === 400) return new ApiError(400, 'Lệnh gửi lên chưa hợp lệ. Kiểm tra lý do và ghi chú rồi gửi lại.', error.fieldErrors)
  return error
}

/** After a 404/409 the screen reloads the machine, its history and the slot counts behind the message. */
export function needsRefresh(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 404 || error.status === 409)
}

/**
 * Sends one column command (shared with FE 7.2): validates, builds the body from the contract fields only, uses the
 * click's Idempotency-Key from `attempts` and words the errors. Client check failures are an ApiError(400) with fieldErrors.
 */
export async function sendMaintenanceCommand(attempts: Attempts, machineId: string, slotId: string, operation: ColumnOperation, input: CommandInput = {}): Promise<MaintenanceCommand> {
  const errors = validateCommand(operation, input)
  if (Object.keys(errors).length) throw new ApiError(400, 'Lệnh chưa đủ thông tin.', errors)
  const body = maintenanceCommandBody(operation, input)
  const signature = JSON.stringify([machineId, slotId, body])
  try {
    const command = await maintenanceCommandsApi.create(machineId, slotId, body, attempts.keyFor(signature))
    attempts.settle(signature)
    return command
  } catch (error) {
    attempts.settle(signature, error)
    throw describeMaintenanceError(error)
  }
}

/** RESET of the controller (MACHINE_RESET), with an optional note, same idempotency rule. */
export async function sendReset(attempts: Attempts, machineId: string, note = ''): Promise<MaintenanceCommand> {
  const text = note.trim()
  if (text.length > NOTE_MAX) throw new ApiError(400, 'Lệnh chưa đủ thông tin.', { note: `Tối đa ${NOTE_MAX} ký tự.` })
  const body = text ? { note: text } : {}
  const signature = JSON.stringify([machineId, 'RESET', body])
  try {
    const command = await maintenanceCommandsApi.reset(machineId, body, attempts.keyFor(signature))
    attempts.settle(signature)
    return command
  } catch (error) {
    attempts.settle(signature, error)
    throw describeMaintenanceError(error)
  }
}

/** Body of POST /maintenance-commands/{id}/reconcile: the outcome and the note when there is one. */
export function reconcileBody(outcome: 'DONE' | 'NOT_DONE' | '', note: string): { body?: ReconcileMaintenanceCommandBody; errors?: Record<string, string> } {
  const errors: Record<string, string> = {}
  if (outcome !== 'DONE' && outcome !== 'NOT_DONE') errors.outcome = 'Chọn máy đã làm hay chưa làm.'
  const text = note.trim()
  if (text.length > NOTE_MAX) errors.note = `Tối đa ${NOTE_MAX} ký tự.`
  if (Object.keys(errors).length) return { errors }
  return { body: text ? { outcome: outcome as 'DONE' | 'NOT_DONE', note: text } : { outcome: outcome as 'DONE' | 'NOT_DONE' } }
}
/** Whether a command waits for Staff to say what happened (RESET never does). */
export const needsReconciliation = (command: Pick<MaintenanceCommand, 'status' | 'operation'>) => command.status === 'NEEDS_RECONCILIATION' && command.operation !== 'RESET'

/** Poll the history every 2 s while a command is unfinished, else every 30 s (a command sent by someone else shows up). */
export const MAINTENANCE_POLL_MS = 2_000
export const MAINTENANCE_IDLE_POLL_MS = 30_000
export const MAINTENANCE_PAGE_SIZE = 10
