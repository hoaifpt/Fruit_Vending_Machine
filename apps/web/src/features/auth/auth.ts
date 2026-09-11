export interface AuthUser { id: string; displayName: string; role: 'ADMIN' | 'STAFF' }
interface Credentials { identifier: string; password: string }
interface LoginOptions { endpoint?: string; signal?: AbortSignal; fetcher?: typeof fetch }

// Proposed cookie-session contract; adapt here when the backend API is agreed.
export async function login(credentials: Credentials, { endpoint, signal, fetcher = fetch }: LoginOptions): Promise<AuthUser> {
  if (!endpoint?.trim()) throw new Error('Đăng nhập chưa được kết nối. Vui lòng thử lại sau khi hệ thống sẵn sàng.')
  const timeout = AbortSignal.timeout(15_000)
  let response: Response
  try {
    response = await fetcher(endpoint, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      credentials: 'include', cache: 'no-store',
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      body: JSON.stringify(credentials),
    })
  } catch {
    if (signal?.aborted) throw new Error('Yêu cầu đã được hủy.')
    if (timeout.aborted) throw new Error('Kết nối mất quá nhiều thời gian. Vui lòng thử lại.')
    throw new Error('Không thể kết nối đến hệ thống. Kiểm tra kết nối mạng và thử lại.')
  }
  if (response.status === 401 || response.status === 403) throw new Error('Thông tin đăng nhập không đúng hoặc tài khoản chưa được cấp quyền truy cập.')
  if (response.status === 429) throw new Error('Bạn đã thử đăng nhập quá nhiều lần. Vui lòng chờ một lúc rồi thử lại.')
  if (!response.ok) throw new Error('Hệ thống chưa thể xử lý đăng nhập. Vui lòng thử lại sau.')
  let data: unknown
  try { data = await response.json() } catch { throw new Error('Phản hồi đăng nhập không hợp lệ. Vui lòng liên hệ quản trị viên.') }
  if (!data || typeof data !== 'object' || !('user' in data)) throw new Error('Phản hồi đăng nhập không hợp lệ. Vui lòng liên hệ quản trị viên.')
  const user = data.user
  if (!user || typeof user !== 'object' || !('id' in user) || typeof user.id !== 'string' || !user.id.trim()
    || !('displayName' in user) || typeof user.displayName !== 'string' || !user.displayName.trim()
    || !('role' in user) || (user.role !== 'ADMIN' && user.role !== 'STAFF')) {
    throw new Error('Tài khoản chưa có thông tin hoặc quyền truy cập hợp lệ.')
  }
  return { id: user.id, displayName: user.displayName, role: user.role }
}
