# Common backend foundation — issue #2

Triển khai theo [issue #2: Setup common backend foundation](https://github.com/hoaifpt/Fruit_Vending_Machine/issues/2)
trên branch `feature/2-backend-common-foundation`, tạo từ `origin/dev` tại commit `80ffd92`.
Base này đã merge migration/entity qua PR #3. Các entity có sẵn được giữ; không thêm User/Role
entity mới, không xây CRUD, auth, payment, MQTT hoặc dispense workflow trong issue này.

## Cấu trúc và quy ước

Giữ root package `com.fruitmachine.backend` theo project hiện có (package trong issue là ví dụ).

```text
com.fruitmachine.backend
├── BackendApplication
├── common
│   ├── entity       # BaseEntity, UuidEntity
│   ├── exception    # GlobalExceptionHandler và ba common exceptions
│   ├── response     # ApiResponse<T>, ApiErrorResponse
│   └── util         # chỗ cho utility khi có use case thực
├── config           # JpaConfig
├── audit            # AuditLog entity
├── security / auth
├── user / product / machine / inventory
├── sensor / alert / order / payment / dispense
└── mqtt
```

Các package chưa có nghiệp vụ giữ package-info.java theo quyết định của chủ dự án.
Đặt controller/DTO/service/repository mới trong feature tương ứng khi issue đó được triển khai.
Sau đợt thống nhất quy định, entity/enum đã chuyển về feature tương ứng, không đổi mapping.
Các superclass CreatedEntity/UpdatedEntity nằm trong common.entity cùng BaseEntity/UuidEntity.
Không triển khai nghiệp vụ các issue tương lai khi chuyển package.

## Database, UUID và auditing

Flyway 11.20.1 chạy trước Hibernate, PostgreSQL 18 là database thực để kiểm thử. Giữ
`ddl-auto=validate`, `generate-ddl=false`, SQL initializer `mode=never`; không sửa V1–V8.
Schema CHECK/index/FK/trigger/default do Flyway quản lý, không tái tạo bằng Hibernate.

`common.entity.UuidEntity` chứa UUID @Id + GenerationType.UUID cho business entity, phù hợp
default gen_random_uuid() trong PostgreSQL. Sensor vẫn Long/IDENTITY và UserRole vẫn khóa kép;
không đổi PK hay thêm @Version/cột mới.

`common.entity.BaseEntity` là @MappedSuperclass, kế thừa UuidEntity, chứa:

- createdAt: Instant/TIMESTAMPTZ, @CreatedDate, NOT NULL, updatable=false.
- updatedAt: Instant/TIMESTAMPTZ, @LastModifiedDate, NOT NULL.
- @EntityListeners(AuditingEntityListener.class).

`config.JpaConfig` bật @EnableJpaAuditing và dùng DateTimeProvider với Clock.systemUTC(),
truncate đến microsecond để Java timestamps round-trip đúng precision PostgreSQL.
Các bảng có cả hai timestamp hiện dùng BaseEntity thông qua UpdatedEntity:
users, machines, machine_slots, products, inventory_items, alerts, order_item_allocations,
dispense_commands. Không đặt BaseEntity lên bảng chỉ có created_at, received_at hoặc recorded_at.
CreatedEntity của bảng chỉ có created_at giữ default DB, inventory history @Immutable và
sensor event time giữ mapping riêng như trước. Không thêm created_at cho sensor hay updated_at
cho orders/payments/history chỉ để dùng superclass.

Timestamp auditing được ghi bởi listener khi persist/dirty update qua EntityManager.
createdAt không đổi khi cập nhật, updatedAt được lấy từ clock lúc cập nhật. SQL trực tiếp,
JPQL bulk update và native update không chạy listener, nên cần tự đặt timestamp. Chưa có
createdBy/lastModifiedBy hay AuditorAware vì schema không có cột audit actor chung và chưa có auth.

## Response và exception

`ApiResponse.success(message, data)` trả:

```json
{
  "timestamp": "2026-10-03T06:00:00Z",
  "message": "Request completed successfully",
  "data": {}
}
```

Timestamp là UTC ISO-8601; không thêm pagination metadata. Tầng API tương lai dùng DTO,
không serialize entity/lazy collection trực tiếp.

`@RestControllerAdvice GlobalExceptionHandler` trả cấu trúc lỗi thống nhất:

```json
{
  "timestamp": "2026-10-03T06:00:00Z",
  "status": 400,
  "error": "Validation Failed",
  "message": "Request validation failed",
  "path": "/api/v1/example",
  "fieldErrors": {
    "email": "Email must be valid"
  }
}
```

fieldErrors bỏ khỏi JSON khi không có lỗi validation. Chỉ dùng URI path, không đưa query string
hay rejected value vào lỗi. Message của common exceptions phải là nội dung được phép trả cho client.

| Trường hợp | HTTP | Message / xử lý |
| --- | --- | --- |
| ResourceNotFoundException | 404 | message công khai từ caller |
| BadRequestException | 400 | message công khai từ caller |
| ConflictException | 409 | message công khai từ caller |
| DataIntegrityViolationException | 409 | message chung, không SQL/constraint/rejected values |
| @Valid request body / method parameter / ConstraintViolationException | 400 | Validation Failed + fieldErrors |
| JSON thiếu/lỗi cú pháp | 400 | Request body is missing or malformed |
| Thiếu parameter / type mismatch / route thiếu / method sai | 400/404/405 | HTTP status chuẩn; giữ header framework như Allow |
| Exception không dự kiến | 500 | An unexpected error occurred; không stack trace/message nội bộ |

HandlerMethodValidationException của return value là lỗi server, trả 500. Validation request
dùng Jakarta Validation; controller test chỉ nằm trong src/test, không thêm feature endpoint.
Fallback server.error cũng tắt message, binding errors, exception và stacktrace.

## Health và chạy local

Chỉ Actuator health được cho phép đọc và expose qua HTTP. show-details/show-components=never;
các endpoints cấu hình không được kích hoạt. Không trả DB password, URL, username, token hay secret.
[Cấu hình access/exposure của Actuator](https://docs.spring.io/spring-boot/3.5/reference/actuator/endpoints.html).
Health dùng contributor DB của Spring Boot để kiểm kết nối PostgreSQL; trạng thái DOWN sẽ không
bị controller tự ép thành UP. Không thêm auth/RBAC trong issue foundation.

Từ root repository (có `.env` và `backend/`):

```powershell
docker compose --env-file .env -f backend/db/compose.yaml up -d --wait postgres
cd backend
mvn '-Dspring-boot.run.jvmArguments=-Duser.timezone=UTC' spring-boot:run
```

Ứng dụng tự migrate/validate khi khởi động. SERVER_PORT mặc định 8080, có mẫu trong .env.example.
Spring đọc root .env như properties; giữ password dạng giá trị đơn giản như hướng dẫn JPA.
JVM timezone UTC tránh gửi alias Asia/Saigon trong JDBC handshake.

Từ terminal khác:

```powershell
Invoke-RestMethod http://localhost:8080/actuator/health
```

Kết quả lúc database hoạt động là `{"status":"UP"}`. Không cần seed dữ liệu để health UP.

## Kiểm chứng và acceptance criteria

Từ backend/, với Java 21, Maven và Docker Desktop:

```powershell
mvn verify
```

Đã đạt **11 tests, 0 failures, 0 errors, 0 skipped** và đóng gói executable JAR thành công.
PostgreSQL 18.6 Testcontainers dùng cổng riêng, không tác động database development.

- GlobalExceptionHandlerTest: 7 tests cho success, 404/400/409, body/method validation,
  malformed JSON, thiếu/sai parameter, sanitization 500/DB error, route thiếu/405 và Allow header.
- EntityMappingTest: 4 integration tests cho context/19 mappings, persist/reload/relationships,
  auditing và lịch sử, schema validation thất bại khi thiếu cột mà không tự sửa,
  HTTP server thật/health/PostgreSQL/Flyway validation và chặn endpoints cấu hình.
- V1–V8 áp dụng từ database trống và Flyway validate thành công; Hibernate chỉ validate.
- Tất cả thay đổi ở backend, docs và .env.example; apps/firmware và SQL migration giữ nguyên.

Foundation sẵn sàng để phát triển các feature tiếp theo. File `.env` và target/ không commit.
