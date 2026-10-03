# Fruit Machine backend

Hiện có PostgreSQL 18/Flyway và entity JPA trên Java 21, Spring Boot 3.5.14.
Flyway quản lý schema; Hibernate chỉ validate. Chưa triển khai API hoặc service nghiệp vụ.

- Migration: `src/main/resources/db/migration/` (V1–V8).
- Môi trường database local: `db/compose.yaml`.
- Kết nối database local: `.env` ở root repository (Git ignore); mẫu `.env.example`.
- Seed development: `db/dev/seed.sql`, phải chạy thủ công.
- Kiểm tra và truy vấn mẫu: `db/verify/`.
- Thiết kế, ERD và hướng dẫn: [database-migration.md](../docs/database-migration.md).
- Mapping JPA, khóa kép và kiểm thử: [jpa-entities.md](../docs/jpa-entities.md).

Chạy lệnh từ root repository (thư mục chứa `backend`, `apps`, `firmware`).
Dùng `docker compose --env-file .env -f backend/db/compose.yaml ...` để đọc cấu hình local.
Không chỉnh migration đã áp dụng vào database dùng chung; thay đổi tiếp theo dùng V9 trở đi.

Kiểm thử entity từ thư mục `backend/`, với Java 21, Maven và Docker Desktop đang chạy:

```powershell
mvn test
```

Testcontainers tự tạo PostgreSQL 18 riêng, không dùng database development trong `.env`.
