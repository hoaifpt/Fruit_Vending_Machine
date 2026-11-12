// Maintenance commands sent to a machine (FE 7.4, screen O6: tab "Bảo trì" of the machine detail page). Shared on purpose:
// the restock ticket of FE 7.2 sends OPEN_REFILL / CLOSE_REFILL / REMOVE_ITEM with the same wording, body builder, lock
// rules and error text (sendMaintenanceCommand below). Pure and unit-tested (tests/maintenance-commands.test.mjs).
// Contract: api-contract/drafts/machine-maintenance.yaml (draft waiting for backend issue 4.2): POST/GET
// /machines/{machineId}/maintenance-commands, life cycle PENDING → SENT → ACKNOWLEDGED → SUCCESS | FAILED | TIMEOUT like a
// dispense command (docs/mqtt-dispense.md). Commands are accepted only while the machine is in MAINTENANCE and online,
// one at a time per machine; REMOVE_ITEM / EMPTY_COLUMN take AVAILABLE or EXPIRED bowls only (like POST
// /inventory/{id}/remove, docs/inventory-management.md) and the bowls become REMOVED when the machine reports success.
// Nothing is ever deleted: a command stays in the history whatever its outcome.
import { ApiError } from '../api/client.ts'
import { maintenanceCommandsApi } from '../api/resources.ts'
import type { CreateMaintenanceCommandBody, InventorySummary, MaintenanceCommand, MaintenanceCommandType } from '../api/resources.ts'
import { formatDateTime } from '../lib/format.ts'
import { statusMeta } from '../lib/status.ts'
import type { ShownConnection } from './connection.ts'
import type { MachineStatus } from './machines.ts'

export const MAINTENANCE_COMMAND_TYPES = ['OPEN_REFILL', 'CLOSE_REFILL', 'REMOVE_ITEM', 'EMPTY_COLUMN', 'RESET'] as const satisfies readonly MaintenanceCommandType[]
/** Commands that act on one slot (slotId required); the others act on the whole machine (slotId must be absent). */
export const SLOT_COMMANDS: readonly MaintenanceCommandType[] = ['REMOVE_ITEM', 'EMPTY_COLUMN']
export const needsSlot = (type: MaintenanceCommandType) => SLOT_COMMANDS.includes(type)
export const REASON_MAX = 500

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

export const COMMAND_INFO: Readonly<Record<MaintenanceCommandType, CommandInfo>> = {
  OPEN_REFILL: {
    label: 'Mở cửa nạp hàng', confirm: false, danger: false,
    does: 'Máy mở khóa cửa nạp và tạm dừng cảm biến khay để bạn nạp hộp vào các ngăn. Tồn kho không đổi; nhập số hộp đã nạp ở màn Tồn kho.',
  },
  CLOSE_REFILL: {
    label: 'Đóng cửa nạp hàng', confirm: false, danger: false,
    does: 'Máy khóa lại cửa nạp và bật lại cảm biến khay. Gửi khi đã nạp xong, trước khi bật bán lại.',
  },
  REMOVE_ITEM: {
    label: 'Rút hộp đáy ngăn', confirm: true, danger: false,
    does: 'Máy nhả hộp ở đáy ngăn đã chọn (hộp sẽ bán tiếp theo) ra khay dịch vụ. Khi máy báo xong, hộp chuyển Đã rút và được ghi vào lịch sử kho.',
  },
  EMPTY_COLUMN: {
    label: 'Rút hết hộp trong ngăn', confirm: true, danger: true,
    does: 'Máy nhả lần lượt mọi hộp của ngăn đã chọn ra khay dịch vụ. Khi máy báo xong, tất cả các hộp đó chuyển Đã rút và không bán lại được.',
  },
  RESET: {
    label: 'Khởi động lại bộ nhả hàng', confirm: true, danger: false,
    does: 'Máy xóa lỗi FAULT của bộ nhả hàng và đưa hai cửa về vị trí ban đầu. Chỉ có tác dụng khi máy đang báo FAULT; nếu không, máy từ chối lệnh.',
  },
}
export const commandLabel = (type: string | undefined) => COMMAND_INFO[type as MaintenanceCommandType]?.label ?? type ?? '—'

// ---- status of a command (same vocabulary as dispense commands, wording about maintenance)

export const UNFINISHED: readonly MaintenanceCommand['status'][] = ['PENDING', 'SENT', 'ACKNOWLEDGED']
export const isUnfinished = (command: Pick<MaintenanceCommand, 'status'>) => UNFINISHED.includes(command.status)
/** The unfinished command of a machine (the server allows one at a time), from the newest-first history. */
export function runningCommand(commands: readonly MaintenanceCommand[] | undefined): MaintenanceCommand | undefined {
  return commands?.find(isUnfinished)
}

