// Rules of the tab "Cảm biến & Sự kiện" of the machine detail (C3, FE 6.4) that do not need React: availability of the
// draft endpoints, Wi-Fi signal level from RSSI, units (°C, %, dBm), readings outside the machine's thresholds, the
// reading range and event filter kept in the URL, Vietnamese wording of machine events and FAULT codes. Unit-tested.
// Contract: api-contract/drafts/machine-telemetry.yaml (waiting for BE 3.4/3.5). Names come from the firmware
// (firmware/fruit: DispenseState, MQTT status/telemetry/events payloads) and the backend tables sensor_readings (V4) and
// machine_events (V6). Connectivity (ONLINE/OFFLINE) is not here: see connection.ts.
import { ApiError } from '../api/client.ts'
import type { MachineEvent, MachineEventQuery, MachineHeartbeat, SensorReading, SensorReadingQuery } from '../api/resources.ts'
import { oneOf } from '../lib/table-query.ts'

/** Heartbeat and events reload this often while the tab is open and visible. */
export const TELEMETRY_POLL_MS = 30_000

// ---- availability of the draft endpoints

/**
 * `missing`: the backend has not shipped BE 3.4/3.5 (404 on the path, or 405/501). The machine itself was loaded by the
 * page, so a 404 here means the endpoint, not the machine. Nothing to show and no reason to ask again.
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
export const TELEMETRY_MISSING = 'Chưa có dữ liệu cảm biến và sự kiện: máy chủ chưa cung cấp chức năng này. Trạng thái kết nối ở đầu trang vẫn đúng vì lấy từ lần cuối máy gửi tín hiệu.'

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

// ---- Wi-Fi signal

export type SignalTone = 'success' | 'warning' | 'danger' | 'neutral'
export interface SignalLevel { label: string; tone: SignalTone; /** 0–4 bars, for the icon only. */ bars: number }

/**
 * Wi-Fi strength from RSSI (dBm, the ESP32's WiFi.RSSI()): ≥ −55 very good, ≥ −67 good, ≥ −75 fair, ≥ −85 weak, below that
 * very weak (drops likely). 0 or a positive value is not a real reading (the ESP32 reports 0 when not associated).
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

// ---- dispense controller state (firmware DispenseState)

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
export function readingProblems(reading: Pick<SensorReading, 'temperature' | 'humidity'>, limits: ReadingLimits): string[] {
  const problems: string[] = []
  const { temperature, humidity } = reading
  if (isNumber(temperature) && temperature > limits.maxTemperature) problems.push(`Nhiệt độ cao hơn ngưỡng ${formatTemperature(limits.maxTemperature)}`)
  if (isNumber(temperature) && temperature < limits.minTemperature) problems.push(`Nhiệt độ thấp hơn ngưỡng ${formatTemperature(limits.minTemperature)}`)
  if (isNumber(humidity) && humidity > limits.maxHumidity) problems.push(`Độ ẩm cao hơn ngưỡng ${formatHumidity(limits.maxHumidity)}`)
  if (isNumber(humidity) && humidity < limits.minHumidity) problems.push(`Độ ẩm thấp hơn ngưỡng ${formatHumidity(limits.minHumidity)}`)
  return problems
}

export interface ReadingStats { count: number; minTemperature?: number; maxTemperature?: number; minHumidity?: number; maxHumidity?: number }
/** Lowest and highest values among the readings shown (one page, not the whole range). */
export function readingStats(readings: readonly Pick<SensorReading, 'temperature' | 'humidity'>[]): ReadingStats {
  const temperatures = readings.map(reading => reading.temperature).filter(isNumber)
  const humidities = readings.map(reading => reading.humidity).filter(isNumber)
  return {
    count: readings.length,
    ...(temperatures.length ? { minTemperature: Math.min(...temperatures), maxTemperature: Math.max(...temperatures) } : {}),
    ...(humidities.length ? { minHumidity: Math.min(...humidities), maxHumidity: Math.max(...humidities) } : {}),
  }
}

// ---- URL state of the tab

export const READING_RANGES = ['24h', '7d', '30d'] as const
export type ReadingRange = (typeof READING_RANGES)[number]
export const READING_RANGE_LABELS: Record<ReadingRange, string> = { '24h': '24 giờ qua', '7d': '7 ngày qua', '30d': '30 ngày qua' }
const RANGE_MS: Record<ReadingRange, number> = { '24h': 86_400_000, '7d': 7 * 86_400_000, '30d': 30 * 86_400_000 }

/** Event types the web knows (firmware today, status messages, and the proposed FAULT/FAULT_CLEARED). */
export const EVENT_TYPES = ['FAULT', 'FAULT_CLEARED', 'DISPENSE_ACCEPTED', 'DISPENSE_REJECTED', 'DISPENSE_COMPLETED', 'DISPENSE_ABORTED', 'BOWL_SENSOR_TRIGGERED', 'ONLINE', 'OFFLINE'] as const
export const EVENT_LABELS: Readonly<Record<string, string>> = {
  FAULT: 'Lỗi bộ nhả hàng (FAULT)',
  FAULT_CLEARED: 'Đã gỡ lỗi (RESET)',
  DISPENSE_ACCEPTED: 'Máy nhận lệnh nhả hàng',
  DISPENSE_REJECTED: 'Máy từ chối lệnh nhả hàng',
  DISPENSE_COMPLETED: 'Nhả hàng xong',
  DISPENSE_ABORTED: 'Nhả hàng bị dừng giữa chừng',
  BOWL_SENSOR_TRIGGERED: 'Cảm biến hộp phát hiện hộp',
  ONLINE: 'Máy kết nối lại',
  OFFLINE: 'Máy báo ngắt kết nối',
}
export const SENSOR_FILTER_KEYS = ['range', 'readingPage', 'eventType', 'eventPage'] as const

