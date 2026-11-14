# Phản ánh sự cố của khách hàng (issue #74, WF-02)

Khách đứng ở máy bấm **"Báo sự cố"** trên kiosk, quét QR, gửi một form công khai ngắn trên điện thoại (không cần tài khoản).
Backend lưu phản ánh, đối chiếu với đơn hàng khi có mã đơn, tạo hoặc gắn vào **work order INCIDENT**, báo cho Admin và đưa các
trường hợp cần hoàn tiền vào danh sách "Cần hoàn tiền" (#72).

```text
Kiosk ── GET /kiosk/incident-report-link (X-Kiosk-Key) ──> https://<web>/report/{reportToken}[?order=ORD-…]
Điện thoại ── GET /public/report-forms/{reportToken} ──> tên máy, loại phản ánh
           ── POST /public/report-forms/{reportToken}/reports (multipart) ──> RPT-20261114-7KQ2
Backend: đối chiếu đơn → verdict → work order INCIDENT (mới hoặc gắn vào cái đang mở) → thông báo Admin
         → PAID_NOT_RECEIVED + DISPENSE_FAILED + đã trả → ứng viên hoàn tiền CUSTOMER_REPORT
Admin: xem, hoàn tiền hoặc giao Staff, giải quyết / từ chối (spam)
```

Không làm ở đây: giao diện form (frontend), tài khoản khách, trang theo dõi trạng thái, trả lời qua email/SMS, thu số tài khoản
ngân hàng, CAPTCHA, giới hạn tốc độ nhiều instance, lưu ảnh trên object storage, job xóa dữ liệu liên hệ / ảnh.

## Link QR của máy

| Method | Endpoint | Quyền |
| --- | --- | --- |
| `GET` | `/api/v1/kiosk/incident-report-link?orderCode=` | `ROLE_KIOSK` |
| `POST` | `/api/v1/machines/{id}/report-token/rotate` | `MACHINE_REPORT_LINK_MANAGE` (ADMIN) |

- URL = `app.public-report.base-url` (`PUBLIC_REPORT_BASE_URL`) + `/{reportToken}` (+ `?order=ORD-…` chỉ khi mã đơn thuộc máy của kiosk,
  không thì bỏ qua). Chưa cấu hình base-url → 409 `REPORT_LINK_NOT_CONFIGURED`.
- `machines.report_token` khác kiosk key và id máy: chỉ cho phép gửi phản ánh cho máy đó. Máy mới / có sẵn nhận token 32 ký tự ngẫu nhiên
  từ default của database (`gen_random_uuid`, không cần pgcrypto); xoay vòng tạo token base64url 22 ký tự (128 bit) và QR cũ hết hiệu
  lực ngay (404). Có audit `MACHINE_REPORT_TOKEN_ROTATED`. Token không xuất hiện trong response máy.

## API công khai (không xác thực)

`SecurityConfig`: `permitAll` chỉ cho `/api/v1/public/**`; JWT filter bỏ qua đường dẫn này (token cũ trong trình duyệt không chặn khách).
CORS chỉ cho các origin trong `PUBLIC_REPORT_ALLOWED_ORIGINS` (GET, POST, header `Content-Type`). Request tối đa 7 MB (lớn hơn → 413).

### Thông tin form

`GET /api/v1/public/report-forms/{reportToken}` → `machineName`, `machineCode`, `types`, `maxPhotos` (3), `maxPhotoBytes` (2 MB).
Token không tồn tại / đã xoay / máy INACTIVE → 404 cùng một nội dung.

### Gửi phản ánh

`POST /api/v1/public/report-forms/{reportToken}/reports`, `multipart/form-data`: phần `report` (JSON, `application/json`) và 0..3 `photos`.

```json
{ "type": "PAID_NOT_RECEIVED", "orderCode": "ORD-20261114-K7QF2M9A",
  "description": "Đã chuyển khoản nhưng máy không ra hàng",
  "contactName": "An", "contactPhone": "0901234567", "contactEmail": null,
  "consent": true, "website": "" }
```

| Trường | Quy tắc |
| --- | --- |
| `type` | `PAID_NOT_RECEIVED`, `PRODUCT_QUALITY`, `MACHINE_FAULT`, `OTHER` |
| `orderCode` | bắt buộc với PAID_NOT_RECEIVED; dạng `ORD-yyyyMMdd-[0-9A-Z]{8}` (không phân biệt hoa thường, chuẩn hóa chữ hoa) |
| `description` | 1..1000 ký tự, bắt buộc trừ PAID_NOT_RECEIVED; bỏ khoảng trắng hai đầu, xóa ký tự điều khiển (giữ xuống dòng) |
| liên hệ | PAID_NOT_RECEIVED, PRODUCT_QUALITY: cần phone hoặc email; phone `^(0\|\+84)[0-9]{9,10}$`; email dạng đơn giản ≤ 254; tên ≤ 100 |
| `consent` | phải `true` (form hiển thị thông báo quyền riêng tư) |
| `website` | honeypot: có giá trị → 201 với mã giả, không lưu gì |
| ảnh | ≤ 3, mỗi ảnh ≤ 2 MB; nhận diện JPEG/PNG theo **magic bytes** (bỏ qua tên file và content type khai báo); ≤ 4000×4000 px (kiểm tra trước khi giải mã); giải mã rồi **mã hóa lại** → mất mọi metadata (EXIF, GPS…) |
| field lạ | 400 |

Kết quả: `201 { "reportCode": "RPT-20261114-7KQ2", "message": "Đã ghi nhận…" }` — giống hệt nhau cho mọi lần gửi hợp lệ, không
bao giờ tiết lộ đơn có tồn tại hay trạng thái thanh toán.

### Giới hạn tốc độ

```yaml
app.public-report:
  rate-limit-per-minute: ${REPORT_RATE_LIMIT_PER_MINUTE:5}            # gửi / phút / nguồn
  rate-limit-per-machine-per-hour: ${REPORT_RATE_LIMIT_PER_MACHINE_HOUR:60}
  form-rate-limit-per-minute: ${REPORT_FORM_RATE_LIMIT_PER_MINUTE:30} # GET form / phút / nguồn
  trusted-proxies: ${REPORT_TRUSTED_PROXIES:}                          # địa chỉ chính xác, phân tách dấu phẩy
  ip-hash-secret: ${REPORT_IP_HASH_SECRET:}
```

- Nguồn = địa chỉ client: `X-Forwarded-For` chỉ được dùng khi địa chỉ kết nối là một trusted proxy (lấy mục ngoài cùng bên phải không
  phải proxy tin cậy).
- Vượt giới hạn → 429 + `Retry-After` (giây). Đếm trong `HandlerInterceptor` trước khi đọc / kiểm tra body, nên gửi sai hàng loạt cũng
  bị chặn. Cửa sổ trượt trong bộ nhớ (một instance backend).
- `source_ip_hash` = HMAC-SHA256(ip, `REPORT_IP_HASH_SECRET`); không bao giờ lưu hay log IP gốc. Không đặt secret → secret ngẫu nhiên mỗi
  lần khởi động (cảnh báo trong log; hash không so được giữa các lần chạy). **Staging / production phải đặt secret.**

## Xử lý phản ánh (một transaction, thông báo sau commit)

### Đối chiếu đơn (PAID_NOT_RECEIVED, PRODUCT_QUALITY có mã đơn)

Đơn phải thuộc máy của phản ánh và được tạo trong 7 ngày gần nhất (tính từ đầu ngày giờ VN); không thì `ORDER_NOT_FOUND`.

| Đơn / thanh toán | verdict |
| --- | --- |
| REFUNDED, hoặc payment trả đơn đã REFUNDED | `ALREADY_REFUNDED` |
| PAID / DISPENSING / còn lệnh nhả chưa xong | `DISPENSE_PENDING` |
| DISPENSE_FAILED, payment trả đơn SUCCESS | `REFUND_ELIGIBLE` |
| COMPLETED | `DELIVERED_PER_MACHINE` |
| CANCELLED có payment SUCCESS (trả trễ) | `REFUND_ELIGIBLE` |
| PENDING_PAYMENT / CANCELLED chưa trả / PAYMENT_FAILED | `NOT_PAID` |
| MACHINE_FAULT / OTHER, PRODUCT_QUALITY không có mã đơn | `NOT_APPLICABLE` |

PRODUCT_QUALITY với đơn COMPLETED → `batch_id` = lô của tô đã bán (allocation DISPENSED).

### Work order

1. Cùng đơn đã có phản ánh NEW / IN_REVIEW với work order chưa xong → phản ánh mới gắn vào work order đó, trạng thái `IN_REVIEW`,
   thêm sự kiện NOTE, **không** thông báo mới.
2. MACHINE_FAULT / OTHER khi máy đang có work order INCIDENT nguồn CUSTOMER_REPORT chưa xong → gắn vào đó (NOTE "New customer report RPT-…").
3. Còn lại → `createBySystem(INCIDENT, CUSTOMER_REPORT, máy, "[RPT-…] <loại>", tóm tắt, ưu tiên, hạn = bây giờ + 24 h)`; ưu tiên
   PAID_NOT_RECEIVED / MACHINE_FAULT → HIGH, PRODUCT_QUALITY → NORMAL, OTHER → LOW. Thông báo theo #66 (work order hệ thống chưa giao →
   mọi người có `WORK_ORDER_MANAGE`), một lần.

