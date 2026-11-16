// Rules of the tab "Cảm biến & Sự kiện" of the machine detail (C3, FE 6.4) that do not need React: availability of the
// endpoints, Wi-Fi signal level from RSSI, units (°C, %, dBm, heap), readings against the machine's thresholds, the
// reading range and event filters kept in the URL, Vietnamese wording of machine events and FAULT codes. Unit-tested.
// API (api-contract/api.yaml, MACHINE_READ): GET /machines/{id}/telemetry/latest, GET /machines/{id}/telemetry?from&to
// (both required) and GET /machines/{id}/events?type&source&from&to (backend #53, #56; docs/machine-health.md,
// docs/machine-event-logging.md, api-contract/mqtt-contract.md §4 and §6). There is no heartbeat endpoint: the last
// heartbeat (firmware, uptime, RSSI, free heap) and connectivity are fields of MachineResponse (connection.ts).
import { ApiError } from '../api/client.ts'
import type { MachineEvent, MachineEventQuery, TelemetryLatest, TelemetryQuery, TelemetryReading } from '../api/resources.ts'
import { oneOf } from '../lib/table-query.ts'

/** Latest reading and the first page of events reload this often while the tab is open and visible. */
export const TELEMETRY_POLL_MS = 30_000

// ---- availability

/**
 * `missing`: the backend has no such path (404 on the path, or 405/501). The machine itself was loaded by the page, so a
 * 404 here means the endpoint, not the machine. Nothing to show and no reason to ask again.
 */
export type TelemetryAvailability = 'missing' | 'forbidden' | 'unauthorized' | 'error'
export function telemetryAvailability(error: unknown): TelemetryAvailability {
  const status = error instanceof ApiError ? error.status : undefined
  if (status === 404 || status === 405 || status === 501) return 'missing'
  if (status === 403) return 'forbidden'
  if (status === 401) return 'unauthorized'
  return 'error'
}
export const isTelemetryMissing = (error: unknown) => telemetryAvailability(error) === 'missing'
export const TELEMETRY_MISSING = 'Chưa có dữ liệu cảm biến và sự kiện: máy chủ chưa cung cấp chức năng này. Trạng thái kết nối ở đầu trang vẫn đúng vì lấy từ thông tin máy.'

// ---- units

const decimal = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 })
const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

/** `4,5 °C`; '—' when the reading has no temperature. */
export function formatTemperature(value: number | null | undefined): string {
  return isNumber(value) ? `${decimal.format(value)} °C` : '—'
}
/** `62 %`; '—' when the reading has no humidity. */
export function formatHumidity(value: number | null | undefined): string {
  return isNumber(value) ? `${decimal.format(value)} %` : '—'
}
/** Free heap of the controller: `17,8 KB`; the reason when the machine did not report it. */
export function formatHeap(bytes: number | null | undefined): string {
  if (!isNumber(bytes) || bytes < 0) return 'Chưa có số đo (máy chưa gửi)'
  return bytes < 1024 ? `${Math.round(bytes)} byte` : `${new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1 }).format(bytes / 1024)} KB`
}

// ---- Wi-Fi signal

export type SignalTone = 'success' | 'warning' | 'danger' | 'neutral'
export interface SignalLevel { label: string; tone: SignalTone; /** 0–4 bars, for the icon only. */ bars: number }

/**
 * Wi-Fi strength from RSSI (dBm, -127 to 0, MachineResponse.wifiRssi): ≥ −55 very good, ≥ −67 good, ≥ −75 fair, ≥ −85
 * weak, below that very weak (drops likely). 0 or a positive value is not a real reading (the backend never stores 0).
 */
