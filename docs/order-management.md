# Order Management (Issue #27)

Phạm vi: xác thực kiosk bằng API key gắn với máy, catalog bán được, tạo đơn kèm giữ chỗ bát trái cây,
đọc/hủy đơn và tự động nhả đơn hết hạn. **Không** có thanh toán, QR, webhook, `PAID`/`DISPENSING`/
`COMPLETED`, dispense command, MQTT hay hoàn tiền. Đơn chỉ đi `PENDING_PAYMENT -> CANCELLED`.
Hợp đồng frontend: [`api-contract/api.yaml`](../api-contract/api.yaml).

## Chạy local và Swagger

1. Khởi động PostgreSQL theo README, đặt `API_DOCS_ENABLED=true` trong `.env` (chỉ môi trường dev).
2. Chạy backend module (`mvn spring-boot:run`), Swagger UI: `http://localhost:8080/swagger-ui/index.html`,
   OpenAPI: `http://localhost:8080/v3/api-docs`.
3. Swagger có hai scheme: `bearerAuth` (JWT ADMIN/STAFF) và `kioskKey` (header `X-Kiosk-Key`).
   Tag mới: **Kiosk Credentials**, **Kiosk**, **Kiosk Orders**, **Orders**.
4. ADMIN gọi `POST /api/v1/machines/{machineId}/kiosk-credentials`, copy `apiKey` (chỉ hiện một lần)
   vào nút Authorize của scheme `kioskKey`, rồi thử các API kiosk. Chỉ dùng dữ liệu dev, không có thanh
   toán hay phần cứng thật.

## Kiosk và user là hai loại khác nhau

| | User (ADMIN/STAFF) | Kiosk |
| --- | --- | --- |
| Credential | email + mật khẩu -> JWT | `X-Kiosk-Key: fvk_<prefix>_<secret>` |
| API | `/api/v1/**` quản lý | chỉ `/api/v1/kiosk/**` |
| Máy | không gắn | **luôn** suy ra từ credential, không nhận từ body |

Key: `fvk_` + 12 ký tự `[a-z0-9]` (prefix, UNIQUE, dùng tra cứu) + 32 byte `SecureRandom` base64url.
Lưu `key_prefix` và SHA-256 hex của secret; plaintext không được lưu. SHA-256 đủ vì secret 256-bit ngẫu nhiên
(BCrypt chỉ làm tốn CPU mỗi request); so sánh bằng `MessageDigest.isEqual`. Thiếu/sai định dạng/prefix lạ/đã thu hồi/
sai secret đều trả `401` giống nhau. Máy `INACTIVE`/`MAINTENANCE` vẫn xác thực được; trạng thái máy là quy tắc nghiệp vụ.

| Tình huống | Kết quả |
| --- | --- |
| Không credential trên `/kiosk/**` | 401 |
| User JWT trên `/kiosk/**` | 403 |
| Kiosk key trên API quản lý | 401 |
| Vừa JWT vừa kiosk key | 401 (mơ hồ nên từ chối) |
| STAFF trên `kiosk-credentials` (kể cả GET) | 403 |

## API

| Method | Endpoint | Quyền |
| --- | --- | --- |
| POST | `/api/v1/machines/{machineId}/kiosk-credentials` | ADMIN, cấp/xoay key (201, key trả một lần) |
| GET | `/api/v1/machines/{machineId}/kiosk-credentials` | ADMIN, metadata, không bao giờ trả key/hash |
| POST | `/api/v1/machines/{machineId}/kiosk-credentials/{credentialId}/revoke` | ADMIN, idempotent, máy khác -> 404 |
| GET | `/api/v1/orders`, `/api/v1/orders/{id}` | ADMIN, STAFF (không có API ghi/xóa/đổi trạng thái); danh sách có `itemCount` = số dòng sản phẩm và `totalQuantity` = tổng số bát |
| GET | `/api/v1/kiosk/me` | KIOSK |
| GET | `/api/v1/kiosk/catalog` | KIOSK |
| POST | `/api/v1/kiosk/orders` | KIOSK, tạo đơn và giữ chỗ |
| GET | `/api/v1/kiosk/orders/{orderId}` | KIOSK, đơn của máy mình (máy khác -> 404) |
| POST | `/api/v1/kiosk/orders/{orderId}/cancel` | KIOSK, `PENDING_PAYMENT -> CANCELLED`, idempotent |

Cấp key mới khóa dòng máy, thu hồi key ACTIVE cũ và tạo key mới trong một transaction; key cũ mất hiệu lực ngay.

## Catalog

