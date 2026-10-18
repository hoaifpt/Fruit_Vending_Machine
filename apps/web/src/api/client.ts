// Single HTTP client for the management API. Contract: api-contract/api.yaml (types in ./schema.d.ts).
import { beginProgress } from '../lib/progress.ts'

export class ApiError extends Error {
  readonly status: number
  readonly fieldErrors: Record<string, string>
  constructor(status: number, message: string, fieldErrors: Record<string, string> = {}) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.fieldErrors = fieldErrors
  }
}

type QueryValue = string | number | boolean | null | undefined
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
  onUnauthorized: () => void
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
    if (value === undefined || value === null || value === '') continue
    params.set(key, String(value))
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
  return new ApiError(status, message, fieldErrors)
}

export async function request<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
  return (await requestWithMeta<T>(method, path, options)).data
}

export async function requestWithMeta<T>(method: string, path: string, options: RequestOptions = {}): Promise<ApiResult<T>> {
  const done = beginProgress()
  try { return await send<T>(method, path, options) } finally { done() }
}

async function send<T>(method: string, path: string, options: RequestOptions): Promise<ApiResult<T>> {
  const { query, body, signal, auth = true, timeoutMs = TIMEOUT_MS } = options
  const headers: Record<string, string> = { Accept: 'application/json', ...options.headers }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (auth) {
    const token = config.getToken()
    if (token) headers.Authorization = `Bearer ${token}`
  }
  const timeout = AbortSignal.timeout(timeoutMs)
  let response: Response
  try {
    response = await config.fetcher(buildUrl(path, query), {
      method, headers, cache: 'no-store',
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    })
  } catch (error) {
    if (signal?.aborted) throw error
    if (timeout.aborted) throw new ApiError(0, 'Kết nối mất quá nhiều thời gian. Vui lòng thử lại.')
    throw new ApiError(0, 'Không thể kết nối đến hệ thống. Kiểm tra kết nối mạng và thử lại.')
  }
  if (!response.ok) {
    const error = await readError(response)
    if (response.status === 401 && auth) config.onUnauthorized()
    throw error
  }
  if (response.status === 204) return { data: undefined as T, status: 204 }
  let envelope: { data?: T; timestamp?: unknown }
  try { envelope = await response.json() } catch { throw new ApiError(response.status, 'Phản hồi từ hệ thống không hợp lệ.') }
  const serverTime = typeof envelope.timestamp === 'string' ? Date.parse(envelope.timestamp) : NaN
  return { data: envelope.data as T, status: response.status, serverTime: Number.isFinite(serverTime) ? serverTime : undefined }
}

export const api = {
  get: <T>(path: string, query?: RequestOptions['query'], signal?: AbortSignal) => request<T>('GET', path, { query, signal }),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, { body }),
  put: <T>(path: string, body: unknown) => request<T>('PUT', path, { body }),
  patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, { body }),
}
