# Initial Admin Bootstrap — issue #8

Bootstrap chỉ tạo ADMIN đầu tiên lúc backend khởi động. Không phải API đăng ký,
đồng bộ tài khoản hay công cụ reset mật khẩu. Không có mật khẩu mặc định.

## Cấu hình lần đầu

Giữ nguyên thông tin DB/JWT đang dùng. Thêm các khóa dưới đây vào `.env` **đã được Git
ignore ở repository root**, rồi tự điền giá trị thật trên máy hoặc secret manager:

```properties
INITIAL_ADMIN_EMAIL=
INITIAL_ADMIN_PASSWORD=
INITIAL_ADMIN_FULL_NAME=
PASSWORD_MIN_LENGTH=12
```

- Email bắt buộc khi chưa có ADMIN: chuẩn hóa `strip()` + lowercase, Jakarta `@Email`,
  tối đa 254 ký tự, như email đăng nhập. Không dùng email đã thuộc một tài khoản khác.
- Mật khẩu bắt buộc, không blank; mặc định tối thiểu 12 ký tự Unicode và tối đa 72 byte
  UTF-8 theo BCrypt. Không trim mật khẩu. `PASSWORD_MIN_LENGTH` cho phép 8–72, mặc định
  12; nên giữ ít nhất 12 cho ADMIN. Đây là policy tạo tài khoản dùng lại được cho User
  Management sau này, không ép các tài khoản hiện có đổi mật khẩu khi đăng nhập.
- Full name có thể để trống: dùng `Initial Administrator`. Tên cấu hình được trim,
  tối đa 200 ký tự theo Flyway; status luôn `ACTIVE`.
- Mật khẩu dùng đúng `PasswordEncoder` hiện có. Chỉ hash được lưu trong `users`.
  Không đặt credential thật trong Git, migration, API contract hay ví dụ Swagger.

Biến môi trường thật ưu tiên hơn `.env`. JWT vẫn cần `JWT_SECRET` hợp lệ ở mọi lần chạy;
bootstrap không thay thế cấu hình JWT. Không đổi/sửa `.env` thật bằng script của agent.

Khởi động PostgreSQL theo cấu hình local hiện có, rồi chạy từ module `backend/`:

```powershell
mvn spring-boot:run '-Dspring-boot.run.jvmArguments=-Duser.timezone=UTC'
```

Hoặc từ repository root:

```powershell
mvn -f backend/pom.xml spring-boot:run '-Dspring-boot.run.jvmArguments=-Duser.timezone=UTC'
```

UTC tránh lỗi JVM gửi timezone alias `Asia/Saigon` tới PostgreSQL. Bootstrap không sửa
timezone hệ điều hành hoặc tạo schema: Flyway migrate/validate, Hibernate chỉ validate.

## Hành vi và xử lý lỗi

1. Khóa bootstrap ở PostgreSQL trong transaction rồi kiểm tra **bất kỳ user nào có
   role ADMIN**, không phụ thuộc email/status. Có ADMIN: bỏ qua, không ghi DB.
2. Chưa có ADMIN: kiểm tra cấu hình, lấy role ADMIN do V8 seed, kiểm tra email chưa tồn
   tại, encode mật khẩu, tạo user và membership `user_roles` atomically.
3. Sau commit: log thành công; startup tiếp tục. Lỗi: transaction rollback, startup fail.

Nếu ADMIN đang `INACTIVE`/`LOCKED`, bootstrap vẫn bỏ qua; không tự reactivate hay tạo
ADMIN thứ hai. Đổi biến môi trường không đổi email, tên, mật khẩu hoặc quyền ADMIN cũ.

Sau lần tạo thành công, nên **xóa giá trị INITIAL_ADMIN_PASSWORD và INITIAL_ADMIN_EMAIL
khỏi môi trường/.env** rồi khởi động lại. ADMIN có sẵn nên không yêu cầu bootstrap secrets
nữa. Không xóa account để reset mật khẩu: việc phục hồi/quản lý tài khoản cần quy trình
riêng, không thuộc issue này.

