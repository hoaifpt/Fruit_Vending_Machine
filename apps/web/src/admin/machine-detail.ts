// Rules of the Machine detail screen (C3) that do not need React: tabs in the URL, the slot list query, the slot forms
// (request bodies limited to the contract fields), readiness before switching the machine to ACTIVE, status changes,
// kiosk keys, and Vietnamese wording of the backend's English errors. Unit-tested.
// Contract: api-contract/api.yaml (getMachine, updateMachineStatus, listMachineSlots, createMachineSlot,
// updateMachineSlot, updateMachineSlotStatus, kiosk credentials). Backend (read only): MachineService,
// MachineSlotService, KioskCredentialService, V2/V10 migrations; rules: docs/machine-management.md,
// docs/machine-slot-management.md.
import { ApiError } from '../api/client.ts'
import { ValidationError } from './form-error.ts'
import type { components } from '../api/schema'
import { formatSort, oneOf, parseSort } from '../lib/table-query.ts'
import type { SortRule, SortState } from '../lib/table-query.ts'
import { MACHINE_NOT_FOUND, UNKNOWN_FIELD, translateFieldError as translateMachineFieldError } from './machines.ts'
import type { MachineStatus } from './machines.ts'

type S = components['schemas']
export type SlotStatus = S['MachineSlotResponse']['status']
type CredentialLike = Pick<S['KioskCredentialResponse'], 'status'>

// ---- tabs

/** `sensors` (FE 6.4): heartbeat, Wi-Fi, firmware, temperature/humidity and machine events with FAULT codes. */
export const DETAIL_TABS = ['overview', 'sensors', 'slots', 'kiosk'] as const
export type DetailTab = (typeof DETAIL_TABS)[number]
export const TAB_LABELS: Record<DetailTab, string> = { overview: 'Tổng quan', sensors: 'Cảm biến & Sự kiện', slots: 'Ngăn', kiosk: 'Khóa kiosk' }

/** Tabs this person may open: the kiosk keys need KIOSK_CREDENTIAL_MANAGE (ADMIN), the others MACHINE_READ. */
export function visibleTabs(canManageKeys: boolean): DetailTab[] {
  return canManageKeys ? [...DETAIL_TABS] : ['overview', 'sensors', 'slots']
}

/** `?tab=` of the page; a missing, unknown or not-allowed value opens the overview (never an empty or forbidden tab). */
export function readDetailTab(params: URLSearchParams, canManageKeys: boolean): DetailTab {
  const tab = oneOf(params.get('tab'), visibleTabs(canManageKeys)) as DetailTab | ''
  return tab || 'overview'
}

/** Query string of a tab: only `tab` (filters and page of the slots tab do not carry over); the overview has none. */
export function tabSearch(tab: DetailTab): string {
  return tab === 'overview' ? '' : `?tab=${tab}`
}

// ---- slot list

export const SLOT_STATUSES = ['ACTIVE', 'INACTIVE', 'ERROR'] as const
export const SLOT_FILTER_KEYS = ['slotStatus'] as const
/** `sort` of GET /machines/{id}/slots: one approved field, default slotCode,asc. */
export const SLOT_SORT: SortRule = { fields: ['id', 'slotCode', 'capacity', 'status', 'createdAt', 'updatedAt'], fallback: 'slotCode,asc' }

export interface SlotFilters { status: string; sort: SortState; page: number }

/** Slot list state from the URL (`slotStatus`, `sort`, `page`); unknown values are dropped so they never become a 400. */
export function readSlotFilters(params: URLSearchParams): SlotFilters {
  const rawPage = Number(params.get('page') ?? 0)
  return {
    status: oneOf(params.get('slotStatus'), SLOT_STATUSES),
    sort: parseSort(params.get('sort'), SLOT_SORT),
    page: Number.isInteger(rawPage) && rawPage > 0 ? rawPage : 0,
  }
}

