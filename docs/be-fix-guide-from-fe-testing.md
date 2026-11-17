# Hướng dẫn sửa BE từ kết quả test FE trên BE thật

Ngày 17/11/2026. FE (nhánh `feature/fe-real-api-integration`) chạy bộ test chức năng `apps/web/e2e-real/` trên BE local
`dev` @ `c239349` (schema V25): 159 case, 133 đạt, 11 không đạt, 5 chặn. Mọi case không đạt còn lại đều do BE.
Bảng case từng luồng ở `apps/web/e2e-real/cases/` (`admin.md`, `staff.md`, `inventory.md`, `customer.md`, `BE-ISSUES.md`).

FE đã có cách đọc tạm cho BE-01 và BE-03 nên người dùng chưa thấy lỗi, nhưng BE vẫn cần sửa để đúng hợp đồng
`api-contract/api.yaml` ("fieldErrors: field-to-validation-message map").

Thứ tự đề nghị: BE-01 → BE-03 → BE-04 → BE-02 (cấu hình) → các mục Thấp.

---

## BE-01 (Vừa): khóa `fieldErrors` là đường dẫn method, không phải tên field

**Hiện tượng.** Validation chạy ở tầng service (`@Validated` + `@Valid` trên tham số method) trả khóa kiểu
`<method>.<param>.<field>`, lộ tên method/tham số nội bộ và FE không gắn lỗi vào ô.

| Endpoint | Khóa đang trả | Khóa đúng |
| --- | --- | --- |
| `PUT /pricing/near-expiry-discount` | `update.request.percent`, `update.request.version` | `percent`, `version` |
| `POST /work-orders/{id}/notes` | `addNote.request.note` | `note` |
| `POST /work-orders/{id}/complete` | `complete.request.resultNote`, `complete.request.lineVariances[0].reason` | `resultNote`, `lineVariances[0].reason` |
| `POST /work-orders/{id}/restock-lines` | `addLine.input.plannedQuantity` | `plannedQuantity` |
| `POST /work-orders/{id}/restock-lines/{lineId}/loads` | `load.request.quantity` | `quantity` |
| `POST /maintenance-plans`, `PATCH /maintenance-plans/{id}` | `create.request.intervalDays`, `create.request.leadDays`, `create.request.title`, `update.request.version` | `intervalDays`, `leadDays`, `title`, `version` |

**Tái hiện.**
```
PUT /api/v1/pricing/near-expiry-discount
{"enabled":true,"percent":0,"version":0}
→ 400 {"fieldErrors":{"update.request.percent":"must be greater than or equal to 1"}}
```

**Chỗ sửa.** `backend/src/main/java/com/fruitmachine/backend/common/exception/GlobalExceptionHandler.java`,
`handleConstraintViolation` đang dùng `v.getPropertyPath().toString()`. Bỏ hai node đầu (method, tham số) và giữ phần
còn lại, gồm cả chỉ số mảng:

```java
private static String fieldKey(ConstraintViolation<?> v) {
    StringBuilder key = new StringBuilder();
    for (Path.Node node : v.getPropertyPath()) {
        ElementKind kind = node.getKind();
        if (kind == ElementKind.METHOD || kind == ElementKind.PARAMETER || kind == ElementKind.CROSS_PARAMETER
                || kind == ElementKind.RETURN_VALUE) continue;
        if (node.getIndex() != null && key.length() > 0) key.append('[').append(node.getIndex()).append(']');
        if (node.getName() != null) { if (key.length() > 0) key.append('.'); key.append(node.getName()); }
    }
    return key.length() == 0 ? "request" : key.toString();
}
// errors.putIfAbsent(fieldKey(v), v.getMessage());
```

Lưu ý: chỉ số của phần tử list nằm trên node của phần tử con (`reason` có index 0), nên kiểm lại kết quả mong đợi
`lineVariances[0].reason` bằng test.

