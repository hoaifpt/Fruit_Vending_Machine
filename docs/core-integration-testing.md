# Core Backend Integration Tests — Issue #24

## Phạm vi và môi trường

Kiểm tra M1 core management: Auth/JWT, ADMIN/STAFF, User, Product, Machine, Slot,
ProductBatch và Inventory. Không thêm API, đổi quyền, schema, business rules hay dependency.
Tất cả V1–V9 giữ nguyên. Không kết nối payment/MQTT/hardware hoặc database development.

Cần Java21, Maven và Docker đang chạy. Chạy từ module backend/:

```powershell
mvn --batch-mode --no-transfer-progress clean verify
```

Surefire chạy cả unit và integration tests theo convention *Test hiện có. Không có Failsafe
hoặc Maven wrapper trong repository; không dùng lệnh mvnw không tồn tại. Không skip tests,
không fallback H2. JVM tests dùng UTC theo pom; PostgreSQL18 do Testcontainers cấp connection.
Maven verify là regression gate trước handoff cho thay đổi phần mềm/môi trường.

## Hạ tầng dùng chung và isolation

- support/TestPostgres.create(): thống nhất image postgres:18, reuse=false. Các suites cũ
  dùng factory này nhưng giữ nguyên bootstrap/properties/assertions và lifecycle riêng.
- support/AbstractCoreIntegrationTest: Spring Boot + MockMvc + profile test, DB động từ
  Testcontainers, JWT key ngẫu nhiên, bootstrap ADMIN giả. spring.config.import rỗng qua
  test annotation để .env không được import ngay từ giai đoạn config loading.
- application-test.yml: Flyway bật, ddl-auto=validate, generate-ddl=false, SQL init tắt;
  documentation tắt mặc định cho các core tests. Các documentation tests cũ vẫn có overrides.
- support/TestDataFactory: tạo STAFF/login và domain fixtures qua controller/API thật,
  JWT thật, mã UUID riêng cho mỗi test. Không mock repositories/database/security.
- Mỗi class có disposable container, không mỗi method. Context đóng sau class qua
  DirtiesContext; Testcontainers dừng/xóa database khi kết thúc class/process.

Không dùng outer @Transactional trong HTTP/rollback/concurrency tests: transaction của
service phải commit/rollback thật. Mỗi test tự tạo preconditions, assertions lọc theo UUID
root của test; không dựa vào thứ tự chạy hoặc số lượng toàn database. Append-only history
không bị DELETE/TRUNCATE để cleanup giữa methods; container riêng được dọn cuối class.
Đây là isolation bằng fixtures + disposal, không dùng cleaner phá trigger lịch sử.

## Các lớp kiểm chứng bổ sung

| Suite mới | Hành vi kiểm tra |
| --- | --- |
| CoreManagementFlowIntegrationTest | Tạo STAFF/login, Product/Machine/Slot/Batch, load với cả ADMIN/STAFF, xác minh FK/actor/history/summary/filters/removal qua API và DB; deactivation/expiry, RBAC và safe DTO/errors |
| CoreDatabaseIntegrationTest | Flyway validate/migrate lại không đổi schema, 9 migrations/20 tables, URL DB thật, unique/FK/CHECK/RESTRICT và append-only history |
| InventoryDatabaseRollbackIntegrationTest | Lỗi SQL thật ở history insert thứ hai trả409/500; toàn bộ load4 rollback, client không thấy SQL nội bộ; bỏ fault rồi load lại thành công |
| InventoryConcurrentRequestsIntegrationTest | Capacity6 có4 hộp và batch20 có18 đăng ký: hai load2 chồng lấp, chỉ một201/một409, final6/final20 cùng history đúng |

Rollback dùng test-only trigger scoped theo batch UUID riêng trong DB disposable. Không
disable trigger production hoặc mock persistence. Function/trigger fault được DROP trong
finally; không để lại ảnh hưởng cho test khác. SQLSTATE55000 là append-only,
23505 unique, 23503 FK insertion, 23514 CHECK, 23001 ON DELETE RESTRICT.

