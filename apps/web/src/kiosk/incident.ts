// "Báo sự cố" corner button on the kiosk (screen K8, issue FE 5.4). Hidden unless VITE_KIOSK_INCIDENT_REPORT is on:
// the public report form (FE 8.2) and its backend (BE 5.2, mid-December) do not exist yet, so the QR only carries the
// link of this machine. FE 8.3 switches the flag on once the form works.

export interface IncidentReportConfig {
  enabled: boolean
  /** Public page the QR opens, without the machine parameter. */
  baseUrl: string
}

const ON = new Set(['1', 'true', 'on', 'yes'])
/** Path of the public report form planned in FE 8.2. */
export const INCIDENT_REPORT_PATH = '/bao-su-co'

/**
 * Flag and target URL from configuration. `override` is the `?incident=on|off` query parameter, honoured only with the
 * mock API so the UX tests can see both states without rebuilding.
 */
export function incidentReportConfig(env: Record<string, string | undefined>, origin: string, override?: string | null): IncidentReportConfig {
  const raw = (mockOverride(env, override) ?? env.VITE_KIOSK_INCIDENT_REPORT ?? '').trim().toLowerCase()
  const fallback = `${origin.replace(/\/+$/, '')}${INCIDENT_REPORT_PATH}`
  return { enabled: ON.has(raw), baseUrl: safeUrl((env.VITE_INCIDENT_REPORT_URL ?? '').trim(), origin) ?? fallback }
}

/** Absolute http(s) URL, a relative path resolved against the kiosk origin, or null for anything else (never throws). */
function safeUrl(value: string, origin: string): string | null {
  if (!value) return null
  try {
    const url = new URL(value, origin)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null
  } catch { return null }
}

/** `?incident=` counts only when the kiosk API itself is mocked (VITE_API_MOCK=all or a list containing kiosk). */
function mockOverride(env: Record<string, string | undefined>, override: string | null | undefined) {
  const groups = (env.VITE_API_MOCK ?? '').split(',').map(name => name.trim().toLowerCase())
  return override && (groups.includes('all') || groups.includes('kiosk')) ? override : undefined
}

/** Link printed in the QR: the report form pre-filled with this machine's code (never its internal id). */
export function incidentReportUrl(baseUrl: string, machineCode: string | undefined): string {
  const url = new URL(baseUrl) // incidentReportConfig only returns absolute http(s) URLs
  if (machineCode) url.searchParams.set('machine', machineCode)
  return url.toString()
}