export interface SensorParams { range: ReadingRange; readingPage: number; eventType: string; eventPage: number }

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
    eventPage: pageOf(params.get('eventPage')),
  }
}

/** GET sensor-readings: newest first, from `now` minus the range (no upper bound, so new readings show). */
export function readingQuery(range: ReadingRange, page: number, size: number, now: number): SensorReadingQuery {
  return { page, size, recordedFrom: new Date(now - RANGE_MS[range]).toISOString(), sort: 'recordedAt,desc' }
}
/** GET events: newest first, optionally one type. */
export function eventQuery(eventType: string, page: number, size: number): MachineEventQuery {
  return { page, size, eventType: eventType || undefined, sort: 'createdAt,desc' }
}
/** Latest FAULT only: what the active fault's code is. */
export const LATEST_FAULT_QUERY: MachineEventQuery = { page: 0, size: 1, eventType: 'FAULT', sort: 'createdAt,desc' }

// ---- FAULT codes and events

/**
 * FAULT codes proposed in the draft contract, from what the firmware can detect today: an interrupted cycle
 * (DispenseController::abort → FAULT), servo start-up failure, the temperature/humidity sensor and the bowl sensor.
 */
export const FAULT_CODES: Readonly<Record<string, { title: string; action: string }>> = {
  CYCLE_INTERRUPTED: {
    title: 'Chu trình nhả hàng bị dừng giữa chừng (bấm STOP hoặc mất điện); chưa rõ vị trí hai cửa.',
    action: 'Kiểm tra tại máy hai cửa đã đóng, gỡ hộp kẹt nếu có, rồi gửi lệnh RESET.',
  },
  SERVO_INIT_FAILED: {
    title: 'Không khởi động được servo điều khiển cửa.',
    action: 'Kiểm tra nguồn và dây cắm servo theo sơ đồ chân, rồi khởi động lại máy.',
  },
  SENSOR_READ_FAILED: {
    title: 'Không đọc được cảm biến nhiệt độ/độ ẩm.',
    action: 'Kiểm tra dây cảm biến; trong lúc chờ, theo dõi nhiệt độ ngăn bằng nhiệt kế.',
  },
  BOWL_SENSOR_STUCK: {
    title: 'Cảm biến hộp báo liên tục, có thể bị che hoặc kẹt hộp.',
    action: 'Kiểm tra khay nhận hộp và lau mắt cảm biến.',
  },
}

const MAX_CODE = 64
/** A FAULT code from the payload (untrusted): a short string, else null. */
export function faultCode(payload: unknown): string | null {
  const code = payload && typeof payload === 'object' ? (payload as Record<string, unknown>).code : undefined
  return typeof code === 'string' && code.trim() ? code.trim().slice(0, MAX_CODE) : null
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

const text = (payload: unknown, key: string): string | null => {
  const value = payload && typeof payload === 'object' ? (payload as Record<string, unknown>)[key] : undefined
  return typeof value === 'string' && value ? value.slice(0, MAX_CODE) : null
}

/** How one machine event is shown: FAULT stands out with its code, a refusal because of FAULT too. */
export function eventView(event: Pick<MachineEvent, 'eventType' | 'payload'>): EventView {
  const type = event.eventType
  const payload: unknown = event.payload
  const details = payloadText(payload)
  const label = Object.hasOwn(EVENT_LABELS, type) ? EVENT_LABELS[type] : type
  if (type === 'FAULT') {
    const code = faultCode(payload)
    return { label, tone: 'fault', code, summary: describeFault(code).title, details }
  }
  const command = text(payload, 'commandId')
  const of = command ? ` (lệnh ${command})` : ''
  if (type === 'DISPENSE_REJECTED') {
    const state = text(payload, 'state')
    if (state === 'FAULT') return { label, tone: 'fault', code: null, summary: `Máy đang ở trạng thái FAULT nên không nhả hàng${of}. Cần kiểm tra và RESET máy.`, details }
    return { label, tone: 'warning', code: null, summary: `Máy đang bận${state ? ` (${state})` : ''}, lệnh sẽ được gửi lại cho tới khi hết giờ${of}.`, details }
  }
  if (type === 'DISPENSE_ABORTED') return { label, tone: 'warning', code: null, summary: `Hộp chưa được nhả${of}; máy chuyển sang FAULT cho tới khi được RESET.`, details }
  if (type === 'OFFLINE') return { label, tone: 'warning', code: null, summary: 'Máy mất kết nối với máy chủ MQTT (tin nhắn Last Will).', details }
  return { label, tone: 'normal', code: null, summary: command ? `Lệnh ${command}.` : '', details }
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
 * The fault the machine is in now: its last heartbeat says the controller is FAULT. The code comes from the newest FAULT
 * event (if any). null when the controller is not in FAULT or its state is unknown.
 */
export function activeFault(heartbeat: Pick<MachineHeartbeat, 'dispenseState'> | undefined, latestFault: Pick<MachineEvent, 'payload' | 'createdAt'> | undefined): ActiveFault | null {
  if (heartbeat?.dispenseState !== 'FAULT') return null
  const code = latestFault ? faultCode(latestFault.payload) : null
  return { code, ...describeFault(code), since: latestFault?.createdAt }
}