export function signalLevel(rssi: number | null | undefined): SignalLevel {
  if (!isNumber(rssi) || rssi >= 0) return { label: 'Chưa có số đo', tone: 'neutral', bars: 0 }
  if (rssi >= -55) return { label: 'Rất tốt', tone: 'success', bars: 4 }
  if (rssi >= -67) return { label: 'Tốt', tone: 'success', bars: 3 }
  if (rssi >= -75) return { label: 'Trung bình', tone: 'warning', bars: 2 }
  if (rssi >= -85) return { label: 'Yếu', tone: 'danger', bars: 1 }
  return { label: 'Rất yếu, dễ mất kết nối', tone: 'danger', bars: 1 }
}

/** `-58 dBm (Tốt)`, or the reason there is no value. */
export function formatRssi(rssi: number | null | undefined): string {
  const level = signalLevel(rssi)
  return level.bars ? `${Math.round(rssi!)} dBm (${level.label})` : 'Chưa có số đo (máy chưa gửi RSSI)'
}

/** Time since the controller started: "3 ngày 4 giờ", "2 giờ 5 phút", "4 phút", "45 giây". */
export function formatUptime(seconds: number | null | undefined): string {
  if (!isNumber(seconds) || seconds < 0) return '—'
  const s = Math.floor(seconds)
  const days = Math.floor(s / 86_400), hours = Math.floor((s % 86_400) / 3600), minutes = Math.floor((s % 3600) / 60)
  if (days) return hours ? `${days} ngày ${hours} giờ` : `${days} ngày`
  if (hours) return minutes ? `${hours} giờ ${minutes} phút` : `${hours} giờ`
  if (minutes) return `${minutes} phút`
  return `${s} giây`
}

// ---- dispense controller state (firmware DispenseState, sent in DISPENSE_REJECTED and BOWL_SENSOR_TRIGGERED)

const MOVING_STATES = ['LOCK_UPPER', 'OPENING_LOWER', 'HOLD_LOWER', 'CLOSING_LOWER', 'PAUSE_BETWEEN_GATES', 'OPENING_UPPER', 'HOLD_UPPER', 'CLOSING_UPPER']

/** The controller state in Vietnamese (the raw name follows in the UI); an unknown name is shown as is. */
export function dispenseStateLabel(state: string | null | undefined): string {
  if (!state) return 'Chưa rõ (máy chưa gửi)'
  if (state === 'IDLE') return 'Sẵn sàng'
  if (state === 'FAULT') return 'Đang lỗi (FAULT): không nhả hàng cho tới khi được RESET'
  if (state === 'MANUAL_MOVE') return 'Đang chỉnh cửa bằng tay'
  if (MOVING_STATES.includes(state)) return 'Đang nhả hàng'
  return state
}

// ---- readings

export interface ReadingLimits { minTemperature: number; maxTemperature: number; minHumidity: number; maxHumidity: number }

/** What is out of the machine's configured range in one reading, in words (empty when all is within range). */
export function readingProblems(reading: Pick<TelemetryReading, 'temperature' | 'humidity'>, limits: ReadingLimits): string[] {
  const problems: string[] = []
  const { temperature, humidity } = reading
  if (isNumber(temperature) && temperature > limits.maxTemperature) problems.push(`Nhiệt độ cao hơn ngưỡng ${formatTemperature(limits.maxTemperature)}`)
  if (isNumber(temperature) && temperature < limits.minTemperature) problems.push(`Nhiệt độ thấp hơn ngưỡng ${formatTemperature(limits.minTemperature)}`)
  if (isNumber(humidity) && humidity > limits.maxHumidity) problems.push(`Độ ẩm cao hơn ngưỡng ${formatHumidity(limits.maxHumidity)}`)
  if (isNumber(humidity) && humidity < limits.minHumidity) problems.push(`Độ ẩm thấp hơn ngưỡng ${formatHumidity(limits.minHumidity)}`)
  return problems
}

