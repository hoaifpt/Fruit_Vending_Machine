// The `fetch` replacement given to configureClient: picks the mocked groups, applies ?scenario=, routes to a handler.
import { errorResponse, MockHttpError, successResponse } from './http.ts'
import type { Reply } from './http.ts'
import { advanceOrders, permissionsOfUser, routes } from './handlers.ts'
import type { HandlerContext, Policy } from './handlers.ts'
import { expireSince, readScenario, scenarioApplies } from './scenario.ts'
import type { Scenario, ScenarioStorage } from './scenario.ts'
import { createStore } from './seed.ts'
import type { MockUser } from './seed.ts'

export const MOCK_GROUPS = ['auth', 'users', 'products', 'machines', 'slots', 'kiosk-credentials', 'batches', 'inventory', 'orders', 'payments', 'webhook-logs', 'kiosk', 'roles'] as const
export type MockGroup = (typeof MOCK_GROUPS)[number]

export interface MockSelection { all: boolean; groups: MockGroup[]; unknown: string[] }

/** `all`, or a comma-separated list of groups. Empty means off (see isMockEnabled). */
export function parseSelection(raw: string | null | undefined): MockSelection {
  const names = (raw ?? '').split(',').map(name => name.trim().toLowerCase()).filter(Boolean)
  const groups = MOCK_GROUPS.filter(group => names.includes(group))
  return { all: names.includes('all'), groups, unknown: names.filter(name => name !== 'all' && !MOCK_GROUPS.includes(name as MockGroup)) }
}
export const isMockEnabled = (selection: MockSelection) => selection.all || selection.groups.length > 0

const TOP_LEVEL_GROUPS: Record<string, MockGroup> = {
  auth: 'auth', users: 'users', products: 'products', machines: 'machines', 'product-batches': 'batches',
  inventory: 'inventory', orders: 'orders', payments: 'payments', 'payment-webhook-logs': 'webhook-logs', kiosk: 'kiosk',
  roles: 'roles', permissions: 'roles',
}

export function groupOf(path: string): MockGroup | null {
  if (/^\/machines\/[^/]+\/kiosk-credentials(\/|$)/.test(path)) return 'kiosk-credentials'
  if (/^\/machines\/[^/]+\/slots(\/|$)/.test(path)) return 'slots'
  return TOP_LEVEL_GROUPS[path.split('/')[1] ?? ''] ?? null
}

export interface MockOptions {
  /** Used for endpoints outside the selected groups. */
  realFetch: typeof fetch
  /** Query string of the page (not of the API call), for ?scenario=. */
  getSearch: () => string
  storage: ScenarioStorage | null
  latencyMs: number
  slowMs: number
  now: () => number
  /** Delay before a kiosk QR counts as paid; the `pending` scenario turns this off. */
  autoPayMs: number
  dispenseMs: number
}

const API_PREFIX = '/api/v1'
const SCENARIO_ERRORS: Partial<Record<Scenario['name'], { status: number; message: string }>> = {
  error500: { status: 500, message: 'An unexpected error occurred' },
  401: { status: 401, message: 'Authentication required or access token invalid' },
  403: { status: 403, message: 'Access denied' },
  400: { status: 400, message: 'Dữ liệu gửi lên chưa hợp lệ.' },
  409: { status: 409, message: 'Thao tác xung đột với trạng thái hiện tại của dữ liệu.' },
}

/**
 * Message of the `409` scenario on paths whose contract example names a specific conflict, so a screen can be tested
 * with the backend's own wording (POST /inventory/load: a slot filled by someone else meanwhile).
 */
const CONTRACT_CONFLICTS: Record<string, string> = { '/inventory/load': 'Slot capacity exceeded' }

function requestUrl(input: RequestInfo | URL): URL {
  const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  return new URL(raw, 'http://mock.invalid') // base URL is irrelevant: only the path and query matter
}

