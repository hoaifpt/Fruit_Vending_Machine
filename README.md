# Fruit Vending Machine

Hệ thống máy bán trái cây tự động, gồm kiosk tại máy, bộ điều khiển phần cứng ESP32 và hệ thống quản trị tập trung.

> **Trạng thái hiện tại:** backend đã có Flyway, JPA mappings, common foundation, User/Role persistence, JWT login/stateless authentication, Initial Admin Bootstrap, nền ADMIN/STAFF method authorization, Swagger/OpenAPI và health check. Đã có User Management API dành cho ADMIN, Product Management và Machine Management API (ADMIN đọc/ghi, STAFF chỉ đọc); chưa có refresh token hoặc các API nghiệp vụ khác. Các nghiệp vụ mua hàng/payment/dispense dưới đây là thiết kế mục tiêu, chưa được triển khai đầy đủ; các phần còn lại có thể vẫn là placeholder.

Hướng dẫn chạy backend, cấu hình `JWT_SECRET`, Swagger và login: [JWT authentication](docs/jwt-authentication.md).
Hợp đồng API cho frontend: [api-contract/api.yaml](api-contract/api.yaml).
Database chưa có ADMIN cần cấu hình lần đầu: [Initial Admin Bootstrap](docs/initial-admin-bootstrap.md).
Quyền ADMIN/STAFF, `@PreAuthorize` và lỗi 401/403: [Authorization](docs/admin-staff-authorization.md).
API tạo STAFF, phân trang/lọc, cập nhật hồ sơ và trạng thái: [User Management](docs/user-management.md).
API danh mục sản phẩm, SKU, giá và ACTIVE/INACTIVE: [Product Management](docs/product-management.md).
API danh tính, cấu hình môi trường và trạng thái quản trị máy: [Machine Management](docs/machine-management.md).

## Tổng quan kiến trúc

```text
Người dùng
    │ chạm màn hình / quét QR
    ▼
Kiosk (Electron + React) ── Serial/USB ──> ESP32 ──> Motor, cảm biến
    │ REST / kênh trạng thái backend
    └──────────────────> Backend (Spring Boot)
                               │
                               ├── PostgreSQL
                               ├── MQTT telemetry/events (tích hợp tương lai)
                               ├── Cổng thanh toán QR
                               └── Web quản trị (React)
```

### Luồng mua hàng

1. Khách chọn sản phẩm trên **kiosk**.
2. Kiosk gọi `POST /api/v1/orders`; backend kiểm tra/giữ hàng và tạo Order = PENDING_PAYMENT.
3. Backend tạo QR payment; kiosk hiển thị QR.
4. Khách thanh toán; provider gửi webhook về backend.
5. Backend verify payment và chuyển Order = PAID.
6. Backend tạo/lưu DispenseCommand; kiosk nhận PAID cùng commandId/slot được backend cấp.
7. Kiosk gửi `DISPENSE <commandId> <slot=A2>` tới **ESP32** qua Serial/USB.
8. ESP32 điều khiển motor, xác nhận kết quả vật lý và trả `DISPENSE_SUCCESS <commandId>` cho kiosk.
9. Kiosk báo kết quả tương ứng lên backend.
10. Backend kiểm tra quyền máy/command/trạng thái, xử lý idempotent: command SUCCESS,
    allocation DISPENSED, item SOLD; Order COMPLETED khi tất cả phần hàng đã nhả thành công.

Trong lúc nhả hàng dùng trạng thái DISPENSING. Kiosk không tự tạo command hay đánh dấu PAID.
Mất kết nối/timeout/kết quả không rõ phải đối soát, không gửi lại mù quáng gây nhả hàng hai lần.
MQTT không thay thế đường Serial/USB cho dispense trong flow đã thống nhất.

Backend là nguồn dữ liệu chính. Kiosk không duy trì hàng đợi đồng bộ giao dịch khi mất điện/mất mạng.

## Cấu trúc repository