type Level = TelemetryLatest['temperatureStatus']
/** What the backend says about the latest reading (temperatureStatus / humidityStatus), in words; empty when NORMAL. */
export function latestProblems(latest: Pick<TelemetryLatest, 'temperatureStatus' | 'humidityStatus'>, limits: ReadingLimits): string[] {
  const problems: string[] = []
  const word = (status: Level, what: string, low: string, high: string) => {
    if (status === 'HIGH') problems.push(`${what} cao hơn ngưỡng ${high}`)
    if (status === 'LOW') problems.push(`${what} thấp hơn ngưỡng ${low}`)
  }
  word(latest.temperatureStatus, 'Nhiệt độ', formatTemperature(limits.minTemperature), formatTemperature(limits.maxTemperature))
  word(latest.humidityStatus, 'Độ ẩm', formatHumidity(limits.minHumidity), formatHumidity(limits.maxHumidity))
  return problems
}

export interface ReadingStats { count: number; minTemperature?: number; maxTemperature?: number; minHumidity?: number; maxHumidity?: number }
/** Lowest and highest values among the readings shown (one page, not the whole range). */
export function readingStats(readings: readonly Pick<TelemetryReading, 'temperature' | 'humidity'>[]): ReadingStats {
  const temperatures = readings.map(reading => reading.temperature).filter(isNumber)
  const humidities = readings.map(reading => reading.humidity).filter(isNumber)
  return {
    count: readings.length,
    ...(temperatures.length ? { minTemperature: Math.min(...temperatures), maxTemperature: Math.max(...temperatures) } : {}),
    ...(humidities.length ? { minHumidity: Math.min(...humidities), maxHumidity: Math.max(...humidities) } : {}),
  }
}

// ---- URL state of the tab

/** Ranges of the history; the API allows at most 31 days between from and to. */
export const READING_RANGES = ['24h', '7d', '30d'] as const
export type ReadingRange = (typeof READING_RANGES)[number]
export const READING_RANGE_LABELS: Record<ReadingRange, string> = { '24h': '24 giờ qua', '7d': '7 ngày qua', '30d': '30 ngày qua' }
const RANGE_MS: Record<ReadingRange, number> = { '24h': 86_400_000, '7d': 7 * 86_400_000, '30d': 30 * 86_400_000 }
/** `to` is exclusive: a minute past now, so a reading received this very moment (or on a server clock a bit ahead) shows. */
const TO_MARGIN_MS = 60_000

/**
 * Event types the web knows: what the machine reports (api-contract/mqtt-contract.md §4: dispense lifecycle, IR sensor,
 * FAULT, FAULT_CLEARED, BOOT), its status messages (STATUS_ONLINE / STATUS_OFFLINE) and the backend's decisions about it
 * (BACKEND_*, docs/machine-event-logging.md). The vocabulary is open: unknown types are shown as they are.
 */
export const EVENT_TYPES = [
  'FAULT', 'FAULT_CLEARED', 'BOOT', 'DISPENSE_ACCEPTED', 'DISPENSE_REJECTED', 'DISPENSE_COMPLETED', 'DISPENSE_ABORTED', 'BOWL_SENSOR_TRIGGERED',
  'STATUS_ONLINE', 'STATUS_OFFLINE',
  'BACKEND_DISPENSE_FAILED', 'BACKEND_DISPENSE_LATE_SUCCESS', 'BACKEND_DISPENSE_MULTIPLE_BOWLS', 'BACKEND_MAINTENANCE_ENTERED', 'BACKEND_REBOOT_DETECTED',
] as const
export const EVENT_LABELS: Readonly<Record<string, string>> = {
  FAULT: 'Lỗi phần cứng (FAULT)',
  FAULT_CLEARED: 'Đã gỡ lỗi (RESET)',
  BOOT: 'Bộ điều khiển khởi động',
  DISPENSE_ACCEPTED: 'Máy nhận lệnh nhả hàng',
  DISPENSE_REJECTED: 'Máy từ chối lệnh nhả hàng',
  DISPENSE_COMPLETED: 'Nhả hàng xong',
  DISPENSE_ABORTED: 'Nhả hàng bị dừng giữa chừng',
  BOWL_SENSOR_TRIGGERED: 'Cảm biến hộp phát hiện hộp',
  STATUS_ONLINE: 'Máy kết nối',
  STATUS_OFFLINE: 'Máy báo ngắt kết nối',
  BACKEND_DISPENSE_FAILED: 'Hệ thống ghi nhả hàng thất bại',
  BACKEND_DISPENSE_LATE_SUCCESS: 'Hệ thống ghi nhả hàng thành công muộn',
  BACKEND_DISPENSE_MULTIPLE_BOWLS: 'Hệ thống ghi máy nhả nhiều hộp',
  BACKEND_MAINTENANCE_ENTERED: 'Hệ thống chuyển máy sang bảo trì',
  BACKEND_REBOOT_DETECTED: 'Hệ thống phát hiện máy khởi động lại',
}
export const EVENT_SOURCES = ['MACHINE', 'BACKEND'] as const
export type EventSource = (typeof EVENT_SOURCES)[number]
export const EVENT_SOURCE_LABELS: Record<EventSource, string> = { MACHINE: 'Máy gửi', BACKEND: 'Hệ thống ghi' }
export const SENSOR_FILTER_KEYS = ['range', 'readingPage', 'eventType', 'eventSource', 'eventPage'] as const

