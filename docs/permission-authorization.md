# Phân quyền theo permission (issue #48)

Mọi endpoint quản trị được bảo vệ đều kiểm tra một **permission**, không kiểm tra role ADMIN hay STAFF nữa.
Role là một **tập permission** lưu trong database:

```text
User ──< user_roles >── Role ──< role_permissions >── Permission

@PreAuthorize(Permissions.HAS_PRODUCT_WRITE)      // = hasAuthority('PRODUCT_WRITE')
```

Issue này **không đổi ai được làm gì**: mapping seed trong V13 tái tạo đúng quyền ADMIN/STAFF trước đó.
Bằng chứng là test ma trận `AuthorizationMatrixIntegrationTest`: mọi operation của `api-contract/api.yaml`, chạy với
{anonymous, STAFF, ADMIN, KIOSK}, phải trả **đúng status code** như baseline đã ghi trên code cũ.

## Danh mục permission (V13)

| Code | Cho phép |
| --- | --- |
| `USER_READ` | `GET /api/v1/users`, `GET /api/v1/users/{id}` |
| `USER_WRITE` | tạo user, sửa hồ sơ, đổi trạng thái |
| `PERMISSION_MANAGE` | các API role/permission bên dưới |
| `PRODUCT_READ` / `PRODUCT_WRITE` | xem / tạo, sửa, đổi trạng thái sản phẩm |
| `MACHINE_READ` / `MACHINE_WRITE` | xem / tạo, sửa, đổi trạng thái máy và slot |
| `KIOSK_CREDENTIAL_MANAGE` | cấp, liệt kê, thu hồi kiosk credential |
| `BATCH_READ` / `BATCH_CREATE` | xem / tạo lô hàng |
| `INVENTORY_READ` / `INVENTORY_WRITE` | xem tồn kho, summary, lịch sử / nạp và gỡ bát |
| `ORDER_READ` | `GET /api/v1/orders`, `GET /api/v1/orders/{id}` |
| `PAYMENT_READ` | `GET /api/v1/payments`, `GET /api/v1/payments/{id}` |
| `PAYMENT_WEBHOOK_LOG_READ` | `GET /api/v1/payment-webhook-logs`, `/{id}` |
| `AUDIT_LOG_READ` (V16, #56) | `GET /api/v1/audit-logs`, `/{id}` (chỉ ADMIN) |
| `ALERT_READ` (V17, #58) | `GET /api/v1/alerts`, `/{id}` |
| `ALERT_MANAGE` (V17, #58) | `POST /api/v1/alerts/{id}/acknowledge`, `/{id}/resolve` |
| `ALERT_NOTIFY` (V17, #58) | không mở endpoint nào: người có quyền nhận thông báo cho mỗi cảnh báo mới |
| `PRICING_READ` (V18, #61) | `GET /api/v1/pricing/near-expiry-discount` |
| `PRICING_MANAGE` (V18, #61) | `PUT /api/v1/pricing/near-expiry-discount` |
| `MAINTENANCE_COMMAND_READ` (V19, #64) | `GET /api/v1/maintenance-commands`, `/{id}` |
| `MAINTENANCE_COMMAND_EXECUTE` (V19, #64) | `POST /api/v1/machines/{machineId}/slots/{slotId}/maintenance-commands`, `POST /api/v1/maintenance-commands/{id}/reconcile` |
| `MACHINE_RESET` (V19, #64) | `POST /api/v1/machines/{machineId}/reset` (chỉ ADMIN) |
| `WORK_ORDER_READ_ALL` (V20, #66) | `GET /api/v1/work-orders` |
| `WORK_ORDER_READ_ASSIGNED` (V20, #66) | `GET /api/v1/work-orders/me`, `/{id}`, `/{id}/events` (không có READ_ALL: chỉ việc của mình, còn lại 404) |
| `WORK_ORDER_MANAGE` (V20, #66) | tạo, sửa, giao, bỏ giao, hủy, liên kết cảnh báo, `POST /api/v1/alerts/{alertId}/work-orders` |
| `RESTOCK_PLAN` (V21, #68) | gợi ý nạp hàng, tạo RESTOCK từ gợi ý, thêm/sửa/xóa dòng nạp |
| `RESTOCK_EXECUTE` (V21, #68) | `POST /api/v1/work-orders/{id}/restock-lines/{lineId}/loads` (STAFF chỉ việc của mình) |
| `INVENTORY_LOAD_DIRECT` (V21, #68) | `POST /api/v1/inventory/load` (chỉ ADMIN; STAFF nạp qua work order) |
| `WORK_ORDER_EXECUTE` (V20, #66) | `POST /api/v1/work-orders/{id}/start`, `/notes`, `/complete` (STAFF chỉ việc của mình) |

Code có dạng `^[A-Z][A-Z0-9_]{2,63}$` (CHECK trong DB) và không bao giờ bắt đầu bằng `ROLE_`, nên không trùng authority của role.
UUID cố định `20000000-0000-0000-0000-0000000000NN`, giống V8, để mọi môi trường có cùng dữ liệu tham chiếu.

## Mapping mặc định

| Permission | ADMIN | STAFF |
| --- | :-: | :-: |
| `USER_READ`, `USER_WRITE`, `PERMISSION_MANAGE` | ✓ | |
| `PRODUCT_READ` | ✓ | ✓ |
| `PRODUCT_WRITE` | ✓ | |
| `MACHINE_READ` | ✓ | ✓ |
| `MACHINE_WRITE`, `KIOSK_CREDENTIAL_MANAGE` | ✓ | |
| `BATCH_READ`, `BATCH_CREATE`, `INVENTORY_READ`, `INVENTORY_WRITE`, `ORDER_READ` | ✓ | ✓ |
| `PAYMENT_READ`, `PAYMENT_WEBHOOK_LOG_READ`, `AUDIT_LOG_READ` | ✓ | |
| `ALERT_READ`, `ALERT_MANAGE` | ✓ | ✓ |
| `ALERT_NOTIFY` | ✓ | |
| `PRICING_READ` | ✓ | ✓ |
| `PRICING_MANAGE` | ✓ | |
| `MAINTENANCE_COMMAND_READ`, `MAINTENANCE_COMMAND_EXECUTE` | ✓ | ✓ |
| `MACHINE_RESET` | ✓ | |
| `WORK_ORDER_READ_ALL`, `WORK_ORDER_MANAGE` | ✓ | |
| `WORK_ORDER_READ_ASSIGNED`, `WORK_ORDER_EXECUTE` | ✓ | ✓ |
| `RESTOCK_PLAN`, `INVENTORY_LOAD_DIRECT` | ✓ | |
| `RESTOCK_EXECUTE` | ✓ | ✓ |

Mapping này đã được đối chiếu với từng `@PreAuthorize` và URL rule cũ (29 `hasRole('ADMIN')`, 21 `hasAnyRole('ADMIN','STAFF')`),
không có khác biệt. Các annotation trước đây đặt ở mức class mà lẫn đọc/ghi (User, Inventory, ProductBatch) đã được tách theo từng method.

## Authorities và JWT

- Mỗi request có JWT, `CustomUserDetailsService` đọc user, role và permission của các role đó trong **một câu SQL**
  (entity graph `roleMemberships.role.permissionGrants.permission`), rồi tạo authorities = `ROLE_<tên>` + các code permission.
- Không cache: đổi permission của một role thì **request kế tiếp** của mọi thành viên áp dụng ngay, cùng JWT, không cần đăng nhập lại.
- **JWT không đổi**: claim `roles` vẫn chỉ chứa `ROLE_*`; permission không bao giờ nằm trong token.
- `ROLE_*` vẫn được giữ cho các kiểm tra có sẵn, ví dụ không cho khóa ADMIN đang hoạt động cuối cùng.
- Kiosk không đổi: principal kiosk chỉ có `ROLE_KIOSK`; `/api/v1/kiosk/**` vẫn `hasRole('KIOSK')`.

## URL rule và method security

`SecurityConfig` kiểm tra cùng permission ở mức URL. Nhờ vậy, request không đủ quyền nhận `403` **trước** khi body được
validate (`400`). Với mỗi path, `GET` cần quyền đọc, các method khác cần quyền ghi. Các method không có endpoint vẫn trả `405`
cho người có quyền ghi, như trước. Giữ nguyên:

```text
POST /api/v1/auth/login               permitAll
POST /api/v1/webhooks/payments/*      permitAll (chỉ tin chữ ký)
/api/v1/kiosk/**                      hasRole KIOSK
health, swagger                       như cũ
anyRequest                            authenticated
```

Lỗi: không có hoặc sai JWT → `401`; có JWT nhưng thiếu permission → `403` (nội dung lỗi không nói thiếu permission nào);
kiosk key trên API quản trị → `401`; JWT người dùng trên API kiosk → `403`.

`PermissionRuleConsistencyIntegrationTest` chứng minh URL rule và `@PreAuthorize` của từng endpoint đòi **cùng một** permission.

## API quản lý role (cần `PERMISSION_MANAGE`)

| Method | Endpoint | Việc |
| --- | --- | --- |
| `GET` | `/api/v1/permissions` | toàn bộ danh mục (code, description) |
| `GET` | `/api/v1/roles` | các role kèm code permission |
| `GET` | `/api/v1/roles/{id}` | chi tiết một role |
| `PUT` | `/api/v1/roles/{id}/permissions` | thay **toàn bộ** tập permission của role |

```json
{ "permissions": ["PRODUCT_READ", "MACHINE_READ", "INVENTORY_READ", "INVENTORY_WRITE"] }
```

- Code không tồn tại → `400`, `fieldErrors.permissions` liệt kê các code đó; code trùng → `400`; danh sách rỗng được phép (role không có quyền gì).
- **Chống tự khóa**: role ADMIN phải luôn giữ `PERMISSION_MANAGE` và `USER_WRITE`; bỏ một trong hai → `409`.
- Role không tồn tại → `404`.
- Dòng role bị khóa `PESSIMISTIC_WRITE` trong lúc thay, và tập cũ được đọc dưới khóa đó, nên hai lần thay đồng thời không mất cập nhật.
- Mỗi lần thay ghi một dòng `audit_logs`: action `ROLE_PERMISSIONS_CHANGED`, entity `Role`, `old_value`/`new_value` =
  `{"permissions":[...]}` đã sắp xếp, `user_id` = người thực hiện.
- Không có API tạo, đổi tên, xóa role hay permission.

## Thêm permission trong issue sau

1. Migration mới: `INSERT` permission và các dòng `role_permissions` (UUID cố định).
2. Thêm hằng số vào `security/permission/Permissions.java` (code, biểu thức `HAS_...`, và đưa vào `ALL`).
3. Dùng nó ở URL rule trong `SecurityConfig` và ở `@PreAuthorize` của endpoint.
4. Mở rộng test: ma trận phân quyền (`AuthorizationMatrixIntegrationTest`, ghi lại baseline có chủ đích),
   `PermissionSchemaIntegrationTest` (danh mục, mapping). `PermissionRuleConsistencyIntegrationTest` tự kiểm endpoint mới.

`/api/v1/notifications/**` (#58) chỉ cần đăng nhập (`isAuthenticated()`), không cần permission: mỗi user chỉ thấy thông báo của mình.

Swagger tự gắn `x-required-permission` cho mỗi operation, đọc từ `@PreAuthorize` của handler. Nhớ cập nhật cả `api-contract/api.yaml`.