**Tiêu chí xong.**
- Mọi endpoint trong bảng trả khóa ở cột "Khóa đúng".
- Thêm test (WebMvc hoặc integration) cho ít nhất `pricing`, `notes`, `complete` có `lineVariances`.
- Chạy lại FE: `npx playwright test -c playwright.real.config.ts -g "ADM-34|ADM-37|INV-19|INV-22|INV-23|INV-25|STF-10|STF-12"` đạt.

---

## BE-03 (Vừa): lỗi chính sách mật khẩu thiếu `fieldErrors.password`

**Hiện tượng.** `POST /users` với mật khẩu ngắn trả 400 chỉ có `message`
("Password must contain at least 8 characters and at most 72 UTF-8 bytes"), không có `fieldErrors`.

**Chỗ sửa.** `user/service/UserService.java` (`createStaff`, khối `catch (IllegalArgumentException ex)`): đang ném
`new BadRequestException(ex.getMessage())` chung cho cả email và mật khẩu. Tách hai lời gọi để biết field:

```java
try { email = credentials.normalizeEmail(request.email()); }
catch (IllegalArgumentException ex) { throw new BadRequestException(ex.getMessage(), Map.of("email", ex.getMessage())); }
try { credentials.validateNewPassword(request.password()); }
catch (IllegalArgumentException ex) { throw new BadRequestException(ex.getMessage(), Map.of("password", ex.getMessage())); }
```

Làm tương tự ở mọi chỗ khác gọi `validateNewPassword`/`normalizeEmail` từ request (đổi mật khẩu, nếu có).

**Tiêu chí xong.** Mật khẩu 7 ký tự → 400 có `fieldErrors.password`; email sai → `fieldErrors.email`. Case ADM-11/ADM-12 đạt.

---

## BE-04 (Vừa): `/auth/login` không giới hạn số lần thử

**Hiện tượng.** 25 lần đăng nhập sai liên tiếp đều 401, không có 429. FE đã sẵn câu báo cho 429 (`Retry-After`).

**Chỗ sửa.** `auth/controller/AuthController.java` / service đăng nhập. Có thể dùng lại cơ chế đã có
`customerreport.ratelimit.TooManyRequestsException` (handler trong `GlobalExceptionHandler` đã gắn `Retry-After`).
Đề nghị: đếm theo email đã chuẩn hóa và theo IP (sau `REPORT_TRUSTED_PROXIES`/forwarded headers đã tin cậy), ví dụ
5 lần sai trong 15 phút → 429 trong 15 phút; đăng nhập đúng thì xóa bộ đếm của email. Message 429 không được lộ email
có tồn tại hay không.

**Tiêu chí xong.** Lần sai thứ 6 trong cửa sổ → 429 kèm `Retry-After`; email không tồn tại bị đối xử giống email có thật.

---

## BE-02 (Vừa, cấu hình): độ dài mật khẩu tối thiểu

Local đang đặt `PASSWORD_MIN_LENGTH=8`, hợp đồng và FE dùng 12 (mật khẩu 11 ký tự vẫn tạo được tài khoản). Đặt `12`
(hoặc bỏ biến để dùng mặc định) ở mọi môi trường. FE chặn ở client theo 12 ký tự / 72 byte UTF-8.

---

## Mục mức Thấp

