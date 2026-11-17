// "Báo sự cố" corner button on the kiosk (screen K8, FE 5.4 / 8.3). The QR opens the public report form of this
// machine; its URL comes from the backend (GET /kiosk/incident-report-link?orderCode=, backend #74): the machine's report
// token, plus the order code on the "máy chưa nhả được hàng" screen (K-07) when that order belongs to this machine. The
// kiosk never builds the link itself. VITE_KIOSK_INCIDENT_REPORT=false still hides the button (e.g. a machine whose site
// has no mobile signal).
import { ApiError } from '../api/client.ts'
import { errorCode } from '../admin/form-error.ts'

export interface IncidentReportConfig { enabled: boolean }

const OFF = new Set(['0', 'false', 'off', 'no'])

/**
 * Flag from configuration. `override` is the `?incident=on|off` query parameter, honoured only with the mock API so the
 * UX tests can see both states without rebuilding.
 */
export function incidentReportConfig(env: Record<string, string | undefined>, override?: string | null): IncidentReportConfig {
  const raw = (mockOverride(env, override) ?? env.VITE_KIOSK_INCIDENT_REPORT ?? '').trim().toLowerCase()
  return { enabled: !OFF.has(raw) }
}

/** `?incident=` counts only when the kiosk API itself is mocked (VITE_API_MOCK=all or a list containing kiosk). */
function mockOverride(env: Record<string, string | undefined>, override: string | null | undefined) {
  const groups = (env.VITE_API_MOCK ?? '').split(',').map(name => name.trim().toLowerCase())
  return override && (groups.includes('all') || groups.includes('kiosk')) ? override : undefined
}

/** The server's URL, only when it is an absolute http(s) link (it goes into a QR a customer scans); null otherwise. */
export function safeReportUrl(value: string | null | undefined): string | null {
  if (!value) return null
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null
  } catch { return null }
}

/** What the incident dialog shows when the link cannot be read, with the next step for the customer. */
export function reportLinkProblem(error: unknown): string {
  if (error instanceof ApiError && error.status === 409 && errorCode(error) === 'REPORT_LINK_NOT_CONFIGURED') {
    return 'Máy này chưa bật trang báo sự cố. Vui lòng báo nhân viên vận hành theo số điện thoại dán trên máy.'
  }
  if (error instanceof ApiError && (error.status === 401 || error.status === 403)) return 'Máy đang mất kết nối với hệ thống. Vui lòng báo nhân viên vận hành theo số điện thoại dán trên máy.'
  return 'Chưa lấy được mã QR báo sự cố. Thử lại sau ít giây hoặc báo nhân viên vận hành theo số điện thoại dán trên máy.'
}
