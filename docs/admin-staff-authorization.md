# ADMIN/STAFF authorization — issue #10

Backend đã có nền RBAC bằng Spring Security method authorization. Issue này **không**
thêm User Management, `/api/v1/users`, permission API hay endpoint nghiệp vụ/demo.
API ứng dụng hiện tại vẫn chỉ có login. Không có refresh token hoặc role hierarchy.

## Nguồn quyền và tích hợp JWT

- `users → user_roles → roles` trong PostgreSQL là nguồn quyền chính thức.
- `CustomUserDetailsService` hiện có ánh xạ tên role: ADMIN → `ROLE_ADMIN`,
  STAFF → `ROLE_STAFF`. `AuthenticatedUser.getAuthorities()` loại authority trùng;
  hỗ trợ tài khoản nhiều role hoặc không có role.
- `JwtAuthenticationFilter` hiện có validate JWT rồi nạp lại user/role theo UUID,
  thiết lập `Authentication` và `SecurityContext`. Không có filter/auth mechanism mới.
- Claim `roles` trong JWT là snapshot thông tin, **không** dùng để cấp quyền. Thêm/gỡ
  membership có hiệu lực ở request tiếp theo ngay cả với cùng JWT, không đợi token hết hạn.
- ACTIVE có thể xác thực; INACTIVE/LOCKED/deleted không thể dùng JWT cũ để vượt chặn.
- Không mặc định ADMIN > STAFF. ADMIN-only không được qua STAFF-only trừ khi tài khoản
  thật sự có cả hai role. Endpoint dành cho cả hai phải dùng `hasAnyRole`.
- Frontend có thể ẩn menu dựa trên role, nhưng đó không phải biện pháp bảo mật; backend
  vẫn kiểm tra mỗi thao tác. Không parse/check JWT thủ công trong controller/service.

## Cách dùng cho feature sau

`SecurityConfig` bật `@EnableMethodSecurity`. Dùng annotation trên public method của
Spring-managed service tại ranh giới use case; controller cũng có thể được bảo vệ bằng
method annotation khi phù hợp. Đây là hướng dẫn, không phải API đã triển khai:

```java
@PreAuthorize("hasRole('ADMIN')")
// Chỉ ADMIN

@PreAuthorize("hasRole('STAFF')")
// Chỉ STAFF; ADMIN không tự có quyền này

@PreAuthorize("hasAnyRole('ADMIN', 'STAFF')")
// ADMIN hoặc STAFF

@PreAuthorize("isAuthenticated()")
// Bất kỳ tài khoản đã xác thực, không yêu cầu role
```

`hasRole` tự thêm prefix `ROLE_`: dùng `hasRole('ADMIN')`, không `hasRole('ROLE_ADMIN')`.
Nếu dùng `hasAuthority` thì truyền toàn bộ tên như `hasAuthority('ROLE_ADMIN')`.
HTTP-level `.requestMatchers(...).hasRole("ADMIN")` chỉ bổ sung khi có endpoint thật và
policy được issue giao; không tạo wildcard role policy cho các API chưa tồn tại.