Concurrency giữ khóa product bằng connection riêng, khởi động hai requests đồng thời và
quan sát pg_stat_activity cho đến khi cả hai transaction chờ khóa. Sau đó release lock và
kiểm response/database. Dùng latch/futures và timeout hữu hạn; không dùng Thread.sleep
để giả lập overlap hoặc gọi service tuần tự. pg_stat_activity polling chỉ quan sát lock;
LockSupport.parkNanos giảm busy polling, không quyết định thứ tự transaction.

MockMvc đi qua security/controller/service/JPA/PostgreSQL thật nhưng không mở TCP socket.
EntityMappingTest hiện có còn chạy server cổng ngẫu nhiên và kiểm health qua HTTP thật.

## Coverage tái sử dụng

| Nhóm | Suites hiện có |
| --- | --- |
| Login/JWT | AuthIntegrationTest, JwtServiceTest, JwtAuthenticationFilterTest |
| Role/account guards | AuthorizationIntegrationTest, UserManagementIntegrationTest |
| User/credentials | UserManagementIntegrationTest, UserRolePersistenceTest, bootstrap/policy tests |
| Product | ProductManagementIntegrationTest |
| Machine/Slot | MachineManagementIntegrationTest, MachineSlotManagementIntegrationTest |
| Batch | ProductBatchManagementIntegrationTest |
| Inventory | InventoryManagementIntegrationTest, InventoryHistoryMigrationTest |
| Schema/entities/runtime | EntityMappingTest, UserRolePersistenceTest |
| API docs/contracts | Các *DocumentationTest hiện có, bao gồm production docs disabled |

Không copy lại hàng trăm assertions theo feature. Tests mới tập trung khoảng trống liên
thông, DB fault atomicity, overlap quan sát được và direct PostgreSQL constraints.

## Chạy riêng, lặp lại và reports

```powershell
mvn '-Dtest=CoreManagementFlowIntegrationTest,CoreDatabaseIntegrationTest,InventoryDatabaseRollbackIntegrationTest,InventoryConcurrentRequestsIntegrationTest' test
mvn '-Dtest=InventoryConcurrentRequestsIntegrationTest' test
```

Mỗi lần dùng fixtures/container mới. Test không cần secrets .env, DB service cố định hoặc
hardware. Surefire reports ở backend/target/surefire-reports/, nêu class/method/assertion
và lỗi. Không catch/ignore failures; Maven thoát nonzero khi tests fail.

## GitHub Actions

.github/workflows/backend-tests.yml chạy trên PR tới dev/main và push dev/main/feature/**/
fix/** khi backend/contract/docs/workflow đổi; có workflow_dispatch. Runner ubuntu-24.04,
Java21 Temurin, Docker runtime check, Maven clean verify, upload reports với always().
Actions chính thức được pin SHA, token chỉ contents:read, không dùng shared DB/secrets.
Không continue-on-error hoặc maven.test.failure.ignore; build step fail làm job fail.
Unit/integration chạy cùng lifecycle, không bị loại khỏi CI. Reports retention14 ngày.

Workflow đã lint local bằng actionlint. Chạy local không chứng minh GitHub runner đã pass:
workflow phải được commit/push rồi xem run kết thúc và artifact reports trên GitHub.
Issue #24 chưa được phép publish nhánh; các mục yêu cầu chạy thực tế trên GitHub giữ
unchecked cho đến có bằng chứng remote. Không tự tạo PR, merge hoặc sửa issue checkboxes.

## Verification status

Local verification hoàn tất: full clean verify442 tests, không failure/error/skip;
11 core tests pass, lặp lại với thứ tự class/method ngẫu nhiên11 pass, chạy riêng một
batch race1 pass. PostgreSQL18 containers được dọn; actionlint1.7.12 pass. Tất cả
production/API/migrations/dependencies giữ nguyên, assertions của20 suites cũ không đổi.

Maven failure propagation đã được quan sát ở lượt test đầu (exit1), sau sửa assertions
đúng với datasource và RESTRICT thì pass. Workflow được cấu hình fail theo Maven và
upload reports luôn; chạy và failure behavior trên GitHub vẫn chưa xác minh. Có4 mục
remote CI chưa check, ghi rõ trong CURRENT_TASK.md. Chưa commit/push/PR/merge #24.
