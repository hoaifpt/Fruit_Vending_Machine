// Single HTTP client for the management API. Contract: api-contract/api.yaml (types in ./schema.d.ts).
import { beginProgress } from '../lib/progress.ts'

export class ApiError extends Error {
  readonly status: number
  readonly fieldErrors: Record<string, string>
  /** Seconds of the `Retry-After` header of a 429 (public report form), when the server sent one. */
  readonly retryAfterSeconds?: number
  constructor(status: number, message: string, fieldErrors: Record<string, string> = {}, retryAfterSeconds?: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.fieldErrors = fieldErrors
    if (retryAfterSeconds !== undefined) this.retryAfterSeconds = retryAfterSeconds
  }
}

/** `Retry-After` as whole seconds (delta-seconds only; an HTTP date or anything else is ignored). */
export function retryAfterOf(value: string | null | undefined): number | undefined {
  const text = value?.trim() ?? ''
  return /^\d{1,6}$/.test(text) ? Number(text) : undefined
}

type QueryScalar = string | number | boolean | null | undefined
/** An array repeats the parameter (`status=OPEN&status=ASSIGNED`), as Spring binds a List. */
type QueryValue = QueryScalar | readonly QueryScalar[]
export interface RequestOptions {
  query?: Record<string, QueryValue>
  body?: unknown
  signal?: AbortSignal
  /** false for public endpoints (login) and kiosk calls: no Authorization header, no 401 session reset. */
  auth?: boolean
  /** Extra request headers (for example X-Kiosk-Key). Never logged. */
  headers?: Record<string, string>
  timeoutMs?: number
}

/** Unwrapped `data` plus envelope metadata: HTTP status and the server `timestamp` (for clock-skew correction). */
export interface ApiResult<T> { data: T; status: number; serverTime?: number }

export interface ClientConfig {
  baseUrl: string
  fetcher: typeof fetch
  getToken: () => string | null
  /** 401 on an authenticated call. `token` is the one that request sent, so a late 401 from an old session can be ignored. */
  onUnauthorized: (token: string | null) => void
}

const API_PREFIX = '/api/v1'
const TIMEOUT_MS = 20_000

function envBaseUrl(): string {
  const env = (import.meta as { env?: Record<string, string | undefined> }).env
  return (env?.VITE_API_BASE_URL ?? '').trim().replace(/\/+$/, '')
}

const config: ClientConfig = {
  baseUrl: envBaseUrl(),
  fetcher: (...args) => fetch(...args),
  getToken: () => null,
  onUnauthorized: () => {},
}

export function configureClient(patch: Partial<ClientConfig>) {
  Object.assign(config, patch)
}

export function buildUrl(path: string, query?: Record<string, QueryValue>, baseUrl = config.baseUrl): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query ?? {})) {
    for (const item of Array.isArray(value) ? value : [value]) {
      if (item === undefined || item === null || item === '') continue
      params.append(key, String(item))
    }
  }
  const search = params.toString()
  return `${baseUrl}${API_PREFIX}${path}${search ? `?${search}` : ''}`
}

const GENERIC_MESSAGES: Record<number, string> = {
  401: 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.',
  403: 'Bạn không có quyền thực hiện thao tác này.',
  404: 'Không tìm thấy dữ liệu yêu cầu.',
}

async function readError(response: Response): Promise<ApiError> {
  let body: { message?: unknown; fieldErrors?: unknown } = {}
  try { body = await response.json() } catch { /* body is not JSON; never surface it */ }
  const fieldErrors: Record<string, string> = {}
  if (body.fieldErrors && typeof body.fieldErrors === 'object') {
    for (const [field, message] of Object.entries(body.fieldErrors)) if (typeof message === 'string') fieldErrors[field] = message
  }
  const { status } = response
  // Only 400/409 messages are business messages from the contract; everything else is generic.
  const backendMessage = (status === 400 || status === 409) && typeof body.message === 'string' && body.message.trim() ? body.message : ''
  const message = backendMessage || GENERIC_MESSAGES[status] || (status >= 500 ? 'Hệ thống đang gặp sự cố. Vui lòng thử lại.' : 'Yêu cầu không hợp lệ.')
  return new ApiError(status, message, fieldErrors, status === 429 ? retryAfterOf(response.headers.get('Retry-After')) : undefined)
}

export async function request<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
  return (await requestWithMeta<T>(method, path, options)).data
}

/** Signals of background work (polling): requests made with them do not move the top progress bar. */
const backgroundSignals = new WeakSet<AbortSignal>()
/** Marks requests made with `signal` as background work the user is not waiting on (no top progress bar). */
export function markBackground(signal: AbortSignal): AbortSignal {
  backgroundSignals.add(signal)
  return signal
}