Thông tin liên hệ không bao giờ có trong tiêu đề / mô tả work order, sự kiện, thông báo, audit hay log.

### Hoàn tiền (#72)

- Ứng viên hoàn tiền loại `CUSTOMER_REPORT` = payment SUCCESS của đơn có phản ánh NEW / IN_REVIEW với verdict `REFUND_ELIGIBLE` hoặc
  `DELIVERED_PER_MACHINE` (Admin tự đánh giá ca chất lượng). Mỗi ứng viên có `customerReport {id, reportCode, verdict, contactName,
  contactPhone, contactEmail}` (đã che) và `relatedWorkOrder`. Danh sách không lọc giữ loại riêng (DISPENSE_FAILED, LATE_PAYMENT…)
  và vẫn kèm `customerReport` khi đơn có phản ánh.
- Ghi nhận hoàn tiền cho đơn (`POST /payments/{id}/refund`) → trong cùng transaction, mọi phản ánh đang mở của đơn → `RESOLVED`,
  resolution `REFUNDED`, `resolved_by` = Admin hoàn tiền, có audit.

## API quản trị

| Method | Endpoint | Quyền |
| --- | --- | --- |
| `GET` | `/api/v1/customer-reports` (status, type, verdict, machineId, from, to, hasOrder, page, size) | `CUSTOMER_REPORT_READ` |
| `GET` | `/api/v1/customer-reports/{id}` | `CUSTOMER_REPORT_READ` |
| `GET` | `/api/v1/customer-reports/{id}/photos/{photoId}` | `CUSTOMER_REPORT_READ` |
| `POST` | `/api/v1/customer-reports/{id}/review` | `CUSTOMER_REPORT_MANAGE` (NEW → IN_REVIEW) |
| `POST` | `/api/v1/customer-reports/{id}/resolve` | `CUSTOMER_REPORT_MANAGE` (`FIXED`, `NO_ACTION_NEEDED`, `REFUNDED`) |
| `POST` | `/api/v1/customer-reports/{id}/reject` | `CUSTOMER_REPORT_MANAGE` (`SPAM`, `DUPLICATE`) |