/** Query of GET /machines/{id}/slots: only page, size, status and sort. */
export function slotListQuery(filters: SlotFilters, size: number) {
  return { page: filters.page, size, status: (filters.status || undefined) as SlotStatus | undefined, sort: formatSort(filters.sort) }
}

// ---- slot forms

/** Limits of CreateMachineSlotRequest / UpdateMachineSlotRequest (capacity is a positive 32-bit integer). */
export const SLOT_LIMITS = { slotCode: 32, capacityMax: 2_147_483_647 } as const
export type SlotValues = { slotCode: string; capacity: string }

export type CapacityResult = { ok: true; value: number } | { ok: false; message: string }

/** Capacity typed by a person: a whole number of boxes from 1 to 2147483647, no decimals or separators. */
export function parseCapacity(raw: string): CapacityResult {
  const text = raw.trim()
  if (!text) return { ok: false, message: 'Vui lòng nhập sức chứa.' }
  if (!/^\d+$/.test(text)) return { ok: false, message: 'Sức chứa là số nguyên số hộp, ví dụ 6.' }
  const value = Number(text)
  if (value < 1) return { ok: false, message: 'Sức chứa phải lớn hơn 0.' }
  if (value > SLOT_LIMITS.capacityMax) return { ok: false, message: `Sức chứa tối đa ${SLOT_LIMITS.capacityMax.toLocaleString('vi-VN')}.` }
  return { ok: true, value }
}

/** Checks the backend also makes, shown beside the fields without a round trip. `slotCode` only when creating. */
export function validateSlot(values: SlotValues, mode: 'create' | 'edit'): Record<string, string> {
  const errors: Record<string, string> = {}
  if (mode === 'create') {
    const code = values.slotCode.trim()
    if (!code) errors.slotCode = 'Vui lòng nhập mã ngăn.'
    else if (code.length > SLOT_LIMITS.slotCode) errors.slotCode = `Mã ngăn tối đa ${SLOT_LIMITS.slotCode} ký tự.`
  }
  const capacity = parseCapacity(values.capacity)
  if (!capacity.ok) errors.capacity = capacity.message
  return errors
}

function capacityOf(values: SlotValues): number {
  const capacity = parseCapacity(values.capacity)
  if (!capacity.ok) throw new ValidationError({ capacity: capacity.message })
  return capacity.value
}

/** POST body: slotCode (uppercased as the backend stores it) and capacity, nothing else (status starts ACTIVE). */
export function createSlotBody(values: SlotValues): S['CreateMachineSlotRequest'] {
  const errors = validateSlot(values, 'create')
  if (Object.keys(errors).length) throw new ValidationError(errors)
  return { slotCode: values.slotCode.trim().toUpperCase(), capacity: capacityOf(values) }
}

/** PUT body: capacity only (the slot code never changes). */
export function updateSlotBody(values: SlotValues): S['UpdateMachineSlotRequest'] {
  return { capacity: capacityOf(values) }
}

export const SLOT_CODE_TAKEN = 'Máy này đã có ngăn mang mã này (không phân biệt hoa thường). Hãy nhập mã khác; máy khác vẫn dùng được cùng mã.'
export const SLOT_CONFLICT = 'Máy chủ từ chối vì ngăn vừa bị thay đổi ở nơi khác. Hãy tải lại danh sách ngăn rồi thử lại.'
export const SLOT_GONE = 'Không tìm thấy ngăn này trong máy (có thể đường dẫn đã cũ). Danh sách ngăn đã được tải lại.'
export const MACHINE_GONE = MACHINE_NOT_FOUND
export const MALFORMED = 'Dữ liệu gửi lên không đúng định dạng (sức chứa phải là số nguyên). Hãy kiểm tra rồi thử lại.'
const SLOT_FIELDS = ['slotCode', 'capacity'] as const

/** Bean-validation messages for the slot fields (English) in Vietnamese; an unknown message is kept as is. */
export function translateSlotFieldError(field: string, message: string): string {
  if (field === 'capacity') {
    if (/must be greater than 0|positive/i.test(message)) return 'Sức chứa phải lớn hơn 0.'
    if (/must not be null|required/i.test(message)) return 'Vui lòng nhập sức chứa.'
  }
  return translateMachineFieldError(message)
}

