# Backend implementation: machine health and heartbeat

Hướng dẫn triển khai backlog 3.4 phía backend. Định dạng message (topic, envelope, payload `status` và `heartbeat`,
trường bắt buộc/tùy chọn, chu kỳ 30 giây, ngưỡng offline 180 giây) **chỉ** được định nghĩa trong
[api-contract/mqtt-contract.md](../api-contract/mqtt-contract.md) §1, §2, §5 và §7; ví dụ đầy đủ ở
`api-contract/mqtt/examples/status-online.json`, `status-offline-lwt.json`, `heartbeat.json`.
Yêu cầu nghiệp vụ: [backend-machine-health.md](backend-machine-health.md).

## Mục tiêu

Backend cần biết:

1. Máy còn kết nối MQTT và firmware còn chạy hay không.
2. Máy có gửi heartbeat đều đặn hay đã mất kết nối.
3. Lần cuối backend nhận được thông tin từ máy là khi nào.
4. Trạng thái máy trên trang quản trị là `ONLINE`, `WARNING` hay `OFFLINE`.

Heartbeat đã có ở nhánh firmware `feature/firmware-staff-refill-and-maintenance`, chưa có trong firmware trên `dev` (contract: `PLANNED`).
Broker ACL `infra/mosquitto/acl` đã cho phép máy ghi `heartbeat`.

## Subscribe

`MqttMachineGateway` subscribe theo `MachineChannel.SUBSCRIBED` (`mqtt/contract/`). Trong 3.4 thêm `MachineChannel.HEARTBEAT`
(và `TELEMETRY` khi firmware có cảm biến) vào danh sách đó; `MachineMessageHandler` định tuyến theo kênh.

## Dữ liệu cần lưu

Có thể mở rộng bảng `machines` hiện tại hoặc tạo bảng telemetry riêng (migration mới). Tối thiểu:

| Column | Kiểu đề xuất | Ý nghĩa |
|---|---|---|
| `last_seen_at` | `timestamptz nullable` | Lần cuối nhận status, heartbeat hoặc event hợp lệ (đã có) |
| `last_status_at` | `timestamptz nullable` | Lần cuối nhận status |
| `last_heartbeat_at` | `timestamptz nullable` | Lần cuối nhận heartbeat |
| `health_status` | enum/string | `ONLINE`, `WARNING`, `OFFLINE` |
| `last_heartbeat_uptime_seconds` | bigint nullable | Uptime từ heartbeat gần nhất |
| `last_wifi_rssi` | integer nullable | RSSI gần nhất |
| `last_free_heap` | bigint nullable | Heap gần nhất |
| `firmware_version` | varchar nullable | Firmware gần nhất |
| `last_error` | varchar nullable | Mã lỗi gần nhất (catalog của contract) |

Không đổi ý nghĩa `machines.last_seen_at`. Không lưu mật khẩu MQTT hay credential vào payload, log hay response API.

## Quy tắc cập nhật message

### Khi nhận `status`

1. Validate envelope và mã máy (contract §2).
2. Tìm máy theo mã máy; không có thì log và bỏ.
3. Cập nhật `last_seen_at` và `last_status_at` bằng thời gian server.
4. `ONLINE` → `health_status = ONLINE`; `OFFLINE` (Last Will) → ghi nhận mất kết nối và log chuyển trạng thái.
5. Cập nhật `firmware_version` và uptime nếu có.

### Khi nhận `heartbeat`

1. Validate envelope và mã máy.
2. Cập nhật `last_seen_at` và `last_heartbeat_at` bằng thời gian server.
3. Cập nhật các trường chẩn đoán có trong payload; trường vắng mặt lưu `null`.
4. Chuyển `health_status` về `ONLINE`; nếu trước đó `OFFLINE`/`WARNING` thì log khôi phục.

### Khi nhận `events`

Mọi event hợp lệ cập nhật `last_seen_at` (đã làm). Lưu event và nguyên nhân thuộc 3.5; cảnh báo theo mã lỗi thuộc 3.6.

## Phát hiện máy mất kết nối

Scheduled job, cấu hình bằng biến môi trường, ví dụ:

```text
MACHINE_HEALTH_WARNING_AFTER=PT60S
MACHINE_HEALTH_OFFLINE_AFTER=PT180S
MACHINE_HEALTH_SWEEP_INTERVAL=PT30S
```

```text
Không có last_seen_at                 => UNKNOWN hoặc OFFLINE theo chính sách UI
now - last_seen_at <= 60 giây         => ONLINE
60 giây < now - last_seen_at <= 180s  => WARNING
now - last_seen_at > 180 giây         => OFFLINE
```

Job phải:

- Chỉ ghi log khi trạng thái thực sự thay đổi.
- Không ghi đè trạng thái vận hành như `MAINTENANCE`; `health_status` tách khỏi `MachineStatus`.
- Khi nhận tin mới sau `OFFLINE`, chuyển về `ONLINE` và ghi thời điểm khôi phục.
- Xử lý theo batch nếu số lượng máy lớn.

## API cho web quản trị

Response máy hiện có trả thêm `healthStatus`, `lastSeenAt`, `lastHeartbeatAt`, `uptimeSeconds`, `wifiRssi`, `freeHeap`,
`firmwareVersion` (có thể `null` khi máy chưa gửi heartbeat). Cập nhật Swagger và `api-contract/api.yaml` cùng lúc.

## Tiêu chí nghiệm thu backend

- [ ] Subscribe được `vending/+/heartbeat`.
- [ ] Nhận và parse đúng envelope `schemaVersion` 1.
- [ ] Từ chối message sai mã máy giữa topic và envelope.
- [ ] Message JSON lỗi không làm mất MQTT connection.
- [ ] Cập nhật `last_seen_at` bằng thời gian server nhận message.
- [ ] Lưu được thời gian heartbeat và các thông số chẩn đoán.
- [ ] Có scheduled job chuyển `ONLINE -> WARNING -> OFFLINE`.
- [ ] Không tạo log lặp khi trạng thái không thay đổi.
- [ ] Heartbeat mới đưa máy `OFFLINE` trở lại `ONLINE`.
- [ ] API quản trị trả được trạng thái và thông tin health.
- [ ] Có test cho message hợp lệ, message lỗi, duplicate message và timeout (dùng `api-contract/mqtt/examples/heartbeat.json`).

## Test thủ công trước khi có firmware

Publish nội dung `api-contract/mqtt/examples/heartbeat.json` (đổi mã máy thành máy test của bạn) vào
`vending/<mãMáy>/heartbeat` bằng tài khoản của máy đó. Backend luôn dùng thời điểm nhận thực tế.
