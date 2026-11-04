# Backend implementation: machine health and heartbeat

## Mục tiêu

Backend cần biết:

1. Máy còn kết nối MQTT và firmware còn chạy hay không.
2. Máy có gửi heartbeat đều đặn hay đã mất kết nối.
3. Lần cuối backend nhận được thông tin từ máy là khi nào.
4. Trạng thái máy trên trang quản trị là `ONLINE`, `WARNING` hay `OFFLINE`.

Phần firmware sẽ được triển khai trước. Backend cần chuẩn bị sẵn contract dưới
đây để nhận heartbeat khi firmware được cập nhật.

## MQTT topic

MQTT topic root hiện tại là `vending`.

```text
vending/{machineCode}/status
vending/{machineCode}/heartbeat
vending/{machineCode}/events
```

Backend subscribe bằng wildcard:

```text
vending/+/status
vending/+/heartbeat
vending/+/events
```

Backend không được tin tưởng `machineCode` chỉ từ payload. Mã máy trong topic
và payload phải giống nhau.

## Envelope bắt buộc

Mọi message từ firmware dùng envelope:

```json
{
  "schemaVersion": 1,
  "messageId": "a1b2c3d4-1",
  "machineCode": "FV-DEV-001",
  "payload": {}
}
```

Quy tắc:

- `schemaVersion` phải là `1`.
- `messageId` phải tồn tại nếu backend cần chống xử lý trùng.
- `machineCode` phải trùng với `{machineCode}` trong topic.
- JSON sai, thiếu object `payload` hoặc sai machine code phải bị bỏ qua và ghi
  log; không được làm MQTT consumer dừng.
- Thời gian dùng để tính health là thời gian backend nhận message
  (`receivedAt`/`Instant.now()`), không dùng timestamp từ ESP32.

## Status message

### Khi máy kết nối MQTT thành công

Topic:

```text
vending/FV-DEV-001/status
```

Payload:

```json
{
  "state": "ONLINE",
  "firmwareVersion": "0.3.0",
  "uptimeSeconds": 12
}
```

### Khi mất kết nối đột ngột

Firmware dùng MQTT Last Will để broker phát message:

```json
{
  "schemaVersion": 1,
  "messageId": "lwt-...",
  "machineCode": "FV-DEV-001",
  "payload": {
    "state": "OFFLINE"
  }
}
```

Last Will chỉ là tín hiệu bổ sung. Backend vẫn phải có timeout dựa trên
heartbeat vì Last Will có thể đến trễ hoặc không có trong một số trường hợp.

## Heartbeat message

Firmware sẽ gửi heartbeat định kỳ, dự kiến mỗi 30 giây.

Topic:

```text
vending/FV-DEV-001/heartbeat
```

Payload tối thiểu:

```json
{
  "state": "ONLINE",
  "uptimeSeconds": 12345,
  "wifiRssi": -55,
  "freeHeap": 18240,
  "firmwareVersion": "0.3.0"
}
```

Các field:

| Field | Kiểu | Bắt buộc | Ý nghĩa |
|---|---|---:|---|
| `state` | string | Có | Trạng thái firmware, thường là `ONLINE` |
| `uptimeSeconds` | long | Có | Số giây từ lần ESP32 khởi động |
| `wifiRssi` | integer | Không | Cường độ Wi-Fi, đơn vị dBm |
| `freeHeap` | long | Không | Heap còn trống trên ESP32 |
| `firmwareVersion` | string | Có | Phiên bản firmware |

Không được coi `wifiRssi`, `freeHeap` hoặc field chẩn đoán bị thiếu là `0`.
Nếu field không có, lưu `null`.

## Dữ liệu cần lưu

Có thể mở rộng bảng `machines` hiện tại hoặc tạo bảng telemetry riêng. Tối
thiểu bảng `machines` cần có:

| Column | Kiểu đề xuất | Ý nghĩa |
|---|---|---|
| `last_seen_at` | `timestamptz nullable` | Lần cuối nhận status, heartbeat hoặc event hợp lệ |
| `last_status_at` | `timestamptz nullable` | Lần cuối nhận status |
| `last_heartbeat_at` | `timestamptz nullable` | Lần cuối nhận heartbeat |
| `health_status` | enum/string | `ONLINE`, `WARNING`, `OFFLINE` |
| `last_heartbeat_uptime_seconds` | bigint nullable | Uptime từ heartbeat gần nhất |
| `last_wifi_rssi` | integer nullable | RSSI gần nhất |
| `last_free_heap` | bigint nullable | Heap gần nhất |
| `firmware_version` | varchar nullable | Firmware gần nhất |
| `last_error` | varchar nullable | Lỗi gần nhất nếu có |

Project hiện đã có `machines.last_seen_at`; không thay đổi ý nghĩa field này.
Mọi message hợp lệ từ máy đều phải cập nhật `last_seen_at`.

Nếu cần lưu lịch sử để điều tra:

```text
machine_events
- id
- machine_id
- event_type
- payload_json
- received_at
```