const STATUS_TEXT: Readonly<Record<MaintenanceCommand['status'], string>> = {
  PENDING: 'Đã tạo, đang chờ gửi xuống máy.',
  SENT: 'Đã gửi xuống máy, đang chờ máy phản hồi.',
  ACKNOWLEDGED: 'Máy đã nhận lệnh và đang thực hiện.',
  SUCCESS: 'Máy báo đã làm xong.',
  FAILED: 'Máy báo không làm được lệnh này.',
  TIMEOUT: 'Máy không phản hồi trong 60 giây nên lệnh dừng. Kiểm tra kết nối và tình trạng tại máy rồi gửi lại nếu cần.',
}
export const commandStatusLabel = (status: string) => statusMeta('dispense', status).label
export const commandStatusText = (status: string) => STATUS_TEXT[status as MaintenanceCommand['status']] ?? status

/** Codes the machine may report with a FAILED command (draft); unknown codes are shown as they are. */
const FAILURES: Readonly<Record<string, string>> = {
  NOT_IN_FAULT: 'Bộ nhả hàng không ở trạng thái lỗi FAULT nên không cần khởi động lại.',
  BUSY: 'Máy đang bận một chu trình khác. Chờ máy xong rồi gửi lại.',
  DOOR_OPEN: 'Cửa máy đang mở. Đóng cửa rồi gửi lại.',
  ABORTED: 'Máy dừng giữa chừng. Kiểm tra ngăn và khay tại máy trước khi gửi lại.',
}
export function failureText(code: string | null | undefined): string {
  if (!code) return 'Máy không gửi lý do.'
  return FAILURES[code] ?? `Máy báo mã ${code}. Kiểm tra tại máy.`
}

/** One line under a command in the history: slot, bowls, outcome. */
export function commandDetail(command: MaintenanceCommand): string {
  const parts: string[] = []
  if (command.slotCode) parts.push(`Ngăn ${command.slotCode}`)
  if (command.status === 'SUCCESS' && typeof command.removedCount === 'number') parts.push(`đã rút ${command.removedCount} hộp`)
  else if (typeof command.itemCount === 'number') parts.push(`${command.itemCount} hộp`)
  if (command.status === 'FAILED') parts.push(failureText(command.failureCode))
  return parts.join(' · ')
}

/** Refill door as last reported by a successful OPEN_REFILL / CLOSE_REFILL in the (newest-first) history. */
export function refillState(commands: readonly MaintenanceCommand[] | undefined): { state: 'open' | 'closed' | 'unknown'; at?: string } {
  const last = commands?.find(command => command.status === 'SUCCESS' && (command.type === 'OPEN_REFILL' || command.type === 'CLOSE_REFILL'))
  if (!last) return { state: 'unknown' }
  return { state: last.type === 'OPEN_REFILL' ? 'open' : 'closed', at: last.completedAt ?? last.updatedAt }
}

// ---- when the buttons are locked, and why

export type LockCode = 'missing' | 'permission' | 'status' | 'offline' | 'running'
export interface Lock { code: LockCode; reason: string; next: string }
export interface LockInput {
  /** The account holds MACHINE_MAINTENANCE. */
  canMaintain: boolean
  /** The account may change the machine status (MACHINE_WRITE), so the next step can be done by itself. */
  canChangeStatus: boolean
  machineStatus: MachineStatus
  /** Connectivity as shown in the page header (UNKNOWN never locks: the data is old, not the machine). */
  connection: ShownConnection
  neverConnected?: boolean
  running?: MaintenanceCommand
  /** The backend does not have the endpoints yet (404/501). */
  missing?: boolean
}

export const NOT_MAINTENANCE_NEXT_ADMIN = 'Chuyển máy sang Bảo trì ở thẻ Tổng quan (nút “Chuyển sang Bảo trì”), rồi quay lại đây.'
export const NOT_MAINTENANCE_NEXT_STAFF = 'Nhờ Quản trị viên chuyển máy sang Bảo trì; tài khoản nhân viên không đổi được trạng thái máy.'

