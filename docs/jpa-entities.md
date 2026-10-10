# Entity JPA theo schema Flyway

SQL V1–V9 là nguồn schema. Không sửa migration để phù hợp entity và không thêm bảng/cột ngoài
migration. Entity nằm trong `com.fruitmachine.backend.<feature>.entity`, enum trong
`com.fruitmachine.backend.<feature>.enums`; các superclass dùng chung nằm ở `common.entity`.
User/Role thuộc user; ProductBatch thuộc product; MachineEvent thuộc machine;
OrderItemAllocation thuộc order; AuditLog thuộc audit. Java 21, Spring Boot 3.5.14, Hibernate 6.6.49.Final,
Flyway 11.20.1; dependencies được khai báo tại `backend/pom.xml`.

## Quản lý schema

`backend/src/main/resources/application.yaml`:

```yaml
spring:
  jpa:
    generate-ddl: false
    hibernate:
      ddl-auto: validate
  flyway:
    enabled: true
  sql:
    init:
      mode: never
```

Spring Boot chạy Flyway trước khi xây EntityManagerFactory. Hibernate validate bảng/cột/type
và thất bại khi mapping không khớp; không dùng create/update/create-drop. CHECK constraints,
partial indexes, composite FK, trigger, defaults và role seed vẫn do Flyway quản lý.
`validate` không phải công cụ kiểm toán đầy đủ index, CHECK, nullability hoặc varchar length;
SQL migrations và bộ kiểm thử SQL vẫn là nguồn kiểm chứng cho các ràng buộc đó.

## Mapping bảng và quan hệ

| Bảng | Entity | Quan hệ owning |
| --- | --- | --- |
| users | User | roleMemberships là inverse của UserRole.user |
| roles | Role | userMemberships là inverse của UserRole.role |
| user_roles | UserRole | user, role; @EmbeddedId UserRoleId + @MapsId |
| machines | Machine | slots là inverse của MachineSlot.machine |
| machine_slots | MachineSlot | machine; inventoryItems inverse |
| products | Product | batches inverse |
| product_batches | ProductBatch | product, createdBy nullable; inventoryItems inverse |
| inventory_items | InventoryItem | batch, slot nullable; allocations inverse; không machine_id |
| sensor_readings | SensorReading | machine |
| alerts | Alert | machine, resolvedBy nullable |
| orders | Order | machine; items/payments inverse |
| order_items | OrderItem | order, product; allocations inverse |
| order_item_allocations | OrderItemAllocation | orderItem, inventoryItem |
| payments | Payment | order, nhiều attempts |
| payment_webhook_logs | PaymentWebhookLog | không FK order/payment; orderCode chỉ là scalar |
| dispense_commands | DispenseCommand | UUID orderId/machineId/slotId/inventoryItemId ghi FK kép; navigation read-only |
| inventory_transactions | InventoryTransaction | inventoryItem, performedBy nullable; UUID machineId/slotId ghi snapshot; slot navigation read-only; V9 reason/statusBefore/statusAfter nullable |
| machine_events | MachineEvent | machine |
| audit_logs | AuditLog | user nullable; entityId là UUID đa hình, không association |

Tất cả @ManyToOne/@OneToMany dùng LAZY. Không cascade REMOVE/ALL và không orphanRemoval.
Không dựng collection cho mỗi bảng sensor/event/history có lưu lượng lớn; truy vấn phân trang
sẽ thuộc repository khi triển khai sau. UserRole là entity của join table, không cần một
@ManyToMany khác ghi cùng bảng. Khi thêm membership, persist UserRole riêng với user/role.
Các collection inverse không tự persist con; phải đặt owning relationship và persist con riêng.
Issue #5 thêm UserRepository/RoleRepository, RoleName cho known names và getRoles() dẫn xuất,
read-only. Fetch user cùng roles bằng graph roleMemberships.role; không thêm mapping ghi thứ hai
cho user_roles. Xem [user-role-persistence.md](user-role-persistence.md).

### Composite foreign keys

DispenseCommand mapping đúng ba composite FK trong V6:

- (order_id, machine_id) → orders(id, machine_id).
- (slot_id, machine_id) → machine_slots(id, machine_id).
- (inventory_item_id, slot_id) → inventory_items(id, slot_id).

Vì machine_id và slot_id được dùng trong nhiều associations, các cột UUID scalar là nơi duy
nhất ghi dữ liệu. `order`, `slot`, `inventoryItem`, `machine` là navigation read-only
(insertable=false/updatable=false), không có setter. Khi tạo command, đặt bốn UUID scalar:

```java
DispenseCommand command = new DispenseCommand();
command.setCommandCode(commandCode);
command.setOrderId(order.getId());
command.setMachineId(machine.getId());
command.setSlotId(slot.getId());
command.setInventoryItemId(inventoryItem.getId());
entityManager.persist(command);
```

InventoryTransaction tương tự: đặt machineId/slotId snapshot hoặc cả hai NULL theo MATCH FULL.
Các FK thực trong DB bảo đảm tính nhất quán, kể cả khi ghi bằng SQL ngoài JPA. Associations
read-only và scalar mirrors MachineSlot.machineId / Order.machineId / InventoryItem.slotId
được hydrate khi reload/refresh; không giả định chúng tự đồng bộ ngay sau khi đổi owning field.
Khi đổi UUID scalar trên entity đang managed, flush rồi refresh/reload trước dùng navigation.
Không đổi slot/machine của bản ghi lịch sử hoặc item đã có command để tránh vi phạm FK.

## Kiểu dữ liệu, trạng thái và timestamp