/**
 * Errors of POST/PUT slot shown where they belong:
 * - 409 on create: `(machine_id, slot_code)` is the only unique key of machine_slots (V2), so the service check
 *   ("Slot code is already in use for this machine") and the constraint hit by two simultaneous creates ("Request
 *   conflicts with existing data") both mean a taken code: shown once, in Vietnamese, under the slot code field.
 * - 409 on edit (code not sent): a Vietnamese form-level message.
 * - 404: the machine (create) or the slot (edit) is gone.
 * - 400 with field errors: under the fields in Vietnamese; an unknown field is named at form level.
 * - 400 "Unknown request field" / "Request body is missing or malformed": Vietnamese form-level messages.
 */
export function describeSlotError(error: unknown, mode: 'create' | 'edit'): unknown {
  if (!(error instanceof ApiError)) return error
  if (error.status === 409) return mode === 'create' ? new ValidationError({ slotCode: SLOT_CODE_TAKEN }) : new ApiError(409, SLOT_CONFLICT)
  if (error.status === 404) return new ApiError(404, mode === 'create' ? MACHINE_GONE : SLOT_GONE)
  if (error.status !== 400) return error
  const entries = Object.entries(error.fieldErrors)
  if (!entries.length) {
    if (/unknown request field/i.test(error.message)) return new ApiError(400, UNKNOWN_FIELD)
    if (/missing or malformed/i.test(error.message)) return new ApiError(400, MALFORMED)
    return error
  }
  if (entries.some(([field]) => !(SLOT_FIELDS as readonly string[]).includes(field))) {
    const all = entries.map(([field, message]) => `${field}: ${translateSlotFieldError(field, message)}`).join('; ')
    return new ApiError(400, `Máy chủ từ chối dữ liệu gửi lên (${all}). Hãy tải lại trang rồi thử lại.`)
  }
  return new ValidationError(Object.fromEntries(entries.map(([field, message]) => [field, translateSlotFieldError(field, message)])))
}

/** What each slot status means for selling, shown when choosing a new one. */
export const SLOT_STATUS_HELP: Record<SlotStatus, string> = {
  ACTIVE: 'Ngăn nhận hộp và bán được khi máy đang Hoạt động.',
  INACTIVE: 'Ngăn tạm không dùng: không nạp hộp mới, kiosk không bán từ ngăn này. Hộp đang có vẫn ở trong ngăn.',
  ERROR: 'Ngăn hỏng hoặc kẹt: kiosk không bán từ ngăn này cho tới khi chuyển lại Hoạt động.',
}

// ---- switching the machine status

export interface ReadinessItem { key: 'slots' | 'key'; done: boolean | undefined; label: string; detail: string; tab: DetailTab }

/**
 * What the kiosk needs to sell once the machine is ACTIVE. The backend does not require any of it to switch the status
 * (MachineService.updateStatus only sets the value), so this is advice shown before the switch, never a block.
 * `activeSlots`/`activeKey` undefined: not known yet (loading or failed). `canSeeKeys` false: the person cannot list
 * kiosk keys (STAFF), so that item stays unknown and is worded for them.
 */
export function readiness(input: { activeSlots: number | undefined; activeKey: boolean | undefined; canSeeKeys: boolean }): ReadinessItem[] {
  const { activeSlots, canSeeKeys } = input
  const activeKey = canSeeKeys ? input.activeKey : undefined
  return [
    {
      key: 'slots', tab: 'slots', done: activeSlots === undefined ? undefined : activeSlots > 0,
      label: 'Ngăn đang hoạt động',
      detail: activeSlots === undefined ? 'Chưa kiểm tra được số ngăn.' : activeSlots > 0 ? `${activeSlots} ngăn Hoạt động.` : 'Chưa có ngăn Hoạt động: kiosk không có chỗ lấy hộp để bán.',
    },
    {
      key: 'key', tab: 'kiosk', done: activeKey,
      label: 'Khóa kiosk đang dùng',
      detail: !canSeeKeys ? 'Chỉ quản trị viên xem và cấp khóa kiosk.'
        : activeKey === undefined ? 'Chưa kiểm tra được khóa kiosk.'
          : activeKey ? 'Đã cấp khóa cho kiosk của máy.' : 'Chưa có khóa: kiosk không kết nối được hệ thống.',
    },
  ]
}