Các lỗi chỉ chỉ ra khóa/cách xử lý, không in giá trị credential:

- Thiếu email/password và chưa có ADMIN: điền các khóa thiếu được báo trong môi trường.
- Email/mật khẩu/tên/policy sai: sửa theo giới hạn trên; chưa có user nào được tạo.
- Không có role ADMIN: kiểm tra đúng database/schema và trạng thái Flyway/V8; không sửa
  migration đã áp dụng, không để bootstrap tự seed role thay thế.
- Email đã tồn tại nhưng chưa có ADMIN: không promote STAFF, không reset password.
  Chọn email **chưa được sử dụng** và chạy lại, hoặc giải quyết tài khoản qua quy trình
  quản trị được phê duyệt. Agent không tự xóa/đổi tài khoản hiện có.
- Lỗi lưu membership: user và membership cùng rollback, không có tài khoản tạo dở.

Hai instance bootstrap dùng chung PostgreSQL được serialize bởi
`pg_advisory_xact_lock(0x46564D, 1)` (SQL thực tế truyền integer namespace qua parameter).
`READ_COMMITTED` cho lần kiểm tra sau khóa thấy ADMIN đã commit; khóa tự nhả ở commit/
rollback. Không cần Redis/distributed infrastructure hay migration mới. Quy tắc khóa này
chỉ phối hợp các instance bootstrap, không thay thế UNIQUE/FK/CHECK của database và
không tự bảo vệ workflow user-management tương lai.
Tham khảo [PostgreSQL transaction advisory locks](https://www.postgresql.org/docs/18/explicit-locking.html#ADVISORY-LOCKS).

Log bootstrap chỉ gồm started/skipped/created, không email, mật khẩu, hash, JWT/key hoặc
dump môi trường. Không bật SQL bind-parameter/HTTP-body debug logging với credential thật.

## Đăng nhập và frontend

ADMIN tạo xong dùng API hiện có: `POST /api/v1/auth/login`, lấy Bearer JWT.
Khi backend xác thực token, authority là `ROLE_ADMIN` từ user/role hiện tại trong DB.
Chưa có User Management API hay role policy endpoint trong issue này.

Với `API_DOCS_ENABLED=true` ở local, mặc định port 8080:

- Swagger UI: http://localhost:8080/swagger-ui/index.html
- OpenAPI: http://localhost:8080/v3/api-docs
- Contract versioned: `api-contract/api.yaml`.

Không có API mới nên không thêm operation vào Swagger/contract. Đọc
[JWT authentication](jwt-authentication.md) để biết request/response, validation, lỗi và
Bearer authentication. Không chép credential thật vào contract/ví dụ/log hoặc chia sẻ
ảnh token; production tiếp tục tắt Swagger/OpenAPI.

## Kiểm chứng

Chạy `mvn clean verify` từ module với Java 21 và Docker. Test dùng PostgreSQL 18 cô lập,
credential giả chỉ cho test, JWT key random; không dùng `.env`/database của developer.

- Bootstrap creation, hash/matches, normalize/default, idempotency, ACTIVE/INACTIVE/LOCKED
  ADMIN ưu tiên, thiếu role/cấu hình, conflict STAFF, validation và redacted toString.
- Membership failure kiểm tra transaction rollback; hai transaction với email khác
  nhau kiểm tra chỉ tạo một ADMIN.
- Startup thật: thiếu cấu hình fail, thêm cấu hình tạo thành công, đóng context rồi
  khởi động lại cùng DB không có bootstrap secrets, mọi dữ liệu giữ nguyên.
- Login ADMIN bootstrap → JWT → endpoint **test-only** kiểm tra `ROLE_ADMIN`; capture log
  kiểm tra không credential/hash/token/key. Không tạo endpoint demo trong production.
- Toàn bộ test JWT/persistence/schema/Swagger-contract/production docs cũ vẫn phải pass.
