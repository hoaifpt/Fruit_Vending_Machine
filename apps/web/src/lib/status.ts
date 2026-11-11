// Status vocabularies shown in the portal, one per backend enum. tests/status.test.mjs compares every domain with the
// Java enum (or the design documents, for vocabularies the backend does not have yet), so add values there first.

export type StatusTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral'
export type StatusIcon =
  | 'active' | 'alert' | 'ban' | 'boxBad' | 'boxOk' | 'critical' | 'dashed' | 'dispensing' | 'expired' | 'failed' | 'help'
  | 'hourglass' | 'info' | 'lock' | 'offline' | 'online' | 'pause' | 'pending' | 'received' | 'refund' | 'sent' | 'signal' | 'wrench'

export interface StatusMeta {
  label: string
  tone: StatusTone
  icon: StatusIcon
  /** One sentence: what the state means and, when the operator has to act, what to do next. */
  description: string
}

export const STATUS_CATALOG = {
  machine: {
    ACTIVE: { label: 'Hoạt động', tone: 'success', icon: 'active', description: 'Máy đang được phép bán hàng.' },
    INACTIVE: { label: 'Ngừng hoạt động', tone: 'neutral', icon: 'pause', description: 'Máy không nhận đơn. Quản trị viên bật lại khi máy sẵn sàng.' },
    MAINTENANCE: { label: 'Bảo trì', tone: 'warning', icon: 'wrench', description: 'Máy tạm dừng nhận đơn. Kiểm tra máy rồi để quản trị viên bật lại.' },
  },
  connection: {
    ONLINE: { label: 'Trực tuyến', tone: 'success', icon: 'online', description: 'Máy đang kết nối với hệ thống.' },
    OFFLINE: { label: 'Mất kết nối', tone: 'danger', icon: 'offline', description: 'Máy không còn kết nối với hệ thống. Kiểm tra nguồn điện và mạng của máy.' },
  },
  box: {
    AVAILABLE: { label: 'Sẵn sàng', tone: 'success', icon: 'boxOk', description: 'Hộp nằm trong ngăn và có thể bán.' },
    RESERVED: { label: 'Đã giữ chỗ', tone: 'warning', icon: 'lock', description: 'Hộp đang được giữ cho một đơn chưa hoàn tất.' },
    SOLD: { label: 'Đã bán', tone: 'neutral', icon: 'active', description: 'Hộp đã bán và nhả cho khách.' },
    EXPIRED: { label: 'Hết hạn', tone: 'danger', icon: 'expired', description: 'Hộp đã quá hạn sử dụng và không được bán. Cần rút khỏi ngăn.' },
    REMOVED: { label: 'Đã rút', tone: 'neutral', icon: 'ban', description: 'Hộp đã được rút khỏi ngăn.' },
    DISPENSE_FAILED: { label: 'Nhả hàng thất bại', tone: 'danger', icon: 'boxBad', description: 'Máy không nhả được hộp này nên hộp cần đối soát; hệ thống chưa cho rút trực tiếp. Kiểm tra ngăn tại máy và xem đơn liên quan.' },
  },
  order: {
    PENDING_PAYMENT: { label: 'Chờ thanh toán', tone: 'warning', icon: 'pending', description: 'Đơn đang chờ khách quét mã QR và thanh toán.' },
    PAID: { label: 'Đã thanh toán', tone: 'info', icon: 'active', description: 'Đơn đã thanh toán và đang chờ máy nhả hàng.' },
    DISPENSING: { label: 'Đang nhả hàng', tone: 'info', icon: 'dispensing', description: 'Máy đang nhả hộp cho khách.' },
    COMPLETED: { label: 'Hoàn tất', tone: 'success', icon: 'active', description: 'Khách đã nhận được hộp.' },
    CANCELLED: { label: 'Đã hủy', tone: 'neutral', icon: 'ban', description: 'Đơn đã hủy hoặc hết hạn thanh toán, hộp được trả lại ngăn.' },
    PAYMENT_FAILED: { label: 'Thanh toán thất bại', tone: 'danger', icon: 'failed', description: 'Thanh toán không thành công, đơn không được xử lý tiếp.' },
    DISPENSE_FAILED: { label: 'Nhả hàng thất bại', tone: 'danger', icon: 'boxBad', description: 'Khách đã trả tiền nhưng chưa nhận được hộp. Cần kiểm tra máy và xử lý hoàn tiền.' },
    REFUNDED: { label: 'Đã hoàn tiền', tone: 'info', icon: 'refund', description: 'Tiền của đơn đã được hoàn lại cho khách.' },
  },
  payment: {
    PENDING: { label: 'Đang chờ', tone: 'warning', icon: 'pending', description: 'Mã QR còn hiệu lực, đang chờ khách thanh toán.' },
    SUCCESS: { label: 'Thành công', tone: 'success', icon: 'active', description: 'Đã nhận được tiền từ khách.' },
    FAILED: { label: 'Thất bại', tone: 'danger', icon: 'failed', description: 'Lần thanh toán này không thành công. Khách có thể tạo mã QR mới khi đơn còn thanh toán được.' },
    EXPIRED: { label: 'Hết hạn', tone: 'warning', icon: 'expired', description: 'Mã QR của lần thanh toán này không còn hiệu lực.' },
    REFUNDED: { label: 'Đã hoàn tiền', tone: 'info', icon: 'refund', description: 'Khoản thanh toán đã được hoàn lại cho khách.' },
  },
  dispense: {
    PENDING: { label: 'Đang chờ', tone: 'warning', icon: 'pending', description: 'Lệnh đã tạo và chờ gửi xuống máy.' },
    SENT: { label: 'Đã gửi', tone: 'info', icon: 'sent', description: 'Lệnh đã gửi xuống máy, đang chờ máy phản hồi.' },
    ACKNOWLEDGED: { label: 'Máy đã nhận', tone: 'info', icon: 'signal', description: 'Máy đã nhận lệnh và đang thực hiện.' },
    SUCCESS: { label: 'Thành công', tone: 'success', icon: 'active', description: 'Máy đã nhả hộp thành công.' },
    FAILED: { label: 'Thất bại', tone: 'danger', icon: 'failed', description: 'Máy báo không nhả được hộp. Kiểm tra ngăn trước khi bán tiếp.' },
    TIMEOUT: { label: 'Quá thời gian', tone: 'danger', icon: 'hourglass', description: 'Máy không phản hồi kịp thời. Lệnh không tự gửi lại, cần kiểm tra máy và đối soát.' },
  },
  alert: {
    OPEN: { label: 'Đang mở', tone: 'warning', icon: 'alert', description: 'Cảnh báo chưa có người tiếp nhận.' },
    ACKNOWLEDGED: { label: 'Đã tiếp nhận', tone: 'info', icon: 'received', description: 'Đã có người tiếp nhận và đang xử lý cảnh báo.' },
    RESOLVED: { label: 'Đã xử lý', tone: 'success', icon: 'active', description: 'Sự cố của cảnh báo đã được xử lý xong.' },
  },
  alertSeverity: {
    INFO: { label: 'Thông tin', tone: 'info', icon: 'info', description: 'Chỉ để theo dõi, chưa cần xử lý ngay.' },
    WARNING: { label: 'Cảnh báo', tone: 'warning', icon: 'alert', description: 'Cần kiểm tra sớm để tránh ảnh hưởng tới việc bán hàng.' },
    CRITICAL: { label: 'Nghiêm trọng', tone: 'danger', icon: 'critical', description: 'Ảnh hưởng tới việc bán hàng, cần xử lý ngay.' },
  },
  slot: {
    ACTIVE: { label: 'Hoạt động', tone: 'success', icon: 'active', description: 'Ngăn đang nhận hàng và bán được.' },
    INACTIVE: { label: 'Ngừng hoạt động', tone: 'neutral', icon: 'pause', description: 'Ngăn không được dùng để bán. Quản trị viên bật lại khi cần.' },
    ERROR: { label: 'Lỗi', tone: 'danger', icon: 'failed', description: 'Ngăn đang báo lỗi và không bán được. Kiểm tra ngăn tại máy.' },
  },
  product: {
    ACTIVE: { label: 'Đang bán', tone: 'success', icon: 'active', description: 'Sản phẩm được phép bán trên kiosk.' },
    INACTIVE: { label: 'Ngừng bán', tone: 'neutral', icon: 'pause', description: 'Sản phẩm không hiện trên kiosk; hộp đã nạp vẫn còn trong ngăn.' },
  },
  user: {
    ACTIVE: { label: 'Hoạt động', tone: 'success', icon: 'active', description: 'Tài khoản đăng nhập được.' },
    INACTIVE: { label: 'Ngừng hoạt động', tone: 'neutral', icon: 'pause', description: 'Tài khoản không đăng nhập được cho đến khi quản trị viên bật lại.' },
    LOCKED: { label: 'Đã khóa', tone: 'danger', icon: 'lock', description: 'Tài khoản bị khóa và không đăng nhập được. Liên hệ quản trị viên để mở khóa.' },
  },
  kioskCredential: {
    ACTIVE: { label: 'Đang dùng', tone: 'success', icon: 'active', description: 'Kiosk của máy đang dùng khóa này để gọi hệ thống.' },
    REVOKED: { label: 'Đã thu hồi', tone: 'neutral', icon: 'ban', description: 'Khóa không còn hiệu lực; kiosk dùng khóa này sẽ bị từ chối.' },
  },
  allocation: {
    RESERVED: { label: 'Đã giữ chỗ', tone: 'warning', icon: 'lock', description: 'Hộp đang được giữ cho đơn này.' },
    DISPENSED: { label: 'Đã nhả hàng', tone: 'success', icon: 'active', description: 'Máy đã nhả hộp này cho khách.' },
    RELEASED: { label: 'Đã trả lại ngăn', tone: 'neutral', icon: 'refund', description: 'Đơn không hoàn tất nên hộp được trả lại ngăn để bán tiếp.' },
  },
  inventoryTransactionType: {
    LOAD: { label: 'Nạp hàng', tone: 'success', icon: 'boxOk', description: 'Hộp được nạp vào ngăn.' },
    RESERVE: { label: 'Giữ chỗ', tone: 'warning', icon: 'lock', description: 'Hộp được giữ cho một đơn.' },
    SALE: { label: 'Bán', tone: 'info', icon: 'active', description: 'Hộp đã bán và nhả cho khách.' },
    EXPIRE: { label: 'Hết hạn', tone: 'danger', icon: 'expired', description: 'Hộp quá hạn sử dụng và không được bán nữa.' },
    REMOVE: { label: 'Rút hộp', tone: 'neutral', icon: 'ban', description: 'Hộp được rút khỏi ngăn.' },
    RETURN: { label: 'Trả lại ngăn', tone: 'info', icon: 'refund', description: 'Hộp đang giữ chỗ được trả lại ngăn để bán tiếp.' },
    ADJUSTMENT: { label: 'Điều chỉnh', tone: 'neutral', icon: 'wrench', description: 'Trạng thái hộp được điều chỉnh.' },
  },
  ticket: {
    OPEN: { label: 'Chưa phân công', tone: 'warning', icon: 'dashed', description: 'Phiếu chưa có người phụ trách. Quản trị viên cần phân công.' },
    ASSIGNED: { label: 'Đã phân công', tone: 'info', icon: 'received', description: 'Phiếu đã giao cho một nhân viên và chờ bắt đầu.' },
    IN_PROGRESS: { label: 'Đang thực hiện', tone: 'info', icon: 'wrench', description: 'Nhân viên đang thực hiện công việc tại máy.' },
    COMPLETED: { label: 'Hoàn tất', tone: 'success', icon: 'active', description: 'Công việc của phiếu đã hoàn tất.' },
    CANCELLED: { label: 'Đã hủy', tone: 'neutral', icon: 'ban', description: 'Phiếu đã bị quản trị viên hủy.' },
  },
} as const satisfies Record<string, Record<string, StatusMeta>>

export type StatusDomain = keyof typeof STATUS_CATALOG

/** The backend may add a value before the portal knows it: show the raw value instead of failing or hiding it. */
export function statusMeta(domain: StatusDomain, value: string): StatusMeta {
  const values: Record<string, StatusMeta> = STATUS_CATALOG[domain]
  if (Object.hasOwn(values, value)) return values[value]
  return { label: value, tone: 'neutral', icon: 'help', description: 'Hệ thống chưa có mô tả cho trạng thái này. Hãy báo quản trị viên kiểm tra.' }
}