/** Items still missing (done === false); unknown items are not reported as missing. */
export function missingForSale(items: ReadinessItem[]): ReadinessItem[] {
  return items.filter(item => item.done === false)
}

/** Wording of each status change: the button, the confirmation title and its confirm button, and what it does. */
export const MACHINE_STATUS_ACTIONS: Record<MachineStatus, { label: string; title: string; confirm: string; explain: string }> = {
  ACTIVE: { label: 'Bật bán (Hoạt động)', title: 'Bật bán cho máy', confirm: 'Bật bán', explain: 'Máy chuyển sang Hoạt động: kiosk nhận đơn khi ngăn Hoạt động có hộp còn hạn.' },
  MAINTENANCE: { label: 'Chuyển sang Bảo trì', title: 'Chuyển máy sang Bảo trì', confirm: 'Chuyển sang Bảo trì', explain: 'Kiosk ngừng nhận đơn mới trong lúc bảo trì. Ngăn, hộp và lịch sử được giữ nguyên.' },
  INACTIVE: { label: 'Ngừng hoạt động', title: 'Ngừng hoạt động máy', confirm: 'Ngừng hoạt động', explain: 'Kiosk ngừng nhận đơn mới. Ngăn, hộp và lịch sử được giữ nguyên; bật lại bất cứ lúc nào.' },
}

/** Status buttons of a machine: every other status, ACTIVE first. */
export function statusTargets(current: MachineStatus): MachineStatus[] {
  return (['ACTIVE', 'MAINTENANCE', 'INACTIVE'] as const).filter(status => status !== current)
}

export const STATUS_CONFLICT = 'Máy chủ từ chối vì máy vừa được thay đổi ở nơi khác. Hãy tải lại trang để xem trạng thái mới rồi thử lại.'

/** PATCH status errors in Vietnamese: 409 (backend generic English "Request conflicts with existing data"), 404, 400. */
export function describeStatusError(error: unknown): unknown {
  if (!(error instanceof ApiError)) return error
  if (error.status === 409) return new ApiError(409, STATUS_CONFLICT)
  if (error.status === 404) return new ApiError(404, MACHINE_GONE)
  if (error.status === 400) return new ApiError(400, /unknown request field/i.test(error.message) ? UNKNOWN_FIELD : 'Trạng thái gửi lên không hợp lệ. Hãy tải lại trang rồi thử lại.')
  return error
}

/** PATCH slot status errors in Vietnamese. */
export function describeSlotStatusError(error: unknown): unknown {
  if (!(error instanceof ApiError)) return error
  if (error.status === 409) return new ApiError(409, SLOT_CONFLICT)
  if (error.status === 404) return new ApiError(404, SLOT_GONE)
  if (error.status === 400) return new ApiError(400, /unknown request field/i.test(error.message) ? UNKNOWN_FIELD : 'Trạng thái gửi lên không hợp lệ. Hãy tải lại trang rồi thử lại.')
  return error
}

// ---- kiosk keys

/** The key in use: at most one ACTIVE per machine (partial unique index of V10). */
export function hasActiveKey(credentials: readonly CredentialLike[] | undefined): boolean | undefined {
  return credentials ? credentials.some(credential => credential.status === 'ACTIVE') : undefined
}

/** How a stored key is shown: only its prefix, never the secret (the server keeps only a hash). */
export function maskedKey(keyPrefix: string | undefined): string {
  return keyPrefix ? `fvk_${keyPrefix}_••••••••` : '—'
}

