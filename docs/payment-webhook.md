# Payment Webhook (Issue #33)

Webhook là thông báo server-tới-server do nhà cung cấp thanh toán gửi khi đã nhận tiền. Đây là **đường duy nhất** có thể tạo `payment PENDING -> SUCCESS` và
`order PENDING_PAYMENT -> PAID`. Không có `dispense command`, không `SOLD`, không `DISPENSING/COMPLETED`, không hoàn tiền, không job đối soát.
Hợp đồng frontend: [`api-contract/api.yaml`](../api-contract/api.yaml). Liên quan: [payment-service.md](payment-service.md), [payment-provider.md](payment-provider.md), [order-management.md](order-management.md).

## Ranh giới tin cậy

Endpoint công khai: ai trên Internet cũng gọi được. Chỉ **chữ ký đã xác thực** chứng minh provider gửi; tham chiếu và số tiền khớp mới chứng minh thông báo nói về payment này.
Không bao giờ tin: kiosk/màn hình cảm ứng, ESP32, frontend, `returnUrl`/`cancelUrl`, body webhook chưa xác thực.

```text
POST /api/v1/webhooks/payments/{provider}
  -> đọc nguyên văn body (UTF-8, tối đa 64 KB), chưa bind DTO
  -> gateway.verifyWebhook(rawBody, headers)            (PAYOS hoặc MOCK)
  -> ghi 1 dòng payment_webhook_logs (transaction RIÊNG)
  -> chưa xác thực: 401, dừng
  -> đã xác thực + có sự kiện: xử lý idempotent (Order -> Payment)
  -> 200
```

- `{provider}` không phân biệt hoa thường và **phải là provider đang hoạt động** (`payos` khi `PAYMENT_PROVIDER=PAYOS`), nếu không `404`. Content-Type không phải JSON -> `415`; body > 64 KB -> `413`.
- Security: `permitAll` **chỉ** cho `POST /api/v1/webhooks/payments/*`. Không có JWT/kiosk key; `GET` vào đường dẫn này không được xử lý (401, hoặc 405 nếu đã đăng nhập).
- Ba trường hợp không ghi log (chưa tới bước xác thực): `404`, `413`, `415`. Mọi attempt đã tới bước xác thực đều được ghi.

## Chính sách phản hồi

Provider **retry khi nhận non-2xx**, nên chỉ trả lỗi khi retry có ích.

| Tình huống | Phản hồi | Lý do |
| --- | --- | --- |
| Đã xác thực, đã xử lý | `200` | xong |
| Đã xác thực, trùng lặp | `200` | no-op idempotent |
| Đã xác thực, tham chiếu không biết | `200` | retry không sửa được; có log (payOS dùng kiểu này cho payload thử của `confirm-webhook`) |
| Đã xác thực, bất thường (muộn/trùng/lệch tiền/xung đột txn) | `200` | cần người xem xét, không phải retry |
| Xác thực thất bại hoặc body lỗi | `401` | không phải từ provider |
| Provider lạ | `404` | |
| Body quá lớn | `413` | |
| Không phải JSON | `415` | |
| Lỗi nội bộ bất ngờ (ví dụ DB down) | `500` | retry có ích |

Body phản hồi tối thiểu, không lộ chi tiết nội bộ. Provider-specific acknowledgement: mặc định `{"success":true}`.

## Bằng chứng: `payment_webhook_logs`

Ghi **trước** xử lý nghiệp vụ, trong transaction riêng (`REQUIRES_NEW`), nên vẫn còn khi nghiệp vụ rollback.

| Cột | Giá trị |
| --- | --- |
| `provider` | provider đang hoạt động (chuẩn hóa) |
| `raw_body` | nguyên văn body (ký tự NUL, vốn PostgreSQL không lưu được, được thay bằng U+FFFD) |
| `raw_payload` | JSON đã parse, hoặc `NULL` nếu body không phải JSON hợp lệ |
| `signature` | chữ ký như nhận được (header hoặc trường body) |
| `is_verified` | kết quả xác thực |
| `event_type` | `PAYMENT_SUCCESS`, `PAYMENT_FAILED` hoặc `UNKNOWN` |
| `order_code` | **gợi ý tham chiếu của provider, không đáng tin** (payOS `orderCode`), tối đa 64 ký tự, dài hơn thì `NULL`; **không** phải `orders.order_code` |

