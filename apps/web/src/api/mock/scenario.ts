// `?scenario=<name>[:<targets>]` on the page URL forces a state for testing. It sticks in sessionStorage so it survives
// SPA navigation and the full-page redirect after a 401. `?scenario=none` (or an empty value) clears it.
// Targets narrow it to groups or path prefixes: `?scenario=403:orders,payments`, `?scenario=409:/inventory/load`.
// `expire`: tokens issued before the scenario started get 401 (session expired once); signing in again works,
// so the return to the previous page can be tested. Unlike `401`, it does not fail the new session.
export const SCENARIO_NAMES = ['empty', 'slow', 'error500', 'network', '401', '403', '400', '409', 'pending', 'expire'] as const
export type ScenarioName = (typeof SCENARIO_NAMES)[number]

export interface Scenario { name: ScenarioName; targets: string[]; /** Set in this page's URL, as opposed to carried over. */ explicit: boolean }
export interface ScenarioStorage { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void }

export const SCENARIO_STORAGE_KEY = 'fv-mock-scenario'
/** When the `expire` scenario started (ms), kept so a page reload does not expire the new session too. */
export const EXPIRE_SINCE_STORAGE_KEY = 'fv-mock-expire-since'

/** Start time of the `expire` scenario: remembered on first use, forgotten when another scenario (or none) is active. */
export function expireSince(scenario: Scenario | null, storage: ScenarioStorage | null, now: number, memory: { since: number | null }): number | null {
  if (scenario?.name !== 'expire') {
    memory.since = null
    attempt(() => storage?.removeItem(EXPIRE_SINCE_STORAGE_KEY))
    return null
  }
  const stored = Number(attempt(() => storage?.getItem(EXPIRE_SINCE_STORAGE_KEY)) ?? NaN)
  const since = memory.since ?? (Number.isFinite(stored) && stored > 0 ? stored : now)
  memory.since = since
  attempt(() => storage?.setItem(EXPIRE_SINCE_STORAGE_KEY, String(since)))
  return since
}

export function parseScenario(raw: string | null | undefined, explicit = false): Scenario | null {
  if (!raw) return null
  const separator = raw.indexOf(':')
  const name = (separator < 0 ? raw : raw.slice(0, separator)).trim() as ScenarioName
  if (!SCENARIO_NAMES.includes(name)) return null
  const targets = separator < 0 ? [] : raw.slice(separator + 1).split(',').map(target => target.trim()).filter(Boolean)
  return { name, targets, explicit }
}

function attempt<T>(action: () => T): T | null {
  try { return action() } catch { return null } // storage unavailable: the scenario then only lasts for this URL
}

/** The scenario for the current page: one in the URL wins and is remembered; otherwise the remembered one. */
export function readScenario(search: string, storage: ScenarioStorage | null): Scenario | null {
  const params = new URLSearchParams(search)
  if (params.has('scenario')) {
    const raw = params.get('scenario')
    const scenario = parseScenario(raw, true)
    if (scenario && raw) attempt(() => storage?.setItem(SCENARIO_STORAGE_KEY, raw))
    else attempt(() => storage?.removeItem(SCENARIO_STORAGE_KEY))
    return scenario
  }
  return parseScenario(attempt(() => storage?.getItem(SCENARIO_STORAGE_KEY)))
}

const isLogin = (method: string, path: string) => method === 'POST' && path === '/auth/login'

/**
 * Whether the scenario applies to this request. Without targets, 400/409 only hit writes so the page still loads and
 * the form can be submitted, and a carried-over scenario leaves login alone so the tester can get back in.
 */
export function scenarioApplies(scenario: Scenario, method: string, path: string, group: string | null): boolean {
  if (scenario.targets.length) return scenario.targets.some(target => (target.startsWith('/') ? path === target || path.startsWith(`${target}/`) : target === group))
  if (isLogin(method, path) && !scenario.explicit) return false
  if (scenario.name === '400' || scenario.name === '409') return method !== 'GET'
  return true
}