function wait(ms: number, signal?: AbortSignal | null): Promise<void> {
  signal?.throwIfAborted()
  if (ms <= 0) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const onAbort = () => { clearTimeout(timer); reject(signal!.reason) }
    const timer = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve() }, ms)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

function parseBody(init?: RequestInit): unknown {
  if (typeof init?.body !== 'string') return undefined
  try { return JSON.parse(init.body) } catch { throw new MockHttpError(400, 'Nội dung yêu cầu không phải JSON hợp lệ.') }
}

/** Per-field errors for a simulated 400, keyed on the first submitted field so forms can show them. */
function simulatedFieldErrors(body: unknown): Record<string, string> | undefined {
  const field = body && typeof body === 'object' ? Object.keys(body)[0] : undefined
  return field ? { [field]: 'Giá trị không hợp lệ (mô phỏng).' } : undefined
}

interface TokenClaims { sub?: unknown; email?: unknown; roles?: unknown; exp?: unknown; iat?: unknown; iatMs?: unknown }

function decodeClaims(token: string): TokenClaims | null {
  try {
    const payload = (token.split('.')[1] ?? '').replace(/-/g, '+').replace(/_/g, '/')
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(payload), char => char.charCodeAt(0))))
  } catch { return null }
}

/** Empties list payloads only; single records (detail pages, kiosk identity) are unaffected. */
function emptied(data: unknown): unknown {
  if (Array.isArray(data)) return []
  if (data && typeof data === 'object') {
    if ('content' in data) return { ...data, content: [], totalElements: 0, totalPages: 0 }
    if ('products' in data) return { ...data, products: [] }
  }
  return data
}

