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

Mỗi slot là một **cột dọc**: chỉ bát ở **đáy cột (head)** rơi ra được. Head của slot là bát còn nằm trong máy
(`AVAILABLE`, `RESERVED`, `EXPIRED`, `DISPENSE_FAILED`) có `loaded_at` sớm nhất, hòa thì theo `id`; bát `SOLD`/`REMOVED` không còn trong cột.
Giả định (cần phần cứng xác nhận): cột được nạp từ trên xuống nên nạp trước = nằm dưới = rơi trước; các bát cùng một lần nạp có cùng
`loaded_at`, cùng batch nên thay thế được cho nhau.

Slot **bán được** khi head `AVAILABLE`, batch của head còn hạn **sau** hạn giữ chỗ (`now + ttl`), product `ACTIVE`, slot `ACTIVE`, máy `ACTIVE`.
Head `RESERVED` (đang có người trả tiền), `EXPIRED`, `DISPENSE_FAILED`, hoặc `AVAILABLE` nhưng hết hạn / sắp hết hạn trong lúc giữ chỗ
sẽ **chặn cả cột**: các bát phía sau không bán được dù còn tươi.

Catalog chỉ liệt kê product có ít nhất một slot bán được với head là product đó; máy không `ACTIVE` thì `acceptingOrders=false` và danh sách rỗng.
`availableQuantity` (chỉ để hiển thị, không phải giữ chỗ) = số bát `AVAILABLE` của product, còn hạn sau `now + ttl`, nằm trong các slot có head
bán được của chính product đó. Một câu SQL gộp (`DISTINCT ON` tìm head), không nạp item vào Java; không lộ slot, item hay batch.
Trường `maxTotalQuantity` đã bị bỏ (issue #35).

## Tạo đơn

**Một đơn = một bát** (ràng buộc phần cứng). Body: `{"productId":"<uuid>"}`, bắt buộc. Mọi field khác (`items`, `quantity`, `machineId`, giá,
`status`, `orderCode`, id slot/item) bị từ chối (400). **Breaking change của issue #35**: dạng cũ `{"items":[...]}` trả 400; ứng dụng kiosk
(chưa phát hành) phải gửi dạng mới, cần thống nhất với người làm kiosk. Response giữ nguyên dạng và luôn có đúng một item `quantity = 1`,
`subtotal = totalAmount = unitPrice`. Giá lấy từ DB tại thời điểm tạo và là snapshot bất biến trong `order_items`.
Mã đơn: `ORD-<yyyyMMdd UTC>-<8 ký tự Crockford base32>`, thử lại tối đa 3 lần, DB UNIQUE là chốt cuối.

Thuật toán (một transaction): khóa product (FOR SHARE) -> khóa máy (FOR SHARE) -> tìm các slot của máy đang chứa product rồi khóa
chúng `FOR UPDATE` theo id -> tính lại head của từng slot dưới khóa, giữ slot bán được -> chọn slot có head hết hạn sớm nhất (FEFO **giữa các head**,
không bao giờ bên trong một cột), hòa thì theo `loaded_at` của head, `slot_code`, id slot -> khóa head `FOR UPDATE`, kiểm tra lại `AVAILABLE` và hạn
-> tạo order, một order_item (quantity 1, snapshot giá), head `AVAILABLE -> RESERVED`, một allocation `RESERVED`, một history `RESERVE`.
Bát không phải head **không bao giờ** được giữ, nên mỗi slot có tối đa một bát `RESERVED`. Khóa ở mức slot (không còn `SKIP LOCKED` theo item)
vì "một reservation mỗi slot" và "chỉ head" là luật của slot: hai đơn đồng thời trên cùng slot phải xếp hàng trên slot.
Lỗi: 400 sai request, 404 product không tồn tại, 409 product không ACTIVE / máy không ACTIVE / không slot nào có head bán được
("Requested product is not available on this machine"; không giữ gì).

## Hủy và hết hạn

Hủy (kiosk) hoặc sweep: khóa order, `PENDING_PAYMENT -> CANCELLED`, allocation `RELEASED`, item `RESERVED -> AVAILABLE`
(`reserved_at = NULL`), history `RETURN` với lý do `ORDER_CANCELLED` hoặc `RESERVATION_EXPIRED`. Thứ tự khóa: Order -> Payment -> InventoryItem.
Bát được trả lại vẫn là head của cột (không đổi `loaded_at`) nên đơn kế tiếp giữ lại đúng bát đó.
Sweep (`app.order.expiry-sweep.*`) lấy tối đa `batch-size` đơn đến hạn, mỗi đơn một transaction riêng, khóa rồi kiểm tra lại, nên an toàn khi
chạy song song với hủy hoặc nhiều instance và một đơn lỗi không chặn đơn khác. Đọc đơn không ghi: đơn quá hạn vẫn hiện
`PENDING_PAYMENT` cho tới khi sweep chạy (kiosk dùng `expiresAt` để đếm ngược).

## Cấu hình

| Biến | Mặc định | Ý nghĩa |
| --- | --- | --- |
| `ORDER_RESERVATION_TTL` | `PT5M` | thời gian giữ chỗ |
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

## Một bát mỗi đơn và head của slot (issue #35)

- Không đổi schema: `order_items` / `order_item_allocations` vẫn cho nhiều dòng (dữ liệu lịch sử của #27 vẫn đọc được qua API quản lý,
  `itemCount`/`totalQuantity` giữ nguyên, luôn bằng 1 với đơn mới). Luật một bát do DTO và service đảm bảo; không thêm CHECK `quantity = 1`.
- `app.order.max-total-quantity` / `ORDER_MAX_TOTAL_QUANTITY` đã bị xóa.
- Thứ tự khóa: tạo đơn Product -> Machine -> Slot -> InventoryItem; nạp hàng Product -> Batch -> Machine -> Slot; gỡ hàng Slot -> Item;
  hủy/hết hạn Order -> Payment -> InventoryItem. Không có vòng khóa.
- Inventory summary của slot có thêm `headStatus` (`AVAILABLE | RESERVED | EXPIRED | DISPENSE_FAILED | null` khi trống) và `headExpired`
  (head có status `EXPIRED` hoặc batch đã hết hạn) để nhân viên thấy bát đáy hết hạn đang chặn cột. Các trường cũ không đổi.
- Ảnh hưởng Milestone 3 (chỉ ghi nhận, chưa làm): một đơn -> một allocation -> một lệnh dispense -> một slot; "hoàn tất đơn sau khi mọi lệnh
  thành công" thu gọn còn một lệnh.
