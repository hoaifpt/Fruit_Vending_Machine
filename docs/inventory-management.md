# Inventory Management — Issue #22

API dành cho ADMIN/STAFF, xác nhận nạp/lấy hộp đã thực hiện tại máy. Một hộp là một
InventoryItem; không điều khiển motor, giữ hàng, thanh toán hay nhả hàng.

## Schema thực tế và migration

Đã đọc V3/V6/V7 trước triển khai. inventory_items có batch_id bắt buộc, slot_id nullable
cho hàng chưa ở máy và không có machine_id. inventory_transactions V6 có id,
inventory_item_id, machine_id, slot_id, type, reference_id, performed_by, created_at.
Không có quantity, batch_id, lý do hay trạng thái trước/sau.

V9 thêm reason VARCHAR(500), status_before/status_after VARCHAR(24), nullable và CHECK
phù hợp. Dòng cũ giữ NULL vì không thể suy ra sự kiện quá khứ. V1–V8, composite FK
MATCH FULL và trigger chặn UPDATE/DELETE/TRUNCATE giữ nguyên. Batch của sự kiện được
đọc qua item FK. Không xóa item hoặc sửa lịch sử để sửa sai.

Nạp N hộp tạo N items và N dòng LOAD chung reference_id = operationId do server tạo.
LOAD có status_before NULL, status_after AVAILABLE. REMOVE ghi reason, actor, trạng thái
trước/sau và snapshot vị trí. Actor lấy từ JWT đã xác thực, không nhận từ body.
operationId không phải idempotency key: gửi lại load có thể tạo thêm hộp nếu giới hạn cho phép.

## API

Mọi response dùng ApiResponse/common error hiện có và Cache-Control: no-store.

| Method | Path | Nội dung |
| --- | --- | --- |
| GET | /api/v1/inventory | Phân trang, lọc machineId/slotId/batchId/status/expired |
| GET | /api/v1/inventory/{id} | Chi tiết item, trạng thái và thời gian hết hạn |
| GET | /api/v1/machines/{machineId}/inventory | Tồn kho máy, kiểm máy tồn tại |
| GET | /api/v1/machines/{machineId}/slots/{slotId}/inventory | Tồn kho slot, sai máy trả 404 |
| GET | /api/v1/machines/{machineId}/slots/{slotId}/inventory/summary | Thống kê slot từ DB |
| POST | /api/v1/inventory/load | Tạo N items và lịch sử, trả 201 |
| POST | /api/v1/inventory/{id}/remove | Xác nhận lấy hộp và ghi lịch sử, trả 200 |
| GET | /api/v1/inventory/transactions | Lịch sử, lọc inventoryItemId/machineId/slotId/referenceId/type |

Load body chỉ nhận batchId, slotId, quantity. quantity là JSON integer 1..1000;
1000 là giới hạn bulk request, capacity slot và số lượng batch vẫn phải thỏa mãn.
Remove body chỉ nhận reason, strip khoảng trắng ngoài, bắt buộc 1..500 ký tự.
Field do server quản lý hoặc field lạ đều bị từ chối 400.

Page bắt đầu từ 0, mặc định size20, tối đa100. List inventory hỗ trợ sort
id/status/loadedAt/createdAt/updatedAt với asc/desc, mặc định createdAt,desc và UUID
làm khóa phụ ổn định. Scoped lists/history dùng thứ tự mặc định. expired là kiểm tra
batch.expiresAt <= server time, độc lập với stored status.

401 thiếu/sai JWT; 403 thiếu role hoặc account không được phép; 400 input không hợp lệ;
404 batch/slot/item hoặc scoped parent không tồn tại; 409 vi phạm trạng thái/số lượng.
Không có DELETE hoặc PATCH tùy ý trạng thái inventory.

## Quy tắc tồn kho

Nạp chỉ khi product ACTIVE, batch chưa hết hạn, slot ACTIVE, machine ACTIVE hoặc
MAINTENANCE. Không tự kích hoạt máy/slot. Khóa Product -> Batch -> Machine -> Slot,
kiểm tra và ghi item/history cùng transaction. Lỗi history làm rollback tất cả.

Capacity đếm AVAILABLE, RESERVED, EXPIRED, DISPENSE_FAILED đang chiếm chỗ; SOLD/REMOVED
giữ slot lịch sử nhưng không chiếm chỗ. Giới hạn batch đếm tất cả items đã đăng ký,
kể cả SOLD/REMOVED. Không giảm hoặc sửa product_batches.quantity khi lấy hàng.

Lấy chỉ cho AVAILABLE/EXPIRED, khóa Slot -> Item, giữ vị trí cuối, ghi removedAt và
lịch sử. SOLD/REMOVED/RESERVED/DISPENSE_FAILED trả409; các trạng thái chưa rõ kết quả
vật lý cần workflow đối soát ở issue sau. Dữ liệu legacy chưa có slot vẫn đọc/lấy được
với snapshot location cả hai ID NULL; API load mới luôn gắn một slot hiện hữu.

Summary trong một SQL statement snapshot trả capacity, occupiedCount, availableCount,
expiredCount, reservedCount, sellableCount, remainingCapacity, asOf:

- occupiedCount: bốn trạng thái vật lý trên.
- availableCount: AVAILABLE và batch còn hạn, chưa xét trạng thái product/machine/slot.
- sellableCount: available và cả product/machine/slot ACTIVE.
- expiredCount: items vật lý có batch hết hạn hoặc status EXPIRED.
- reservedCount: RESERVED; có thể đồng thời thuộc expiredCount.
- remainingCapacity: max(0, capacity - occupiedCount).

Không lưu counter tồn kho và không chạy job đổi status; expired AVAILABLE vẫn chiếm
chỗ nhưng không sellable. Query dùng DB pagination/filter và to-one entity graphs.

## Chạy và kiểm thử local

Từ root repository, cấu hình .env theo .env.example (không commit secrets), khởi động
PostgreSQL theo docs/database-migration.md. Đặt API_DOCS_ENABLED=true trong .env và
JWT_SECRET/INITIAL_ADMIN_* hợp lệ. Từ module backend/ chạy mvn spring-boot:run
(plugin đã cấu hình JVM UTC). Nếu chạy JAR trực tiếp, dùng java -Duser.timezone=UTC -jar
target/backend-0.0.1-SNAPSHOT.jar để tránh timezone alias Asia/Saigon khi JDBC kết nối.
Flyway áp dụng V9 trước Hibernate validate. Không dùng ddl-auto=update hay Flyway repair.

- Swagger UI: http://localhost:8080/swagger-ui/index.html
- OpenAPI: http://localhost:8080/v3/api-docs
- Contract version-controlled: api-contract/api.yaml.

Đăng nhập qua Auth, dùng Authorize bearer token, tạo product/batch/machine/slot qua API
đã có; chủ động đổi machine/slot ACTIVE. Inventory load không thực hiện thay bước đó.
Dùng dữ liệu giả để thử load2, đọc summary, remove một hộp rồi đọc history theo
operationId/itemId. Không gửi load lại chỉ vì giao diện chưa nhận response.
Production profile vô hiệu hóa documentation.

Tự động: mvn clean verify dùng PostgreSQL18 Testcontainers. InventoryManagementIntegrationTest
kiểm tra atomicity, capacity/batch concurrency, expiry, role guards, query và removal;
InventoryHistoryMigrationTest kiểm nâng V8 -> V9 với lịch sử cũ;
InventoryManagementDocumentationTest so sánh Swagger với contract cho 8 operations/13 schemas.
Browser Try it out chưa được xác minh trong môi trường agent vì browser kernel không khởi tạo.