export function createMockFetcher(selection: MockSelection, overrides: Partial<MockOptions> = {}): typeof fetch {
  const options: MockOptions = {
    realFetch: (...args) => fetch(...args), getSearch: () => '', storage: null, latencyMs: 0, slowMs: 3000, now: () => Date.now(), autoPayMs: 15_000, dispenseMs: 4_000, ...overrides,
  }
  const store = createStore(options.now())
  const enabledGroups = new Set<string>(selection.groups)
  const expiry = { since: null as number | null }
  /** Set per request by the `expire` scenario: tokens issued before this instant are treated as expired. */
  let expiredBefore: number | null = null

  // Sign-in goes to the real backend when `auth` is not mocked (for example VITE_API_MOCK=roles): its tokens name
  // accounts the mock store does not have.
  const realSignIn = !selection.all && !enabledGroups.has('auth')

  /**
   * With a real sign-in, a token whose `sub` is not in the mock store is served as a stand-in account built from its
   * own claims (id, email, `roles` such as ROLE_ADMIN), so mocking one group does not sign the user out. The stand-in is
   * not added to the store; the role table of the mock still decides its permissions. Expiry is checked as usual.
   */
  function standIn(claims: TokenClaims | null): MockUser | undefined {
    if (!realSignIn || typeof claims?.sub !== 'string' || !claims.sub || !Array.isArray(claims.roles)) return undefined
    const roles = claims.roles.filter((role): role is string => typeof role === 'string').map(role => role.replace(/^ROLE_/, ''))
    const email = typeof claims.email === 'string' ? claims.email : ''
    const at = new Date(options.now()).toISOString()
    return { id: claims.sub, email, fullName: email || 'Tài khoản đăng nhập thật', phone: null, status: 'ACTIVE', roles, password: '', createdAt: at, updatedAt: at }
  }

  function authenticate(policy: Exclude<Policy, 'public' | 'kiosk'>, authorization: string | null): MockUser {
    const token = authorization?.replace(/^Bearer\s+/i, '')
    const claims = token ? decodeClaims(token) : null
    const user = store.users.find(candidate => candidate.id === claims?.sub) ?? standIn(claims)
    const issuedAt = typeof claims?.iatMs === 'number' ? claims.iatMs : typeof claims?.iat === 'number' ? claims.iat * 1000 : 0
    if (!user || user.status !== 'ACTIVE' || typeof claims?.exp !== 'number' || claims.exp * 1000 <= options.now() || (expiredBefore !== null && issuedAt < expiredBefore)) {
      throw new MockHttpError(401, 'Authentication required or access token invalid')
    }
    if (policy === 'admin' && !user.roles.includes('ADMIN')) throw new MockHttpError(403, 'Access denied')
    // Backend #48: permissions are read from the role table on every request, so a change applies to the next call.
    if (typeof policy === 'object' && !permissionsOfUser(store, user).includes(policy.permission)) throw new MockHttpError(403, 'Access denied')
    return user
  }

  function kioskMachineId(key: string | null): string {
    const credential = key ? store.credentials.find(candidate => candidate.apiKey === key) : undefined
    if (!key || credential?.status === 'REVOKED') throw new MockHttpError(401, 'Authentication required or access token invalid')
    // Any other key is accepted as the first machine, so the mock works with whatever VITE_KIOSK_API_KEY is configured.
    return credential?.machineId ?? store.machines[0].id
  }

  function dispatch(method: string, path: string, query: URLSearchParams, headers: Headers, body: unknown, autoPay: boolean): Reply {
    for (const route of routes) {
      if (route.method !== method) continue
      const match = route.pattern.exec(path)
      if (!match) continue
      const ctx: HandlerContext = { store, now: options.now(), params: match.groups ?? {}, query, body, user: undefined, machineId: '', options: { autoPayMs: options.autoPayMs, dispenseMs: options.dispenseMs, autoPay } }
      if (route.policy === 'kiosk') ctx.machineId = kioskMachineId(headers.get('x-kiosk-key'))
      else if (route.policy !== 'public') ctx.user = authenticate(route.policy, headers.get('authorization'))
      advanceOrders(ctx)
      return route.handle(ctx)
    }
    throw new MockHttpError(501, `Mock chưa có handler cho ${method} ${API_PREFIX}${path}`)
  }

  return async (input, init) => {
    const url = requestUrl(input)
    const path = url.pathname.startsWith(`${API_PREFIX}/`) ? url.pathname.slice(API_PREFIX.length) : url.pathname
    const fullPath = url.pathname
    const group = groupOf(path)
    if (!selection.all && !(group && enabledGroups.has(group))) return options.realFetch(input, init)

    const method = (init?.method ?? 'GET').toUpperCase()
    const signal = init?.signal
    await wait(options.latencyMs, signal)
    const current = readScenario(options.getSearch(), options.storage)
    const scenario = current && scenarioApplies(current, method, path, group) ? current : null
    const since = expireSince(current, options.storage, options.now(), expiry)
    expiredBefore = scenario ? since : null
    if (scenario?.name === 'slow') await wait(options.slowMs, signal)
    if (scenario?.name === 'network') throw new TypeError('Failed to fetch')

    const now = options.now()
    try {
      const body = parseBody(init)
      const simulated = scenario ? SCENARIO_ERRORS[scenario.name] : undefined
      if (simulated) {
        // Like GlobalExceptionHandler: only validation (400) carries fieldErrors; handleConflict (409) sends the message alone.
        const fields = simulated.status === 400 ? simulatedFieldErrors(body) : undefined
        const message = simulated.status === 409 ? CONTRACT_CONFLICTS[path] ?? simulated.message : simulated.message
        return errorResponse(simulated.status, message, fullPath, now, fields)
      }
      const reply = dispatch(method, path, url.searchParams, new Headers(init?.headers), body, current?.name !== 'pending')
      return successResponse(scenario?.name === 'empty' && method === 'GET' ? { ...reply, data: emptied(reply.data) } : reply, now)
    } catch (error) {
      if (error instanceof MockHttpError) return errorResponse(error.status, error.message, fullPath, now, error.fieldErrors)
      console.error('[mock] handler failed', error)
      return errorResponse(500, 'An unexpected error occurred', fullPath, now)
    }
  }
}