Bát bán được: `AVAILABLE`, có slot `ACTIVE` của chính máy, batch còn hạn **sau** hạn giữ chỗ (`now + ttl`), product `ACTIVE`;
máy phải `ACTIVE`, nếu không `acceptingOrders=false` và danh sách rỗng. Một câu truy vấn gộp theo product; không lộ slot, item
hay batch. `availableQuantity` chỉ là ảnh chụp, không phải giữ chỗ.

## Tạo đơn

Body: `{"items":[{"productId":"...","quantity":2}]}` — 1..10 dòng, productId không trùng, `quantity` là số nguyên >= 1
(không nhận `1.5` hay `"2"`), tổng không vượt `app.order.max-total-quantity`. Mọi field khác (`machineId`, giá, `status`,
`orderCode`, id slot/item) bị từ chối (400). Giá lấy từ DB tại thời điểm tạo và là snapshot bất biến trong `order_items`.
Mã đơn: `ORD-<yyyyMMdd UTC>-<8 ký tự Crockford base32>`, thử lại tối đa 3 lần, DB UNIQUE là chốt cuối.

Thuật toán (một transaction, hoặc tất cả hoặc không): khóa product (FOR SHARE, theo id) -> khóa máy (FOR SHARE) -> với mỗi
product chọn bát bằng `FOR UPDATE OF item SKIP LOCKED` theo FEFO (`batch.expires_at`, `loaded_at`, `id`), batch phải sống lâu
hơn `expiresAt` -> tạo order, order_items, allocation `RESERVED`, item `RESERVED` và history `RESERVE`. Lỗi: 400 sai request, 404 product
không tồn tại, 409 product không ACTIVE / máy không ACTIVE / thiếu hàng (không giữ gì).

## Hủy và hết hạn

Hủy (kiosk) hoặc sweep: khóa order, `PENDING_PAYMENT -> CANCELLED`, allocation `RELEASED`, item `RESERVED -> AVAILABLE`
(`reserved_at = NULL`), history `RETURN` với lý do `ORDER_CANCELLED` hoặc `RESERVATION_EXPIRED`. Thứ tự khóa: Order -> InventoryItem.
Sweep (`app.order.expiry-sweep.*`) lấy tối đa `batch-size` đơn đến hạn, mỗi đơn một transaction riêng, khóa rồi kiểm tra lại, nên an toàn khi
chạy song song với hủy hoặc nhiều instance và một đơn lỗi không chặn đơn khác. Đọc đơn không ghi: đơn quá hạn vẫn hiện
`PENDING_PAYMENT` cho tới khi sweep chạy (kiosk dùng `expiresAt` để đếm ngược).

## Cấu hình

| Biến | Mặc định | Ý nghĩa |
| --- | --- | --- |
| `ORDER_RESERVATION_TTL` | `PT5M` | thời gian giữ chỗ |
| `ORDER_MAX_TOTAL_QUANTITY` | `5` | tổng số bát tối đa mỗi đơn |
| `ORDER_EXPIRY_SWEEP_ENABLED` | `true` | bật scheduler (profile test tắt) |
| `ORDER_EXPIRY_SWEEP_INTERVAL` | `PT30S` | chu kỳ sweep |
| `ORDER_EXPIRY_SWEEP_BATCH_SIZE` | `50` | số đơn mỗi lượt |

Giá trị không hợp lệ làm ứng dụng dừng khi khởi động.

## Database (V10, V11)

Xem `.ai/DATABASE.md` mục 11. V10 tạo `kiosk_credentials` (partial UNIQUE một ACTIVE mỗi máy, giữ lịch sử thu hồi); V11 thêm
`orders.expires_at` (nullable, `expires_at > created_at`, index partial cho `PENDING_PAYMENT`). V1–V9 không đổi.

## Kiểm thử

`mvn clean verify` (Java 21 + Docker). Lớp mới trong `src/test/java/.../order`: `KioskCredentialIntegrationTest`,
`KioskCatalogIntegrationTest`, `OrderCreationIntegrationTest`, `OrderCancelExpiryIntegrationTest`,
`OrderManagementReadIntegrationTest`, `OrderConcurrencyIntegrationTest` (giao dịch PostgreSQL thật, nhiều thread/connection),
`OrderSchemaIntegrationTest` và `OrderManagementDocumentationTest` (Swagger/OpenAPI khớp `api-contract/api.yaml`).
Test dùng `OffsetClock` (chỉ chạy tiến) và gọi `OrderExpiryService.sweep()` trực tiếp; scheduler tắt ở profile test.