export async function requestWithMeta<T>(method: string, path: string, options: RequestOptions = {}): Promise<ApiResult<T>> {
  const done = options.signal && backgroundSignals.has(options.signal) ? () => {} : beginProgress()
  try { return await send<T>(method, path, options) } finally { done() }
}

async function send<T>(method: string, path: string, options: RequestOptions): Promise<ApiResult<T>> {
  const { query, body, signal, auth = true, timeoutMs = TIMEOUT_MS } = options
  const headers: Record<string, string> = { Accept: 'application/json', ...options.headers }
  // FormData (multipart, e.g. the public incident report with a photo) goes as is: the browser sets the boundary.
  const multipart = typeof FormData !== 'undefined' && body instanceof FormData
  if (body !== undefined && !multipart) headers['Content-Type'] = 'application/json'
  const token = auth ? config.getToken() : null
  if (token) headers.Authorization = `Bearer ${token}`
  const timeout = AbortSignal.timeout(timeoutMs)
  let response: Response
  try {
    response = await config.fetcher(buildUrl(path, query), {
      method, headers, cache: 'no-store',
      body: body === undefined ? undefined : multipart ? body as FormData : JSON.stringify(body),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    })
  } catch (error) {
    if (signal?.aborted) throw error
    if (timeout.aborted) throw new ApiError(0, 'Kết nối mất quá nhiều thời gian. Vui lòng thử lại.')
    throw new ApiError(0, 'Không thể kết nối đến hệ thống. Kiểm tra kết nối mạng và thử lại.')
  }
  if (!response.ok) {
    const error = await readError(response)
    if (response.status === 401 && auth) config.onUnauthorized(token)
    throw error
  }
  if (response.status === 204) return { data: undefined as T, status: 204 }
  let envelope: { data?: T; timestamp?: unknown }
  try { envelope = await response.json() } catch { throw new ApiError(response.status, 'Phản hồi từ hệ thống không hợp lệ.') }
  const serverTime = typeof envelope.timestamp === 'string' ? Date.parse(envelope.timestamp) : NaN
  noteServerTime(Number.isFinite(serverTime) ? serverTime : undefined)
  return { data: envelope.data as T, status: response.status, serverTime: Number.isFinite(serverTime) ? serverTime : undefined }
}

/**
 * Server clock minus client clock (ms), from the `timestamp` of the last 2xx envelope; 0 until one arrives. Lets screens
 * compare server instants (e.g. `lastSeenAt`) with "now" on the server's clock, so a wrong PC clock does not show a
 * machine OFFLINE or online by mistake. Includes the response's transit time (a few hundred ms at most).
 */
let serverOffsetMs = 0
export function serverClockOffset(): number { return serverOffsetMs }
/** "Now" on the server's clock (ms). */
export function serverNow(): number { return Date.now() + serverOffsetMs }
/** Records the server time of a response received at `receivedAt` (client clock). Ignores unreadable times. */
export function noteServerTime(serverTime: number | undefined, receivedAt = Date.now()) {
  if (typeof serverTime === 'number' && Number.isFinite(serverTime)) serverOffsetMs = serverTime - receivedAt
}

/**
 * A binary response read with the session's Authorization header (a customer report photo, which a plain <img src>
 * could not authenticate). Errors and 401 behave as for JSON calls; the caller makes the object URL and revokes it.
 */
export async function requestBlob(path: string, signal?: AbortSignal): Promise<Blob> {
  const done = beginProgress()
  const token = config.getToken()
  const timeout = AbortSignal.timeout(TIMEOUT_MS)
  try {
    let response: Response
    try {
      response = await config.fetcher(buildUrl(path), {
        method: 'GET', cache: 'no-store', headers: { Accept: 'image/jpeg, image/png', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      })
    } catch (error) {
      if (signal?.aborted) throw error
      throw new ApiError(0, timeout.aborted ? 'Kết nối mất quá nhiều thời gian. Vui lòng thử lại.' : 'Không thể kết nối đến hệ thống. Kiểm tra kết nối mạng và thử lại.')
    }
    if (!response.ok) {
      const error = await readError(response)
      if (response.status === 401) config.onUnauthorized(token)
      throw error
    }
    return await response.blob()
  } finally { done() }
}

export const api = {
  get: <T>(path: string, query?: RequestOptions['query'], signal?: AbortSignal) => request<T>('GET', path, { query, signal }),
  /** `headers`: extra headers of an authenticated call, e.g. the Idempotency-Key of a maintenance command. */
  post: <T>(path: string, body?: unknown, headers?: Record<string, string>) => request<T>('POST', path, { body, headers }),
  put: <T>(path: string, body: unknown) => request<T>('PUT', path, { body }),
  patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, { body }),
  /** Only for the few contract DELETEs (a restock line not loaded yet); records are never deleted otherwise. */
  delete: <T>(path: string) => request<T>('DELETE', path),
}