export interface SensorParams { range: ReadingRange; readingPage: number; eventType: string; eventSource: EventSource | ''; eventPage: number }

const pageOf = (raw: string | null) => {
  const value = Number(raw ?? 0)
  return Number.isInteger(value) && value > 0 ? value : 0
}

/** Tab state from the URL; unknown values fall back to the defaults so they never reach the API as a 400. */
export function readSensorParams(params: URLSearchParams): SensorParams {
  return {
    range: (oneOf(params.get('range'), READING_RANGES) || '24h') as ReadingRange,
    readingPage: pageOf(params.get('readingPage')),
    eventType: oneOf(params.get('eventType'), EVENT_TYPES),
    eventSource: oneOf(params.get('eventSource'), EVENT_SOURCES) as EventSource | '',
    eventPage: pageOf(params.get('eventPage')),
  }
}

/** GET telemetry: newest first (fixed order), from `now` minus the range to just after now (both required by the API). */
export function readingQuery(range: ReadingRange, page: number, size: number, now: number): TelemetryQuery {
  return { page, size, from: new Date(now - RANGE_MS[range]).toISOString(), to: new Date(now + TO_MARGIN_MS).toISOString() }
}
/** GET events: newest first (fixed order), optionally one exact type and one source. */
export function eventQuery(eventType: string, page: number, size: number, source: EventSource | '' = ''): MachineEventQuery {
  return { page, size, type: eventType || undefined, source: source || undefined }
}
/** Newest FAULT and newest FAULT_CLEARED: a FAULT newer than the last clear is the fault the machine is in now. */
export const LATEST_FAULT_QUERY: MachineEventQuery = { page: 0, size: 1, type: 'FAULT', source: 'MACHINE' }
export const LATEST_CLEARED_QUERY: MachineEventQuery = { page: 0, size: 1, type: 'FAULT_CLEARED', source: 'MACHINE' }

// ---- payloads (untrusted device data)

const MAX_CODE = 64
/**
 * A short text field of an event payload. MACHINE payloads are the envelope payload `{ eventType, details: {...} }`
 * (mqtt-contract §4), BACKEND payloads are flat: the field is read from `details` first, then from the top level.
 */
export function payloadField(payload: unknown, key: string): string | null {
  const record = payload && typeof payload === 'object' ? payload as Record<string, unknown> : undefined
  const details = record?.details && typeof record.details === 'object' ? record.details as Record<string, unknown> : undefined
  const value = details?.[key] ?? record?.[key]
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, MAX_CODE) : null
}
const numberField = (payload: unknown, key: string): number | null => {
  const record = payload && typeof payload === 'object' ? payload as Record<string, unknown> : undefined
  const details = record?.details && typeof record.details === 'object' ? record.details as Record<string, unknown> : undefined
  const value = details?.[key] ?? record?.[key]
  return isNumber(value) ? value : null
}

