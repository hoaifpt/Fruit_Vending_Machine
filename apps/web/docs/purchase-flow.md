# Luồng kiosk và thanh toán (issue #40)

Màn hình `/buy` là ứng dụng cảm ứng tại máy. Nguồn chân lý: `api-contract/api.yaml` (tag Kiosk, Kiosk Orders, Kiosk Payments). Phạm vi tới `PAID`; nhả hàng, hóa đơn, hoàn tiền nằm ngoài phạm vi.

## Xác thực máy

- Mọi request gửi `X-Kiosk-Key: fvk_<prefix>_<secret>`, không bao giờ dùng `Authorization: Bearer`.
- Khóa do ADMIN cấp trên web quản trị (chỉ hiện một lần), đặt vào `VITE_KIOSK_API_KEY` trong `.env.local` của máy kiosk. Không commit, không ghi log, không hiển thị.
- Biến `VITE_*` được nhúng vào bundle khi build: chỉ build bản kiosk trên máy kiosk, không phục vụ công khai.
- `401`/`403` ở bất kỳ bước nào → "Máy chưa được cấu hình" (khóa thiếu, sai hoặc bị thu hồi). Lỗi này không đụng tới phiên đăng nhập quản trị.

## Trạng thái màn hình

| `order.status` | `currentPayment.status` | Kiosk |
| --- | --- | --- |
| `PENDING_PAYMENT` | không có | Tự tạo attempt thanh toán |
| `PENDING_PAYMENT` | `PENDING` | QR + bộ đếm |
| `PENDING_PAYMENT` | `FAILED` / `EXPIRED` | "Mã QR đã hết hạn" + "Tạo mã QR mới" (nếu đơn còn hạn) |
| `PAID` / `DISPENSING` / `COMPLETED` | — | "Đã xác nhận thanh toán", về danh mục sau 12 giây |
| `CANCELLED` | bất kỳ | "Đơn hàng đã hủy", về danh mục sau 8 giây |
| khác | — | "Đơn hàng đã hết hạn" |

Logic thuần nằm ở `src/kiosk/flow.ts` (có test); gọi API ở `src/kiosk/api.ts`.

## Xử lý lỗi

| Tình huống | Hành vi |
| --- | --- |
| Tạo đơn `409`/`404` | "Sản phẩm này vừa hết…", làm mới danh mục |
| Tạo đơn lỗi mạng/`5xx`/timeout | Thông báo chung, về danh mục. **Không tự gửi lại** |
| Tạo thanh toán `502` | "Cổng thanh toán đang bận" + "Thử lại" |
| Tạo thanh toán `409` | Đọc lại đơn và làm theo bảng trạng thái |
| Polling lỗi mạng | Lùi dần 2,5 → 5 → 10 giây, hiện "Đang kết nối lại" |
| Hủy đơn `409` | Đọc lại đơn: thường là đã `PAID` → màn hình đã thanh toán |

Khách hàng không bao giờ thấy thông điệp thô từ backend, id nội bộ hay stack trace. Chỉ mã đơn (`orderCode`) được hiển thị để báo nhân viên khi cần.

## Thời gian

Bộ đếm dùng `min(currentPayment.expiresAt, order.expiresAt)`, hiệu chỉnh theo `timestamp` của phản hồi (giờ server). Hết giờ vẫn polling; backend quyết định hết hạn.

## Kiểm thử

- `npm test`: header kiosk, body tạo đơn chỉ có `productId`, phân biệt `200`/`201`, `502`, bảng trạng thái, hạn QR không vượt hạn giữ chỗ, lệch đồng hồ, backoff polling.
- Đã chạy E2E với backend local (PostgreSQL 18, `PAYMENT_PROVIDER=MOCK`, webhook MOCK đã ký): danh mục → tạo đơn → QR → `PAID` (polling dừng sau trạng thái cuối, tự về danh mục); webhook `FAILED` → "Tạo mã QR mới" → QR mới; nút Hủy; tự hủy khi không chạm; `409` khi sản phẩm bị ngừng bán; máy `MAINTENANCE` → tạm ngừng phục vụ; thu hồi khóa → "Máy chưa được cấu hình".
- Chưa kiểm tra: thanh toán thật qua payOS, `502` thật từ provider, mất mạng thật giữa lúc polling.