| Mã | Việc | Gợi ý |
| --- | --- | --- |
| BE-05 | `/work-orders` và `/work-orders/me` sắp ưu tiên → hạn → **cũ nhất trước**, không xét trạng thái; phiếu mới giao có thể rơi xuống trang sau. FE đã đổi mặc định lọc `status=OPEN&status=ASSIGNED&status=IN_PROGRESS`. | Đưa phiếu DONE/CANCELLED xuống cuối, hoặc trong cùng mức ưu tiên/hạn thì mới nhất trước. |
| BE-06 | 400 chỉ có `message`: `plannedQuantity` vượt sức chứa ("plannedQuantity 6 exceeds the capacity 5 of slot B"), tạo lô đã hết hạn ("Batch must not already be expired"). | `BadRequestException(msg, Map.of("plannedQuantity", msg))`, `Map.of("expiresAt", msg)`. |
| BE-07 | `handleHttpMessageNotReadable` trả chung "Request body is missing or malformed" cho field lạ, JSON hỏng, enum sai, sai kiểu. | Với `UnrecognizedPropertyException`/`InvalidFormatException` (cause của `HttpMessageNotReadableException`), lấy `getPath()` để trả `fieldErrors.<field>` ("unknown request field" / "invalid value"). |
| BE-08 | 409 của `POST /inventory/load` không có mã đầu ("Batch is expired", "Slot must be ACTIVE for loading"), trong khi nạp theo phiếu có (`BATCH_EXPIRED: …`, `SLOT_INACTIVE: …`). | Dùng chung mã để FE và log thống nhất. |
| BE-09 | `POST /inventory/load` cho nạp lô sản phẩm khác vào ngăn đang có sản phẩm khác (cột lẫn 2 sản phẩm); nạp theo phiếu chặn `BATCH_PRODUCT_MISMATCH`. | Cần nghiệp vụ chốt; nếu không cho lẫn thì nạp trực tiếp cũng trả 409 cùng mã. |

---

## Cấu hình trước khi lên production

- `PASSWORD_MIN_LENGTH=12`.
- `PUBLIC_REPORT_BASE_URL`, `PUBLIC_REPORT_ALLOWED_ORIGINS`, `REPORT_IP_HASH_SECRET`, `REPORT_TRUSTED_PROXIES`. Thiếu
  `PUBLIC_REPORT_BASE_URL` thì kiosk nhận 409 `REPORT_LINK_NOT_CONFIGURED` và admin không xoay được token QR.
- Tắt hoặc bảo vệ Swagger (`/swagger-ui`, `/v3/api-docs`). Bản deploy `104.214.184.23:8080` đang mở công khai qua HTTP;
  nên đặt sau HTTPS (Caddy trong `compose.yaml`).
- `ORDER_RESERVATION_TTL`: local đang 600 s, mặc định 300 s.
- Đổi khóa payOS (đã bị dán vào chat) và secret webhook MOCK dev/staging (chuỗi cũ còn trong lịch sử git của FE).
- CORS: khai báo origin của web nếu web không chạy cùng origin với API.

## Đã đúng chuẩn production (giữ nguyên)

- Không lộ stack trace, tên class hay SQL ở mọi lỗi 400/401/403/404/409/413/415/429 đã thử.
- Header `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Cache-Control: no-store`.
- Phân quyền: STAFF bị 403 ở mọi API chỉ dành ADMIN; không token/token hỏng → 401.

## Chưa test được

- Thanh toán tới PAID và nhả hàng: BE local dùng `PAYMENT_PROVIDER=PAYOS` thật, test không tạo thanh toán. Cần môi trường
  `PAYMENT_PROVIDER=MOCK` + `PAYMENT_MOCK_WEBHOOK_SECRET` để kiểm.
- Gửi phản ánh hợp lệ: thiếu `PUBLIC_REPORT_BASE_URL`.
- Lệnh bảo trì chạy tới COMPLETED: không có máy online/firmware.

## Cách chạy lại bộ test của FE

1. BE ở `http://localhost:8080`; trong `apps/web`: `npx vite --port 5800` (proxy `/api` sang 8080).
2. Tạo `apps/web/.env.e2e-real` (không commit) với `REAL_ADMIN_EMAIL`, `REAL_ADMIN_PASSWORD`, `REAL_STAFF_EMAIL`,
   `REAL_STAFF_PASSWORD`, `REAL_KIOSK_KEY`, `REAL_MACHINE_ID`.
3. `npx playwright test -c playwright.real.config.ts` (thêm `-g "<ID>"` để chạy từng case).
