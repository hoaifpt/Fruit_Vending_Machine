# Payment Service (Issue #29)

Phạm vi: tầng thanh toán độc lập nhà cung cấp. Kiosk tạo hoặc dùng lại một **payment attempt** (QR) cho đơn `PENDING_PAYMENT`
của chính máy mình; ADMIN xem danh sách/chi tiết payment; đơn bị hủy hoặc hết hạn thì attempt đang chờ chuyển `EXPIRED`.
**Không** có provider thật (PayOS/MoMo/VNPay), webhook, `PENDING -> SUCCESS`, `Order -> PAID`, hoàn tiền hay dispense.
Không client nào (kiosk, frontend, ADMIN, ESP32) đánh dấu được payment thành công; chỉ webhook đã xác thực của issue sau mới làm được.
Hợp đồng frontend: [`api-contract/api.yaml`](../api-contract/api.yaml).

## Chạy local và Swagger

1. Đặt `API_DOCS_ENABLED=true` trong `.env`, chạy backend (`mvn spring-boot:run`, JDK 21).
2. Swagger UI `http://localhost:8080/swagger-ui/index.html`, OpenAPI `http://localhost:8080/v3/api-docs`. Tag mới: **Kiosk Payments**, **Payments**.
3. Dùng provider `MOCK` (mặc định, không gọi mạng): ADMIN cấp kiosk key (xem `order-management.md`), nhập vào scheme `kioskKey`, tạo đơn rồi
   gọi `POST /api/v1/kiosk/orders/{orderId}/payments`. Chỉ dùng dữ liệu dev, không có tiền thật.

## API

| Method | Endpoint | Quyền |
| --- | --- | --- |
| POST | `/api/v1/kiosk/orders/{orderId}/payments` | KIOSK, không có body; 201 attempt mới, 200 dùng lại |
| GET | `/api/v1/kiosk/orders/{orderId}` | KIOSK, có thêm `currentPayment` (attempt gần nhất hoặc `null`) |
| GET | `/api/v1/payments` | ADMIN, phân trang DB, lọc `status/provider/orderId/machineId/createdFrom/createdTo`, sort `createdAt` (mặc định desc), `amount`, `paidAt` |
| GET | `/api/v1/payments/{id}` | ADMIN, kèm `qrCode` (danh sách không có `qrCode`) |
| GET | `/api/v1/orders/{id}` | ADMIN, STAFF, có thêm `payments[]` (tóm tắt, không có `qrCode`/`paymentReference`/`transactionId`) |

Không có `PATCH /payments/{id}/status`, `POST /payments/{id}/success` hay `DELETE`. Đường dẫn webhook của issue sau nằm ngoài `/api/v1/payments/**`
(`POST /api/v1/webhooks/payments/{provider}`) để matcher ADMIN không chồng lên webhook công khai. STAFF vào `/api/v1/payments/**` bị 403, kiosk key bị 401,
user JWT trên endpoint kiosk bị 403. **Kiosk nên poll `GET /api/v1/kiosk/orders/{orderId}` mỗi 2-3 giây.** Đọc đơn không ghi dữ liệu.

## Tạo attempt: 3 bước, không giữ transaction khi gọi provider

| Bước | Transaction | Việc làm |
| --- | --- | --- |
| 1 `prepare` | có | khóa order (`FOR UPDATE`), kiểm tra đúng máy (404), `PENDING_PAYMENT` (409), còn ít nhất `min-remaining-hold` trước `expires_at` (409); khóa mọi attempt của đơn, attempt `PENDING` quá `expired_at` -> `EXPIRED`; còn attempt `PENDING` có QR -> dùng lại (200); `PENDING` chưa có QR -> 409; đủ `max-attempts-per-order` -> 409; chèn attempt `PENDING` |
| 2 | **không** | `PaymentGateway.createPayment(...)` chạy với timeout `provider-timeout` (ngắt được); `PaymentService` từ chối chạy nếu đang trong transaction |
| 3 `complete` | có | khóa order rồi payment; payment không còn `PENDING` (ví dụ đơn bị hủy lúc đang gọi provider) -> không sửa gì, 409; thành công -> lưu `qr_code` (và rút `expired_at` nếu provider có hạn sớm hơn), 201; lỗi/timeout/QR rỗng -> `FAILED`, 502 |

