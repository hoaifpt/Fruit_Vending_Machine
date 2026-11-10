// Single switch for the mock API. Loaded through a dynamic import from main.tsx, only when VITE_API_MOCK is set.
import { configureClient } from '../client.ts'
import { createMockFetcher, isMockEnabled, parseSelection } from './fetcher.ts'
import type { MockControls, MockOptions, MockSelection } from './fetcher.ts'

function sessionStorageOrNull(): Storage | null {
  try { return window.sessionStorage } catch { return null }
}

/** Plugs the mock into the API client. Returns the selection, or null when VITE_API_MOCK selects nothing. */
export function installMock(raw: string | undefined, overrides: Partial<MockOptions> = {}): MockSelection | null {
  const selection = parseSelection(raw)
  if (selection.unknown.length) console.warn(`[mock] Bỏ qua nhóm không hợp lệ: ${selection.unknown.join(', ')}`)
  if (!isMockEnabled(selection)) return null
  const fetcher = createMockFetcher(selection, {
    getSearch: () => (typeof window === 'undefined' ? '' : window.location.search),
    storage: typeof window === 'undefined' ? null : sessionStorageOrNull(),
    latencyMs: 150,
    ...overrides,
  })
  configureClient({ fetcher })
  // Test/demo hooks (for example paying the kiosk QR at a chosen instant). Only exists when the mock is installed.
  if (typeof window !== 'undefined') (window as typeof window & { __freshvendMock?: MockControls }).__freshvendMock = fetcher.controls
  console.info(`[mock] API giả đang bật: ${selection.all ? 'tất cả nhóm' : selection.groups.join(', ')}. Dữ liệu chỉ nằm trong bộ nhớ.`)
  return selection
}
