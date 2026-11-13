# Cảnh báo và thông báo (issue #58)

Backend tự phát hiện sự cố của máy và slot, tạo **một cảnh báo (alert) cho mỗi sự cố đang mở**, báo cho người có quyền
`ALERT_NOTIFY` trên portal, và tự đóng cảnh báo khi điều kiện hết. Nhân viên xem, xác nhận (acknowledge) và đóng (resolve) qua API.

```text
health check 60 s ─┐                       ┌─ alerts (một dòng chưa RESOLVED / dedupe_key)
sự kiện dispense ──┼─► AlertService.raise ─┤
FAULT / BOOT MQTT ─┘                       └─ AFTER_COMMIT ─► notifications (mỗi user ACTIVE có ALERT_NOTIFY)
```

## Nguồn cảnh báo

| Loại | Mức | Nguồn | dedupe_key | Tự đóng khi | Hành động máy |
| --- | --- | --- | --- | --- | --- |
| `MACHINE_OFFLINE` | WARNING | health check: kết nối OFFLINE (180 s, Last Will) | `MACHINE_OFFLINE:{machineId}` | máy ONLINE lại | — |
| `HIGH_TEMPERATURE` / `LOW_TEMPERATURE` | CRITICAL | health check: ngoài `temperature_min..max` liên tục ≥ 5 phút | `{TYPE}:{machineId}` | đọc trong ngưỡng | MAINTENANCE (chỉ khi cảnh báo mới) |
| `HIGH_HUMIDITY` | WARNING | health check: trên `humidity_max` liên tục ≥ 5 phút | `HIGH_HUMIDITY:{machineId}` | đọc trong ngưỡng | — |
| `LOW_STOCK` | WARNING | health check: slot ACTIVE còn ≤ 2 tô bán được | `LOW_STOCK:{slotId}` | nạp thêm / slot không ACTIVE | — |
| `PRODUCT_EXPIRING` | INFO | health check: slot có tô hết hạn trong 12 h | `PRODUCT_EXPIRING:{slotId}` | không còn tô như vậy | — |
| `PRODUCT_EXPIRED` | WARNING | health check: slot còn tô đã hết hạn | `PRODUCT_EXPIRED:{slotId}` | tô được gỡ | — |
| `DISPENSE_FAILED` | CRITICAL (unsafe) / WARNING (safe) | lệnh dispense FAILED/TIMEOUT (#52) | `DISPENSE_FAILED:{commandId}` | báo `DISPENSE_COMPLETED` muộn | MAINTENANCE do #52 |
| `HARDWARE_FAULT` | theo mã | `FAULT`, `BOOT` (WATCHDOG/PANIC/BROWNOUT), `MULTIPLE_BOWLS_DETECTED` | `HARDWARE_FAULT:{machineId}:{code}` | `FAULT_CLEARED` (chỉ `CONTROLLER_FAULT`) | MAINTENANCE cho SERVO_INIT_FAILED, GATE_POSITION_UNKNOWN, CONTROLLER_FAULT, IR_SENSOR_STUCK, IR_SENSOR_DISCONNECTED |

Mã lỗi và mức nằm trong [api-contract/mqtt-contract.md](../api-contract/mqtt-contract.md) §6. `FAULT` thiếu `code` hoặc mã sai dạng
thành `UNKNOWN_FAULT`; mã đúng dạng nhưng chưa có trong catalog vẫn tạo cảnh báo WARNING (firmware mới hơn backend).
Máy đã MAINTENANCE vẫn ở MAINTENANCE khi cảnh báo tự đóng: nhân viên kiểm tra rồi mới kích hoạt lại.

## Health check

- `MachineHealthCheckJob` chạy mỗi `app.health-check.interval` (mặc định 60 s, `fixedDelay`) trên máy ACTIVE và MAINTENANCE; máy
  INACTIVE bị bỏ qua.
- `pg_try_advisory_xact_lock` đảm bảo chỉ một lần chạy tại một thời điểm, kể cả nhiều instance; lần trùng bị bỏ qua.
- Mỗi máy chạy trong transaction riêng (REQUIRES_NEW): một máy lỗi được log và các máy khác vẫn được kiểm.
- Nhiệt độ/độ ẩm: chỉ đánh giá khi có reading trong 180 s gần nhất (không có thì `MACHINE_OFFLINE` lo). Đang có cảnh báo
  `TEMP_SENSOR_ERROR` thì bỏ qua nhiệt độ.
- Tồn kho dùng đúng quy tắc "bán được" của catalog (tô đầu cột, chưa hết hạn trước hạn giữ chỗ).

| Biến môi trường | Mặc định | Ý nghĩa |
| --- | --- | --- |
| `HEALTH_CHECK_ENABLED` | `true` | bật job (test tắt và gọi `MachineHealthCheckRunner.runOnce()`) |
| `HEALTH_CHECK_INTERVAL` | `PT60S` | khoảng giữa hai lần chạy |
| `ALERT_LOW_STOCK_THRESHOLD` | `2` | LOW_STOCK khi số tô bán được ≤ ngưỡng |
| `ALERT_EXPIRING_WITHIN` | `PT12H` | cửa sổ PRODUCT_EXPIRING |
| `ALERT_ENVIRONMENT_GRACE` | `PT5M` | thời gian vượt ngưỡng liên tục trước khi cảnh báo |

## Chống trùng và đồng thời

- `uq_alerts_open_dedupe (dedupe_key) WHERE status <> 'RESOLVED'`: `INSERT … ON CONFLICT DO NOTHING RETURNING id`. Chỉ cảnh báo
  thật sự mới mới gửi thông báo và đưa máy vào MAINTENANCE; MQTT gửi lại hoặc health check lặp không tạo gì thêm.
- Tự đóng: `UPDATE … WHERE dedupe_key = ? AND status <> 'RESOLVED'`, `resolved_by` NULL (API trả `"system"`), note `Condition cleared`.
- Đóng tay khóa dòng (PESSIMISTIC_WRITE): nếu hệ thống vừa đóng trước thì API trả 409, không bao giờ đóng hai lần.
- Đóng tay một cảnh báo trạng thái mà điều kiện vẫn còn: lần health check sau tạo cảnh báo mới.
- Lỗi khi tạo cảnh báo/thông báo được log và không làm hỏng xử lý MQTT hay dispense (listener AFTER_COMMIT, try/catch).

## Thông báo

Mỗi cảnh báo mới → một `notifications` cho mỗi user ACTIVE có `ALERT_NOTIFY` (mặc định ADMIN), một câu `INSERT … SELECT` có chặn
trùng. Portal poll `GET /api/v1/notifications/me/unread-count` mỗi 30 s. User chỉ thấy và đánh dấu thông báo của mình; id của người
khác là 404. Kiosk key không phải user: 401.

## API

| Method | Path | Quyền | Ghi chú |
| --- | --- | --- | --- |
| GET | `/api/v1/alerts` | `ALERT_READ` | mặc định OPEN + ACKNOWLEDGED; lọc status, type, severity, machineId, slotId, errorCode, from/to; CRITICAL → WARNING → INFO rồi mới nhất; size ≤ 200 |
| GET | `/api/v1/alerts/{id}` | `ALERT_READ` | |
| POST | `/api/v1/alerts/{id}/acknowledge` | `ALERT_MANAGE` | lặp lại trả nguyên; RESOLVED → 409 |
| POST | `/api/v1/alerts/{id}/resolve` | `ALERT_MANAGE` | body tùy chọn `{"note": "..."}` ≤ 500 ký tự; RESOLVED → 409 |
| GET | `/api/v1/notifications/me` | đã đăng nhập | `unreadOnly`, size ≤ 100 |
| GET | `/api/v1/notifications/me/unread-count` | đã đăng nhập | |
| POST | `/api/v1/notifications/{id}/read` | đã đăng nhập | idempotent (`marked` 0 khi đã đọc) |
| POST | `/api/v1/notifications/me/read-all` | đã đăng nhập | |

Cảnh báo không được tạo hay xóa qua API. Từ issue #66, Admin tạo work order từ cảnh báo (`POST /api/v1/alerts/{alertId}/work-orders`); response cảnh báo có `workOrderId` / `workOrderCode` và thông báo có `workOrderId` ([work-orders.md](work-orders.md)). Hợp đồng đầy đủ: `api-contract/api.yaml` (tag Alerts, Notifications).

## Schema (V17)

`alerts`: thêm `slot_id` (FK ghép `(slot_id, machine_id)` → `machine_slots`), `error_code` (CHECK `^[A-Z][A-Z0-9_]{1,63}$`),
`dedupe_key` NOT NULL (dòng cũ: `LEGACY:{id}`), `acknowledged_at/by`, `resolution_note`; loại `HARDWARE_FAULT`.
Bảng mới `notifications` (user, alert, title, message, severity, read_at, created_at). Quyền `ALERT_READ`, `ALERT_MANAGE`
(ADMIN, STAFF), `ALERT_NOTIFY` (ADMIN). Chi tiết: [database-migration.md](database-migration.md).

## Kiểm thử

`AlertIntegrationTest` (health check với clock dịch được, sự kiện dispense/FAULT/BOOT, thông báo, API, race đóng tay/hệ thống),
`AlertNotificationDocumentationTest` (Swagger = api.yaml).