- Danh sách: mới nhất trước, phân trang trong DB, `from` / `to` là ngày giờ VN của `createdAt`; liên hệ luôn bị che (`090****567`,
  `a***@example.com`). Chi tiết: liên hệ đầy đủ chỉ cho người có `CUSTOMER_REPORT_MANAGE`; kèm đơn, lô, ảnh (id, loại, dung lượng),
  work order, kết quả xử lý.
- Không có `CUSTOMER_REPORT_MANAGE` (STAFF): chỉ thấy phản ánh gắn với work order được giao cho mình, liên hệ bị che; còn lại 404.
- Ảnh: trả đúng Content-Type đã lưu, `Content-Disposition: inline`, `X-Content-Type-Options: nosniff`, `Cache-Control: private, no-store`.
- RESOLVED / REJECTED là cuối → 409 `REPORT_ALREADY_CLOSED`; review khi không NEW → 409 `REPORT_NOT_NEW`; resolution sai nhóm → 400.
  Mỗi lần đổi trạng thái ghi `audit_logs` (`CUSTOMER_REPORT_REVIEWED` / `_RESOLVED` / `_REJECTED`).
- Work order (#66) có `linkedReports [{id, code, type, verdict, status}]` (không có dữ liệu liên hệ).

## Database (V24)

`machines.report_token` (backfill, NOT NULL, UNIQUE, CHECK `^[A-Za-z0-9_-]{22,32}$`), `customer_reports` (loại, verdict, trạng thái,
kết quả xử lý với CHECK; PAID_NOT_RECEIVED cần mã đơn; loại khác cần mô tả; RESOLVED / REJECTED ⇔ có resolution và resolved_at),
`customer_report_photos` (JPEG / PNG, 1..2 MB, bytea, xóa theo phản ánh). Quyền `CUSTOMER_REPORT_READ` (ADMIN, STAFF),
`CUSTOMER_REPORT_MANAGE`, `MACHINE_REPORT_LINK_MANAGE` (ADMIN). Chi tiết: [database-migration.md](database-migration.md).

## Cấu hình triển khai

| Biến | Ý nghĩa |
| --- | --- |
| `PUBLIC_REPORT_BASE_URL` | route form trên web, vd `https://staging.freshvend.vn/report` |
| `PUBLIC_REPORT_ALLOWED_ORIGINS` | origin của web app được gọi API công khai (CORS) |
| `REPORT_IP_HASH_SECRET` | secret HMAC cho hash IP (bắt buộc đặt ở staging / production) |
| `REPORT_TRUSTED_PROXIES` | địa chỉ reverse proxy (Caddy / nginx) để dùng `X-Forwarded-For` |
| `REPORT_RATE_LIMIT_PER_MINUTE`, `REPORT_RATE_LIMIT_PER_MACHINE_HOUR`, `REPORT_FORM_RATE_LIMIT_PER_MINUTE` | giới hạn tốc độ |

Frontend cần: trang form công khai `/report/{token}` (đọc `?order=`), màn hình QR "Báo sự cố" trên kiosk và màn hình nhả lỗi (có mã đơn).

## Kiểm thử

`CustomerReportIntegrationTest` (schema, gửi từng loại, token sai / đã xoay / máy INACTIVE, validation, honeypot, ảnh theo nội dung +
xóa EXIF / GPS + giới hạn, phản hồi giống nhau, không cần xác thực + CORS, giới hạn 5/phút, X-Forwarded-For tin cậy, 60/giờ/máy và
30/phút cho form, mọi verdict, đơn máy khác / quá 7 ngày, lô sản phẩm, work order + thông báo một lần, gắn vào work order đang mở,
ứng viên hoàn tiền + tự đóng khi hoàn, danh sách / che liên hệ, STAFF, review / resolve / reject + audit, header ảnh, kiosk link và
xoay token), `CustomerReportDocumentationTest` (Swagger ↔ `api-contract/api.yaml`).