Bước 1 và 3 là hai method transactional trên bean riêng (`PaymentAttemptTransactions`) nên được gọi qua proxy Spring, không tự gọi nội bộ.
`amount` luôn bằng `orders.total_amount`; mọi giá trị từ client (body) bị bỏ qua. `expired_at = min(order.expires_at, now + attempt-ttl)` nên QR không bao giờ sống lâu hơn
phần giữ chỗ hàng. `payment_reference` do gateway sinh (mỗi provider có quy tắc riêng) và duy nhất theo `(provider, payment_reference)` (V12).
Lỗi provider chỉ trả `502` với thông báo chung; không ghi log secret, body hay QR của provider.

## Trạng thái payment

```text
PENDING -> FAILED   (provider lỗi/timeout)
PENDING -> EXPIRED  (hết hạn attempt, hoặc đơn bị hủy/hết hạn)
```

`PENDING -> SUCCESS` và `SUCCESS -> REFUNDED` thuộc issue sau. `FAILED/EXPIRED` không đổi trạng thái đơn; đơn vẫn `PENDING_PAYMENT` cho đến khi
bị hủy/hết hạn (hoặc được thanh toán ở issue sau) và kiosk có thể tạo attempt mới khi đơn còn thanh toán được. Không có trạng thái `CANCELLED` của payment và
trạng thái đơn `PAYMENT_FAILED` chưa được dùng. Khi attempt không còn `PENDING`, `qrCode` trong response kiosk là `null`. Chuyển trạng thái tập trung ở `PaymentTransitions`.

## Hủy và hết hạn đơn

Luồng nhả chỗ của #27 (`OrderReservationService.release`) giờ sau khi khóa order sẽ khóa các payment `PENDING` và chuyển `EXPIRED`, rồi mới nhả bát:
**thứ tự khóa Order -> Payment -> InventoryItem** (khớp tài liệu `.ai/DATABASE.md` mục 12). Không gọi provider để hủy QR.

## Gateway và cấu hình

`PaymentService -> PaymentGateway` (`MockPaymentGateway` ở issue này; `PayOsPaymentGateway` ở issue sau). Đúng một gateway hoạt động theo `app.payment.provider`
(`PaymentGatewayRegistry`); provider lạ hoặc `MOCK` ở profile `prod` làm ứng dụng không khởi động. `MOCK` chỉ để dev/test: `provider()=MOCK`,
`newPaymentReference()="MOCK-"+8 ký tự`, QR `MOCK-QR|<reference>|<amount>`, không gọi mạng và không bao giờ đánh dấu đã trả.

| Biến | Mặc định | Ý nghĩa |
| --- | --- | --- |
| `PAYMENT_PROVIDER` | `MOCK` | provider đang dùng |
| `PAYMENT_ATTEMPT_TTL` | `PT5M` | thời hạn một attempt (bị chặn bởi hạn giữ chỗ đơn) |
| `PAYMENT_MIN_REMAINING_HOLD` | `PT30S` | thời gian giữ chỗ tối thiểu còn lại để được bắt đầu thanh toán |
| `PAYMENT_MAX_ATTEMPTS_PER_ORDER` | `5` | số attempt tối đa mỗi đơn |
| `PAYMENT_PROVIDER_TIMEOUT` | `PT10S` | timeout gọi provider |

Giá trị không hợp lệ làm ứng dụng dừng khi khởi động. Không đặt credential provider trong `application.yaml`.

## Database (V12)

`uq_payments_provider_reference`: UNIQUE `(provider, payment_reference)` khi `payment_reference IS NOT NULL`, để webhook sau này tìm attempt theo reference của ta.
Tạo thất bại ồn ào nếu dữ liệu cũ vi phạm (không sửa/xóa dữ liệu). `payments` không có `updated_at` và không thêm. V1-V11 không đổi.

## Kiểm thử

`mvn clean verify` (JDK 21 + Docker). Lớp mới trong `src/test/java/.../payment`: `PaymentAttemptIntegrationTest`, `PaymentLifecycleIntegrationTest`
(gồm race tạo attempt với hủy đơn), `PaymentManagementIntegrationTest`, `PaymentSchemaIntegrationTest`, `PaymentConfigurationTest`,
`PaymentServiceDocumentationTest`. Test dùng `ControllableGateway` (provider `TESTPAY`, điều khiển thành công/lỗi/timeout/hook giữa lúc gọi, đo số session
"idle in transaction" khi gọi provider) và `OffsetClock` chỉ chạy tiến. Bản `ProductionDocumentationTest` dùng `TESTPAY` vì prod cấm MOCK.