- UUID cho business PK với GenerationType.UUID; JPA tạo UUID trước INSERT. Default
  gen_random_uuid() trong SQL vẫn hỗ trợ các insert ngoài JPA. Sensor dùng Long + IDENTITY
  đúng BIGINT GENERATED ALWAYS AS IDENTITY; không thêm sequence riêng.
- NUMERIC dùng BigDecimal với precision/scale đúng migration: 12,2 cho tiền; 5,2 cho cảm biến
  và ngưỡng. Quantity/capacity dùng Integer. Không dùng double cho tiền.
- TIMESTAMPTZ dùng Instant; Hibernate JDBC timezone UTC. Với bảng có cả created_at/updated_at,
  UpdatedEntity kế thừa common.entity.BaseEntity dùng @CreatedDate/@LastModifiedDate và
  AuditingEntityListener. JpaConfig cung cấp clock UTC với microsecond precision. Với bảng chỉ
  có created_at, CreatedEntity vẫn đọc default DB qua @Generated(INSERT). received_at webhook
  đọc từ default DB tương tự. UUID superclass nằm trong common.entity.UuidEntity.
- InventoryTransaction @Immutable chống dirty-update của Hibernate. created_at riêng dùng
  @CreationTimestamp (JVM, trước INSERT) để tránh lỗi Hibernate khi refresh DB-generated value
  trên immutable entity. Trigger append-only trong V6 vẫn bảo vệ UPDATE/DELETE/TRUNCATE ở DB.
  @Immutable không ngăn remove/bulk/native SQL; các lệnh này bị DB trigger từ chối.
- Sensor recordedAt và alert triggeredAt có thể đặt thời gian sự kiện thật; mặc định Instant.now()
  nếu caller chưa cung cấp. Không dùng @CreationTimestamp cho sensor vì cần giữ event time.
- Status/type có CHECK được mapping bằng 13 Java enums, EnumType.STRING + JDBC VARCHAR.
  Provider, role.name và machine eventType giữ String vì vocabulary mở trong migrations.
  Không chuyển chúng thành enum đóng và không dùng PostgreSQL native enum.
- JSONB dùng JsonNode + @JdbcTypeCode(SqlTypes.JSON); TEXT dùng String/columnDefinition="text",
  không @Lob (tránh PostgreSQL large object OID). Webhook rawBody giữ nguyên văn, rawPayload nullable.
- Không @Version, @SoftDelete, extra currency hay foreign key đa hình: migration không có các cột đó.
  Không @Data/toString/equalsHashCode trên entity để tránh duyệt lazy relations/lộ password hash.
  UserRoleId có equals/hashCode theo hai UUID như JPA yêu cầu cho composite key.

Các trạng thái mặc định ACTIVE/AVAILABLE/OPEN/PENDING_PAYMENT/RESERVED/PENDING và ngưỡng
máy 2..8 °C, 0..100 %RH khớp default SQL. Entity chỉ mapping dữ liệu; chưa tính tổng order,
kiểm hết hạn, phân bổ theo số lượng, payment verification hoặc xử lý dispense workflow.

## Chạy và kiểm chứng

Từ root repository, khởi động database đã cấu hình trong `.env`:

```powershell
docker compose --env-file .env -f backend/db/compose.yaml up -d --wait postgres
```

Từ thư mục `backend/`:

```powershell
mvn test
mvn '-Dspring-boot.run.jvmArguments=-Duser.timezone=UTC' spring-boot:run
```

Bootstrap hiện khởi tạo persistence/Flyway và HTTP server với common exception handling,
validation và GET /actuator/health; chưa có API nghiệp vụ. Xem [common-foundation.md](common-foundation.md).
Spring config
đọc `.env` ở root hoặc working directory qua file import. Dùng giá trị dạng properties đơn
giản (không bọc password trong dấu nháy, không inline comment hay shell expansion); biến
môi trường vẫn có ưu tiên cao hơn file. Không log/commit password.
DB_HOST trong `.env` phải là địa chỉ host mà JVM kết nối được, mặc định 127.0.0.1.
Nếu chạy Spring Boot trong container sau này, override DB_HOST=postgres và DB_PORT=5432
cho riêng container ứng dụng, thay vì dùng cổng host 5433.

JVM timezone UTC tránh JDBC gửi timezone alias Asia/Saigon không được server chấp nhận;
hibernate.jdbc.time_zone chỉ điều khiển JDBC binding, không thay múi giờ JVM lúc handshake.

`EntityMappingTest` dùng PostgreSQL 18 Testcontainers riêng, không dùng credentials hoặc dữ
liệu development. Flyway áp dụng V1–V9, rồi Hibernate validate. Các integration tests đã đạt:

1. 19 entity khớp 19 bảng nghiệp vụ, toàn bộ column mappings được đối chiếu với database.
2. Persist/reload mọi entity, membership khóa kép, composite navigation, lazy collections,
   optional relations, UUID/identity, sensor event time, money snapshot, nhiều payment attempts,
   JSONB/TEXT, timestamps và immutable inventory history.
3. Trong schema test riêng, chủ động xóa products.image_url: validation phải thất bại,
   cột không bị Hibernate tạo lại; schema public vẫn còn nguyên cột.
4. HTTP server khởi động ở cổng ngẫu nhiên; health trả đúng trạng thái UP, PostgreSQL connection
   và Flyway validation hoạt động; /actuator/env và /actuator/configprops không truy cập được.

Docker cần chạy để test; không fallback sang H2 và không bỏ qua test khi thiếu Docker.
Testcontainers tự dọn container test sau khi chạy. V1–V8 giữ nguyên; Issue #22 thêm V9
cho reason/statusBefore/statusAfter của InventoryTransaction, không đổi 19 bảng/entity.