Không có FK tới `orders`/`payments` và không có cột trạng thái xử lý: một dòng log **không** phải bằng chứng thanh toán và **không** làm guard idempotency. Không bao giờ ghi body, chữ ký hay secret vào log ứng dụng.

## Xử lý một sự kiện đã xác thực (một transaction)

```text
1. tìm payment theo (provider, paymentReference)   (chỉ lấy id, chưa khóa)   không thấy -> WARN (chỉ tham chiếu), 200
2. khóa order  FOR UPDATE
3. khóa payment FOR UPDATE                          (thứ tự khóa: Order -> Payment -> InventoryItem)
4. kiểm tra số tiền bằng BigDecimal.compareTo       lệch -> không đổi gì, anomaly PAYMENT_AMOUNT_MISMATCH, 200
5. áp dụng sự kiện
6. commit
7. sau commit: hủy link (best effort) của các attempt bị EXPIRED ở bước 5
```

**SUCCESS** (`transaction_id = event.transactionId`, `paid_at` = giờ server, không sớm hơn `created_at`):

| Payment hiện tại | Hành động |
| --- | --- |
| `PENDING` / `FAILED` / `EXPIRED` | -> `SUCCESS` (tiền thật đã nhận, nên bản ghi phản ánh thực tế dù đơn không còn thực hiện được) |
| `SUCCESS`, cùng transaction id | trùng lặp, no-op |
| `SUCCESS`, transaction id khác | không đổi, anomaly `PAYMENT_TRANSACTION_CONFLICT` |
| `REFUNDED` | không đổi, WARN |

Vi phạm unique `(provider, transaction_id)` (txn đã dùng cho payment khác): rollback giao dịch nghiệp vụ, ghi anomaly `PAYMENT_TRANSACTION_CONFLICT` ở transaction mới, trả `200`.

Sau khi payment thành `SUCCESS`:

| Order hiện tại | Hành động |
| --- | --- |
| `PENDING_PAYMENT` | -> `PAID`, `paid_at`; các attempt `PENDING` khác -> `EXPIRED` (link provider bị hủy sau commit, lý do `ORDER_PAID`); bát và allocation **vẫn `RESERVED`** (kể cả khi đã quá `expires_at` mà sweep chưa chạy) |
| `CANCELLED` | đơn giữ nguyên, **không đặt chỗ lại**, anomaly `PAYMENT_LATE` (cần hoàn tiền) |
| `PAID`/`DISPENSING`/`COMPLETED`/khác | đơn giữ nguyên, anomaly `PAYMENT_DUPLICATE` (cần hoàn tiền) |

