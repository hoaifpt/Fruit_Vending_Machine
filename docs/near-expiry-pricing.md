# Giảm giá hàng sắp hết hạn (issue #61)

Bát trái cây thuộc lô **hết hạn trong ngày kinh doanh hôm nay** (múi giờ `Asia/Ho_Chi_Minh`) được bán giảm giá (mặc định
**50 %**) để bán hết thay vì bỏ đi. Admin bật/tắt và đổi phần trăm khi hệ thống đang chạy.

```text
hôm nay 13/11, giá sản phẩm 35.000, giảm 50 %
bát thuộc lô hết hạn 13/11 18:00 → 17.500
bát thuộc lô hết hạn 14/11 08:00 → 35.000
đơn tạo 23:58 ngày 13/11 giá 17.500 → vẫn 17.500 sau nửa đêm
Admin đổi sang 30 % lúc 15:00 → đơn tạo sau 15:00 trả 24.500; đơn trước đó giữ nguyên
```

## Quy tắc (một chỗ duy nhất: `NearExpiryPricingService`)

```text
hôm nay      = ngày của thời điểm hiện tại trong app.business-zone
eligible     = setting bật VÀ ngày hết hạn của lô (cùng múi giờ) == hôm nay
giá trả      = eligible ? floor(giá gốc × (100 − percent) / 100) : giá gốc     (làm tròn xuống đồng nguyên; payOS chỉ nhận VND nguyên)
chốt giá     = lúc tạo đơn, theo đúng bát được giữ (dưới khóa dòng); không tính lại khi tạo thanh toán, thử lại, hết hạn, webhook
đổi setting  = áp dụng ngay cho catalog và đơn mới; đơn cũ không đổi
```

Câu SQL của catalog (`InventoryItemRepository.findCatalog`) áp dụng cùng quy tắc với tham số `dayStart`, `dayEnd`, `enabled`,
`percent`; `NearExpiryPricingIntegrationTest` kiểm tra SQL và Java cho cùng kết quả (giá lẻ, phần trăm 1–90).

## Múi giờ kinh doanh

`app.business-zone` (`BUSINESS_ZONE`, mặc định `Asia/Ho_Chi_Minh`); sai múi giờ → ứng dụng không khởi động. `BusinessCalendar`
(dựa trên `Clock`) cho `today`, `dayStart`, `dayEnd`. Database và JDBC vẫn UTC.

- Mã đơn `ORD-yyyyMMdd-…` dùng ngày kinh doanh: đơn 00:00–06:59 giờ Việt Nam không còn mang ngày hôm trước. Mã cũ giữ nguyên.
- Không đổi: mã đơn gửi payOS (chỉ cần duy nhất) và `PayOsWebhookParser` (đã đọc giờ Việt Nam).
- Chưa có API báo cáo doanh thu (F-09); khi làm, gom ngày theo `BusinessCalendar` và trả thêm tổng giảm giá.

## Setting (Admin)

| Method | Endpoint | Quyền |
| --- | --- | --- |
| `GET` | `/api/v1/pricing/near-expiry-discount` | `PRICING_READ` (ADMIN, STAFF) |
| `PUT` | `/api/v1/pricing/near-expiry-discount` | `PRICING_MANAGE` (ADMIN) |

```json
PUT  { "enabled": true, "percent": 50, "version": 3 }
200  { "enabled": true, "percent": 50, "version": 4, "updatedAt": "…", "updatedBy": { "id": "…", "fullName": "…" },
       "businessZone": "Asia/Ho_Chi_Minh" }
```

- `percent` số nguyên 1–90 (0, 91, 50.5, `"50"` → 400); thiếu field hoặc field lạ → 400.
- `version` khác bản đang lưu (người khác vừa sửa) → 409.
- Giá trị không đổi → 200, giữ nguyên version, không ghi audit.
- Mỗi thay đổi: một dòng `audit_logs` (`PRICING_NEAR_EXPIRY_UPDATED`, entity `PRICING_SETTINGS`, old/new `{enabled, percent}`,
  user, IP). Đọc theo từng request, không cache.

## API thay đổi

| API | Thay đổi |
| --- | --- |
| `GET /api/v1/kiosk/catalog` | `price` = giá **bát kế tiếp** (head FEFO sẽ được giữ nếu đặt ngay); thêm `originalPrice`, `discountPercent`, `discountReason` (`NONE`/`NEAR_EXPIRY`). `availableQuantity` không đổi (có thể lẫn giá). Chỉ hiện badge/gạch giá khi `discountPercent > 0`. |
| Đơn kiosk (tạo, xem, hủy) | mỗi dòng thêm `originalUnitPrice`, `discountPercent`, `discountReason`; đơn thêm `discountAmount`. Kiosk hiển thị `totalAmount` của đơn trước khi tạo QR (có thể khác catalog: qua nửa đêm, đổi setting, đổi head). |
| `GET /api/v1/orders`, `/{id}` | thêm `discountAmount` (danh sách, chi tiết), các field giảm giá trên dòng; filter `discounted=true|false`. |
| Inventory items | thêm `discountEligibleToday` (cùng quy tắc, setting hiện tại, bát chưa hết hạn). |
| Mã đơn | ngày theo múi giờ kinh doanh thay vì UTC. |

Frontend cần biết: nghĩa của `price` trong catalog đã đổi; cần màn hình Admin cho setting (ngoài phạm vi backend).

## Database (V18)

- `pricing_settings`: một dòng duy nhất (`singleton` UNIQUE + CHECK), seed `enabled = TRUE`, `percent = 50`; CHECK percent 1–90,
  `version` cho optimistic check, `updated_by` → users.
- `orders.discount_amount` (mặc định 0) + CHECK `0 ≤ discount_amount ≤ subtotal` và `total_amount = subtotal − discount_amount`.
- `order_items.original_unit_price` (backfill = `unit_price`), `discount_percent` (0–90), `discount_reason` (`NONE`/`NEAR_EXPIRY`)
  + CHECK `unit_price ≤ original_unit_price`, `NONE` ⇔ percent 0 và giá bằng giá gốc.
- Nghĩa: `subtotal` = tổng giá gốc, `discount_amount` = giảm, `total_amount` = số tiền thu (số tiền thanh toán, không đổi nghĩa).
- Migration dừng với thông báo rõ nếu có đơn cũ `total_amount <> subtotal` (không bao giờ sửa số tiền đã thu).
- Quyền `PRICING_READ` (ADMIN, STAFF), `PRICING_MANAGE` (ADMIN).

## Kiểm thử

`NearExpiryPricingRuleTest` (clock cố định: múi giờ, mã đơn, làm tròn, biên ngày), `NearExpiryPricingIntegrationTest` (API setting,
catalog FEFO, đơn, thanh toán, qua nửa đêm, filter, inventory, CHECK), `NearExpiryPricingMigrationTest` (backfill trên DB có đơn,
dừng khi dữ liệu sai), `NearExpiryPricingDocumentationTest` (Swagger = `api.yaml`).
