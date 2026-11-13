# Luồng kiosk và thanh toán (issue #40)

Màn hình `/buy` là ứng dụng cảm ứng tại máy. Nguồn chân lý: `api-contract/api.yaml` (tag Kiosk, Kiosk Orders, Kiosk Payments). FM5 (FE 5.1–5.4) làm lại toàn bộ màn kiosk K1–K8, gồm cả nhả hàng; hóa đơn và hoàn tiền nằm ngoài phạm vi.

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
| `PAID` | — | K3 "Đang gửi lệnh nhả hàng" + mã đơn |
| `DISPENSING` | — | K3 "Máy đang nhả hàng" + mã đơn; quá 45 giây thêm lời giải thích và mã đơn to |
| `COMPLETED` | — | K4 "Mời bạn lấy trái cây" + mã đơn, về danh mục sau 12 giây (có đếm ngược) |
| `DISPENSE_FAILED` | — | K5 "Máy chưa nhả được hàng", mã đơn cỡ 44px + mã máy, giữ 60 giây |
| `CANCELLED` (còn hạn giữ) | khác `SUCCESS` | K6 "Đơn hàng đã hủy" + "Bạn chưa bị trừ tiền", về sau 10 giây |
| `CANCELLED` (quá hạn giữ) / khác | khác `SUCCESS` | K6 "Đơn hàng đã hết hạn" + "Bạn chưa bị trừ tiền" |
| `CANCELLED` / khác | `SUCCESS` (tiền về muộn) | K6 báo nhân viên mã đơn để hoàn tiền |

## Trạng thái máy (K1, K7)

| Điều kiện | Màn hình |
| --- | --- |
| Không có khóa, `401`/`403` | "Máy chưa được cấu hình" (không thử lại) |
| Lỗi mạng / `5xx` khi tải | "Máy đang mất kết nối", thử lại mỗi 15 giây |
| `acceptingOrders=false` + `machineStatus` `MAINTENANCE` / `INACTIVE` / khác | "Máy đang bảo trì" / "Máy tạm ngừng phục vụ" / "Máy tạm ngừng nhận đơn" |
| Danh mục rỗng | "Máy đã hết hàng" |

Không chạm `VITE_KIOSK_PAYMENT_IDLE_SECONDS` (mặc định 120 giây) chỉ tự hủy đơn khi chưa có QR hoặc QR đã hết hạn; khi QR còn hiệu lực, khách đang trả tiền trên điện thoại nên chỉ hạn giữ hàng (5 phút) kết thúc đơn. `DISPENSING` quá 150 giây không có kết quả → màn "Máy chưa báo kết quả nhả hàng" giữ mã đơn 60 giây. Nút "Giả lập thanh toán (Mock Pay)" cho QR `MOCK-QR|` của backend chỉ có trong `npm run dev`, không vào bản build.

Mọi màn trạng thái có lời giải thích, bước tiếp theo, mã máy và giờ kiểm tra lần cuối. Mọi nút cảm ứng cao ≥ 64px.

## Giảm giá cận hạn (K1, FE 7.5)

Field nháp `api-contract/drafts/pricing-discount.yaml` (chờ BE 4.1). Thẻ sản phẩm: `price` (giá trả, sau giảm) vẫn là `<strong>` duy nhất của thẻ; khi `originalUnitPrice > price` thì thêm giá gốc gạch (`<s>`, đọc là "Giá gốc …") và nhãn "-50%" bằng chữ (kèm chữ ẩn "giảm giá hộp cận hạn"). Màn thanh toán vẫn lấy số tiền từ `order.totalAmount` của server; nếu đơn có `discountAmount > 0` thì thêm dòng "Giảm giá hộp cận hạn: đã giảm …, giá gốc …". Kiosk không tự tính giá; catalog thiếu field thì hiện như cũ. Mock: dưa hấu cận hạn 25.000 → 12.500 ₫.

## Nút Báo sự cố (K8)

Bật mặc định từ FE 8.3 (form công khai FE 8.2 đã có, mock tới khi có BE 5.2). Tắt trên một máy bằng `VITE_KIOSK_INCIDENT_REPORT=false` (`0`/`off`/`no` cũng tắt; để trống hoặc giá trị khác là bật). Nút "Báo sự cố" nằm góc trái chân màn hình trên mọi màn (K-01 danh mục…); QR mở `VITE_INCIDENT_REPORT_URL` (mặc định `<origin>/bao-su-co`) kèm `?machine=<mã máy>`. Màn "Máy chưa nhả được hàng" / "chưa báo kết quả" (K-07) có thêm nút "Quét mã QR báo sự cố" cạnh nút chính; QR lúc này kèm `&order=<mã đơn>` và form điền sẵn loại "Đã trả tiền nhưng không nhận hàng" cùng mã đơn (mã sai dạng thì bỏ qua). Báo cáo tạo phiếu INCIDENT (O3) và, với đơn PAID/DISPENSE_FAILED, hiện ngay ở "Cần hoàn tiền" (W-12). Với mock, `?incident=on|off` đổi cờ để test.

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

## Chạy bằng mock (chờ API thật)

`npm run dev:mock` rồi mở `/buy`. Kịch bản: `?scenario=pending` (không tự thanh toán), `maintenance`, `network`, `401`, `empty`, `dispense-failed`, `dispense-slow`. `window.__freshvendMock.payKioskOrder()` giả lập webhook thanh toán thành công cho QR đang hiện.

Chờ API thật (BE M2, dự kiến 30/11):

- BE 3.3 Dispense: mock tự chuyển `PAID → DISPENSING → COMPLETED/DISPENSE_FAILED`. Kiosk chỉ đọc `order.status` qua `GET /kiosk/orders/{id}`; nếu BE thêm endpoint trạng thái lệnh riêng thì nối vào `src/kiosk/api.ts`. Cần kiểm lại thời gian thật từ webhook tới `DISPENSING` và ngưỡng 45 giây.
- "Thấy PAID ≤ 3 giây sau webhook" mới đo trên mock (polling 2,5 giây); đo lại với webhook payOS thật.
- BE 5.2 Báo sự cố công khai: chỉ có link QR, chưa có trang đích.

## Kiểm thử

- `e2e/kiosk.spec.ts` (1280×800, axe): K1 danh mục + chạm ≥ 64px + bàn phím, K7 bốn trạng thái máy, K2→K3→K4 đo PAID ≤ 3 giây sau webhook, K5 mã đơn to, K3 nhả lâu, K6 hủy và hết hạn, K8 cờ tắt/bật và link QR.
- `e2e/discount.spec.ts` (1280×800, axe): thẻ hộp cận hạn, giá gốc gạch, nhãn -50%, thanh toán đúng giá sau giảm; hộp không giảm giữ nguyên.
- `npm test`: header kiosk, body tạo đơn chỉ có `productId`, phân biệt `200`/`201`, `502`, bảng trạng thái, hạn QR không vượt hạn giữ chỗ, lệch đồng hồ, backoff polling.
- Đã chạy E2E với backend local (PostgreSQL 18, `PAYMENT_PROVIDER=MOCK`, webhook MOCK đã ký): danh mục → tạo đơn → QR → `PAID` (polling dừng sau trạng thái cuối, tự về danh mục); webhook `FAILED` → "Tạo mã QR mới" → QR mới; nút Hủy; tự hủy khi không chạm; `409` khi sản phẩm bị ngừng bán; máy `MAINTENANCE` → tạm ngừng phục vụ; thu hồi khóa → "Máy chưa được cấu hình".
- Chưa kiểm tra: thanh toán thật qua payOS, `502` thật từ provider, mất mạng thật giữa lúc polling.