Khóa order bảo đảm đúng một bên thắng giữa webhook, kiosk hủy và sweep: webhook trước -> `PAID` (sweep bỏ qua vì chỉ xử lý `PENDING_PAYMENT`); sweep/hủy trước -> `CANCELLED` và webhook đi nhánh `PAYMENT_LATE`.
Webhook cũng không mất cập nhật khi tới giữa lúc tạo attempt (bước 2 của #29): bước 3 thấy attempt không còn `PENDING`, trả 409 và không hủy link đã được trả tiền.

**FAILED**: `PENDING -> FAILED`; trạng thái khác không đổi; đơn không đổi (kiosk có thể tạo attempt mới). payOS thường chỉ báo thành công; `FAILED` chủ yếu được MOCK dùng.

### Hạn chế đã biết

Đơn `PAID` giữ bát `RESERVED` cho đến khi có luồng dispense (Milestone 3); **chưa có timeout cho PAID**. `PAID` nghĩa là "backend đã xác minh thanh toán", **không** cho phép kiosk xuất hàng trong milestone này.

## Bất thường (anomaly)

Ghi một dòng `audit_logs` cho mỗi bất thường: `user_id = NULL` (hệ thống), `entity_type = "Payment"`, `entity_id = payment.id`, `old_value` = trạng thái payment/order trước, `new_value` = trạng thái sau cộng `transactionId`, `amountReceived`, `amountExpected`; kèm một dòng WARN chỉ có id và loại. Không tự hoàn tiền, không tạo alert.

| `action` | Khi nào |
| --- | --- |
| `PAYMENT_LATE` | tiền về cho đơn đã `CANCELLED` |
| `PAYMENT_DUPLICATE` | tiền về lần nữa cho đơn đã được thanh toán |
| `PAYMENT_AMOUNT_MISMATCH` | số tiền webhook khác `payments.amount` (payment không đổi) |
| `PAYMENT_TRANSACTION_CONFLICT` | transaction id trùng payment khác hoặc khác payment đã `SUCCESS` |

Tham chiếu không biết không có payment id nên chỉ xem được trong webhook log.

## API quản lý (ADMIN)

| Endpoint | Mô tả |
| --- | --- |
| `GET /api/v1/payment-webhook-logs` | phân trang DB; lọc `provider`, `verified`, `reference` (khớp chính xác cột `order_code`), `receivedFrom` (gồm), `receivedTo` (không gồm); sắp xếp `receivedAt` (mặc định desc) hoặc `provider` |
| `GET /api/v1/payment-webhook-logs/{id}` | thêm `rawPayload` (JSON) hoặc `rawBody` (chỉ khi body không phải JSON). **Không bao giờ** trả `signature` |
| `GET /api/v1/payments?requiresAttention=true` | payment `SUCCESS` mà đơn `CANCELLED` (muộn) hoặc đơn có payment `SUCCESS` khác (trùng; cả hai đều xuất hiện, payment có `paidAt` muộn hơn là ứng viên hoàn tiền) |

STAFF -> 403, kiosk key -> 401. Không có replay, mark-paid hay delete. Lệch số tiền không đổi payment nên **không** nằm trong `requiresAttention`; tìm qua webhook log và `audit_logs` (`PAYMENT_AMOUNT_MISMATCH`).

## Kiosk

Không có endpoint mới: `GET /api/v1/kiosk/orders/{orderId}` giờ trả `status: PAID` và `currentPayment.status: SUCCESS` (không có `qrCode`).

## Thử cục bộ với MOCK (không có tiền thật)

MOCK chỉ dùng khi phát triển và test (bị cấm ở profile `prod`). Đặt `PAYMENT_MOCK_WEBHOOK_SECRET` trong `.env` (giá trị tự chọn, **không** dùng secret thật); để trống thì mọi webhook MOCK đều bị từ chối. Ký đúng **các byte** sẽ gửi:

```bash
BODY='{"paymentReference":"MOCK-8F3KQ2","transactionId":"MOCK-TXN-0001","amount":105000.00,"status":"SUCCESS"}'
SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$PAYMENT_MOCK_WEBHOOK_SECRET" -hex | sed 's/^.* //')
curl -i -X POST http://localhost:8080/api/v1/webhooks/payments/mock \
  -H 'Content-Type: application/json' -H "X-Mock-Signature: $SIG" --data-binary "$BODY"
```

`paymentReference` lấy từ `payments.payment_reference` của attempt (kiosk trả `qrCode` dạng `MOCK-QR|<reference>|<amount>`), `amount` phải bằng tổng đơn. Chỉ cần đổi một byte (kể cả khoảng trắng) là chữ ký không còn khớp. Với `status`: `SUCCESS` hoặc `FAILED`.
Trong Swagger UI, gửi body như trên và thêm header `X-Mock-Signature` ở bước gọi thủ công (ví dụ trong tài liệu chỉ dùng giá trị giả).

## Dữ liệu thử nhanh: `scripts/payment_test_data.py`

Script Python (chỉ thư viện chuẩn) gọi API của backend **đang chạy**, giống web quản lý và kiosk; không đụng DB hay schema. State (id và kiosk key) lưu ở
`~/.fruitmachine/payment-test-data.json`, **ngoài repo** nên không thể bị commit. Đặt `FVM_ADMIN_EMAIL`/`FVM_ADMIN_PASSWORD` (hoặc để script hỏi, mật khẩu không hiện, không lưu).

```bash
python scripts/payment_test_data.py seed            # máy ACTIVE, slot A1..A4, sản phẩm 2000/5000/10000/35000.50 VND, lô hàng, tồn kho, kiosk key
python scripts/payment_test_data.py order           # đơn mới (mặc định A1 = 2000 VND) + payment attempt, in QR payload
python scripts/payment_test_data.py status --watch  # poll như kiosk mỗi 3 giây đến khi PAID/CANCELLED
python scripts/payment_test_data.py cancel          # kiosk hủy đơn gần nhất
python scripts/payment_test_data.py mock-pay        # chỉ với MOCK: gửi webhook đã ký cho attempt mới nhất
```

`order --product A4` dùng giá lẻ: với PAYOS phải trả `409`. `mock-pay --amount 1` thử lệch tiền, `mock-pay --status FAILED` thử thất bại, `cancel` rồi `mock-pay` thử thanh toán muộn
(`PAYMENT_LATE`), `--transaction <id>` dùng lại một transaction id để thử xung đột. **Với `PAYMENT_PROVIDER=PAYOS`, lệnh `order` tạo link payOS thật**: dùng giá nhỏ, nguyên VND, rồi quét QR bằng app ngân hàng.

Lưu ý khi tự chạy backend trên Windows: nếu JVM dùng múi giờ `Asia/Saigon`, PostgreSQL 18 từ chối kết nối (`invalid value for parameter "TimeZone"`). Chạy với `-Duser.timezone=UTC`,
ví dụ `mvn spring-boot:run -Dspring-boot.run.jvmArguments="-Duser.timezone=UTC"` (test tự động đã đặt sẵn qua Surefire).

## payOS

Chữ ký nằm trong trường `signature` của body, tính trên đối tượng `data` đã chuẩn hóa (xem [payment-provider.md](payment-provider.md)); `PayOsPaymentGateway.verifyWebhook` dùng `PayOsWebhookVerifier` và `PayOsWebhookParser`. Cần URL HTTPS công khai: dùng tunnel (ngrok/cloudflared) và đăng ký
`https://<host>/api/v1/webhooks/payments/payos` ở dashboard payOS hoặc `POST /confirm-webhook`; payOS gửi payload thử có tham chiếu không biết và endpoint trả `200`. Đăng ký lại mỗi khi URL tunnel đổi.
Cách chuẩn hóa chữ ký webhook vẫn **chưa được đối chiếu với một webhook thật** (xem payment-provider.md); các mục kiểm thử thủ công với payOS thật được để trống nếu chưa có quyền truy cập.

## Kiểm thử

`PaymentWebhookEndpointIntegrationTest` (xác thực, giới hạn, log, bảo mật), `PaymentWebhookProcessingIntegrationTest` (thành công, idempotent, bất thường, FAILED, `requiresAttention`), `PaymentWebhookRaceIntegrationTest`
(webhook với sweep/hủy/bước 3, nhiều thread trên PostgreSQL thật), `PaymentWebhookRollbackIntegrationTest` (log còn khi nghiệp vụ lỗi, 500), `PaymentWebhookLogManagementIntegrationTest`, `MockWebhookSchemeTest`, `MockWebhookIntegrationTest`,
`PayOsWebhookIntegrationTest` (webhook ký bằng khóa test), `PaymentWebhookDocumentationTest` (Swagger khớp `api.yaml`) và `DotenvIsolationTest` (test không bao giờ đọc `.env` của lập trình viên: Surefire đặt `APP_DOTENV_IMPORT` trỏ tới file không tồn tại).