// ---- FAULT codes and events

/** FAULT codes of api-contract/mqtt-contract.md §6.2 (also the errorCode of HARDWARE_FAULT alerts), with the next step. */
export const FAULT_CODES: Readonly<Record<string, { title: string; action: string }>> = {
  SERVO_INIT_FAILED: {
    title: 'Không khởi động được servo điều khiển cửa.',
    action: 'Kiểm tra nguồn và dây cắm servo theo sơ đồ chân, rồi khởi động lại máy.',
  },
  GATE_POSITION_UNKNOWN: {
    title: 'Chu trình nhả hàng bị dừng giữa chừng; có thể một cửa chưa đóng.',
    action: 'Kiểm tra tại máy hai cửa đã đóng, gỡ hộp kẹt nếu có, rồi gửi lệnh RESET.',
  },
  CONTROLLER_FAULT: {
    title: 'Bộ điều khiển nhả hàng chuyển sang trạng thái lỗi (FAULT).',
    action: 'Kiểm tra cửa và hộp kẹt tại máy, rồi gửi lệnh RESET khi đã an toàn.',
  },
  IR_SENSOR_STUCK: {
    title: 'Cảm biến hộp báo liên tục, có thể bị che hoặc kẹt hộp.',
    action: 'Kiểm tra khay nhận hộp và lau mắt cảm biến; tạm ngừng bán tới khi kiểm tra xong.',
  },
  IR_SENSOR_DISCONNECTED: {
    title: 'Không nhận được tín hiệu cảm biến hộp qua nhiều lần nhả hàng.',
    action: 'Kiểm tra dây cảm biến hộp; tạm ngừng bán tới khi kiểm tra xong.',
  },
  UNEXPECTED_BOWL_DETECTED: {
    title: 'Cảm biến hộp phát hiện hộp khi máy không nhả hàng.',
    action: 'Kiểm tra khay nhận hộp và đối soát số hộp trong ngăn.',
  },
  TEMP_SENSOR_ERROR: {
    title: 'Không đọc được cảm biến nhiệt độ/độ ẩm.',
    action: 'Kiểm tra dây cảm biến; trong lúc chờ, theo dõi nhiệt độ ngăn bằng nhiệt kế.',
  },
}

/** A FAULT code from the payload (untrusted): a short string, else null. */
export function faultCode(payload: unknown): string | null {
  return payloadField(payload, 'code')
}

/** Vietnamese meaning of a FAULT code and what to do; unknown codes are named as they are. */
export function describeFault(code: string | null): { title: string; action: string } {
  if (code && Object.hasOwn(FAULT_CODES, code)) return FAULT_CODES[code]
  return {
    title: code ? `Mã lỗi ${code} chưa có mô tả trên hệ thống.` : 'Máy báo lỗi nhưng không gửi mã lỗi.',
    action: 'Kiểm tra máy tại chỗ (cửa, hộp kẹt, dây nối) rồi gửi lệnh RESET khi đã an toàn.',
  }
}

export type EventTone = 'fault' | 'warning' | 'normal'
export interface EventView {
  label: string
  tone: EventTone
  /** FAULT code, for FAULT events (null when the machine sent none). */
  code: string | null
  /** One line about this event in Vietnamese ('' when there is nothing to add). */
  summary: string
  /** The stored payload as JSON text (shown escaped, never as HTML). */
  details: string
}

