# Fruit Vending Machine

Hệ thống máy bán trái cây tự động, gồm kiosk tại máy, bộ điều khiển phần cứng ESP32 và hệ thống quản trị tập trung.

> **Trạng thái hiện tại:** repository đang ở giai đoạn khởi tạo cấu trúc. Một số file mới là placeholder và chưa thể chạy ngay.

## Tổng quan kiến trúc

```text
Người dùng
    │ chạm màn hình / quét QR
    ▼
Kiosk (Electron + React) ── Serial/USB ──> ESP32 ──> Motor, cảm biến
    │ REST / MQTT                                │
    └──────────────────> Backend (Spring Boot) <─┘
                               │
                               ├── PostgreSQL
                               ├── MQTT broker (Mosquitto)
                               ├── Cổng thanh toán QR
                               └── Web quản trị (React)
```

### Luồng mua hàng

1. Khách chọn sản phẩm trên **kiosk**.
2. Kiosk gọi **backend** tạo giao dịch và nhận dữ liệu QR.
3. Cổng thanh toán gửi webhook xác nhận thanh toán về backend.
4. Backend thông báo trạng thái thanh toán cho kiosk.
5. Kiosk gửi lệnh nhả sản phẩm tới **ESP32** qua Serial/USB.
6. ESP32 điều khiển động cơ, đọc cảm biến xác nhận hàng đã rơi và trả kết quả.
7. Kiosk báo kết quả nhả hàng lên backend; backend cập nhật giao dịch và tồn kho.

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
- Trạng thái giao dịch do backend quản lý, tối thiểu gồm: `PENDING_PAYMENT`, `PAID`, `DISPENSING`, `SUCCESS`, `DISPENSE_FAILED`.

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
3. Tạo branch theo tiền tố `feature/`, `fix/` hoặc `docs/`.
4. Không commit file môi trường, mật khẩu, token hay khóa của cổng thanh toán.

Các hướng dẫn chạy, biến môi trường và quy ước code sẽ được bổ sung khi từng module bắt đầu được triển khai.