```text
.
├─ apps/
│  ├─ kiosk/              # Electron + React: giao diện và điều phối tại máy
│  └─ web/                # React: dashboard quản trị
├─ backend/               # Java + Spring Boot: API, nghiệp vụ, payment, MQTT
├─ firmware/              # ESP-IDF + C++: chương trình cho ESP32
├─ packages/
│  ├─ contracts/          # TypeScript types/DTO dùng chung cho các ứng dụng web
│  ├─ protocol/           # Giao thức Serial và MQTT, hằng số/mã dùng chung
│  └─ config/             # Cấu hình dùng chung: lint, TypeScript, build
├─ api-contract/
│  └─ api.yaml            # Hợp đồng API REST (OpenAPI) giữa frontend và backend
├─ infra/
│  ├─ docker-compose.yml  # Môi trường local: PostgreSQL, Mosquitto, backend
│  ├─ db/                 # Cấu hình/dữ liệu khởi tạo database nếu cần
│  └─ mosquitto/          # Cấu hình MQTT broker
├─ docs/                  # Tài liệu kiến trúc, giao thức, phần cứng
├─ scripts/
│  └─ simulate-controller.ts  # Giả lập ESP32 phục vụ phát triển kiosk
├─ .github/workflows/     # CI/CD với GitHub Actions (khi được bổ sung)
└─ README.md
```

## Phân công theo khu vực

| Nhóm | Nơi làm việc chính | Trách nhiệm |
| --- | --- | --- |
| Kiosk | `apps/kiosk` | UI cảm ứng, hiển thị QR, gọi backend, giao tiếp Serial với ESP32 |
| Web quản trị | `apps/web` | Quản lý máy, sản phẩm, tồn kho, giao dịch và cảnh báo |
| Backend | `backend` | Spring Boot API, PostgreSQL, xác thực, webhook thanh toán, MQTT |
| Firmware | `firmware` | Motor, cảm biến rơi hàng, nhiệt độ, cơ chế an toàn và Serial protocol |
| Hạ tầng | `infra` | Docker Compose, PostgreSQL, Mosquitto và cấu hình môi trường |
| Phân tích/tích hợp | `api-contract`, `packages/protocol`, `docs` | Chuẩn hoá API, giao thức và tài liệu kỹ thuật |

## Các nguyên tắc tích hợp

- Không lưu API key hoặc secret thanh toán trong kiosk hay repository. Dùng biến môi trường và GitHub Secrets.
- Mọi thay đổi API REST phải cập nhật `api-contract/api.yaml` trước hoặc cùng lúc với backend/frontend.
- Mọi lệnh Serial giữa kiosk và ESP32 phải được mô tả trong `packages/protocol` và tài liệu tương ứng.
- ESP32 chỉ xử lý các việc thời gian thực: điều khiển motor, đọc cảm biến, nhiệt độ và bảo vệ an toàn. Không đưa logic thanh toán xuống firmware.
- Trạng thái Order do backend quản lý: `PENDING_PAYMENT`, `PAID`, `DISPENSING`, `COMPLETED` và các trạng thái lỗi/hủy/hoàn tiền theo Flyway. `SUCCESS` là trạng thái của Payment/DispenseCommand, không phải Order.

## Công nghệ dự kiến

| Thành phần | Công nghệ |
| --- | --- |
| Kiosk | Electron, React, TypeScript |
| Admin web | React, TypeScript |
| Backend | Java 21, Spring Boot 3, Spring Data JPA |
| Database | PostgreSQL, Flyway |
| Messaging | MQTT, Mosquitto |
| Firmware | ESP-IDF, C++ |
| Local development | Docker Compose |
| CI/CD | GitHub Actions |

## Bắt đầu đóng góp

1. Đọc phần thư mục liên quan đến nhóm của bạn và các tài liệu trong `docs/`.
2. Thống nhất API trước khi frontend/backend triển khai tính năng mới.
3. Tạo branch từ `dev` mới nhất: tính năng dùng `feature/<issue-number>-<description>`, issue báo lỗi (ví dụ nhãn `[BUG]`) dùng `fix/<issue-number>-<description>`, tài liệu dùng `docs/`. Ví dụ: `feature/6-jwt-authentication` hoặc `fix/27-duplicate-payment-webhook`. Phần mô tả dùng chữ thường kebab-case.
4. Không commit file môi trường, mật khẩu, token hay khóa của cổng thanh toán.

Các hướng dẫn chạy, biến môi trường và quy ước code sẽ được bổ sung khi từng module bắt đầu được triển khai.
