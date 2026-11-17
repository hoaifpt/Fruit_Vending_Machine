# Lỗi phía BE tìm thấy khi test FE trên BE thật

Chạy lại ngày 17/11/2026 trên BE local `dev` @ `c239349` (schema V25), FE nhánh `feature/fe-real-api-integration`.
Bộ test: `apps/web/playwright.real.config.ts`, `apps/web/e2e-real/*.spec.ts`. Kết quả lần chạy: 133 đạt, 11 không đạt, 5 chặn.
Trong 11 case không đạt, 9 case do BE (bảng dưới), 1 case là test cũ (ADM-12) và 1 case là lỗi FE (STF-06), hai case này FE tự sửa.

FE đã có cách đọc tạm cho BE-01 và BE-03 (chuẩn hóa khóa và dịch câu), nên người dùng không thấy lỗi; BE vẫn cần sửa để đúng hợp đồng.

| Mã | Mức | Lỗi | Tái hiện | Thực tế | Mong đợi | Case |
| --- | --- | --- | --- | --- | --- | --- |
| BE-01 | Vừa | Khóa `fieldErrors` là đường dẫn validation của method Java, không phải tên field của request. Lộ tên method và tham số nội bộ; trái hợp đồng "field-to-validation-message map" mà các endpoint khác đang theo (ví dụ `/alerts/{id}/resolve` trả `note`). | `PUT /api/v1/pricing/near-expiry-discount` `{"enabled":true,"percent":0,"version":0}` | `{"fieldErrors":{"update.request.percent":"must be greater than or equal to 1"}}` | `{"fieldErrors":{"percent":"…"}}` | ADM-34, ADM-37, INV-19, INV-22, INV-23, INV-25, STF-10, STF-12 |
| BE-02 | Vừa | Cấu hình local `PASSWORD_MIN_LENGTH=8`, hợp đồng và FE dùng 12: mật khẩu 11 ký tự vẫn tạo được tài khoản. | `POST /api/v1/users` với `password` 11 ký tự | 201 `STAFF account created` | 400 (cấu hình 12 như mặc định) | ADM-11 |
| BE-03 | Vừa | Lỗi chính sách mật khẩu chỉ có `message`, không có `fieldErrors.password`. | `POST /api/v1/users` với `password` 7 ký tự | 400 `"Password must contain at least 8 characters and at most 72 UTF-8 bytes"`, không `fieldErrors` | 400 kèm `fieldErrors.password` | ADM-11, ADM-12 |
| BE-04 | Vừa | `/auth/login` không giới hạn số lần sai. | 25 lần `POST /api/v1/auth/login` sai mật khẩu liên tiếp | 25 lần 401 | 429 kèm `Retry-After` sau N lần sai | Lần chạy trước (ADM) |
| BE-05 | Thấp | Thứ tự `/work-orders` và `/work-orders/me`: ưu tiên → hạn → **cũ nhất trước**, không xét trạng thái. Khi có nhiều phiếu đã hủy/hoàn tất, phiếu mới được giao rơi xuống trang sau. FE đã đổi mặc định sang lọc "Chưa xong", nhưng nên cân nhắc đưa phiếu đã xong xuống cuối hoặc sắp mới nhất trước. | STAFF có > 20 phiếu đã hủy, ADMIN giao phiếu mới | Phiếu mới không ở trang 1 | Phiếu chưa xong luôn trước | STF-06 |
| BE-06 | Thấp | Một số lỗi 400 chỉ có `message`, không `fieldErrors`: `plannedQuantity` vượt sức chứa ("plannedQuantity 6 exceeds the capacity 5 of slot B"), tạo lô đã hết hạn ("Batch must not already be expired"). | Như mô tả | Chỉ `message` | Kèm `fieldErrors.plannedQuantity` / `fieldErrors.expiresAt` | INV (lần chạy trước) |
| BE-07 | Thấp | Field lạ, JSON hỏng, enum sai, sai kiểu đều trả chung "Request body is missing or malformed", không nêu field. | `POST /api/v1/machines` kèm field lạ | 400 câu chung | 400 kèm `fieldErrors.<field>` | ADM, INV (lần chạy trước) |
| BE-08 | Thấp | Message 409 của nạp trực tiếp không có mã đầu ("Batch is expired", "Slot must be ACTIVE for loading"), trong khi nạp theo phiếu có (`BATCH_EXPIRED: …`). | `POST /api/v1/inventory/load` với lô hết hạn | `Batch is expired` | `BATCH_EXPIRED: …` | INV (lần chạy trước) |
| BE-09 | Cần chốt nghiệp vụ | `POST /api/v1/inventory/load` cho nạp lô của sản phẩm khác vào ngăn đang có sản phẩm khác (cột lẫn 2 sản phẩm); nạp theo phiếu thì chặn `BATCH_PRODUCT_MISMATCH`. | Nạp lô sản phẩm Y vào ngăn đang có X | 201 | 409 như nạp theo phiếu (nếu nghiệp vụ không cho lẫn) | INV-13 |

Các khóa `fieldErrors` dạng đường dẫn đã thấy (BE-01): `addLine.input.plannedQuantity`, `addNote.request.note`,
`complete.request.lineVariances[0].reason`, `complete.request.resultNote`, `create.request.intervalDays`,
`load.request.quantity`, `update.request.percent`, `update.request.version`.
Nghi ở `backend/src/main/java/com/fruitmachine/backend/common/exception/GlobalExceptionHandler.java:76`: nhánh
`ConstraintViolationException` dùng `getPropertyPath().toString()`; nên lấy node cuối của path (giữ chỉ số mảng cho
`lineVariances[0].reason`).

## Cấu hình cần cho production (không phải lỗi code)

- `PASSWORD_MIN_LENGTH=12` (hoặc bỏ để dùng mặc định).
- `PUBLIC_REPORT_BASE_URL`, `PUBLIC_REPORT_ALLOWED_ORIGINS`, `REPORT_IP_HASH_SECRET`, `REPORT_TRUSTED_PROXIES`: thiếu thì kiosk không có QR báo sự cố (409 `REPORT_LINK_NOT_CONFIGURED`) và không xoay được token.
- Tắt hoặc bảo vệ Swagger (`/swagger-ui`, `/v3/api-docs`): bản deploy `104.214.184.23:8080` đang mở công khai qua HTTP.
- `ORDER_RESERVATION_TTL`: local đang 600 s, mặc định 300 s.

## Chưa test được

- Thanh toán tới PAID và nhả hàng: BE local dùng `PAYMENT_PROVIDER=PAYOS` thật, test không tạo thanh toán.
- Gửi phản ánh hợp lệ: thiếu `PUBLIC_REPORT_BASE_URL`.
- Lệnh bảo trì chạy tới COMPLETED: máy M1 OFFLINE, không có firmware.