/** Why every command of the machine is locked right now, or null when they can be sent. Checked in this order. */
export function machineLock(input: LockInput): Lock | null {
  if (input.missing) return { code: 'missing', reason: 'Máy chủ chưa hỗ trợ lệnh bảo trì nên chưa gửi được lệnh nào.', next: 'Trong thời gian này, thao tác trực tiếp tại máy.' }
  if (!input.canMaintain) return { code: 'permission', reason: 'Tài khoản của bạn chưa có quyền gửi lệnh bảo trì.', next: 'Nhờ Quản trị viên cấp quyền rồi đăng nhập lại.' }
  if (input.machineStatus !== 'MAINTENANCE') {
    return {
      code: 'status',
      reason: `Máy đang ở trạng thái ${statusMeta('machine', input.machineStatus).label}. Lệnh bảo trì chỉ gửi được khi máy ở trạng thái Bảo trì, để kiosk không bán hàng trong lúc cửa nạp mở hay hộp đang được rút.`,
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
    const { type, status, createdAt } = input.running
    return {
      code: 'running',
      reason: `Đang chờ lệnh “${commandLabel(type)}” gửi lúc ${formatDateTime(createdAt)} xong (${commandStatusLabel(status).toLowerCase()}). Mỗi máy chỉ chạy một lệnh một lúc.`,
      next: 'Lịch sử bên dưới tự cập nhật; các nút mở lại khi lệnh kết thúc.',
    }
  }
  return null
}

/** Bowls a slot command would take out, or why it cannot run on this slot (from the slot's inventory summary). */
export interface SlotPlan { count: number; blocked?: string }
export function slotPlan(type: MaintenanceCommandType, summary: Pick<InventorySummary, 'occupiedCount' | 'availableCount' | 'expiredCount' | 'reservedCount' | 'headStatus'> | undefined): SlotPlan {
  if (!summary) return { count: 0, blocked: 'Chọn ngăn trước.' }
  const occupied = summary.occupiedCount ?? 0
  const removable = (summary.availableCount ?? 0) + (summary.expiredCount ?? 0)
  const reserved = summary.reservedCount ?? 0
  const failed = Math.max(0, occupied - removable - reserved)
  if (occupied === 0) return { count: 0, blocked: 'Ngăn đang trống, không có hộp nào để rút.' }
  if (type === 'REMOVE_ITEM') {
    if (summary.headStatus === 'RESERVED') return { count: 0, blocked: 'Hộp ở đáy ngăn đang được giữ cho một đơn chưa xong. Chờ đơn kết thúc rồi rút.' }
    if (summary.headStatus === 'DISPENSE_FAILED') return { count: 0, blocked: 'Hộp ở đáy ngăn nhả hàng thất bại nên cần đối soát với đơn liên quan trước khi rút.' }
    return { count: 1 }
  }
  if (reserved > 0) return { count: 0, blocked: `Ngăn có ${reserved} hộp đang được giữ cho đơn chưa xong. Chờ đơn kết thúc rồi rút.` }
  if (failed > 0) return { count: 0, blocked: `Ngăn có ${failed} hộp nhả hàng thất bại cần đối soát với đơn liên quan trước.` }
  return { count: removable }
}

// ---- request body, validation, errors

export interface CommandInput { slotId?: string; inventoryItemId?: string; reason?: string }

/** Client checks before sending: a slot for slot commands, the reason length. */
export function validateCommand(type: MaintenanceCommandType, input: CommandInput): Record<string, string> {
  const errors: Record<string, string> = {}
  if (needsSlot(type) && !input.slotId) errors.slotId = 'Chọn ngăn cần rút hộp.'
  if ((input.reason ?? '').trim().length > REASON_MAX) errors.reason = `Tối đa ${REASON_MAX} ký tự.`
  return errors
}

/**
 * Body of POST /machines/{id}/maintenance-commands: only fields of CreateMaintenanceCommandRequest. slotId for slot
 * commands only, inventoryItemId for REMOVE_ITEM only (and only when given), reason only when not blank.
 */
export function maintenanceCommandBody(type: MaintenanceCommandType, input: CommandInput = {}): CreateMaintenanceCommandBody {
  const body: CreateMaintenanceCommandBody = { type }
  if (needsSlot(type) && input.slotId) body.slotId = input.slotId
  if (type === 'REMOVE_ITEM' && input.inventoryItemId) body.inventoryItemId = input.inventoryItemId
  const reason = input.reason?.trim()
  if (reason) body.reason = reason
  return body
}

export type MaintenanceAvailability = 'missing' | 'forbidden' | 'unauthorized' | 'error'
/** 404/405/501 on the list: the backend has not shipped the draft yet (BE 4.2). */
export function maintenanceAvailability(error: unknown): MaintenanceAvailability {
  const status = error instanceof ApiError ? error.status : undefined
  if (status === 404 || status === 405 || status === 501) return 'missing'
  if (status === 403) return 'forbidden'
  if (status === 401) return 'unauthorized'
  return 'error'
}
export const isMaintenanceMissing = (error: unknown) => maintenanceAvailability(error) === 'missing'
export const MAINTENANCE_MISSING = 'Chưa có chức năng lệnh bảo trì: máy chủ chưa hỗ trợ phần này. Trong thời gian này, thao tác trực tiếp tại máy; trạng thái máy và tồn kho ở các thẻ khác vẫn đúng.'

const CONFLICTS: readonly [RegExp, string][] = [
  [/not in maintenance/i, 'Máy không còn ở trạng thái Bảo trì (có thể vừa được đổi ở nơi khác). Trang đã tải lại trạng thái máy.'],
  [/offline/i, 'Máy đang mất kết nối nên máy chủ không gửi lệnh. Kiểm tra nguồn điện và Wi-Fi của máy rồi thử lại.'],
  [/still running/i, 'Máy đang chạy một lệnh bảo trì khác (có thể do người khác gửi). Chờ lệnh đó kết thúc ở lịch sử bên dưới rồi gửi lại.'],
  [/slot is empty/i, 'Ngăn đã trống (có thể vừa được rút ở nơi khác). Số hộp đã được tải lại.'],
  [/head cannot be removed/i, 'Hộp ở đáy ngăn không rút được: đang giữ cho đơn hoặc nhả hàng thất bại. Số hộp đã được tải lại.'],
  [/reserved or dispense-failed/i, 'Ngăn có hộp đang giữ cho đơn hoặc nhả hàng thất bại nên chưa rút hết được. Số hộp đã được tải lại.'],
  [/not the slot head/i, 'Hộp ở đáy ngăn đã thay đổi từ lúc bạn mở trang. Số hộp đã được tải lại; kiểm tra rồi gửi lại.'],
]

/** POST errors in Vietnamese with the next step; 400 keeps its fieldErrors. */
export function describeMaintenanceError(error: unknown): unknown {
  if (!(error instanceof ApiError)) return error
  if (error.status === 409) return new ApiError(409, CONFLICTS.find(([pattern]) => pattern.test(error.message))?.[1] ?? 'Máy chủ từ chối lệnh vì trạng thái máy hoặc ngăn vừa thay đổi. Trang đã tải lại; kiểm tra rồi gửi lại.')
  if (error.status === 404) {
    if (/slot/i.test(error.message)) return new ApiError(404, 'Ngăn này không còn thuộc máy. Tải lại trang rồi chọn ngăn khác.')
    if (/machine/i.test(error.message)) return new ApiError(404, 'Không tìm thấy máy này nữa. Về danh sách máy rồi mở lại.')
    return new ApiError(404, MAINTENANCE_MISSING)
  }
  if (error.status === 403) return new ApiError(403, 'Tài khoản của bạn không có quyền gửi lệnh bảo trì. Nhờ Quản trị viên cấp quyền rồi đăng nhập lại.')
  if (error.status === 501 || error.status === 405) return new ApiError(error.status, MAINTENANCE_MISSING)
  if (error.status === 400) return new ApiError(400, 'Lệnh gửi lên chưa hợp lệ. Kiểm tra ngăn và ghi chú rồi gửi lại.', error.fieldErrors)
  return error
}

/** After a 404/409 the screen reloads the machine, its history and the slot counts behind the message. */
export function needsRefresh(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 404 || error.status === 409)
}

/**
 * Sends one command (shared with FE 7.2): validates, builds the body from the contract fields only and words the
 * errors. Throws a ValidationError-like ApiError(400) with fieldErrors when the client checks fail.
 */
export async function sendMaintenanceCommand(machineId: string, type: MaintenanceCommandType, input: CommandInput = {}): Promise<MaintenanceCommand> {
  const errors = validateCommand(type, input)
  if (Object.keys(errors).length) throw new ApiError(400, 'Lệnh chưa đủ thông tin.', errors)
  try {
    return await maintenanceCommandsApi.create(machineId, maintenanceCommandBody(type, input))
  } catch (error) {
    throw describeMaintenanceError(error)
  }
}

/** Poll the history every 2 s while a command is unfinished, else every 30 s (a command sent by someone else shows up). */
export const MAINTENANCE_POLL_MS = 2_000
export const MAINTENANCE_IDLE_POLL_MS = 30_000
export const MAINTENANCE_PAGE_SIZE = 10