Method security dùng Spring AOP: phải gọi qua bean/proxy được inject; không tạo service
bằng `new`, không đặt guard trên private/final method/class cần proxy, không dựa vào
`this.protectedMethod()` (self-invocation bỏ qua proxy). Annotate method entry-point của
use case hoặc gọi sang bean được bảo vệ riêng. Method không annotation **không** tự được
phân quyền. Không catch/suppress `AccessDeniedException` để tiếp tục thao tác bị từ chối.
Ngoài HTTP (scheduler/listener), phải chủ động thiết kế principal/trust boundary hợp lệ;
không tự giả danh ADMIN để vượt guard. Bootstrap hiện có không bị thêm guard cần login.
Tham khảo [Spring Security 6.5 method authorization](https://docs.spring.io/spring-security/reference/6.5/servlet/authorization/method-security.html).

## 401 và 403

- Thiếu JWT, token invalid/expired/wrong signature/malformed, account unavailable:
  `401 Unauthorized`. Security entry point dùng message
  `Authentication required or access token invalid`, `WWW-Authenticate: Bearer` và
  `Cache-Control: no-store`.
- Đã xác thực nhưng thiếu role: `403 Forbidden`, message `Access denied`. Không trả
  401, không kèm `WWW-Authenticate` khiến client hiểu nhầm phải login lại.
- Filter-level security errors dùng `SecurityErrorHandler` hiện có; method denial trong
  MVC dùng `GlobalExceptionHandler` hiện có. Cùng schema `ApiErrorResponse`:
  timestamp/status/error/message/path, không exception/stack trace/JWT/password/hash.
- Login sai credentials vẫn trả 401 `Invalid email or password`; đó là lỗi authentication,
  không phải lỗi thiếu quyền. Không thêm role restriction lên public login.
- Gọi service có guard ngoài HTTP khi không có Authentication sẽ throw security exception;
  HTTP status chỉ được tạo bởi security/MVC handlers khi có request.

POST login, GET health và opt-in local documentation giữ nguyên access policy. Những
application request khác vẫn bắt buộc xác thực; không có blanket API `permitAll` mới.
Session vẫn stateless, không thêm form/Basic/cookie login. Không log SecurityContext,
Authorization header, JWT, password/hash hoặc key; không bật bind/body debug với secrets thật.

## Swagger và API contract

Không có operation RBAC mới; không xuất endpoint test vào Swagger hoặc contract.
`api-contract/api.yaml` vẫn chỉ mô tả POST login, metadata được cập nhật tình trạng nền RBAC.
Generated OpenAPI và contract giữ cùng metadata, Auth grouping và public login/security schema.
Mỗi API nghiệp vụ tương lai phải ghi rõ role policy thực tế, 401/403 và DTO/validation/error
trong cả Swagger và contract cùng lúc triển khai; không ghi ví dụ tương lai như API đã chạy.

Local setup không đổi: đọc [JWT authentication](jwt-authentication.md) và
[Initial Admin Bootstrap](initial-admin-bootstrap.md). Với `API_DOCS_ENABLED=true` và
SERVER_PORT=8080:

- Swagger UI: http://localhost:8080/swagger-ui/index.html
- OpenAPI JSON: http://localhost:8080/v3/api-docs
- OpenAPI YAML: http://localhost:8080/v3/api-docs.yaml

Authorize bằng access token (không gõ thêm Bearer). UI không thể thử ADMIN-only nghiệp vụ
vì chưa có API đó; hành vi RBAC được kiểm chứng tự động bằng fixtures trong `src/test`.
Production tiếp tục tắt Swagger/OpenAPI. Không đưa credential/token thật vào ví dụ hoặc Git.

## Verification

Chạy `mvn clean verify` từ module backend bằng Java 21 và Docker. Test không đọc `.env`
hay database của developer; PostgreSQL 18 Testcontainers cô lập, JWT key random.

- `AuthorityMappingTest`: mapping cả hai role, nhiều/duplicate/no role, username/UUID
  lookup và trạng thái tài khoản; reuse code mapping hiện có.
- `AuthorizationIntegrationTest`: login thật → JWT → filter → principal/SecurityContext →
  `@PreAuthorize` trên Spring service proxy và controller test-only. Kiểm tra ADMIN/STAFF/
  shared/any-authenticated, no hierarchy, denied method không chạy body, thiếu/invalid/
  expired token 401, thiếu quyền 403, DB role changes ngay với cùng token, unavailable/
  deleted account, context không bị tái sử dụng, không secrets trong response/log.
- `SecurityErrorHandlerTest`: entry point và AccessDeniedHandler thực hiện common JSON,
  đúng status/header, không lộ exception details.
- Toàn bộ tests JWT/bootstrap/persistence/Flyway/Hibernate/Swagger-contract/production
  docs cũ vẫn phải pass. Fixtures không được đóng gói vào production JAR.

Schema/entity/dependency và Flyway V1–V8 không đổi; Hibernate giữ `ddl-auto=validate`.
