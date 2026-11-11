# Heartbeat, kết nối và telemetry của máy (issue #53)

Backend nhận `status`, `heartbeat` và `telemetry` của mọi máy qua MQTT, biết máy còn sống không, controller khỏe không, và lưu
nhiệt độ/độ ẩm khi máy có cảm biến. Định dạng message: [api-contract/mqtt-contract.md](../api-contract/mqtt-contract.md) §2, §5, §7.
API: tag **Machine Health** và các trường mới của **Machines** trong `api-contract/api.yaml` / Swagger.

## Luồng

```text
vending/{code}/status     ONLINE khi kết nối, OFFLINE là Last Will      (firmware v0.3.0)
vending/{code}/heartbeat  mỗi 30 s: uptime, Wi-Fi RSSI, heap, firmware  (firmware: nhánh firmware chưa merge)
vending/{code}/telemetry  nhiệt độ, độ ẩm                               (firmware: chờ cảm biến)
vending/{code}/events     kết quả lệnh nhả hàng                         (#46, #52)
        │  MqttMachineGateway subscribe cả 4 kênh, QoS 1, subscribe lại sau mỗi lần kết nối lại
        ▼
MachineMessageHandler: ≤ 8 KB, JSON UTF-8, envelope (schemaVersion 1, messageId ≤ 64, machineCode = topic, payload object),
                       mã máy đã đăng ký  → không đạt: WARN + bỏ, không đổi gì
        ├── events     → presence (last_seen_at) → DispenseService
        ├── status     → ONLINE: presence + firmware/uptime; OFFLINE: last_offline_at
        ├── heartbeat  → kiểm tra payload → một câu UPDATE: last_seen_at, last_heartbeat_at, chẩn đoán
        └── telemetry  → kiểm tra giá trị → presence → chống trùng/giới hạn tần suất → sensor_readings
```

Thời điểm luôn là đồng hồ backend (`Clock`, làm tròn micro giây); không dùng thời gian của thiết bị.

## Presence (V15)

| Cột `machines` | Ghi bởi |
| --- | --- |
| `last_seen_at` | mọi tin hợp lệ trừ Last Will OFFLINE |
| `last_heartbeat_at`, `wifi_rssi`, `free_heap_bytes` | heartbeat (thiếu RSSI/heap → NULL, không bao giờ 0) |
| `firmware_version`, `uptime_seconds` | heartbeat, và status ONLINE nếu có trường đó |
| `last_offline_at` | status OFFLINE (Last Will) |

- Mỗi tin là **một câu UPDATE có điều kiện**, chỉ tiến lên (`last_seen_at` không bao giờ lùi; tin cũ hơn bị bỏ qua), không nạp entity,
  không đổi `updated_at` (cột này chỉ theo dõi thay đổi cấu hình). Giá trị cũ lấy bằng `RETURNING old.*` (PostgreSQL 18).
- Entity `Machine` map các cột này `insertable/updatable = false`: Admin sửa cấu hình cùng lúc với heartbeat không ghi đè giá trị
  cũ, không mất cập nhật, không deadlock (cả hai chỉ khóa một dòng `machines`).
- **Khởi động lại:** uptime mới nhỏ hơn uptime đã lưu → `MachineRebootDetectedEvent` (một lần; heartbeat sau đó uptime lại tăng).
- **Có lại kết nối:** tin đến khi lần trước đã im quá 180 s hoặc đã có Last Will → log INFO `Machine {code} back online after {gap}`
  một lần.

## Kết nối (tính ra, không lưu)

```text
last_seen_at NULL                        NEVER_SEEN
last_offline_at >= last_seen_at          OFFLINE (Last Will, ngay lập tức)
now - last_seen_at > 180 s               OFFLINE   MACHINE_OFFLINE_AFTER
now - last_seen_at > 60 s                WARNING   MACHINE_WARNING_AFTER (2 heartbeat bị lỡ)
còn lại                                  ONLINE
```

Khởi động sẽ lỗi nếu không có `0 < warning-after < offline-after`. Kết nối tách khỏi `status` (ACTIVE / INACTIVE / MAINTENANCE)
và **không chặn bán hàng** trong issue này (cảnh báo và tự chuyển MAINTENANCE thuộc 3.6).

## Telemetry

- Ít nhất một trong `temperature` / `humidity`; số hữu hạn, làm tròn HALF_UP 2 chữ số; nhiệt độ -40..85 °C, độ ẩm 0..100 %RH;
  trường lạ bị bỏ qua. Sai → bỏ cả tin (không ghi gì).
- Lưu `sensor_readings` với giờ nhận của backend. Bỏ tin trùng `messageId` trong 10 phút và tin cách tin đã lưu trước của máy
  dưới `TELEMETRY_MIN_INTERVAL` (10 s). Trạng thái chống trùng nằm trong bộ nhớ một instance backend.
- Tin bị xếp hàng khi backend tắt sẽ được lưu với thời điểm nhận được (giới hạn đã biết).

## API (MACHINE_READ: ADMIN, STAFF)

| Method | Endpoint | Việc |
| --- | --- | --- |
| `GET` | `/api/v1/machines`, `/api/v1/machines/{id}` | thêm `connectivity`, `lastHeartbeatAt`, `firmwareVersion`, `uptimeSeconds`, `wifiRssi`, `freeHeapBytes`; lọc `?connectivity=ONLINE\|WARNING\|OFFLINE\|NEVER_SEEN` bằng SQL, phân trang trong DB |
| `GET` | `/api/v1/machines/{machineId}/telemetry/latest` | bản ghi mới nhất, `temperatureStatus` / `humidityStatus` = LOW / NORMAL / HIGH theo ngưỡng của máy, `connectivity`; chưa có bản ghi → 200 với các trường null |
| `GET` | `/api/v1/machines/{machineId}/telemetry?from=&to=&page=&size=` | lịch sử: `from` (gồm) và `to` (không gồm) bắt buộc, `to > from`, tối đa 31 ngày, `size` 1..500 (mặc định 100); mới nhất trước; máy không có → 404 |

Chỉ để hiển thị: không tạo cảnh báo. Ẩn danh và khóa kiosk → 401; tài khoản không có MACHINE_READ → 403.

## Sự kiện miền (cho 3.5 / 3.6)

`MachineRebootDetectedEvent`, `MachineOfflineReportedEvent`, `TelemetryRecordedEvent`: phát trong transaction, xử lý sau commit;
hiện chỉ ghi log (`MachineHealthEventLog`).

## Cấu hình

`MACHINE_WARNING_AFTER` (PT60S), `MACHINE_OFFLINE_AFTER` (PT180S), `TELEMETRY_MIN_INTERVAL` (PT10S), `TELEMETRY_DUPLICATE_WINDOW` (PT10M).
Broker ACL `infra/mosquitto/acl` cho mỗi máy ghi `heartbeat` và `telemetry` của chính nó.

## Kiểm chứng

`MachineHealthIntegrationTest` (envelope, presence, kết nối với đồng hồ điều khiển được, khởi động lại, telemetry, API),
`MqttHealthEndToEndTest` (Mosquitto thật với `mosquitto.conf` + ACL của repo, Last Will thật), `MachineHealthPropertiesTest`,
`MachineHealthDocumentationTest`.
