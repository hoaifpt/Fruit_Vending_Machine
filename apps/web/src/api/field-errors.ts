// Keys of `fieldErrors` as the screens use them. The backend's bean validation of a request body answers with the
// field name (`quantity`, `photos[0]`), but its method validation answers with the Java path
// `<method>.<parameter>.<field>` (`update.request.percent`, `addLine.input.plannedQuantity`,
// `complete.request.lineVariances[0].reason`; e2e-real/cases/inventory.md L-01, admin.md L-04). Both are read the same
// way, so a message always lands under its field and no internal method name reaches the screen.

/**
 * Field name of one `fieldErrors` key: the last segment, or, when the path goes through a list, the path from that list
 * on (`lineVariances[0].reason`), so the index still says which row is meant. A plain key is returned as is.
 */
export function normalizeFieldKey(key: string): string {
  const parts = key.split('.').map(part => part.trim()).filter(Boolean)
  if (parts.length <= 1) return parts[0] ?? key
  const list = parts.findIndex(part => /\[\d+\]$/.test(part))
  return list >= 0 ? parts.slice(list).join('.') : parts[parts.length - 1]
}

/** `fieldErrors` with every key normalized; when two keys meet on the same field the first message is kept. */
export function normalizeFieldErrors(fieldErrors: Readonly<Record<string, string>>): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [key, message] of Object.entries(fieldErrors)) {
    const field = normalizeFieldKey(key)
    if (!(field in result)) result[field] = message
  }
  return result
}

/** `lineVariances[2].reason` → `{ list: 'lineVariances', index: 2, field: 'reason' }`; undefined for a key without an index. */
export function listFieldOf(key: string): { list: string; index: number; field: string } | undefined {
  const match = /^([A-Za-z_$][\w$]*)\[(\d+)\](?:\.(.+))?$/.exec(normalizeFieldKey(key))
  return match ? { list: match[1], index: Number(match[2]), field: match[3] ?? '' } : undefined
}

/**
 * Form-level line of a 400 that names no field the form shows (an unknown key, or only the backend's generic English
 * "Request validation failed"): said in Vietnamese with the next step, never the English text.
 */
export const INVALID_REQUEST = 'Dữ liệu gửi lên chưa hợp lệ. Kiểm tra lại các ô rồi gửi lại; nếu vẫn lỗi, hãy tải lại trang.'

/** The backend's generic 400 line (`Request validation failed`): it says nothing the person can act on. */
export function isValidationFailedMessage(message: string): boolean {
  return /^(request )?validation failed\.?$/i.test(message.trim())
}

/**
 * A field message in Vietnamese. Messages already in Vietnamese (screens map them; they carry diacritics) are kept;
 * the backend's English bean-validation messages are worded in Vietnamese, and an English message we do not know
 * becomes a neutral "Giá trị chưa hợp lệ." so no English reaches the screen.
 */
export function fieldMessageVi(message: string): string {
  const text = message.trim()
  if (!text) return text
  // Non-ASCII: Vietnamese already (or at least not one of the backend's English lines).
  if (/[^ -~]/.test(text)) return text
  const size = /size must be between (\d+) and (\d+)/i.exec(text)
  if (size) return Number(size[1]) <= 1 ? `Tối đa ${size[2]} ký tự.` : `Từ ${size[1]} đến ${size[2]} ký tự.`
  if (/must not be (blank|null|empty)|is required|required/i.test(text)) return 'Không được để trống.'
  const min = /must be greater than or equal to (-?[\d.]+)/i.exec(text)
  if (min) return `Phải lớn hơn hoặc bằng ${min[1]}.`
  const max = /must be less than or equal to (-?[\d.]+)/i.exec(text)
  if (max) return `Phải nhỏ hơn hoặc bằng ${max[1]}.`
  const gt = /must be greater than (-?[\d.]+)/i.exec(text)
  if (gt) return `Phải lớn hơn ${gt[1]}.`
  const lt = /must be less than (-?[\d.]+)/i.exec(text)
  if (lt) return `Phải nhỏ hơn ${lt[1]}.`
  if (/must be positive/i.test(text)) return 'Phải lớn hơn 0.'
  if (/well-formed email/i.test(text)) return 'Email chưa đúng định dạng.'
  if (/uuid/i.test(text)) return 'Lựa chọn không hợp lệ. Chọn lại.'
  if (/unknown request field/i.test(text)) return 'Máy chủ không nhận trường này. Hãy tải lại trang rồi thử lại.'
  return 'Giá trị chưa hợp lệ.'
}