Không lưu password MQTT hoặc thông tin credential vào payload, database log hay
response API.

## Quy tắc cập nhật message

### Khi nhận `status`

1. Validate envelope và machine code.
2. Tìm machine theo `machineCode`.
3. Cập nhật `last_seen_at` và `last_status_at` bằng server time.
4. Nếu `state = ONLINE`, cập nhật `health_status = ONLINE`.
5. Nếu `state = OFFLINE`, cập nhật trạng thái kết nối tương ứng và ghi log
   chuyển trạng thái.
6. Cập nhật `firmware_version` và `uptime` nếu payload có field.

### Khi nhận `heartbeat`

1. Validate envelope và machine code.
2. Cập nhật `last_seen_at` và `last_heartbeat_at` bằng server time.
3. Cập nhật các field chẩn đoán có trong payload.
4. Chuyển `health_status` về `ONLINE`.
5. Nếu trạng thái trước đó là `OFFLINE` hoặc `WARNING`, ghi log máy đã khôi
   phục.

### Khi nhận `events`

Các event dispense hiện tại gồm:

```text
DISPENSE_ACCEPTED
DISPENSE_REJECTED
DISPENSE_COMPLETED
DISPENSE_ABORTED
BOWL_SENSOR_TRIGGERED
```

Mỗi event hợp lệ cũng cập nhật `last_seen_at`. Event `DISPENSE_ABORTED`,
`DISPENSE_REJECTED` hoặc event lỗi cần được lưu để backend có thể hiển thị
nguyên nhân.

## Phát hiện máy mất kết nối

Tạo scheduled job chạy mỗi 30 hoặc 60 giây. Ngưỡng nên cấu hình bằng
environment variable, ví dụ:

```text
MACHINE_HEALTH_WARNING_AFTER=PT60S
MACHINE_HEALTH_OFFLINE_AFTER=PT180S
MACHINE_HEALTH_SWEEP_INTERVAL=PT30S
```

Quy tắc:

```text
Không có last_seen_at                 => UNKNOWN hoặc OFFLINE theo chính sách UI
now - last_seen_at <= 60 giây         => ONLINE
60 giây < now - last_seen_at <= 180s  => WARNING
now - last_seen_at > 180 giây         => OFFLINE
```

Job phải:

- Chỉ ghi log khi trạng thái thực sự thay đổi, không log lặp mỗi lần sweep.
- Không ghi đè trạng thái vận hành như `MAINTENANCE` nếu hệ thống đang dùng
  status đó cho nghiệp vụ; nên tách `health_status` khỏi `MachineStatus`.
- Khi nhận heartbeat mới sau `OFFLINE`, chuyển về `ONLINE` và ghi thời điểm
  recovery.
- Xử lý theo batch nếu số lượng máy lớn.

## API cho web quản trị

API hiện tại cần trả thêm thông tin health trong response machine, ví dụ:

```json
{
  "code": "FV-DEV-001",
  "name": "Fruit Machine 01",
  "status": "ACTIVE",
  "healthStatus": "ONLINE",
  "lastSeenAt": "2026-11-04T00:00:00Z",
  "lastHeartbeatAt": "2026-11-04T00:00:00Z",
  "uptimeSeconds": 12345,
  "wifiRssi": -55,
  "freeHeap": 18240,
  "firmwareVersion": "0.3.0"
}
```

`lastSeenAt`, `lastHeartbeatAt`, `uptimeSeconds`, `wifiRssi` và `freeHeap` có
thể là `null` nếu máy chưa từng gửi heartbeat.

## Tiêu chí nghiệm thu backend

- [ ] Subscribe được `vending/+/heartbeat`.
- [ ] Nhận và parse đúng envelope version `1`.
- [ ] Từ chối message sai machine code giữa topic và payload.
- [ ] Message JSON lỗi không làm mất MQTT connection.
- [ ] Cập nhật `last_seen_at` bằng thời gian server nhận message.
- [ ] Lưu được thời gian heartbeat và các thông số chẩn đoán.
- [ ] Có scheduled job chuyển `ONLINE -> WARNING -> OFFLINE`.
- [ ] Không tạo log lặp khi trạng thái không thay đổi.
- [ ] Heartbeat mới đưa máy `OFFLINE` trở lại `ONLINE`.
- [ ] API quản trị trả được trạng thái và thông tin health.
- [ ] Có test cho message hợp lệ, message lỗi, duplicate message và timeout.

## Lưu ý khi tích hợp với firmware

Hiện tại firmware đã gửi `status` và `events`. Heartbeat sẽ được bổ sung ở
phần firmware riêng. Vì vậy backend nên triển khai consumer và schema theo tài
liệu này nhưng không được giả định rằng heartbeat đã xuất hiện ngay khi chạy
local.

Để test backend trước khi firmware hoàn tất, có thể publish thủ công một
envelope heartbeat hợp lệ vào:

```text
vending/FV-DEV-001/heartbeat
```

Không dùng timestamp của message test để tính offline; backend phải dùng thời
điểm nhận thực tế.
