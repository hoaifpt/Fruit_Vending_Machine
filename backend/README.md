# Fruit Machine backend

Hiện có PostgreSQL 18/Flyway và entity JPA trên Java 21, Spring Boot 3.5.14.
Flyway quản lý schema; Hibernate chỉ validate. Chưa triển khai API hoặc service nghiệp vụ.
Common foundation gồm JPA auditing, chuẩn response/exception, Jakarta Validation và Actuator health.

- Migration: `src/main/resources/db/migration/` (V1–V8).
- Môi trường database local: `db/compose.yaml`.
- Kết nối database local: `.env` ở root repository (Git ignore); mẫu `.env.example`.
- Seed development: `db/dev/seed.sql`, phải chạy thủ công.
- Kiểm tra và truy vấn mẫu: `db/verify/`.
- Thiết kế, ERD và hướng dẫn: [database-migration.md](../docs/database-migration.md).
- Mapping JPA, khóa kép và kiểm thử: [jpa-entities.md](../docs/jpa-entities.md).
- Common foundation theo issue #2: [common-foundation.md](../docs/common-foundation.md).

Chạy lệnh từ root repository (thư mục chứa `backend`, `apps`, `firmware`).
Dùng `docker compose --env-file .env -f backend/db/compose.yaml ...` để đọc cấu hình local.
Không chỉnh migration đã áp dụng vào database dùng chung; thay đổi tiếp theo dùng V9 trở đi.

Kiểm thử entity từ thư mục `backend/`, với Java 21, Maven và Docker Desktop đang chạy:

```powershell
mvn verify
```

Testcontainers tự tạo PostgreSQL 18 riêng, không dùng database development trong `.env`.

Sau khi khởi động PostgreSQL bằng Compose, chạy ứng dụng từ thư mục `backend/`:

```powershell
mvn '-Dspring-boot.run.jvmArguments=-Duser.timezone=UTC' spring-boot:run
```

Health check: `GET http://localhost:8080/actuator/health` → `{"status":"UP"}`.
Đổi cổng HTTP bằng SERVER_PORT trong `.env`. Chi tiết health và endpoint cấu hình không công khai.