export const PREFIX_RETRY = 'Máy chủ chưa tạo được khóa không trùng lặp. Hãy bấm cấp khóa lại.'
export const KEY_RACE = 'Danh sách khóa của máy vừa thay đổi ở nơi khác và đã được tải lại. Kiểm tra cảnh báo trong hộp thoại rồi cấp lại nếu cần.'
export const KEY_GONE = 'Không tìm thấy khóa này nữa. Danh sách khóa đã được tải lại.'
export const KEY_CHANGED = 'Khóa này vừa bị thay đổi ở nơi khác (có thể đã bị thu hồi hoặc thay bằng khóa mới). Danh sách khóa đã được tải lại; kiểm tra rồi thử lại nếu cần.'
export const KEY_NOT_RETURNED = 'Đã cấp khóa nhưng không nhận được khóa từ máy chủ, nên không hiển thị được. Hãy cấp lại khóa mới; khóa vừa cấp sẽ bị thu hồi.'

/**
 * Question asked before leaving the screen while a key is being issued or is on screen (the plain key exists only in the
 * dialog, so leaving loses it for good); null when there is nothing to lose.
 */
export function keyLeaveQuestion(pending: boolean, shown: boolean): string | null {
  if (shown) return 'Khóa kiosk mới chỉ hiện lần này; rời màn hình thì không ai xem lại được. Bạn đã sao chép và lưu khóa chưa? Vẫn rời đi?'
  if (pending) return 'Đang cấp khóa kiosk. Rời màn hình bây giờ thì khóa mới (nếu cấp xong) sẽ không hiện lại và phải cấp khóa khác. Vẫn rời đi?'
  return null
}

/**
 * Errors of issuing/revoking a key in Vietnamese. Issuing locks the machine row (KioskCredentialService.issue), so two
 * admins issuing at once are run one after the other, not refused: the second simply revokes the first one's key. The
 * only 409 the service raises is "Could not allocate a unique credential prefix" (retry). Any other 409 (the generic
 * "Request conflicts with existing data" of a constraint) means the key list changed under us: the screen reloads it.
 */
export function describeKeyError(error: unknown, action: 'issue' | 'revoke'): unknown {
  if (!(error instanceof ApiError)) return error
  if (error.status === 409) return new ApiError(409, /unique credential prefix/i.test(error.message) ? PREFIX_RETRY : action === 'issue' ? KEY_RACE : KEY_CHANGED)
  // The client keeps only 400/409 messages from the server, so a 404 is told apart by the action alone.
  if (error.status === 404) return new ApiError(404, action === 'revoke' ? KEY_GONE : MACHINE_GONE)
  return error
}

/** The plain key of a 201 from POST kiosk-credentials, or '' when the server sent none (then the screen says so). */
export function issuedKey(result: { apiKey?: string | null } | null | undefined): string {
  return typeof result?.apiKey === 'string' ? result.apiKey.trim() : ''
}

export interface IssuePrompt {
  /** Masked key a click would revoke now ('' when the machine has no key in use). */
  revokes: string
  /** The key in use differs from the one when the dialog opened (another admin, a 409, a key issued but not returned). */
  changed: boolean
  confirmLabel: string
  danger: boolean
  /** False while the key list reloads: the warning must match the key a click would revoke. */
  canConfirm: boolean
}

/**
 * What the "issue a key" confirmation says, from the latest key list rather than the one when it opened, so a click
 * never revokes a key the person was not warned about.
 */
export function issuePrompt(current: { credentialId?: string; keyPrefix?: string } | undefined, openedWith: string | null, listLoading: boolean): IssuePrompt {
  const revokes = current ? maskedKey(current.keyPrefix) : ''
  return {
    revokes,
    changed: !listLoading && (current?.credentialId ?? null) !== openedWith,
    confirmLabel: listLoading ? 'Đang tải lại danh sách khóa…' : current ? 'Cấp khóa mới và thu hồi khóa cũ' : 'Cấp khóa',
    danger: !!current,
    canConfirm: !listLoading,
  }
}