/** How one machine event is shown: FAULT stands out with its code, a refusal because of FAULT too. */
export function eventView(event: Pick<MachineEvent, 'eventType' | 'payload'>): EventView {
  const type = event.eventType
  const payload: unknown = event.payload
  const details = payloadText(payload)
  const label = Object.hasOwn(EVENT_LABELS, type) ? EVENT_LABELS[type] : type
  const view = (tone: EventTone, summary: string, code: string | null = null): EventView => ({ label, tone, code, summary, details })
  const command = payloadField(payload, 'commandCode') ?? payloadField(payload, 'commandId')
  const of = command ? ` (lệnh ${command})` : ''
  const reason = payloadField(payload, 'reason')
  switch (type) {
    case 'FAULT': {
      const code = faultCode(payload)
      return view('fault', describeFault(code).title, code)
    }
    case 'DISPENSE_REJECTED': {
      const state = payloadField(payload, 'state')
      if (state === 'FAULT' || reason === 'CONTROLLER_FAULT') return view('fault', `Máy đang ở trạng thái FAULT nên không nhả hàng${of}. Cần kiểm tra và RESET máy.`)
      return view('warning', `Máy đang bận${state ? ` (${state})` : ''}${reason ? `, lý do ${reason}` : ''}; lệnh được gửi lại cho tới khi hết giờ${of}.`)
    }
    case 'DISPENSE_ABORTED': return view('warning', `Hộp chưa được nhả${reason ? ` (lý do ${reason})` : ''}${of}; hộp bị đánh dấu nhả lỗi và máy chuyển sang bảo trì.`)
    case 'STATUS_OFFLINE': return view('warning', 'Máy mất kết nối với máy chủ MQTT (tin nhắn Last Will).')
    case 'BOOT': {
      const resetReason = payloadField(payload, 'resetReason')
      const firmware = payloadField(payload, 'firmwareVersion')
      const bad = resetReason === 'WATCHDOG' || resetReason === 'PANIC' || resetReason === 'BROWNOUT'
      return view(bad ? 'warning' : 'normal', `${resetReason ? `Lý do khởi động: ${resetReason}.` : ''}${firmware ? ` Firmware ${firmware}.` : ''}`.trim())
    }
    case 'BACKEND_DISPENSE_FAILED': {
      const slot = payloadField(payload, 'slotCode')
      return view('fault', `Nhả hàng thất bại${slot ? ` ở ngăn ${slot}` : ''}${reason ? `, lý do ${reason}` : ''}${of}.`)
    }
    case 'BACKEND_DISPENSE_LATE_SUCCESS': return view('normal', `Máy báo nhả xong sau khi lệnh đã bị coi là thất bại${of}; đơn được ghi nhận thành công.`)
    case 'BACKEND_DISPENSE_MULTIPLE_BOWLS': {
      const count = numberField(payload, 'bowlCount')
      return view('fault', `Máy nhả${count ? ` ${count}` : ' nhiều hơn một'} hộp cho một lệnh${of}; cần đối soát tồn kho.`)
    }
    case 'BACKEND_MAINTENANCE_ENTERED': return view('warning', `Máy được chuyển sang bảo trì${reason ? ` (lý do ${reason})` : ''}; không bán cho tới khi được bật lại.`)
    case 'BACKEND_REBOOT_DETECTED': return view('warning', 'Thời gian chạy của máy giảm so với lần trước: máy vừa khởi động lại.')
    default: return view('normal', command ? `Lệnh ${command}.` : '')
  }
}

/** Payload as readable JSON text; never interpreted. */
export function payloadText(payload: unknown): string {
  if (payload === null || payload === undefined) return ''
  if (typeof payload === 'string') return payload
  try {
    const value = JSON.stringify(payload, null, 2)
    return value === '{}' ? '' : value
  } catch { return '' }
}

export interface ActiveFault { code: string | null; title: string; action: string; since?: string }

/**
 * The fault the machine is in now: its newest FAULT event is newer than its newest FAULT_CLEARED (the firmware sends
 * FAULT_CLEARED after a RESET). null when there is no FAULT, or it was cleared since.
 */
export function activeFault(latestFault: Pick<MachineEvent, 'payload' | 'createdAt'> | undefined, latestCleared?: Pick<MachineEvent, 'createdAt'>): ActiveFault | null {
  if (!latestFault) return null
  if (latestCleared && Date.parse(latestCleared.createdAt) >= Date.parse(latestFault.createdAt)) return null
  const code = faultCode(latestFault.payload)
  return { code, ...describeFault(code), since: latestFault.createdAt }
}
